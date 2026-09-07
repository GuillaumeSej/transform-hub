"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { AxisStageBadge } from "@/components/strategic/AxisStageBadge";
import { ChantierStaffingEditor } from "@/components/strategic/ChantierStaffingEditor";
import { EffortScoringGrid } from "@/components/strategic/EffortScoringGrid";
import { MilestoneChecklistPanel } from "@/components/strategic/MilestoneChecklistPanel";
import { MilestoneStepper } from "@/components/strategic/MilestoneStepper";
import { RaciChips } from "@/components/strategic/RaciChips";
import { RaciEditor } from "@/components/strategic/RaciEditor";
import { SuccessKpiList } from "@/components/strategic/SuccessKpiList";
import {
  formatTimelineDay,
  packTimelineLanes,
  timelineColumns,
  timelinePctOf,
  timelineRange,
  timelineYearBands,
  TimelineBar,
  TimelineGridColumns,
  TimelineHeaderRow,
  TimelineScaleToggle,
  type TimelineScale,
} from "@/components/strategic/TimelineBars";
import { UserPicker } from "@/components/strategic/UserPicker";
import {
  canStartAction,
  chantierBounds,
  chantierDependencyAlerts,
  chantierMilestoneProgressPct,
  milestoneProgressPct,
  resolveMilestoneAutoFlags,
} from "@/lib/axisLogic";
import { addDays } from "@/lib/dateUtils";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { saveChantier } from "@/lib/firestore/chantiers";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import type {
  ActionPrerequisite,
  ActionPrerequisiteKind,
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierMilestoneState,
  Deliverable,
  DeliverablePhase,
  MaturityStageConfig,
} from "@/types";

/**
 * Fiche chantier dédiée (round 4, point 9 ; devenue panneau au round 6, point 0) — pendant de
 * `AxisDetailClient.tsx` pour un CHANTIER plutôt qu'un axe. Portait jusqu'au round 6 sa propre route
 * (`/levers/chantier?id=…`, format "fiche PERIAL" demandé par le PO : sponsor/pilote/critères de
 * succès/timeline de livrables, qui n'avait pas sa place dans une modale 720px de l'époque).
 *
 * Round 6, point 0 (retour PO explicite) : reste montée dans un `Modal` PLUS LARGE (1100px, voir les
 * appelants `StrategicAxesView.tsx`/`AxisDetailClient.tsx`) plutôt que sur sa propre route — "tout
 * apparaisse dans le kanban, sur une seule page". RIEN n'est retiré de cette fiche par ce
 * changement : mêmes sections, même contenu, simplement paramétrée par props (`chantierId`,
 * `focusActionId`, `onClose`) au lieu de lire `useSearchParams()`. Garde son propre
 * `useStrategicData(...)` interne — cohérent avec `AxisDetailClient.tsx`/`StrategicDashboardView.tsx`,
 * qui appellent chacun ce hook indépendamment, ce n'est pas un nouveau pattern.
 *
 * Porte TOUT le détail chantier : critères de succès, grille de notation d'effort (round 4, point 7
 * — SEUL endroit qui l'importe), RACI de chantier et de livrable (point 6), dépendances (migration
 * telle quelle), actions avec formulaire inline enrichi (prérequis go/no-go, owner/sponsor via
 * `UserPicker`), et la timeline colorée par livrable façon PERIAL (extraction `TimelineBars.tsx`,
 * voir `ChantierGantt.tsx`).
 */

type ChantierActionFormValues = Pick<
  ChantierAction,
  | "name"
  | "description"
  | "owner"
  | "sponsor"
  | "start"
  | "end"
  | "status"
  | "deliverables"
  | "prerequisites"
>;

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

/** Variante compacte, sans `w-full` : les deux dates d'une sous-étape de livrable, ou une ligne de
 *  prérequis, tiennent sur une même ligne. */
const SMALL_INPUT_CLASS =
  "mt-0.5 rounded-md border border-border bg-white px-2 py-1 text-[12px] text-primary outline-none focus:border-bp-coral";

/** Couleur de repli de la timeline de livrables quand l'axe n'a pas de couleur choisie — même
 *  valeur que `ChantierGantt.FALLBACK_COLOR` (le taupe de la palette BearingPoint). */
const FALLBACK_COLOR = "#a99e9a";

/** Largeur de la colonne d'identité des lignes de la timeline de livrables — légèrement plus
 *  étroite que celle du Gantt (`w-64`) : chaque ligne ne porte que le nom du livrable + celui de
 *  son action, pas d'avancement ni d'étape. */
const TIMELINE_LABEL_WIDTH = "w-56";
const DELIVERABLE_LANE_HEIGHT = 28;
const DELIVERABLE_BAR_HEIGHT = 20;

/** « 3 sept. 2026 → 31 déc. 2027 ». */
function formatRange(start: string, end: string): string {
  return `${formatTimelineDay(start)} → ${formatTimelineDay(end)}`;
}

/** Ids générés côté client pour les livrables, leurs sous-étapes et les prérequis, sur le modèle de
 *  `makeActionId` (lib/leverExcelImport.ts) : jamais affichés, seulement des clés stables de liste
 *  et de patch. Le compteur de module évite la collision de deux créations dans la même
 *  milliseconde. */
let idSeq = 0;
function makeDeliverableId(): string {
  idSeq += 1;
  return `deliverable-${Date.now()}-${idSeq}`;
}
function makePhaseId(): string {
  idSeq += 1;
  return `phase-${Date.now()}-${idSeq}`;
}
function makePrerequisiteId(): string {
  idSeq += 1;
  return `prereq-${Date.now()}-${idSeq}`;
}

/** Normalise `ChantierAction.deliverables` en `Deliverable[]`. Défensif à l'égard des actions
 *  écrites AVANT ce modèle, où un livrable était une simple chaîne (`string[]`) : ces documents
 *  Firestore existent déjà et feraient planter la lecture de `.phases`. */
function normalizeDeliverables(raw: ChantierAction["deliverables"]): Deliverable[] {
  return (raw ?? []).map((d, i) =>
    typeof d === "string"
      ? { id: `legacy-${i}`, label: d, phases: [] }
      : { ...d, phases: d.phases ?? [] }
  );
}

/** Nom affiché d'un utilisateur, résolu par username — repli défensif sur le texte brut stocké : un
 *  `owner`/`sponsor` saisi en texte libre AVANT la conversion round 4 vers `UserPicker` (ou un
 *  utilisateur depuis retiré de l'entreprise) n'a pas de correspondance dans `users`, on l'affiche
 *  quand même tel quel plutôt que de le faire disparaître (voir aussi `UserPicker`, même parti pris
 *  défensif). */
function resolveUserLabel(username: string, users: AuthUser[]): string {
  return users.find((u) => u.username === username)?.name ?? username;
}

