"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus, Save, Trash2, Users } from "lucide-react";
import { Button } from "@/components/shared/Button";
import {
  EMPTY_STAFFING_LINE,
  MissingDatesBadge,
  StaffingLineFields,
  type StaffingLineFormValue,
} from "@/components/strategic/StaffingLineFields";
import { PendingApprovalBadge } from "@/components/strategic/PendingApprovalBadge";
import {
  deleteChantierStaffing,
  saveChantierStaffing,
  subscribeChantierStaffing,
} from "@/lib/firestore/chantierStaffing";
import { colorForDepartment } from "@/lib/axisLogic";
import { todayISO } from "@/lib/dateUtils";
import { useCompanyDepartments } from "@/lib/hooks/useCompanyDepartments";
import { useApprovalErrorToast } from "@/lib/hooks/useApprovalErrorToast";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { isReadOnlyUser } from "@/lib/roleProfiles";
import { directGate, newStaffingId, staffingFlow } from "@/lib/strategicApprovalFlows";
import {
  canEditStaffing,
  isPilotOrAdmin,
  type StaffingOp,
  type StaffingUpdateApprovalPayload,
  type StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import {
  approvalErrorKind,
  pendingStaffingCreations,
  pendingStaffingForLine,
} from "@/lib/strategicApprovalUi";
import { chainLabel, fillTemplate, flowOutcomeMessage } from "@/lib/strategicFiche";
import {
  isStaffingLineMissingDates,
  parseFte,
  validateStaffingLine,
} from "@/lib/staffingLineValidation";
import type { AuthUser, Chantier, ChantierAction, ChantierStaffing, StrategicAxis } from "@/types";

/**
 * Bloc « ETP mobilisés » d'une fiche chantier : la liste des lignes de staffing du chantier
 * (une équipe + un volume d'ETP par ligne) et le mini-formulaire d'ajout/édition.
 *
 * Volontairement AUTONOME — il ne reçoit que les quatre identifiants de son contexte et gère
 * lui-même son abonnement Firestore et ses écritures. Motif : il est rendu à l'intérieur de la
 * pop-up de détail chantier (`components/strategic/AxisDetailClient.tsx`), qui est déjà un gros
 * composant à état ; y faire remonter une sixième collection et deux mutations de plus l'aurait
 * alourdi sans bénéfice, alors que le volume de données concerné (quelques lignes par chantier)
 * ne justifie aucune mutualisation d'abonnement. Même chose pour `useCompanyDepartments`
 * (round 13) : léger abonnement supplémentaire, mais garde le composant capable de fonctionner
 * seul sans dépendre d'un pré-chargement fait par l'appelant.
 *
 * Round 13 : le sélecteur d'équipe liste les départements RÉELS de la base ETP entreprise
 * (`useCompanyDepartments`, Plan Performance) — voir la note de tête de section `ChantierStaffing`
 * dans `types/index.ts`.
 *
 * Round 28 : vrai `<table>` — une personne = une ligne, colonnes Personne/Précision, Équipe, Début,
 * Fin, Taux ETP, et Projet quand pertinent. Gagne aussi `scopedToActionId` : rendu une SECONDE fois
 * directement sur la carte d'un projet/levier précis — voir `ChantierDetailPanel.tsx`. Depuis la
 * règle PO « ETP gérés au niveau chantier », cette instance scopée est en LECTURE SEULE avec un lien
 * vers l'onglet "Effectifs" (seul point d'ajout/édition/suppression après création du projet ; la
 * création initiale passe par `StaffingDraftTable.tsx`, l'import en lot par l'Excel).
 *
 * Règles de saisie (retour PO) : équipe JAMAIS pré-remplie (« À définir », choix obligatoire),
 * ETP vide par défaut et obligatoire (> 0, virgule acceptée), dates de début ET de fin obligatoires
 * (fin ≥ début), avertissement non bloquant si hors période du projet — voir
 * `lib/staffingLineValidation.ts` (partagé avec `StaffingDraftTable.tsx`). Une ligne existante peut
 * désormais être MODIFIÉE en place (crayon, ou badge « Dates à compléter » pour les lignes
 * historiques sans dates) : le formulaire se recharge avec ses valeurs et exige les mêmes règles.
 */

/*
 * Validation (règle PO « staffing = pilotage ») : droits par ligne via `canEditStaffing` (ligne
 * chantier → sponsor de chantier et au-dessus ; ligne projet → responsable projet et au-dessus ;
 * comex/RH jamais) ; toute écriture passe par `staffingFlow` — pilote/admin appliquent directement,
 * les autres créent une demande à 2 paliers (badge « en attente » sur la ligne, ajouts en attente
 * listés sous le tableau). Sans droit : lecture seule.
 */

/** Ré-export (compat) : la règle vit désormais dans `lib/staffingLineValidation.ts`, partagée avec
 *  `StaffingDraftTable.tsx` et testée unitairement. */
export { parseFte };

/** Formatage court : 1 et non 1.0, 0,5 et non 0.5 (locale d'affichage du navigateur). */
export function formatFte(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

const SELECT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

export function ChantierStaffingEditor({
  companyId,
  programId,
  chantierId,
  chantierActions,
  scopedToActionId,
  onManageInStaffingTab,
  focusRequest,
  chantier,
  axes = [],
  users = [],
}: {
  companyId: string;
  programId: string;
  chantierId: string;
  /** Leviers du chantier (round 7) — univers du sélecteur optionnel « levier concerné » ci-dessous.
   *  Un staffing transverse au chantier reste possible en laissant le sélecteur vide. Sert aussi à
   *  retrouver les dates du projet sélectionné (avertissement « hors période »). */
  chantierActions: ChantierAction[];
  /** Scope optionnel à UN projet précis (`ChantierAction.id`) — filtre les lignes affichées à
   *  celles dont `actionId` correspond et cache la colonne "Projet" (redondante dans ce contexte).
   *  Règle PO : une fois le projet créé, sa fiche n'ajoute/modifie/supprime PLUS de ligne ETP —
   *  en mode scopé ce composant est donc TOUJOURS en lecture seule (pas de formulaire, pas de
   *  crayon/corbeille, badge « Dates à compléter » non cliquable). L'onglet "Effectifs" du chantier
   *  (instance non scopée) est l'unique point de saisie après création. */
  scopedToActionId?: string;
  /** Mode scopé uniquement : bascule vers l'onglet "Effectifs" du chantier (lien « Gérer les ETP
   *  dans l'onglet Effectifs du chantier »). Absent = pas de lien. */
  onManageInStaffingTab?: () => void;
  /** Mode non scopé (onglet "Effectifs") : demande de mise en avant d'un projet, émise depuis la
   *  fiche projet. Chaque nouvelle `key` pré-sélectionne ce projet dans le formulaire d'ajout
   *  (toujours modifiable) et surligne ses lignes. */
  focusRequest?: { actionId: string; key: number };
  /** Chantier (sponsor, axes) — droits `canEditStaffing`. Absent : seuls pilote/admin éditent. */
  chantier?: Pick<Chantier, "id" | "name" | "programId" | "pilote" | "axisIds">;
  /** Axes du programme (reconnaît les sponsors d'axe du chantier). */
  axes?: Pick<StrategicAxis, "id" | "owner">[];
  /** Utilisateurs (noms affichés des valideurs). */
  users?: AuthUser[];
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { user } = useRole();
  const sa = useStrategicApprovalsApi();
  const toastApprovalError = useApprovalErrorToast();
  const scoped = !!scopedToActionId;
  const baseReadOnly = isReadOnlyUser(user, programId, "strategic") || scoped;
  const focusActionId = !scoped ? focusRequest?.actionId : undefined;

  const { departmentNames } = useCompanyDepartments(companyId);

  const [all, setAll] = useState<ChantierStaffing[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<StaffingLineFormValue>(EMPTY_STAFFING_LINE);
  // Pré-rempli (pas verrouillé) sur le projet mis en avant depuis sa fiche — voir l'effet
  // `focusRequest` ci-dessous.
  const [actionDraft, setActionDraft] = useState(focusActionId ?? "");
  /** Ligne en cours de modification (`null` = mode ajout). */
  const [editing, setEditing] = useState<ChantierStaffing | null>(null);
  /** Change à chaque réinitialisation du formulaire → remonte `StaffingLineFields` (état « touché »). */
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);

  // Nouvelle demande de mise en avant (clic « Gérer les ETP… » sur une fiche projet) : pré-sélection
  // du projet dans le formulaire d'ajout, sauf si une ligne est en cours de modification (on
  // n'écrase pas une saisie en cours).
  const focusKey = focusRequest?.key;
  useEffect(() => {
    if (!focusActionId || editing) return;
    setActionDraft(focusActionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché par la seule `key`
  }, [focusKey]);

  const actionById = useMemo(
    () => new Map(chantierActions.map((a) => [a.id, a])),
    [chantierActions]
  );

  // Abonnement scopé entreprise côté serveur (comme toutes les collections stratégiques) ; le
  // filtrage chantier/programme est appliqué ci-dessous côté client.
  useEffect(() => {
    if (!companyId) {
      setAll([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeChantierStaffing(companyId, (entries) => {
      setAll(entries);
      setLoading(false);
    });
    return unsub;
  }, [companyId]);

  const entries = useMemo(
    () =>
      all
        .filter(
          (e) =>
            e.chantierId === chantierId &&
            e.programId === programId &&
            (!scopedToActionId || e.actionId === scopedToActionId)
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)),
    [all, chantierId, programId, scopedToActionId]
  );

  const totalFte = entries.reduce((sum, e) => sum + (e.fte || 0), 0);

  // Colonne "Projet" redondante en mode scopé (toutes les lignes affichées appartiennent déjà au
  // même projet) — et sans intérêt sur un chantier qui n'a aucun levier (`chantierActions` vide).
  const showProjetColumn = !scopedToActionId && chantierActions.length > 0;

  // ── Droits (canEditStaffing) ────────────────────────────────────────────────────────────────
  const canEditChantierLines =
    !baseReadOnly &&
    (chantier ? canEditStaffing(user, chantier, null, axes) : isPilotOrAdmin(user, programId));
  const canEditProjetLines = (actionId: string) => {
    if (baseReadOnly) return false;
    const projet = actionById.get(actionId);
    if (!chantier || !projet) return isPilotOrAdmin(user, programId);
    return canEditStaffing(user, chantier, projet, axes);
  };
  const canEditLine = (entry: Pick<ChantierStaffing, "actionId">) =>
    entry.actionId ? canEditProjetLines(entry.actionId) : canEditChantierLines;
  /** Projets dont l'utilisateur peut saisir les lignes (sélecteur du formulaire). */
  const editableActions = chantierActions.filter((a) => canEditProjetLines(a.id));
  const readOnly = !canEditChantierLines && editableActions.length === 0;
  const pendingCreations = scoped
    ? []
    : pendingStaffingCreations(sa?.approvals, chantierId).filter(
        (a) => (a.payload as StaffingUpdateApprovalPayload).line?.programId === programId
      );
  const gate = sa ?? directGate(user, programId);
  const chainJoiner = t("strategicFiche.chain.then", "puis");

  const selectedAction = actionDraft ? actionById.get(actionDraft) : undefined;
  const validation = validateStaffingLine(
    form,
    selectedAction ? { start: selectedAction.start, end: selectedAction.end } : null
  );

  const resetForm = () => {
    setForm(EMPTY_STAFFING_LINE);
    setEditing(null);
    // Retombe sur le projet mis en avant (pas sur vide) quand l'onglet a été ouvert depuis la
    // fiche d'un projet précis.
    setActionDraft(focusActionId ?? "");
    setFormKey((k) => k + 1);
  };

  const startEdit = (entry: ChantierStaffing) => {
    setEditing(entry);
    setForm({
      team: entry.function ?? "",
      fte: entry.fte ? String(entry.fte).replace(".", ",") : "",
      note: entry.note ?? "",
      startDate: entry.startDate ?? "",
      endDate: entry.endDate ?? "",
    });
    setActionDraft(entry.actionId ?? "");
    setFormKey((k) => k + 1);
  };

  /** Écrit une ligne via `staffingFlow` (direct pilote/admin, sinon demande à 2 paliers). */
  const runStaffing = async (
    op: StaffingOp,
    line: ChantierStaffing,
    before: ChantierStaffing | undefined,
    applyDirect: () => Promise<unknown>
  ): Promise<boolean> => {
    const projet = line.actionId ? actionById.get(line.actionId) : undefined;
    const targetName = projet?.name ?? chantier?.name;
    const target: StrategicApprovalTarget = line.actionId
      ? { type: "projet", id: line.actionId, name: targetName }
      : { type: "chantier", id: line.chantierId, name: targetName };
    const payload: StaffingUpdateApprovalPayload = {
      op,
      line,
      ...(op !== "create" ? { before: before ?? line } : {}),
    };
    try {
      const preview = sa ? sa.previewChain("staffing_update", target, payload) : [];
      const outcome = await staffingFlow(gate, { op, line, before, targetName }, applyDirect);
      if (outcome === "pending") {
        const message = flowOutcomeMessage(
          { outcome },
          users,
          {
            applied: t("strategicFiche.toast.applied", "Appliqué"),
            pending: t("strategicFiche.toast.pending", "Envoyé en validation : {chain}"),
            partial: t("strategicFiche.toast.pending", "Envoyé en validation : {chain}"),
            joiner: chainJoiner,
          },
          preview
        );
        if (message) showToast(message, line.function || targetName, "success");
      }
      return true;
    } catch (error) {
      if (approvalErrorKind(error) !== "other") toastApprovalError(error);
      else showToast(t("staffing.saveError"), "", "error");
      return false;
    }
  };

  /** Aperçu « Sera validé par … » de la saisie en cours (vide = application directe). */
  const submitPreview = (() => {
    if (!sa || readOnly) return "";
    const projetId = actionDraft || undefined;
    const draftLine: ChantierStaffing = {
      id: editing?.id ?? "preview",
      companyId,
      programId,
      chantierId,
      createdAt: todayISO(),
      function: form.team,
      fte: validation.fte ?? 0,
      ...(projetId ? { actionId: projetId } : {}),
    };
    const target: StrategicApprovalTarget = projetId
      ? { type: "projet", id: projetId }
      : { type: "chantier", id: chantierId };
    const label = chainLabel(
      sa.previewChain("staffing_update", target, {
        op: editing ? "update" : "create",
        line: draftLine,
        ...(editing ? { before: editing } : {}),
      }),
      users,
      chainJoiner
    );
    return label
      ? fillTemplate(t("strategicFiche.chain.preview", "Sera validé par {chain}"), {
          chain: label,
        })
      : "";
  })();

  const submit = async () => {
    if (!validation.valid || validation.fte === null) return;
    const note = form.note.trim();
    const base: ChantierStaffing = editing
      ? {
          id: editing.id,
          companyId: editing.companyId,
          programId: editing.programId,
          chantierId: editing.chantierId,
          createdAt: editing.createdAt,
          function: "",
          fte: 0,
        }
      : {
          id: newStaffingId(),
          companyId,
          programId,
          chantierId,
          createdAt: todayISO(),
          function: "",
          fte: 0,
        };
    // `setDoc` remplace le document : un champ optionnel vidé en édition est bien retiré.
    // Champs optionnels OMIS plutôt que passés à `undefined` : Firestore rejette `undefined`.
    const line: ChantierStaffing = {
      ...base,
      function: form.team,
      fte: validation.fte,
      startDate: form.startDate.trim(),
      endDate: form.endDate.trim(),
      ...(note !== "" ? { note } : {}),
      ...(actionDraft !== "" ? { actionId: actionDraft } : {}),
    };
    // Ligne projet : le projet choisi doit être dans le périmètre de l'utilisateur ; ligne
    // chantier : droit chantier requis (le sélecteur ne propose déjà que ces options).
    if (!canEditLine(line)) return;
    setSaving(true);
    try {
      const ok = await runStaffing(editing ? "update" : "create", line, editing ?? undefined, () =>
        saveChantierStaffing(line)
      );
      if (ok) resetForm();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: ChantierStaffing) => {
    const ok = await runStaffing("delete", entry, entry, () => deleteChantierStaffing(entry.id));
    if (ok && editing?.id === entry.id) resetForm();
  };

  return (
    <div className="rounded-md border border-border bg-neutral-50/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-secondary">
          <Users size={13} /> {t("staffing.title")}
        </span>
        <span className="text-[11px] text-tertiary">
          {t("staffing.total")} : <strong className="text-primary">{formatFte(totalFte)}</strong>{" "}
          {t("staffing.fteUnit")}
        </span>
      </div>

      {loading ? (
        <p className="text-[12px] text-tertiary">{t("staffing.loading")}</p>
      ) : entries.length === 0 ? (
        <p className="text-[12px] text-tertiary">
          {scoped
            ? t("staffing.emptyProjet", "Aucun ETP déclaré sur ce projet.")
            : t("staffing.empty")}
        </p>
      ) : (
        <div className="mb-3 overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[560px] text-left text-[12px]">
            <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-secondary">
              <tr>
                <th className="px-2.5 py-2">{t("staffing.columnPerson", "Personne/Précision")}</th>
                <th className="px-2.5 py-2">{t("staffing.function")}</th>
                <th className="px-2.5 py-2">{t("staffing.startDate")}</th>
                <th className="px-2.5 py-2">{t("staffing.endDate")}</th>
                <th className="px-2.5 py-2 text-right">{t("staffing.columnFte", "Taux ETP")}</th>
                {showProjetColumn && (
                  <th className="px-2.5 py-2">{t("staffing.columnProjet", "Projet")}</th>
                )}
                {!readOnly && <th className="px-2.5 py-2" aria-hidden />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {entries.map((entry) => {
                const pendingLine = pendingStaffingForLine(sa?.approvals, entry.id);
                const lineEditable = canEditLine(entry) && !pendingLine;
                return (
                  <tr
                    key={entry.id}
                    className={`text-primary ${
                      editing?.id === entry.id
                        ? "bg-bp-coral/5"
                        : focusActionId && entry.actionId === focusActionId
                          ? "bg-rag-amber-light/70"
                          : "bg-white"
                    }`}
                  >
                    <td className="px-2.5 py-1.5 font-medium">
                      {entry.note || "—"}
                      {pendingLine && (
                        <PendingApprovalBadge
                          approval={pendingLine}
                          users={users}
                          className="ml-1.5 align-middle"
                        />
                      )}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className={`h-2 w-2 shrink-0 rounded-full ${colorForDepartment(entry.function)}`}
                        />
                        {entry.function || t("staffing.teamPlaceholder", "À définir")}
                      </span>
                    </td>
                    {isStaffingLineMissingDates(entry) ? (
                      // Données antérieures à la règle « dates obligatoires » : un seul badge sur
                      // les deux colonnes plutôt qu'une date partielle — clic = édition de la ligne.
                      <td colSpan={2} className="px-2.5 py-1.5 text-tertiary">
                        <MissingDatesBadge
                          onClick={lineEditable ? () => startEdit(entry) : undefined}
                        />
                      </td>
                    ) : (
                      <>
                        <td className="px-2.5 py-1.5 text-tertiary">{entry.startDate}</td>
                        <td className="px-2.5 py-1.5 text-tertiary">{entry.endDate}</td>
                      </>
                    )}
                    <td className="px-2.5 py-1.5 text-right font-semibold">
                      {formatFte(entry.fte || 0)} {t("staffing.fteUnit")}
                    </td>
                    {showProjetColumn && (
                      <td className="px-2.5 py-1.5 text-tertiary">
                        {entry.actionId
                          ? (actionById.get(entry.actionId)?.name ?? t("staffing.actionNone"))
                          : "—"}
                      </td>
                    )}
                    {!readOnly && (
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                        {lineEditable && (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(entry)}
                              aria-label={t("staffing.edit", "Modifier cette ligne")}
                              title={t("staffing.edit", "Modifier cette ligne")}
                              className="rounded p-1 text-tertiary transition hover:bg-neutral-100 hover:text-primary"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => remove(entry)}
                              aria-label={t("staffing.remove")}
                              title={t("staffing.remove")}
                              className="rounded p-1 text-tertiary transition hover:bg-neutral-100 hover:text-bp-coral"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pendingCreations.length > 0 && (
        <ul className="mb-3 space-y-1">
          {pendingCreations.map((a) => {
            const line = (a.payload as StaffingUpdateApprovalPayload).line;
            return (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-1.5 rounded-md border border-dashed border-border bg-white px-2 py-1 text-[12px] text-secondary"
              >
                <span className="font-medium text-primary">{line.note || line.function}</span>
                <span>
                  {line.function} · {formatFte(line.fte || 0)} {t("staffing.fteUnit")}
                  {line.actionId ? ` · ${actionById.get(line.actionId)?.name ?? ""}` : ""}
                </span>
                <span className="text-[10.5px] italic">
                  {t("strategicFiche.staffing.pendingCreation", "Ajout en attente de validation")}
                </span>
                <PendingApprovalBadge approval={a} users={users} className="ml-auto" />
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (
        <>
          {editing && (
            <p className="mb-2 text-[11px] font-semibold text-secondary">
              {isStaffingLineMissingDates(editing)
                ? t(
                    "staffing.editingMissingDates",
                    "Modification de la ligne — complétez les dates de début et de fin."
                  )
                : t("staffing.editing", "Modification de la ligne")}
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <StaffingLineFields
              key={formKey}
              value={form}
              onChange={setForm}
              validation={validation}
              departmentNames={departmentNames}
              showAllErrors={editing !== null}
              extraFields={
                <label className="block text-[11px] font-medium text-secondary">
                  {t("staffing.action")}
                  <select
                    value={actionDraft}
                    onChange={(e) => setActionDraft(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {canEditChantierLines ? (
                      <option value="">{t("staffing.actionNone")}</option>
                    ) : (
                      <option value="" disabled>
                        {t("strategicFiche.staffing.chooseProjet", "Choisir un projet")}
                      </option>
                    )}
                    {editableActions.map((action) => (
                      <option key={action.id} value={action.id}>
                        {action.name}
                      </option>
                    ))}
                  </select>
                </label>
              }
            />
            <div className="flex items-end gap-1.5 sm:flex-col sm:justify-end">
              {editing && (
                <Button variant="ghost" size="sm" onClick={resetForm} disabled={saving}>
                  {t("common.cancel", "Annuler")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={submit}
                disabled={
                  saving ||
                  departmentNames.length === 0 ||
                  !validation.valid ||
                  !canEditLine({ actionId: actionDraft || undefined })
                }
              >
                {editing ? <Save size={12} /> : <Plus size={12} />}{" "}
                {editing ? t("staffing.saveEdit", "Enregistrer") : t("staffing.add")}
              </Button>
            </div>
          </div>
        </>
      )}
      {!readOnly && submitPreview && (
        <p className="mt-1.5 rounded-md border border-rag-amber-light bg-rag-amber-light/30 px-2 py-1 text-[11.5px] font-medium text-text-secondary">
          {submitPreview}
        </p>
      )}
      {!readOnly && <p className="mt-1.5 text-[11px] text-tertiary">{t("staffing.hint")}</p>}
      {scoped && onManageInStaffingTab && (
        <button
          type="button"
          onClick={onManageInStaffingTab}
          className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-bp-coral hover:underline"
        >
          <ExternalLink size={12} />
          {t("staffing.manageInStaffingTab", "Gérer les ETP dans l'onglet Effectifs du chantier")}
        </button>
      )}
    </div>
  );
}
