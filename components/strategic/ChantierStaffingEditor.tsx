"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/shared/Button";
import {
  deleteChantierStaffing,
  saveChantierStaffing,
  subscribeChantierStaffing,
} from "@/lib/firestore/chantierStaffing";
import { colorForDepartment } from "@/lib/axisLogic";
import { useCompanyDepartments } from "@/lib/hooks/useCompanyDepartments";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { isReadOnlyUser } from "@/lib/roleProfiles";
import type { ChantierAction, ChantierStaffing } from "@/types";

/**
 * Bloc « ETP mobilisés » d'une fiche chantier : la liste des lignes de staffing du chantier
 * (une équipe + un volume d'ETP par ligne) et le mini-formulaire d'ajout.
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
 * Édition : ajout + suppression seulement, pas de modification en place — une ligne n'a que deux
 * champs signifiants, la corriger revient à la ressaisir (même parti pris que
 * `useStrategicData.createStaffing`, qui n'expose pas non plus d'`updateStaffing`).
 *
 * Round 13 : le sélecteur d'équipe listait auparavant 9 fonctions figées (`StaffingFunction`,
 * retirée de `types/index.ts`) ; il liste désormais les départements RÉELS de la base ETP
 * entreprise (`useCompanyDepartments`, Plan Performance) — voir la note de tête de section
 * `ChantierStaffing` dans `types/index.ts` pour le raisonnement complet. Une entreprise sans base
 * ETP encore saisie n'a aucune option : le champ reste vide plutôt que de retomber sur un
 * référentiel arbitraire.
 *
 * Round 28 : la liste plate (un `<li>` par ligne, champs concaténés avec "·") est devenue un vrai
 * `<table>` — une personne = une ligne, colonnes Personne/Précision, Équipe, Début, Fin, Taux ETP,
 * et Projet quand pertinent (même convention de tableau que `StaffingDetailModal.tsx` :
 * `overflow-x-auto rounded-md border` + `<thead className="bg-neutral-50 ...">`). Gagne aussi
 * `scopedToActionId` : rendu une SECONDE fois (en plus de l'instance chantier existante, inchangée)
 * directement sur la carte d'un projet/levier précis, pour y afficher SES lignes de staffing sans
 * naviguer jusqu'à l'onglet "Effectifs" — voir `ChantierDetailPanel.tsx`.
 */

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

/** Même politique d'id que `useStrategicData` (suffixe aléatoire) : jamais affiché, seulement une
 *  clé de document stable, et pas de lecture préalable de la collection pour trouver un numéro. */