type ChantierActionFormLabels = {
  name: string;
  owner: string;
  sponsor: string;
  start: string;
  end: string;
  stage: string;
  description: string;
  deliverables: string;
  deliverablesHint: string;
  noDeliverables: string;
  deliverableLabel: string;
  addDeliverable: string;
  removeDeliverable: string;
  deliverableRaciTitle: string;
  noPhases: string;
  phaseStart: string;
  phaseEnd: string;
  addPhase: string;
  removePhase: string;
  prerequisitesTitle: string;
  prerequisiteKind: string;
  prerequisiteKindAction: string;
  prerequisiteKindExternal: string;
  prerequisiteTargetPlaceholder: string;
  prerequisiteExternalPlaceholder: string;
  prerequisiteDone: string;
  prerequisiteRemoveRow: string;
  prerequisiteAddRow: string;
  prerequisiteNone: string;
  prerequisiteNoOtherActions: string;
  optional: string;
  missingHint: string;
  submit: string;
  cancel: string;
};

type PrerequisitesEditorLabels = Pick<
  ChantierActionFormLabels,
  | "prerequisitesTitle"
  | "prerequisiteKind"
  | "prerequisiteKindAction"
  | "prerequisiteKindExternal"
  | "prerequisiteTargetPlaceholder"
  | "prerequisiteExternalPlaceholder"
  | "prerequisiteDone"
  | "prerequisiteRemoveRow"
  | "prerequisiteAddRow"
  | "prerequisiteNone"
  | "prerequisiteNoOtherActions"
>;

/**
 * Éditeur de prérequis go/no-go (round 4, point 5) — EXTRAIT de `ChantierActionForm` au round 7
 * pour être réutilisable en dehors du formulaire : chaque levier l'affiche désormais directement
 * sur sa propre ligne dans la carte "Dépendances / Prérequis" fusionnée (voir plus bas), EN PLUS de
 * son usage historique dans le formulaire de création/édition ci-dessous. MÉCANIQUE INCHANGÉE
 * (sélecteur de nature action/externe, ajout/suppression de lignes) — seul le mode de pilotage
 * change : purement CONTRÔLÉ (`value`/`onChange`, aucun état interne), pour que chaque appelant
 * décide s'il bufferise (le formulaire, soumis en bloc via `setPrerequisites`) ou persiste
 * immédiatement (la ligne de levier, même discipline d'auto-sauvegarde que le reste de cette fiche
 * — RACI, critères de succès...).
 *
 * v1 toujours PUREMENT INFORMATIVE (voir `canStartAction` dans `lib/axisLogic.ts`) : rien
 * n'intercepte un changement de statut/étape, un prérequis non satisfait n'empêche rien.
 */
function PrerequisitesEditor({
  value,
  otherActions,
  labels,
  onChange,
}: {
  value: ActionPrerequisite[];
  /** Autres actions du MÊME chantier (l'action éditée exclue) — univers du sélecteur de prérequis
   *  "action". Un prérequis ne référence jamais l'action qui le porte elle-même. */
  otherActions: ChantierAction[];
  labels: PrerequisitesEditorLabels;
  onChange: (next: ActionPrerequisite[]) => void;
}) {
  const patchPrerequisite = (id: string, patch: Partial<ActionPrerequisite>) =>
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const removePrerequisite = (id: string) => onChange(value.filter((p) => p.id !== id));

  const addPrerequisite = () =>
    onChange([
      ...value,
      otherActions.length > 0
        ? { id: makePrerequisiteId(), kind: "action", targetActionId: otherActions[0].id }
        : { id: makePrerequisiteId(), kind: "external", label: "", done: false },
    ]);

  return (
    <div>
      <span className="text-xs font-medium text-secondary">{labels.prerequisitesTitle}</span>
      {value.length === 0 ? (
        <p className="mt-1 text-[12px] text-tertiary">{labels.prerequisiteNone}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {value.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-white p-2"
            >
              <select
                aria-label={labels.prerequisiteKind}
                value={p.kind}
                onChange={(e) => {
                  const kind = e.target.value as ActionPrerequisiteKind;
                  patchPrerequisite(
                    p.id,
                    kind === "action"
                      ? { kind, targetActionId: otherActions[0]?.id }
                      : { kind, label: "", done: false }
                  );
                }}
                className={`${SMALL_INPUT_CLASS} w-auto shrink-0`}
              >
                <option value="action">{labels.prerequisiteKindAction}</option>
                <option value="external">{labels.prerequisiteKindExternal}</option>
              </select>

              {p.kind === "action" ? (
                otherActions.length === 0 ? (
                  <span className="text-[11.5px] text-tertiary">
                    {labels.prerequisiteNoOtherActions}
                  </span>
                ) : (
                  <select
                    value={p.targetActionId ?? ""}
                    onChange={(e) => patchPrerequisite(p.id, { targetActionId: e.target.value })}
                    className={`${SMALL_INPUT_CLASS} min-w-0 flex-1`}
                  >
                    <option value="">{labels.prerequisiteTargetPlaceholder}</option>
                    {otherActions.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )
              ) : (
                <>
                  <input
                    value={p.label ?? ""}
                    onChange={(e) => patchPrerequisite(p.id, { label: e.target.value })}
                    placeholder={labels.prerequisiteExternalPlaceholder}
                    className={`${SMALL_INPUT_CLASS} min-w-0 flex-1`}
                  />
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-secondary">
                    <input
                      type="checkbox"
                      checked={p.done ?? false}
                      onChange={(e) => patchPrerequisite(p.id, { done: e.target.checked })}
                    />
                    {labels.prerequisiteDone}
                  </label>
                </>
              )}

              <Button
                variant="ghost"
                size="sm"
                aria-label={labels.prerequisiteRemoveRow}
                title={labels.prerequisiteRemoveRow}
                onClick={() => removePrerequisite(p.id)}
              >
                <Trash2 size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2">
        <Button variant="outline" size="sm" onClick={addPrerequisite}>
          <Plus size={12} /> {labels.prerequisiteAddRow}
        </Button>
      </div>
    </div>
  );
}

/**
 * Formulaire d'action de chantier, rendu INLINE sur la fiche chantier (déplacé depuis l'ancienne
 * modale de `AxisDetailClient.tsx`, round 4 point 9). Enrichi par ce round : `owner`/`sponsor` via
 * `UserPicker` (point 8, nécessaire pour que les filtres Direction/Personne/Sponsor matchent une
 * vraie personne), éditeur de prérequis go/no-go (point 5), RACI par livrable (point 6), et
 * marquage obligatoire/optionnel + message d'aide sous le bouton désactivé (point 4).
 */
function ChantierActionForm({
  initial,
  stages,
  users,
  otherActions,
  onSubmit,
  onCancel,
  labels,
}: {
  initial?: Partial<ChantierActionFormValues>;
  stages: MaturityStageConfig[];
  users: AuthUser[];
  /** Autres actions du MÊME chantier (l'action éditée exclue) — univers du sélecteur de prérequis
   *  "action". Un prérequis ne référence jamais l'action qui le porte elle-même. */
  otherActions: ChantierAction[];
  onSubmit: (values: ChantierActionFormValues) => void | Promise<void>;
  onCancel: () => void;
  labels: ChantierActionFormLabels;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(initial?.name ?? "");
  const [owner, setOwner] = useState<string | undefined>(initial?.owner);
  const [sponsor, setSponsor] = useState<string | undefined>(initial?.sponsor);
  const [start, setStart] = useState(initial?.start ?? today);
  const [end, setEnd] = useState(initial?.end ?? addDays(today, 30));
  const [status, setStatus] = useState(initial?.status ?? stages[0]?.id ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  // Un champ de saisie PAR livrable (plus de convention « une ligne = un livrable »), chacun
  // portant ses propres sous-étapes temporelles et son propre RACI.
  const [deliverables, setDeliverables] = useState<Deliverable[]>(() =>
    normalizeDeliverables(initial?.deliverables)
  );
  const [prerequisites, setPrerequisites] = useState<ActionPrerequisite[]>(
    initial?.prerequisites ?? []
  );
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = name.trim().length > 0 && start.length > 0 && end.length > 0 && !submitting;

  const patchDeliverable = (id: string, patch: Partial<Deliverable>) =>
    setDeliverables((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  const patchPhase = (deliverableId: string, phaseId: string, patch: Partial<DeliverablePhase>) =>
    setDeliverables((list) =>
      list.map((d) =>
        d.id === deliverableId
          ? { ...d, phases: d.phases.map((p) => (p.id === phaseId ? { ...p, ...patch } : p)) }
          : d
      )
    );

  const addDeliverable = () =>
    setDeliverables((list) => [...list, { id: makeDeliverableId(), label: "", phases: [] }]);

  const removeDeliverable = (id: string) =>
    setDeliverables((list) => list.filter((d) => d.id !== id));

  /** Une nouvelle sous-étape reprend par défaut les bornes de l'action : c'est la plage la plus
   *  probable, et cela évite deux champs date vides que l'on filtrerait au submit. */
  const addPhase = (deliverableId: string) =>
    setDeliverables((list) =>
      list.map((d) =>
        d.id === deliverableId
          ? { ...d, phases: [...d.phases, { id: makePhaseId(), start, end }] }
          : d
      )
    );

  const removePhase = (deliverableId: string, phaseId: string) =>
    setDeliverables((list) =>
      list.map((d) =>
        d.id === deliverableId ? { ...d, phases: d.phases.filter((p) => p.id !== phaseId) } : d
      )
    );

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // Même esprit que l'ancien `.filter(Boolean)` sur les lignes : un livrable sans intitulé
      // n'est pas écrit, et une sous-étape dont une borne a été vidée est ignorée.
      const parsedDeliverables = deliverables
        .map((d) => ({
          ...d,
          label: d.label.trim(),
          phases: d.phases.filter((p) => p.start.length > 0 && p.end.length > 0),
          raci: d.raci ?? [],
        }))
        .filter((d) => d.label.length > 0);

      // Reconstruit chaque prérequis avec EXACTEMENT les clés pertinentes à son `kind` — jamais de
      // clé `undefined` (voir note "clés OMISES" plus bas) : un prérequis "action" sans cible ou
      // "external" sans libellé est simplement ignoré (ligne laissée vide par l'utilisateur).
      const parsedPrerequisites: ActionPrerequisite[] = prerequisites.flatMap(
        (p): ActionPrerequisite[] => {
          if (p.kind === "action") {
            return p.targetActionId
              ? [{ id: p.id, kind: "action", targetActionId: p.targetActionId }]
              : [];
          }
          const label = (p.label ?? "").trim();
          return label ? [{ id: p.id, kind: "external", label, done: p.done ?? false }] : [];
        }
      );

      // Clés OMISES (jamais `undefined`) quand vides : `setDoc` rejette toute valeur `undefined`,
      // voir `optionalIndicatorFields` dans `components/admin/IndicatorsEditor.tsx` — c'est la
      // cause racine du bug "le formulaire ne fait rien" sur un champ optionnel laissé vide.
      await onSubmit({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(owner ? { owner } : {}),
        ...(sponsor ? { sponsor } : {}),
        start,
        end,
        status,
        ...(parsedDeliverables.length > 0 ? { deliverables: parsedDeliverables } : {}),
        ...(parsedPrerequisites.length > 0 ? { prerequisites: parsedPrerequisites } : {}),
      });
    } catch (error) {
      // `onSubmit` (fourni par l'appelant) porte déjà son propre try/catch + `showToast` autour de
      // l'écriture Firestore réelle — ce catch est un filet de sécurité pour ne jamais laisser une
      // rejection non gérée si l'appelant ne loggue pas, et pour que `finally` reste le seul point
      // qui réinitialise `submitting`.
      console.error("[betrack] échec de soumission du formulaire d'action de chantier :", error);
      throw error;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border bg-neutral-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-secondary" htmlFor="ca-name">
            {labels.name} <span className="text-bp-coral">*</span>
          </label>
          <input
            id="ca-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <UserPicker
          users={users}
          value={owner}
          onChange={setOwner}
          label={`${labels.owner} ${labels.optional}`}
          id="ca-owner"
        />
        <UserPicker
          users={users}
          value={sponsor}
          onChange={setSponsor}
          label={`${labels.sponsor} ${labels.optional}`}
          id="ca-sponsor"
        />
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-stage">
            {labels.stage}
          </label>
          <select
            id="ca-stage"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={INPUT_CLASS}
          >
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-start">
            {labels.start} <span className="text-bp-coral">*</span>
          </label>
          <input
            id="ca-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-end">
            {labels.end} <span className="text-bp-coral">*</span>
          </label>
          <input
            id="ca-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-secondary" htmlFor="ca-description">
          {labels.description} {labels.optional}
        </label>
        <textarea
          id="ca-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={INPUT_CLASS}
        />
      </div>

      {/* ── Prérequis go/no-go (round 4, point 5) — purement informatif ─────────────────────── */}
      <PrerequisitesEditor
        value={prerequisites}
        otherActions={otherActions}
        labels={labels}
        onChange={setPrerequisites}
      />

      <div>
        <span className="text-xs font-medium text-secondary">
          {labels.deliverables} {labels.optional}
        </span>
        <p className="mt-0.5 text-[11px] text-tertiary">{labels.deliverablesHint}</p>

        {deliverables.length === 0 ? (
          <p className="mt-2 text-[12px] text-tertiary">{labels.noDeliverables}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {deliverables.map((d, i) => (
              <li key={d.id} className="rounded-md border border-border bg-white p-2.5">
                <div className="flex items-start gap-2">
                  <input
                    aria-label={`${labels.deliverableLabel} ${i + 1}`}
                    value={d.label}
                    onChange={(e) => patchDeliverable(d.id, { label: e.target.value })}
                    placeholder={labels.deliverableLabel}
                    className="w-full min-w-0 rounded-md border border-border bg-white px-2 py-1.5 text-[13px] text-primary outline-none focus:border-bp-coral"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={labels.removeDeliverable}
                    title={labels.removeDeliverable}
                    onClick={() => removeDeliverable(d.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>

                <div className="mt-2 space-y-1.5 border-l border-border pl-2.5">
                  {d.phases.length === 0 && (
                    <p className="text-[11px] text-tertiary">{labels.noPhases}</p>
                  )}
                  {d.phases.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-end gap-2">
                      <div>
                        <label
                          className="text-[10.5px] font-medium text-tertiary"
                          htmlFor={`ca-phase-${p.id}-start`}
                        >
                          {labels.phaseStart}
                        </label>
                        <input
                          id={`ca-phase-${p.id}-start`}
                          type="date"
                          value={p.start}
                          onChange={(e) => patchPhase(d.id, p.id, { start: e.target.value })}
                          className={`block ${SMALL_INPUT_CLASS}`}
                        />
                      </div>
                      <div>
                        <label
                          className="text-[10.5px] font-medium text-tertiary"
                          htmlFor={`ca-phase-${p.id}-end`}
                        >
                          {labels.phaseEnd}
                        </label>
                        <input
                          id={`ca-phase-${p.id}-end`}
                          type="date"
                          value={p.end}
                          onChange={(e) => patchPhase(d.id, p.id, { end: e.target.value })}
                          className={`block ${SMALL_INPUT_CLASS}`}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={labels.removePhase}
                        title={labels.removePhase}
                        onClick={() => removePhase(d.id, p.id)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" onClick={() => addPhase(d.id)}>
                    <Plus size={12} /> {labels.addPhase}
                  </Button>
                </div>

                {/* RACI du livrable (round 4, point 6) — indépendant du RACI du chantier. */}
                <div className="mt-2 border-l border-border pl-2.5">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                    {labels.deliverableRaciTitle}
                  </span>
                  <div className="mt-1">
                    <RaciEditor
                      users={users}
                      value={d.raci ?? []}
                      onChange={(next) => patchDeliverable(d.id, { raci: next })}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={addDeliverable}>
            <Plus size={12} /> {labels.addDeliverable}
          </Button>
        </div>
      </div>

      <div>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={submit} disabled={!canSubmit}>
            {labels.submit}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {labels.cancel}
          </Button>
        </div>
        {!canSubmit && !submitting && (
          <p className="mt-1.5 text-[11px] text-tertiary">{labels.missingHint}</p>
        )}
      </div>
    </div>
  );
}

export function ChantierDetailPanel({
  chantierId,
  focusActionId = "",
  onClose,
}: {
  /** Id du chantier affiché — remplace l'ancien `?id=…` de la route dédiée. */
  chantierId: string;
  /** Action à mettre en évidence à l'ouverture (ex. venant d'un clic sur le Gantt) — remplace
   *  l'ancien `?action=…`. */
  focusActionId?: string;
  /** Ferme le panneau (typiquement : retire `?chantier=`/`&action=` de l'URL de la page appelante).
   *  Appelé par tout ce qui, sur l'ancienne route, naviguait AILLEURS (lien retour, suppression) —
   *  voir `navigateAway` ci-dessous pour le cas où il faut en plus une VRAIE navigation. */
  onClose: () => void;
}) {
  const { user } = useRole();
  const { activeProgram, activeProgramId } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const { showToast } = useToast();

  const data = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);

  /** Ferme le panneau PUIS navigue vers une page réellement différente (ex. la fiche d'axe) — le
   *  panneau ne doit pas rester ouvert « au-dessus » d'une page que l'utilisateur vient de quitter
   *  si jamais il revient en arrière (round 6, point 0). */
  const navigateAway = (path: string) => {
    onClose();
    router.push(path);
  };

  // Échelle de confidentialité de l'entreprise — pour le sélecteur inline de l'en-tête (voir plus
  // bas), même pattern que `components/shared/LeverForm.tsx:291-300` côté Plan Performance.
  const [confidentialityLevels, setConfidentialityLevels] = useState<string[]>([]);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      const company = companies.find((c) => c.id === user?.companyId);
      setConfidentialityLevels(company?.confidentialityLevels ?? []);
    }, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);

  const chantier = useMemo(
    () => data.chantiers.find((c) => c.id === chantierId),
    [data.chantiers, chantierId]
  );
  const axis = useMemo(
    () => (chantier ? data.axes.find((a) => a.id === chantier.axisId) : undefined),
    [data.axes, chantier]
  );

  const chantierActions = useMemo(
    () =>
      chantier
        ? data.chantierActions
            .filter((a) => a.chantierId === chantier.id)
            .sort((a, b) => a.start.localeCompare(b.start))
        : [],
    [data.chantierActions, chantier]
  );

  const bounds = useMemo(
    () => (chantier ? chantierBounds(chantier.id, chantierActions) : undefined),
    [chantier, chantierActions]
  );
  // Round 7 : moyenne des leviers (`chantierMilestoneProgressPct`) — remplace l'ancienne lecture
  // directe de `chantier.milestones` (@deprecated, le suivi E0→E4 vit désormais par levier).
  const progressPct = useMemo(
    () => (chantier ? chantierMilestoneProgressPct(chantier, chantierActions) : 0),
    [chantier, chantierActions]
  );

  // Alertes de dépendance dont CE chantier est le côté bloqué (`sourceId`) — même valeur affichée
  // sur la carte "Dépendances / Prérequis" de CHAQUE levier (round 7, décision actée : les
  // dépendances restent une donnée de chantier, pas de levier).
  const chantierBlockingAlerts = useMemo(
    () =>
      chantier
        ? chantierDependencyAlerts(data.chantiers, data.chantierActions).filter(
            (a) => a.sourceId === chantier.id
          )
        : [],
    [chantier, data.chantiers, data.chantierActions]
  );

  // Bloc "critères de succès" — texte libre, sauvegardé au blur (pas de bouton dédié : cohérent
  // avec le reste de la fiche, où chaque bloc round 4 s'auto-sauvegarde à la modification). Resync
  // depuis la donnée distante si elle change sous nos pieds (autre onglet, autre utilisateur).
  const [successCriteria, setSuccessCriteria] = useState(chantier?.successCriteria ?? "");
  useEffect(() => {
    setSuccessCriteria(chantier?.successCriteria ?? "");
  }, [chantier?.id, chantier?.successCriteria]);

  // Bloc "budget alloué" (round 7) — même discipline de saisie que "critères de succès" ci-dessus
  // (texte libre saisi localement, sauvegardé au blur). Champ optionnel : une valeur vidée doit
  // RETIRER la clé (voir `clearChantierField` plus bas), pas juste écrire `undefined`.
  const [allocatedBudgetInput, setAllocatedBudgetInput] = useState(
    chantier?.allocatedBudget !== undefined ? String(chantier.allocatedBudget) : ""
  );
  useEffect(() => {
    setAllocatedBudgetInput(
      chantier?.allocatedBudget !== undefined ? String(chantier.allocatedBudget) : ""
    );
  }, [chantier?.id, chantier?.allocatedBudget]);

  const [actionForm, setActionForm] = useState<{
    mode: "create" | "edit";
    actionId?: string;
  } | null>(null);
  /** Suppression en deux temps (clic → « Confirmer »), plutôt qu'un `window.confirm()` natif —
   *  aucun autre écran de l'app n'utilise de dialogue natif. */
  const [pendingDeleteAction, setPendingDeleteAction] = useState<string | null>(null);
  const [pendingDeleteChantier, setPendingDeleteChantier] = useState(false);

  // ── Timeline colorée par livrable (round 4, point 9 — format PERIAL) ────────────────────────
  // Une ligne par LIVRABLE (toutes actions du chantier confondues), barres = `Deliverable.phases`.
  // Les livrables sans aucune phase n'ont rien à tracer, ils sont exclus de la timeline (pas de
  // ligne vide) mais restent visibles dans la liste d'actions ci-dessus.
  const [timelineScale, setTimelineScale] = useState<TimelineScale>("quarter");
  const deliverablesWithPhases = useMemo(
    () =>
      chantierActions.flatMap((action) =>
        normalizeDeliverables(action.deliverables)
          .filter((d) => d.phases.length > 0)
          // `packTimelineLanes` requiert des items triés par date de début (voir sa doc) — les
          // phases sont saisies dans l'ordre du formulaire, pas garanties chronologiques.
          .map((d) => ({
            ...d,
            actionName: action.name,
            phases: [...d.phases].sort((a, b) => a.start.localeCompare(b.start)),
          }))
      ),
    [chantierActions]
  );
  const timelineBoundsList = useMemo(
    () => deliverablesWithPhases.flatMap((d) => d.phases),
    [deliverablesWithPhases]
  );
  const { minTime, maxTime } = useMemo(
    () => timelineRange(timelineBoundsList, timelineScale),
    [timelineBoundsList, timelineScale]
  );
  const timelineColumnsComputed = useMemo(
    () => (timelineBoundsList.length === 0 ? [] : timelineColumns(minTime, maxTime, timelineScale)),
    [minTime, maxTime, timelineScale, timelineBoundsList.length]
  );
  const timelineYearBandsComputed = useMemo(
    () => timelineYearBands(timelineColumnsComputed),
    [timelineColumnsComputed]
  );
  const timelinePctOfComputed = useMemo(() => timelinePctOf(minTime, maxTime), [minTime, maxTime]);

  // ── Ouverture ciblée sur une action (`focusActionId`) — défilement + mise en avant ─────────
  const actionRefs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    if (!focusActionId) return;
    const el = actionRefs.current[focusActionId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusActionId, chantierActions.length]);

  if (data.loading) {
    return (
      <div className="rounded-lg border border-border bg-white p-10 text-center text-sm text-tertiary">
        {t("strategicAxes.loading")}
      </div>
    );
  }

  if (!chantier) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center text-secondary">
        {t("strategicChantierDetail.notFound")}{" "}
        <button onClick={onClose} className="font-medium text-bp-coral hover:underline">
          {t("strategicAxes.back")}
        </button>
      </div>
    );
  }

  /** Écrit un patch de champs round 4 sur le chantier, protégé par try/catch + `showToast` (voir
   *  constat transverse du plan — c'est la cause racine du bug "le formulaire ne fait rien"). Les
   *  appelants suivent tous le même idiome : OMETTRE la clé plutôt que la valoir `undefined`. */
  const updateChantierField = async (patch: Partial<Chantier>) => {
    try {
      await data.updateChantier(chantier.id, patch);
    } catch (error) {
      console.error("[betrack] échec d'enregistrement du chantier :", error);
      showToast(
        t("strategicAxes.chantierSaveErrorTitle"),
        t("strategicAxes.chantierSaveError"),
        "error"
      );
    }
  };

  /** Retire une clé optionnelle du chantier (ex. "Aucun" choisi dans le sélecteur de
   *  confidentialité, budget alloué vidé) — cas particulier qui ne peut PAS passer par
   *  `updateChantierField` : celle-ci fusionne un patch sur le document existant
   *  (`{...existing, ...patch}`), et une clé valant explicitement `undefined` ferait échouer
   *  `setDoc` (Firestore rejette toute valeur `undefined`). On écrit donc ici le document complet,
   *  la clé simplement ABSENTE de l'objet. Restreint aux deux champs réellement effacables depuis
   *  cette fiche (pas un `keyof Chantier` générique : les autres champs de `Chantier` sont
   *  obligatoires, les en retirer casserait le type). */
  const clearChantierField = async (field: "confidentialityLevel" | "allocatedBudget") => {
    try {
      const rest = { ...chantier };
      delete rest[field];
      await saveChantier({ ...rest, lastUpdate: new Date().toISOString().slice(0, 10) });
    } catch (error) {
      console.error("[betrack] échec d'enregistrement du chantier :", error);
      showToast(
        t("strategicAxes.chantierSaveErrorTitle"),
        t("strategicAxes.chantierSaveError"),
        "error"
      );
    }
  };

  /** Écrit les jalons E0→E4 d'UN LEVIER (round 7 — déplacé depuis le chantier, voir
   *  `ChantierAction.milestones`) — passe par `updateChantierAction`/`saveChantierAction`, jamais
   *  `updateChantierField`/`updateChantier` : ce sont deux collections/documents distincts. */
  const updateActionMilestones = async (actionId: string, nextState: ChantierMilestoneState) => {
    try {
      await data.updateChantierAction(actionId, { milestones: nextState });
    } catch (error) {
      console.error("[betrack] échec d'enregistrement des jalons du levier :", error);
      showToast(
        t("strategicAxes.actionSaveErrorTitle"),
        t("strategicAxes.actionSaveError"),
        "error"
      );
    }
  };

  /** Écrit les prérequis d'UN LEVIER depuis sa carte "Dépendances / Prérequis" (round 7) — auto-
   *  sauvegarde immédiate à chaque changement (contrairement à `ChantierActionForm`, qui bufferise
   *  jusqu'au submit) : TOUJOURS écrire le tableau complet, y compris vide, pour qu'une suppression
   *  de la dernière ligne persiste réellement (`updateChantierAction` fusionne un patch sur le
   *  document existant, une clé omise laisserait l'ancien tableau en place). */
  const updateActionPrerequisites = async (actionId: string, next: ActionPrerequisite[]) => {
    try {
      await data.updateChantierAction(actionId, { prerequisites: next });
    } catch (error) {
      console.error("[betrack] échec d'enregistrement des prérequis du levier :", error);
      showToast(
        t("strategicAxes.actionSaveErrorTitle"),
        t("strategicAxes.actionSaveError"),
        "error"
      );
    }
  };

  const actionFormLabels: ChantierActionFormLabels = {
    name: t("strategicAxes.actionName"),
    owner: t("strategicAxes.actionOwner"),
    sponsor: t("strategicChantierDetail.sponsor"),
    start: t("strategicAxes.actionStart"),
    end: t("strategicAxes.actionEnd"),
    stage: t("strategicAxes.actionStage"),
    description: t("strategicAxes.actionDescription"),
    deliverables: t("strategicAxes.deliverables"),
    deliverablesHint: t("strategicAxes.deliverablesHint"),
    noDeliverables: t("strategicAxes.noDeliverables"),
    deliverableLabel: t("strategicAxes.deliverableLabel"),
    addDeliverable: t("strategicAxes.addDeliverable"),
    removeDeliverable: t("strategicAxes.removeDeliverable"),
    deliverableRaciTitle: t("strategicChantierDetail.raci.deliverableTitle"),
    noPhases: t("strategicAxes.noPhases"),
    phaseStart: t("strategicAxes.phaseStart"),
    phaseEnd: t("strategicAxes.phaseEnd"),
    addPhase: t("strategicAxes.addPhase"),
    removePhase: t("strategicAxes.removePhase"),
    prerequisitesTitle: t("strategicChantierDetail.prerequisites.title"),
    prerequisiteKind: t("strategicChantierDetail.prerequisites.kind"),
    prerequisiteKindAction: t("strategicChantierDetail.prerequisites.kindAction"),
    prerequisiteKindExternal: t("strategicChantierDetail.prerequisites.kindExternal"),
    prerequisiteTargetPlaceholder: t("strategicChantierDetail.prerequisites.targetPlaceholder"),
    prerequisiteExternalPlaceholder: t("strategicChantierDetail.prerequisites.externalPlaceholder"),
    prerequisiteDone: t("strategicChantierDetail.prerequisites.done"),
    prerequisiteRemoveRow: t("strategicChantierDetail.prerequisites.removeRow"),
    prerequisiteAddRow: t("strategicChantierDetail.prerequisites.addRow"),
    prerequisiteNone: t("strategicChantierDetail.prerequisites.none"),
    prerequisiteNoOtherActions: t("strategicChantierDetail.prerequisites.noOtherActions"),
    optional: t("common.optional"),
    missingHint: t("strategicChantierDetail.actionForm.missingHint"),
    submit: t("common.save"),
    cancel: t("common.cancel"),
  };

  const editedAction =
    actionForm?.mode === "edit"
      ? chantierActions.find((a) => a.id === actionForm.actionId)
      : undefined;

  const timelineHasData = deliverablesWithPhases.length > 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-bp-coral hover:underline"
        >
          <ArrowLeft size={14} /> {t("strategicChantierDetail.back")}
        </button>
      </div>

      {/* ── En-tête : nom/étape, sponsor/pilote (éditables), période, avancement ────────────── */}
      <Card>
        <CardHeader
          title={
            <div className="flex flex-wrap items-center gap-2">
              <span>{chantier.name}</span>
              <AxisStageBadge stageId={chantier.stage} stages={stages} />
            </div>
          }
          actions={
            axis && (
              <button
                onClick={() => navigateAway(`/levers/detail?id=${axis.id}`)}
                className="text-xs font-medium text-secondary hover:text-primary hover:underline"
              >
                {axis.name}
              </button>
            )
          }
        />
        <CardBody>
          {chantier.description && (
            <p className="mb-3 max-w-2xl text-[13px] text-secondary">{chantier.description}</p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <UserPicker
              users={data.users}
              value={chantier.sponsorName}
              onChange={(v) => updateChantierField(v ? { sponsorName: v } : {})}
              label={t("strategicChantierDetail.sponsor")}
              placeholder={t("strategicAxes.unassigned")}
              id="chantier-sponsor"
            />
            <UserPicker
              users={data.users}
              value={chantier.pilote}
              onChange={(v) => updateChantierField(v ? { pilote: v } : {})}
              label={t("strategicChantierDetail.pilote")}
              placeholder={t("strategicAxes.unassigned")}
              id="chantier-pilote"
            />
            <div>
              <span className="text-xs font-medium text-text-secondary">
                {t("strategicAxes.chantierPeriod")}
              </span>
              <div className="mt-1.5 text-[13px] font-semibold text-primary">
                {bounds
                  ? formatRange(bounds.start, bounds.end)
                  : t("strategicAxes.chantierNoDates")}
              </div>
            </div>
            <div>
              <label
                className="text-xs font-medium text-text-secondary"
                htmlFor="chantier-allocated-budget"
              >
                {t("strategicChantierDetail.allocatedBudget")}
                {activeProgram?.currency ? ` (${activeProgram.currency})` : ""}
              </label>
              <input
                id="chantier-allocated-budget"
                type="number"
                inputMode="decimal"
                value={allocatedBudgetInput}
                onChange={(e) => setAllocatedBudgetInput(e.target.value)}
                onBlur={() => {
                  const trimmed = allocatedBudgetInput.trim();
                  if (trimmed === "") {
                    if (chantier.allocatedBudget !== undefined)
                      clearChantierField("allocatedBudget");
                    return;
                  }
                  const parsed = Number(trimmed);
                  if (Number.isNaN(parsed) || parsed === chantier.allocatedBudget) return;
                  updateChantierField({ allocatedBudget: parsed });
                }}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <span className="text-xs font-medium text-text-secondary">
                {t("strategicAxes.progress")}
              </span>
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${progressPct}%`,
                      backgroundColor: axis?.color ?? "var(--bp-warm-taupe)",
                    }}
                  />
                </div>
                <span className="shrink-0 text-[13px] font-bold text-primary">{progressPct}%</span>
              </div>
            </div>
            {confidentialityLevels.length > 0 && (
              <div>
                <label
                  className="text-xs font-medium text-text-secondary"
                  htmlFor="chantier-confidentiality"
                >
                  {t("strategicChantierDetail.confidentialityLevel", "Niveau de confidentialité")}
                </label>
                <select
                  id="chantier-confidentiality"
                  className={INPUT_CLASS}
                  value={chantier.confidentialityLevel ?? ""}
                  onChange={(e) =>
                    e.target.value
                      ? updateChantierField({ confidentialityLevel: e.target.value })
                      : clearChantierField("confidentialityLevel")
                  }
                >
                  <option value="">
                    {t(
                      "strategicChantierDetail.confidentialityLevelNone",
                      "Aucun (visible par tous)"
                    )}
                  </option>
                  {confidentialityLevels.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Critères de succès ──────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title={t("strategicChantierDetail.successCriteria")} />
        <CardBody>
          <textarea
            value={successCriteria}
            onChange={(e) => setSuccessCriteria(e.target.value)}
            onBlur={() => {
              const trimmed = successCriteria.trim();
              if (trimmed === (chantier.successCriteria ?? "").trim()) return;
              updateChantierField(trimmed ? { successCriteria: trimmed } : {});
            }}
            rows={3}
            placeholder={t("strategicChantierDetail.successCriteria.placeholder")}
            className={INPUT_CLASS}
          />
          <SuccessKpiList
            value={chantier.successKpis ?? []}
            onChange={(next) => updateChantierField({ successKpis: next })}
          />
        </CardBody>
      </Card>

      {/* ── Grille de notation d'effort (round 4, point 7 — SEUL endroit qui l'importe) ────── */}
      <Card>
        <CardHeader title={t("strategicChantierDetail.effort.title")} />
        <CardBody>
          <EffortScoringGrid
            value={chantier.effort ?? {}}
            onChange={(next) => updateChantierField({ effort: next })}
          />
        </CardBody>
      </Card>

      {/* ── RACI du chantier ────────────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader title={t("strategicChantierDetail.raci.chantierTitle")} />
        <CardBody>
          <RaciEditor
            users={data.users}
            value={chantier.raci ?? []}
            onChange={(next) => updateChantierField({ raci: next })}
          />
        </CardBody>
      </Card>

      {/* ── Actions, prérequis, livrables + RACI livrable ──────────────────────────────────── */}
      <Card>
        <CardHeader
          title={t("strategicAxes.chantierActions")}
          actions={
            !actionForm && (
              <Button variant="outline" size="sm" onClick={() => setActionForm({ mode: "create" })}>
                <Plus size={12} /> {t("strategicAxes.newAction")}
              </Button>
            )
          }
        />
        <CardBody>
          {actionForm && (
            <div className="mb-3">
              <ChantierActionForm
                key={actionForm.actionId ?? "new"}
                initial={editedAction}
                stages={stages}
                users={data.users}
                otherActions={chantierActions.filter((a) => a.id !== actionForm.actionId)}
                labels={actionFormLabels}
                onCancel={() => setActionForm(null)}
                onSubmit={async (values) => {
                  try {
                    if (actionForm.mode === "edit" && actionForm.actionId) {
                      await data.updateChantierAction(actionForm.actionId, values);
                      showToast(t("strategicAxes.actionUpdated"), values.name, "success");
                    } else {
                      await data.createChantierAction({ ...values, chantierId: chantier.id });
                      showToast(t("strategicAxes.actionCreated"), values.name, "success");
                    }
                    setActionForm(null);
                  } catch (error) {
                    console.error(
                      "[betrack] échec d'enregistrement de l'action de chantier :",
                      error
                    );
                    showToast(
                      t("strategicAxes.actionSaveErrorTitle"),
                      t("strategicAxes.actionSaveError"),
                      "error"
                    );
                  }
                }}
              />
            </div>
          )}

          {chantierActions.length === 0 && !actionForm ? (
            <p className="py-4 text-center text-[13px] text-tertiary">
              {t("strategicAxes.noActions")}
            </p>
          ) : (
            <ul className="space-y-2">
              {chantierActions.map((action) => {
                const isFocused = action.id === focusActionId;
                const actionDeliverables = normalizeDeliverables(action.deliverables);
                const startInfo = canStartAction(action, data.chantierActions, stages);
                // Défaut défensif pour un levier créé avant l'introduction des jalons E0→E4 (round
                // 5, déplacé au levier round 7) — ou jamais encore touché : "encore à E0, rien de
                // répondu". N'est écrit en base qu'à la première interaction réelle.
                const actionMilestones: ChantierMilestoneState = action.milestones ?? {
                  currentMilestone: "E0",
                  passedMilestones: [],
                  checklists: {},
                };
                const actionProgressPct = milestoneProgressPct(action);
                return (
                  <li
                    key={action.id}
                    ref={(el) => {
                      actionRefs.current[action.id] = el;
                    }}
                    className={`rounded-md border p-3 ${
                      isFocused ? "border-bp-coral ring-1 ring-bp-coral/40" : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-primary">
                            {action.name}
                          </span>
                          {isFocused && (
                            <span className="rounded-full bg-bp-coral/10 px-2 py-0.5 text-[10px] font-semibold text-bp-coral">
                              {t("strategicChantierDetail.actionFocused")}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-tertiary">
                          <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-medium text-secondary">
                            {formatRange(action.start, action.end)}
                          </span>
                          {action.owner && (
                            <span>· {resolveUserLabel(action.owner, data.users)}</span>
                          )}
                          {action.sponsor && (
                            <span>
                              · {t("strategicChantierDetail.sponsor")} :{" "}
                              {resolveUserLabel(action.sponsor, data.users)}
                            </span>
                          )}
                          <AxisStageBadge stageId={action.status} stages={stages} />
                        </div>
                        {startInfo.blocked && (
                          <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-rag-amber-light px-2 py-0.5 text-[10.5px] font-semibold text-rag-amber">
                            <Lock size={10} />{" "}
                            {t("strategicChantierDetail.prerequisites.blockedBy")}{" "}
                            {startInfo.reasons.join(", ")}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActionForm({ mode: "edit", actionId: action.id })}
                        >
                          <Pencil size={12} /> {t("strategicAxes.editAction")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (pendingDeleteAction !== action.id) {
                              setPendingDeleteAction(action.id);
                              return;
                            }
                            await data.removeChantierAction(action.id);
                            setPendingDeleteAction(null);
                            showToast(t("strategicAxes.actionDeleted"), action.name, "success");
                          }}
                        >
                          <Trash2 size={12} />{" "}
                          {pendingDeleteAction === action.id
                            ? t("strategicAxes.confirmDelete")
                            : t("common.delete")}
                        </Button>
                      </div>
                    </div>

                    {action.description && (
                      <p className="mt-1.5 text-[12px] text-secondary">{action.description}</p>
                    )}

                    <div className="mt-2">
                      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                        {t("strategicAxes.deliverables")}
                      </div>
                      {actionDeliverables.length === 0 ? (
                        <p className="text-[12px] text-tertiary">
                          {t("strategicAxes.noDeliverables")}
                        </p>
                      ) : (
                        <ul className="mt-1 space-y-2">
                          {actionDeliverables.map((d) => (
                            <li
                              key={d.id}
                              className="rounded-md border border-border bg-neutral-50 p-2"
                            >
                              <div className="text-[12px] font-medium text-primary">{d.label}</div>
                              {d.phases.length > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {d.phases.map((p) => (
                                    <span
                                      key={p.id}
                                      className="rounded-full border border-border bg-white px-2 py-0.5 text-[10.5px] text-secondary"
                                    >
                                      {formatRange(p.start, p.end)}
                                      {p.note ? ` · ${p.note}` : ""}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {d.raci && d.raci.length > 0 && (
                                <div className="mt-1.5">
                                  <RaciChips users={data.users} value={d.raci} />
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* ── Jalons E0→E4 du LEVIER (round 7 — déplacé depuis le chantier) ──────── */}
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                          {t("strategicChantierDetail.milestones.title")}
                        </span>
                        <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-bold text-primary">
                          {actionProgressPct}%
                        </span>
                      </div>
                      <div className="mt-2">
                        <MilestoneStepper
                          currentMilestone={actionMilestones.currentMilestone}
                          passedMilestones={actionMilestones.passedMilestones}
                        />
                      </div>
                      <div className="mt-3">
                        <MilestoneChecklistPanel
                          milestoneId={actionMilestones.currentMilestone}
                          items={
                            actionMilestones.checklists[actionMilestones.currentMilestone] ?? []
                          }
                          autoFlags={resolveMilestoneAutoFlags(
                            actionMilestones.currentMilestone,
                            action,
                            data.chantiers,
                            data.chantierActions
                          )}
                          users={data.users}
                          onChange={(nextItems) => {
                            updateActionMilestones(action.id, {
                              currentMilestone: actionMilestones.currentMilestone,
                              passedMilestones: actionMilestones.passedMilestones,
                              checklists: {
                                ...actionMilestones.checklists,
                                [actionMilestones.currentMilestone]: nextItems,
                              },
                            });
                          }}
                          onValidateMilestone={() => {
                            // Jalon suivant dans l'ordre fixe E0→E4 ; s'il n'y en a pas (E4, déjà
                            // le dernier), on le laisse tel quel — voir même commentaire historique
                            // sur l'ancien callback chantier-level, mécanique identique ici.
                            const currentIndex = MILESTONE_ORDER.indexOf(
                              actionMilestones.currentMilestone
                            );
                            const nextMilestone =
                              MILESTONE_ORDER[currentIndex + 1] ??
                              actionMilestones.currentMilestone;
                            const passedMilestones = actionMilestones.passedMilestones.includes(
                              actionMilestones.currentMilestone
                            )
                              ? actionMilestones.passedMilestones
                              : [
                                  ...actionMilestones.passedMilestones,
                                  actionMilestones.currentMilestone,
                                ];
                            updateActionMilestones(action.id, {
                              currentMilestone: nextMilestone,
                              passedMilestones,
                              checklists: actionMilestones.checklists,
                            });
                          }}
                        />
                      </div>
                    </div>

                    {/* ── Dépendances / Prérequis du LEVIER (round 7 — fusion) ──────────────────
                        titre à changer en "Dépendances / Prérequis" par un round i18n suivant
                        (workstream C, renommage "action" → "levier") — key `prerequisites.title`
                        inchangée volontairement, hors scope ici. */}
                    <div className="mt-3 border-t border-border pt-3">
                      {chantierBlockingAlerts.length > 0 && (
                        <div className="mb-2 space-y-1">
                          {chantierBlockingAlerts.map((alert) => (
                            <div
                              key={`${alert.targetId}-${alert.type}`}
                              className="inline-flex items-center gap-1 rounded-full bg-rag-amber-light px-2 py-0.5 text-[10.5px] font-semibold text-rag-amber"
                            >
                              <Lock size={10} /> {alert.message}
                            </div>
                          ))}
                        </div>
                      )}
                      <PrerequisitesEditor
                        value={action.prerequisites ?? []}
                        otherActions={chantierActions.filter((a) => a.id !== action.id)}
                        labels={actionFormLabels}
                        onChange={(next) => updateActionPrerequisites(action.id, next)}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* ── Timeline colorée par livrable, façon PERIAL ────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={t("strategicChantierDetail.timeline.title")}
          actions={
            timelineHasData && (
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                  {t("strategicAxes.ganttScale")}
                </span>
                <TimelineScaleToggle
                  value={timelineScale}
                  onChange={setTimelineScale}
                  options={[
                    { value: "month", label: t("strategicAxes.ganttScaleMonth") },
                    { value: "quarter", label: t("strategicAxes.ganttScaleQuarter") },
                    { value: "semester", label: t("strategicAxes.ganttScaleSemester") },
                  ]}
                />
              </div>
            )
          }
        />
        <CardBody>
          {!timelineHasData ? (
            <p className="py-6 text-center text-[13px] text-tertiary">
              {t("strategicChantierDetail.timeline.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <TimelineHeaderRow
                  columns={timelineColumnsComputed}
                  yearBands={timelineYearBandsComputed}
                  labelWidthClassName={TIMELINE_LABEL_WIDTH}
                />
                {deliverablesWithPhases.map((d) => {
                  const lanes = packTimelineLanes(d.phases);
                  const trackHeight = Math.max(1, lanes.length) * DELIVERABLE_LANE_HEIGHT;
                  const color = axis?.color ?? FALLBACK_COLOR;
                  return (
                    <div
                      key={d.id}
                      className="flex items-stretch gap-2 border-b border-border py-1.5 last:border-b-0"
                    >
                      <div className={`${TIMELINE_LABEL_WIDTH} shrink-0`}>
                        <div
                          className="truncate text-[11.5px] font-semibold text-primary"
                          title={d.label}
                        >
                          {d.label}
                        </div>
                        <div className="truncate text-[10px] text-tertiary">{d.actionName}</div>
                      </div>
                      <div className="relative flex-1" style={{ height: trackHeight }}>
                        <TimelineGridColumns columns={timelineColumnsComputed} />
                        {lanes.map((lane, laneIndex) =>
                          lane.map((phase) => {
                            const left = timelinePctOfComputed(phase.start);
                            const width = Math.max(1.5, timelinePctOfComputed(phase.end) - left);
                            return (
                              <TimelineBar
                                key={phase.id}
                                left={left}
                                width={width}
                                top={laneIndex * DELIVERABLE_LANE_HEIGHT}
                                height={DELIVERABLE_BAR_HEIGHT}
                                color={color}
                                variant="solid"
                                roundedClassName="rounded-sm"
                                ariaLabel={d.label}
                                tooltipText={`${d.label} · ${formatTimelineDay(phase.start)} → ${formatTimelineDay(phase.end)}${
                                  phase.note ? ` · ${phase.note}` : ""
                                }`}
                                label={phase.note || formatRange(phase.start, phase.end)}
                                labelClassName="min-w-0 flex-1 truncate text-[10px] font-medium"
                                inlineMinWidthPct={10}
                              />
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* ── Effectifs mobilisés sur le chantier (composant autonome du lot « Effectifs ») ──── */}
      <div className="mt-4">
        <ChantierStaffingEditor
          companyId={user?.companyId ?? ""}
          programId={activeProgramId ?? ""}
          axisId={chantier.axisId}
          chantierId={chantier.id}
        />
      </div>

      {/* ── Suppression du chantier ─────────────────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-border pt-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (!pendingDeleteChantier) {
              setPendingDeleteChantier(true);
              return;
            }
            // Les actions du chantier sont retirées d'abord : elles ne portent pas de `programId`
            // et ne seraient plus rattachables à rien une fois le chantier parti.
            for (const action of chantierActions) {
              await data.removeChantierAction(action.id);
            }
            await data.removeChantier(chantier.id);
            showToast(t("strategicAxes.chantierDeleted"), chantier.name, "success");
            onClose();
          }}
        >
          <Trash2 size={12} />{" "}
          {pendingDeleteChantier
            ? t("strategicAxes.confirmDeleteChantier")
            : t("strategicAxes.deleteChantier")}
        </Button>
      </div>
    </div>
  );
}