function newStaffingId(): string {
  return `ST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Saisie numérique tolérante à la virgule décimale. `null` = invalide (vide compris) : un ETP
 *  doit être strictement positif, une ligne à 0 ETP n'aurait aucun sens dans les agrégats.
 *  Exportée (round 29) pour être réutilisée telle quelle par `StaffingDraftTable.tsx`, qui a
 *  besoin de la même règle de validation côté brouillon local (formulaire de création de projet). */
export function parseFte(raw: string): number | null {
  const parsed = Number(raw.trim().replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Formatage court : 1 et non 1.0, 0,5 et non 0.5 (locale d'affichage du navigateur). */
export function formatFte(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export function ChantierStaffingEditor({
  companyId,
  programId,
  chantierId,
  chantierActions,
  scopedToActionId,
}: {
  companyId: string;
  programId: string;
  chantierId: string;
  /** Leviers du chantier (round 7) — univers du sélecteur optionnel « levier concerné » ci-dessous.
   *  Un staffing transverse au chantier reste possible en laissant le sélecteur vide. */
  chantierActions: ChantierAction[];
  /** Scope optionnel à UN projet précis (`ChantierAction.id`) — filtre les lignes affichées à
   *  celles dont `actionId` correspond, cache la colonne "Projet" (redondante dans ce contexte), et
   *  pré-remplit/verrouille le sélecteur "Projet concerné" du formulaire d'ajout sur cette valeur
   *  (toujours modifiable manuellement si l'utilisateur veut au contraire déclarer une ligne
   *  transverse au chantier depuis cette vue — ne pas rendre le champ totalement inerte). */
  scopedToActionId?: string;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { user } = useRole();
  const readOnly = isReadOnlyUser(user);

  const { departmentNames } = useCompanyDepartments(companyId);

  const [all, setAll] = useState<ChantierStaffing[]>([]);
  const [loading, setLoading] = useState(true);
  const [functionDraft, setFunctionDraft] = useState("");
  const [fteDraft, setFteDraft] = useState("1");
  const [noteDraft, setNoteDraft] = useState("");
  const [startDateDraft, setStartDateDraft] = useState("");
  const [endDateDraft, setEndDateDraft] = useState("");
  // Pré-rempli (pas verrouillé, voir doc-comment de `scopedToActionId`) sur le projet scopé dès le
  // montage — simple valeur initiale de `useState`, jamais re-synchronisée ensuite pour ne pas
  // écraser un choix manuel de l'utilisateur.
  const [actionDraft, setActionDraft] = useState(scopedToActionId ?? "");
  const [saving, setSaving] = useState(false);

  const actionNameById = useMemo(
    () => new Map(chantierActions.map((a) => [a.id, a.name])),
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

  // Présélectionne la première équipe dès que la base ETP répond, plutôt que de laisser le champ
  // vide en permanence — ne réagit qu'à l'arrivée de la PREMIÈRE liste non vide (pas à chaque
  // mise à jour) pour ne jamais écraser une sélection déjà faite par l'utilisateur.
  useEffect(() => {
    if (!functionDraft && departmentNames.length > 0) setFunctionDraft(departmentNames[0]);
  }, [departmentNames, functionDraft]);

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

  const add = async () => {
    if (!functionDraft) {
      showToast(t("staffing.functionRequired"), "", "error");
      return;
    }
    const fte = parseFte(fteDraft);
    if (fte === null) {
      showToast(t("staffing.fteInvalid"), "", "error");
      return;
    }
    const note = noteDraft.trim();
    const startDate = startDateDraft.trim();
    const endDate = endDateDraft.trim();
    setSaving(true);
    try {
      await saveChantierStaffing({
        id: newStaffingId(),
        companyId,
        programId,
        chantierId,
        function: functionDraft,
        fte,
        // Champs optionnels OMIS plutôt que passés à `undefined` : Firestore rejette `undefined`.
        ...(note !== "" ? { note } : {}),
        ...(startDate !== "" ? { startDate } : {}),
        ...(endDate !== "" ? { endDate } : {}),
        ...(actionDraft !== "" ? { actionId: actionDraft } : {}),
        createdAt: new Date().toISOString().slice(0, 10),
      });
      setFteDraft("1");
      setNoteDraft("");
      setStartDateDraft("");
      setEndDateDraft("");
      // Retombe sur le projet scopé (pas sur vide) quand ce composant est rendu depuis la carte
      // d'un projet précis — sinon la ligne suivante saisie depuis cette même vue partirait "sans
      // projet" par défaut, contre-intuitif pour l'utilisateur qui vient de l'ouvrir depuis là.
      setActionDraft(scopedToActionId ?? "");
    } catch {
      showToast(t("staffing.saveError"), "", "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteChantierStaffing(id);
    } catch {
      showToast(t("staffing.saveError"), "", "error");
    }
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
        <p className="text-[12px] text-tertiary">{t("staffing.empty")}</p>
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
              {entries.map((entry) => (
                <tr key={entry.id} className="bg-white text-primary">
                  <td className="px-2.5 py-1.5 font-medium">{entry.note || "—"}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${colorForDepartment(entry.function)}`}
                      />
                      {entry.function}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 text-tertiary">{entry.startDate || "—"}</td>
                  <td className="px-2.5 py-1.5 text-tertiary">{entry.endDate || "—"}</td>
                  <td className="px-2.5 py-1.5 text-right font-semibold">
                    {formatFte(entry.fte)} {t("staffing.fteUnit")}
                  </td>
                  {showProjetColumn && (
                    <td className="px-2.5 py-1.5 text-tertiary">
                      {entry.actionId
                        ? (actionNameById.get(entry.actionId) ?? t("staffing.actionNone"))
                        : "—"}
                    </td>
                  )}
                  {!readOnly && (
                    <td className="px-2.5 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => remove(entry.id)}
                        aria-label={t("staffing.remove")}
                        title={t("staffing.remove")}
                        className="rounded p-1 text-tertiary transition hover:bg-neutral-100 hover:text-bp-coral"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="block text-[11px] font-medium text-secondary">
              {t("staffing.function")}
              {departmentNames.length > 0 ? (
                <select
                  value={functionDraft}
                  onChange={(e) => setFunctionDraft(e.target.value)}
                  className={INPUT_CLASS}
                >
                  {departmentNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              ) : (
                // Aucune équipe dans la base ETP entreprise (module RH, `/hr/etp`) : rien à
                // proposer — plutôt qu'un référentiel arbitraire, on renvoie explicitement vers la
                // base ETP à compléter d'abord (round 13, voir doc-comment de tête de fichier).
                <p className={`${INPUT_CLASS} bg-neutral-50 text-tertiary`}>
                  {t("staffing.noDepartments")}
                </p>
              )}
            </label>
            <label className="block text-[11px] font-medium text-secondary">
              {t("staffing.fte")}
              <input
                value={fteDraft}
                onChange={(e) => setFteDraft(e.target.value)}
                inputMode="decimal"
                placeholder="1"
                className={INPUT_CLASS}
              />
            </label>
            <label className="block text-[11px] font-medium text-secondary">
              {t("staffing.note")}
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={t("staffing.notePlaceholder")}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block text-[11px] font-medium text-secondary">
              {t("staffing.startDate")}
              <input
                type="date"
                value={startDateDraft}
                onChange={(e) => setStartDateDraft(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block text-[11px] font-medium text-secondary">
              {t("staffing.endDate")}
              <input
                type="date"
                value={endDateDraft}
                onChange={(e) => setEndDateDraft(e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="block text-[11px] font-medium text-secondary">
              {t("staffing.action")}
              <select
                value={actionDraft}
                onChange={(e) => setActionDraft(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">{t("staffing.actionNone")}</option>
                {chantierActions.map((action) => (
                  <option key={action.id} value={action.id}>
                    {action.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              onClick={add}
              disabled={saving || departmentNames.length === 0}
            >
              <Plus size={12} /> {t("staffing.add")}
            </Button>
          </div>
        </div>
      )}
      {!readOnly && <p className="mt-1.5 text-[11px] text-tertiary">{t("staffing.hint")}</p>}
    </div>
  );
}
