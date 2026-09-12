"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { BudgetVsActualBar } from "@/components/shared/BudgetVsActualBar";
import { Button } from "@/components/shared/Button";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Modal } from "@/components/shared/Modal";
import { ChantierStaffingEditor, formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { EffortScoringGrid } from "@/components/strategic/EffortScoringGrid";
import { MilestoneChecklistPanel } from "@/components/strategic/MilestoneChecklistPanel";
import { MilestoneStepper } from "@/components/strategic/MilestoneStepper";
import { SuccessKpiList } from "@/components/strategic/SuccessKpiList";
import {
  formatTimelineDay,
  timelineColumns,
  timelinePctOf,
  timelineRange,
  timelineYearBands,
  TimelineBar,
  TimelineGridColumns,
  TimelineHeaderRow,
  TimelineMarker,
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
  numberIndicators,
  progressBucket,
  resolveMilestoneAutoFlags,
  sumLevierBudgets,
  type ProgressBucket,
} from "@/lib/axisLogic";
import { cn } from "@/lib/utils";
import { addDays } from "@/lib/dateUtils";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { saveChantier } from "@/lib/firestore/chantiers";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { MILESTONE_CHECKLISTS, MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import type {
  ActionPrerequisite,
  ActionPrerequisiteKind,
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierMilestoneState,
  Deliverable,
  DeliverablePhase,
  Indicator,
  LevierKanbanStatus,
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
 * — SEUL endroit qui l'importe), dépendances (migration telle quelle), actions avec formulaire
 * inline enrichi (prérequis go/no-go, owner/sponsor via `UserPicker`, KPI optionnel round 8), et la
 * timeline colorée par livrable façon PERIAL (extraction `TimelineBars.tsx`,
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
  | "indicatorId"
  | "budget"
  | "consumedBudget"
  | "consumedFte"
>;

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

/** Variante compacte, sans `w-full` : les deux dates d'une sous-étape de livrable, ou une ligne de
 *  prérequis, tiennent sur une même ligne. */
const SMALL_INPUT_CLASS =
  "mt-0.5 rounded-md border border-border bg-white px-2 py-1 text-[12px] text-primary outline-none focus:border-bp-coral";

/** Couleur de la pastille de la pastille "{pct}%" du levier (round 14) — même convention que
 *  `MilestoneChecklistPanel.tsx`'s `BUCKET_DOT_CLASS` (dupliquée ici plutôt qu'importée : ce
 *  fichier n'est pas dans le périmètre modifiable de ce round). Repose sur le même bucketing
 *  partagé `progressBucket` (`lib/axisLogic.ts`), donc les deux pastilles restent en accord. */
const BUCKET_DOT_CLASS: Record<ProgressBucket, string> = {
  empty: "bg-neutral-300",
  red: "bg-rag-red",
  amber: "bg-rag-amber",
  green: "bg-rag-green",
};

/** Fond teinté + texte de la pastille "{jalon} · {pct}%" du levier (round <n>) — même convention
 *  que `MilestoneChecklistPanel.tsx`'s `BUCKET_INPUT_CLASS` (fond `-light` + texte de la couleur du
 *  bucket, `green` utilisant `text-rag-green-dark` pour le contraste, mêmes tokens qu'elle). Avant
 *  ce round la pastille avait un fond neutre fixe (`bg-neutral-100`) quel que soit le statut — trop
 *  discret au retour PO ("le pourcentage est à peine visible"). */
const BUCKET_PILL_CLASS: Record<ProgressBucket, string> = {
  empty: "bg-neutral-100 text-primary",
  red: "bg-rag-red-light text-rag-red",
  amber: "bg-rag-amber-light text-rag-amber",
  green: "bg-rag-green-light text-rag-green-dark",
};

/** Accent de bordure gauche de la ligne de levier (round <n>) — retour PO : la liste des leviers
 *  "fait très blanc, très texte", sans signal de statut visible sans déplier chaque ligne. Dérivé
 *  de la même palette que `BUCKET_DOT_CLASS`/`BUCKET_PILL_CLASS` ci-dessus (mêmes tokens `rag-*`),
 *  jamais une nouvelle palette. Combiné à `border-border`/`border-bp-coral` (existant) via
 *  `border-l-4` : Tailwind émet les utilitaires `border-l-{couleur}` après l'utilitaire générique
 *  `border-{couleur}` (toutes faces), donc l'accent gauche l'emporte sur la couleur de bordure
 *  générale sans qu'aucune spécificité CSS ne soit forcée à la main — même mécanique que le motif
 *  "carte à liseré coloré" déjà répandu en Tailwind. */
const BUCKET_BORDER_CLASS: Record<ProgressBucket, string> = {
  empty: "border-l-neutral-300",
  red: "border-l-rag-red",
  amber: "border-l-rag-amber",
  green: "border-l-rag-green",
};

/** Hex des tokens `--red`/`--amber`/`--green` (voir `app/globals.css`) — repris ici EN DUR, comme
 *  `IndicatorDonut.tsx` (`FAVORABLE`/`UNFAVORABLE`) le fait déjà pour la même raison : `TimelineBar`
 *  attend une couleur hexadécimale brute (`hexToRgb`/`withAlpha`), pas une classe Tailwind
 *  `bg-rag-*`. Alimente l'onglet "Progression" (round 12) — 3 paliers, mêmes seuils que partout
 *  ailleurs ce round : `<= 0` rouge, `>= 100` vert, sinon ambre. */
const PROGRESSION_COLOR_RED = "#ff3c47";
const PROGRESSION_COLOR_AMBER = "#806659";
const PROGRESSION_COLOR_GREEN = "#1a1a1a";

/** Couleur d'une barre de l'onglet "Progression" (round 12), à partir du pourcentage d'avancement
 *  du levier — voir `PROGRESSION_COLOR_*` ci-dessus pour la provenance des valeurs. */
function progressionColorFor(pct: number): string {
  if (pct <= 0) return PROGRESSION_COLOR_RED;
  if (pct >= 100) return PROGRESSION_COLOR_GREEN;
  return PROGRESSION_COLOR_AMBER;
}

/** Couleur du losange d'un livrable sur l'onglet "Timeline" fusionné, à partir de son
 *  `Deliverable.status` — mêmes 3 couleurs que `progressionColorFor` ci-dessus (todo/rouge,
 *  in_progress/ambre, done/vert), `undefined` traité comme "todo" (même convention que
 *  `LevierKanbanStatusControl`). */
function deliverableStatusColor(status: LevierKanbanStatus | undefined): string {
  switch (status) {
    case "done":
      return PROGRESSION_COLOR_GREEN;
    case "in_progress":
      return PROGRESSION_COLOR_AMBER;
    default:
      return PROGRESSION_COLOR_RED;
  }
}

/** Pourcentage d'avancement AFFICHÉ d'un levier sur l'onglet "Progression" (round 12) — jalons
 *  E0→E4 (`milestoneProgressPct`), UNIVERSELLEMENT pour tout levier qu'il soit rattaché à un KPI ou
 *  non (round 18, ancien aiguillage vers un mappage d'affichage `kanbanStatus` supprimé). Items
 *  auto résolus via `resolveMilestoneAutoFlags` (même appel que la pastille de la carte levier,
 *  onglet "Leviers") — `action.milestones` absent est géré par `milestoneProgressPct` lui-même
 *  (0 %). */
function progressionPctFor(
  action: ChantierAction,
  allChantiers: Chantier[],
  allActions: ChantierAction[]
): number {
  const milestoneId = action.milestones?.currentMilestone ?? "E0";
  return milestoneProgressPct(
    action,
    resolveMilestoneAutoFlags(milestoneId, action, allChantiers, allActions)
  );
}

/** Largeur de la colonne d'identité des lignes de la timeline de livrables — légèrement plus
 *  étroite que celle du Gantt (`w-64`) : chaque ligne ne porte que le nom du livrable + celui de
 *  son action, pas d'avancement ni d'étape. */
const TIMELINE_LABEL_WIDTH = "w-56";
const DELIVERABLE_LANE_HEIGHT = 28;
const DELIVERABLE_BAR_HEIGHT = 20;
/** Hauteur de la sous-piste compacte portant les losanges de livrables sous la barre d'un levier,
 *  sur l'onglet "Timeline" fusionné (round <n>) — seulement ajoutée si le levier a au moins un
 *  livrable avec `dueDate` déclarée (voir son calcul dans le rendu de l'onglet). */
const DELIVERABLE_MARKER_LANE_HEIGHT = 18;

/** « 3 sept. 2026 → 31 déc. 2027 ». */
function formatRange(start: string, end: string): string {
  return `${formatTimelineDay(start)} → ${formatTimelineDay(end)}`;
}

/** Formatage d'un montant budgétaire pour `BudgetVsActualBar` (round <n>, blocs "consommé"
 *  chantier/levier) — jusqu'ici aucun montant `allocatedBudget`/`budget` de cette fiche n'était
 *  formaté au-delà du champ de saisie brut (`<input type="number">`), donc pas de convention
 *  d'affichage existante à reprendre à l'identique ; séparateurs de milliers (`Intl.NumberFormat`,
 *  même bibliothèque que `formatFte` de `ChantierStaffingEditor.tsx`) pour rester lisible dans une
 *  barre compacte, devise du programme actif en suffixe (même convention que le libellé du champ
 *  `allocatedBudget` : `{label} ({currency})`). */
function formatBudgetAmount(value: number, currency?: string): string {
  const formatted = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
  return currency ? `${formatted} ${currency}` : formatted;
}

/** « 10/09/2026 10:33 » — horodatage d'un commentaire de livrable (round <n>), à partir d'un ISO
 *  datetime COMPLET (`Deliverable.comments[].createdAt`). Distinct de `formatTimelineDay` : celui-
 *  ci attend une date ISO simple ("2026-09-03") et ajoute `T00:00:00`, ce qui produit une chaîne
 *  invalide sur un datetime déjà complet (avec heure/millisecondes/`Z`). Même patron que
 *  `formatTimestamp` (app/(app)/admin/history/page.tsx). */
function formatCommentTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
function makeCommentId(): string {
  idSeq += 1;
  return `comment-${Date.now()}-${idSeq}`;
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
  indicator: string;
  indicatorNone: string;
  budget: string;
  budgetExceedsChantier: string;
  consumedBudget: string;
  consumedFte: string;
  /** Unité ETP affichée dans la `BudgetVsActualBar` du champ `consumedFte` ci-dessous — même clé
   *  que `staffing.fteUnit` (`ChantierStaffingEditor.tsx`), ce formulaire n'appelant pas `t()`
   *  lui-même (tous ses libellés lui arrivent déjà traduits via `labels`). */
  fteUnit: string;
  description: string;
  deliverables: string;
  deliverablesHint: string;
  noDeliverables: string;
  deliverableLabel: string;
  addDeliverable: string;
  removeDeliverable: string;
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
      <span className="text-[13px] font-bold text-primary">{labels.prerequisitesTitle}</span>
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
 * Contrôle kanban classique 3 états (round 8 : introduit pour le suivi d'UN LEVIER SANS KPI
 * rattaché ; round 18 : ce mode de suivi levier a été supprimé — le PO a unifié tous les leviers
 * sur les jalons E0→E4 — mais ce composant SURVIT car il pilote désormais uniquement
 * `Deliverable.status` (voir `DeliverableDetailModal`/`AddDeliverableForm` ci-dessous), un concept
 * totalement différent et hors scope de ce round. Même esprit visuel que
 * `components/shared/ActionKanban.tsx` du Plan Performance (bouton actif rempli en noir, inactifs
 * en contour) mais écrit ici en JSX Strategic-only, purement contrôlé (`status`/`onChange`,
 * auto-sauvegarde immédiate à chaque clic). N'importe jamais `ActionKanban.tsx` ni son type
 * `ActionStatus`, domaines strictement séparés.
 */
function LevierKanbanStatusControl({
  status,
  onChange,
  labels,
}: {
  /** `undefined` traité comme "todo" pour la mise en avant du bouton actif — voir
   *  `Deliverable.status`, jamais forcé en base tant que l'utilisateur n'a pas cliqué. */
  status: LevierKanbanStatus | undefined;
  onChange: (next: LevierKanbanStatus) => void;
  labels: { title: string; todo: string; inProgress: string; done: string };
}) {
  const effectiveStatus: LevierKanbanStatus = status ?? "todo";
  const COLUMNS: { value: LevierKanbanStatus; label: string }[] = [
    { value: "todo", label: labels.todo },
    { value: "in_progress", label: labels.inProgress },
    { value: "done", label: labels.done },
  ];
  return (
    <div>
      <span className="text-[11.5px] font-bold uppercase tracking-wide text-secondary">
        {labels.title}
      </span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {COLUMNS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
              effectiveStatus === c.value
                ? "border-bp-coral bg-black text-white"
                : "border-border bg-white text-secondary hover:border-black"
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Modale de détail d'UN livrable (round <n>, onglet "Timeline" fusionné) — ouverte au clic sur son
 * losange. Statut réutilise `LevierKanbanStatusControl` tel quel (aucune nouvelle logique), date
 * d'échéance et fil de commentaires en écriture directe (`onPatch`, auto-sauvegarde immédiate comme
 * `updateActionPrerequisites`/`updateActionKanbanStatus`). Rendu via `Modal` (portal Radix) plutôt
 * qu'un `Popover` : le contenu est trop riche pour un panneau ancré, et un losange proche du bord
 * droit du Gantt scrollable couperait un popover non-porté.
 */
function DeliverableDetailModal({
  deliverable,
  kanbanLabels,
  labels,
  users,
  currentUsername,
  onClose,
  onPatch,
}: {
  deliverable: Deliverable;
  kanbanLabels: { title: string; todo: string; inProgress: string; done: string };
  labels: {
    dueDate: string;
    comments: string;
    commentPlaceholder: string;
    noComments: string;
    add: string;
    close: string;
  };
  users: AuthUser[];
  currentUsername?: string;
  onClose: () => void;
  onPatch: (patch: Partial<Deliverable>) => void;
}) {
  const [commentText, setCommentText] = useState("");
  const comments = [...(deliverable.comments ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  return (
    <Modal
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      title={deliverable.label}
      footer={
        <Button variant="outline" size="sm" onClick={onClose}>
          {labels.close}
        </Button>
      }
    >
      <label className="block text-xs font-bold uppercase tracking-wide text-secondary">
        {labels.dueDate}
        <input
          type="date"
          className={INPUT_CLASS}
          value={deliverable.dueDate ?? ""}
          onChange={(e) => onPatch({ dueDate: e.target.value || undefined })}
        />
      </label>

      <div className="mt-4">
        <LevierKanbanStatusControl
          status={deliverable.status}
          labels={kanbanLabels}
          onChange={(status) => onPatch({ status })}
        />
      </div>

      <div className="mt-4">
        <span className="text-[11.5px] font-bold uppercase tracking-wide text-secondary">
          {labels.comments}
        </span>
        {comments.length === 0 ? (
          <p className="mt-1 text-[12px] text-tertiary">{labels.noComments}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="rounded-md border border-border bg-neutral-50 p-2">
                <p className="text-[12px] text-primary">{c.text}</p>
                <p className="mt-1 text-[10.5px] text-tertiary">
                  {c.author ? `${resolveUserLabel(c.author, users)} · ` : ""}
                  {formatCommentTimestamp(c.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex gap-2">
          <input
            className={`${SMALL_INPUT_CLASS} mt-0 flex-1`}
            placeholder={labels.commentPlaceholder}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!commentText.trim()}
            onClick={() => {
              onPatch({
                comments: [
                  ...(deliverable.comments ?? []),
                  {
                    id: makeCommentId(),
                    text: commentText.trim(),
                    author: currentUsername,
                    createdAt: new Date().toISOString(),
                  },
                ],
              });
              setCommentText("");
            }}
          >
            {labels.add}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Modale de création d'un livrable (round <n>) — déclenchée par le bouton "Ajouter un livrable" de
 * l'onglet "Timeline" fusionné. Un livrable est embarqué dans UN levier (`ChantierAction.deliverables`)
 * : sélecteur de levier obligatoire, présélectionné s'il n'y en a qu'un seul.
 */
function AddDeliverableForm({
  actions,
  kanbanLabels,
  labels,
  onCancel,
  onSubmit,
}: {
  actions: ChantierAction[];
  kanbanLabels: { title: string; todo: string; inProgress: string; done: string };
  labels: {
    title: string;
    leverSelect: string;
    deliverableLabel: string;
    dueDate: string;
    save: string;
    cancel: string;
  };
  onCancel: () => void;
  onSubmit: (
    actionId: string,
    values: { label: string; dueDate: string; status: LevierKanbanStatus }
  ) => void;
}) {
  const [actionId, setActionId] = useState(actions.length === 1 ? actions[0].id : "");
  const [label, setLabel] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<LevierKanbanStatus>("todo");
  const canSubmit = actionId.trim() !== "" && label.trim() !== "" && dueDate.trim() !== "";
  return (
    <Modal
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
      title={labels.title}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {labels.cancel}
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={() => onSubmit(actionId, { label: label.trim(), dueDate, status })}
          >
            {labels.save}
          </Button>
        </>
      }
    >
      <label className="block text-[11.5px] font-bold uppercase tracking-wide text-secondary">
        {labels.leverSelect}
        <select
          className={INPUT_CLASS}
          value={actionId}
          onChange={(e) => setActionId(e.target.value)}
        >
          <option value="">—</option>
          {actions.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>

      <label className="mt-3 block text-[11.5px] font-bold uppercase tracking-wide text-secondary">
        {labels.deliverableLabel}
        <input className={INPUT_CLASS} value={label} onChange={(e) => setLabel(e.target.value)} />
      </label>

      <label className="mt-3 block text-[11.5px] font-bold uppercase tracking-wide text-secondary">
        {labels.dueDate}
        <input
          type="date"
          className={INPUT_CLASS}
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </label>

      <div className="mt-3">
        <LevierKanbanStatusControl status={status} labels={kanbanLabels} onChange={setStatus} />
      </div>
    </Modal>
  );
}

/**
 * Formulaire d'action de chantier, rendu INLINE sur la fiche chantier (déplacé depuis l'ancienne
 * modale de `AxisDetailClient.tsx`, round 4 point 9). Enrichi par ce round : `owner`/`sponsor` via
 * `UserPicker` (point 8, nécessaire pour que les filtres Direction/Personne/Sponsor matchent une
 * vraie personne), éditeur de prérequis go/no-go (point 5), et marquage obligatoire/optionnel +
 * message d'aide sous le bouton désactivé (point 4).
 *
 * Round 8 : gagne le sélecteur optionnel de KPI (`indicatorId`) — round 18 : purement informatif,
 * n'aiguille plus aucun système de suivi (voir `ChantierAction.indicatorId`). RACI par livrable
 * retiré (jugé peu pertinent par le PO, voir `RaciEditor`/`RaciChips`, supprimés).
 */
function ChantierActionForm({
  initial,
  stages,
  users,
  otherActions,
  indicators,
  currency,
  chantierAllocatedBudget,
  plannedFte,
  onSubmit,
  onCancel,
  labels,
}: {
  initial?: Partial<ChantierActionFormValues>;
  stages: MaturityStageConfig[];
  users: AuthUser[];
  /** Autres actions du MÊME chantier (l'action éditée exclue) — univers du sélecteur de prérequis
   *  "action". Un prérequis ne référence jamais l'action qui le porte elle-même. RÉUTILISÉ round 12
   *  pour la validation du budget levier (voir `budgetExceeds` ci-dessous) : c'est déjà exactement
   *  l'ensemble "les AUTRES leviers du chantier" dont on a besoin pour sommer leurs budgets. */
  otherActions: ChantierAction[];
  /** KPI proposables à ce levier — DÉJÀ FILTRÉS par l'appelant (`ChantierDetailPanel`) : indicateurs
   *  macro de l'axe du chantier + indicateurs déjà rattachés à ce chantier précis (voir
   *  `ChantierAction.indicatorId`). Ce composant ne refiltre rien, il ne fait qu'afficher la liste
   *  reçue. */
  indicators: Indicator[];
  /** Devise du programme actif — suffixe du champ budget (round 12), même convention que le champ
   *  `allocatedBudget` du CHANTIER sur la fiche appelante. */
  currency?: string;
  /** Budget alloué du CHANTIER parent (round 12) — nécessaire pour valider que la somme des
   *  budgets leviers (`otherActions` + ce formulaire) ne le dépasse pas. `undefined` = pas de
   *  plafond, aucune validation. */
  chantierAllocatedBudget?: number;
  /** ETP PLANIFIÉS de CE LEVIER (round <n>) — somme des lignes `ChantierStaffing` rattachées à son
   *  `actionId`, déjà calculée par l'appelant (`plannedFteByAction`, voir son commentaire) : ce
   *  formulaire n'a pas accès à `data.staffing`, seulement à ce total. Sert de "planned" à la
   *  `BudgetVsActualBar` ETP ci-dessous, pendant de `chantierAllocatedBudget` pour l'ETP. `undefined`
   *  (nouveau levier pas encore créé, donc sans `actionId` à interroger) traité comme `0`. */
  plannedFte?: number;
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
  // KPI optionnel du levier (round 8) — round 18 : purement informatif, n'aiguille plus aucun
  // système de suivi (tout levier progresse via les jalons E0→E4, avec ou sans KPI rattaché).
  const [indicatorId, setIndicatorId] = useState<string | undefined>(initial?.indicatorId);
  // Budget optionnel du levier (round 12) — même discipline de saisie que `allocatedBudget` du
  // chantier (texte libre local, ici bufferisé jusqu'au submit comme le reste de ce formulaire).
  const [budgetInput, setBudgetInput] = useState(
    initial?.budget !== undefined ? String(initial.budget) : ""
  );
  // Consommé optionnel du levier (round <n>) — pendants déclaratifs de `budget` ci-dessus pour
  // `ChantierAction.consumedBudget`/`consumedFte` : EXACTE même discipline de saisie (texte libre
  // local, bufferisé jusqu'au submit).
  const [consumedBudgetInput, setConsumedBudgetInput] = useState(
    initial?.consumedBudget !== undefined ? String(initial.consumedBudget) : ""
  );
  const [consumedFteInput, setConsumedFteInput] = useState(
    initial?.consumedFte !== undefined ? String(initial.consumedFte) : ""
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  // Un champ de saisie PAR livrable (plus de convention « une ligne = un livrable »), chacun
  // portant ses propres sous-étapes temporelles.
  const [deliverables, setDeliverables] = useState<Deliverable[]>(() =>
    normalizeDeliverables(initial?.deliverables)
  );
  const [prerequisites, setPrerequisites] = useState<ActionPrerequisite[]>(
    initial?.prerequisites ?? []
  );
  const [submitting, setSubmitting] = useState(false);

  const requiredFieldsMissing = name.trim().length === 0 || start.length === 0 || end.length === 0;

  // Validation du budget levier (round 12) — voir le commentaire du prop `chantierAllocatedBudget`.
  // Une saisie vide ou non numérique compte pour 0 dans la projection, même parti pris que
  // `sumLevierBudgets` ("un levier sans budget renseigné compte pour 0, jamais exclu").
  const trimmedBudget = budgetInput.trim();
  const parsedBudget = trimmedBudget === "" ? undefined : Number(trimmedBudget);
  const otherLeviersBudgetSum = otherActions.reduce((sum, a) => sum + (a.budget ?? 0), 0);
  const projectedLeviersBudgetTotal =
    otherLeviersBudgetSum +
    (parsedBudget !== undefined && !Number.isNaN(parsedBudget) ? parsedBudget : 0);
  const budgetExceeds =
    chantierAllocatedBudget !== undefined && projectedLeviersBudgetTotal > chantierAllocatedBudget;

  // Consommé (round <n>) — même parti pris de parsing que `parsedBudget` ci-dessus, pas de
  // validation de plafond (le dépassement est une information, pas une erreur bloquante : voir
  // `BudgetVsActualBar` qui le signale déjà visuellement en rouge).
  const trimmedConsumedBudget = consumedBudgetInput.trim();
  const parsedConsumedBudget =
    trimmedConsumedBudget === "" ? undefined : Number(trimmedConsumedBudget);
  const trimmedConsumedFte = consumedFteInput.trim();
  const parsedConsumedFte = trimmedConsumedFte === "" ? undefined : Number(trimmedConsumedFte);

  const canSubmit = !requiredFieldsMissing && !submitting && !budgetExceeds;

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
        ...(indicatorId ? { indicatorId } : {}),
        ...(parsedBudget !== undefined && !Number.isNaN(parsedBudget)
          ? { budget: parsedBudget }
          : {}),
        ...(parsedConsumedBudget !== undefined && !Number.isNaN(parsedConsumedBudget)
          ? { consumedBudget: parsedConsumedBudget }
          : {}),
        ...(parsedConsumedFte !== undefined && !Number.isNaN(parsedConsumedFte)
          ? { consumedFte: parsedConsumedFte }
          : {}),
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
          <label className="text-xs font-medium text-secondary" htmlFor="ca-indicator">
            {labels.indicator} {labels.optional}
          </label>
          <select
            id="ca-indicator"
            value={indicatorId ?? ""}
            onChange={(e) => setIndicatorId(e.target.value || undefined)}
            className={INPUT_CLASS}
          >
            <option value="">{labels.indicatorNone}</option>
            {indicators.map((indicator) => (
              <option key={indicator.id} value={indicator.id}>
                {indicator.name}
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
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-budget">
            {labels.budget} {labels.optional}
            {currency ? ` (${currency})` : ""}
          </label>
          <input
            id="ca-budget"
            type="number"
            inputMode="decimal"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            className={INPUT_CLASS}
          />
        </div>
        {/* ── Consommé du levier (round <n>) — pendants déclaratifs de "budget" ci-dessus pour
          `ChantierAction.consumedBudget`/`consumedFte`, EXACTE même discipline de saisie
          (bufferisé jusqu'au submit, comme le reste de ce formulaire). ─────────────────────── */}
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-consumed-budget">
            {labels.consumedBudget} {labels.optional}
            {currency ? ` (${currency})` : ""}
          </label>
          <input
            id="ca-consumed-budget"
            type="number"
            inputMode="decimal"
            value={consumedBudgetInput}
            onChange={(e) => setConsumedBudgetInput(e.target.value)}
            className={INPUT_CLASS}
          />
          <BudgetVsActualBar
            className="mt-2"
            planned={parsedBudget !== undefined && !Number.isNaN(parsedBudget) ? parsedBudget : 0}
            consumed={
              parsedConsumedBudget !== undefined && !Number.isNaN(parsedConsumedBudget)
                ? parsedConsumedBudget
                : 0
            }
            formatValue={(n) => formatBudgetAmount(n, currency)}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-consumed-fte">
            {labels.consumedFte} {labels.optional}
          </label>
          <input
            id="ca-consumed-fte"
            type="number"
            inputMode="decimal"
            value={consumedFteInput}
            onChange={(e) => setConsumedFteInput(e.target.value)}
            className={INPUT_CLASS}
          />
          <BudgetVsActualBar
            className="mt-2"
            planned={plannedFte ?? 0}
            consumed={
              parsedConsumedFte !== undefined && !Number.isNaN(parsedConsumedFte)
                ? parsedConsumedFte
                : 0
            }
            formatValue={(n) => `${formatFte(n)} ${labels.fteUnit}`}
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
          <p className="mt-1.5 text-[11px] text-tertiary">
            {requiredFieldsMissing ? labels.missingHint : labels.budgetExceedsChantier}
          </p>
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

  // ETP PLANIFIÉS (round <n>) — pendant de `sumLevierBudgets`/`allocatedBudget` pour l'ETP : il
  // n'existe pas de champ "ETP cible" déclaratif sur `Chantier`/`ChantierAction` (contrairement au
  // budget), le seul planifié disponible est la somme des lignes de staffing (`ChantierStaffing`,
  // même collection que `ChantierStaffingEditor.tsx`, déjà abonnée via `data.staffing`). Sert de
  // "planned" à la `BudgetVsActualBar` ETP ci-dessous, chantier ET par levier (une ligne de staffing
  // SANS `actionId` compte dans le total chantier mais dans AUCUN total levier — staffing transverse,
  // même lecture que `ChantierStaffingEditor`).
  const chantierStaffing = useMemo(
    () => (chantier ? data.staffing.filter((s) => s.chantierId === chantier.id) : []),
    [data.staffing, chantier]
  );
  const plannedFteTotal = chantierStaffing.reduce((sum, s) => sum + (s.fte || 0), 0);
  const plannedFteByAction = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of chantierStaffing) {
      if (!s.actionId) continue;
      map.set(s.actionId, (map.get(s.actionId) ?? 0) + (s.fte || 0));
    }
    return map;
  }, [chantierStaffing]);

  // KPI proposables au sélecteur optionnel d'un levier (round 8) — même filtre que `KpiPageClient.tsx`
  // (`grouped` useMemo, `macro`/`byChantier`) : indicateurs macro de l'AXE du chantier (pas de
  // `chantierId`) + indicateurs déjà rattachés à CE chantier précis. Jamais un indicateur d'un autre
  // axe/chantier.
  const chantierAvailableIndicators = useMemo(
    () =>
      chantier
        ? data.indicators.filter(
            (i) => (i.axisId === chantier.axisId && !i.chantierId) || i.chantierId === chantier.id
          )
        : [],
    [data.indicators, chantier]
  );

  // Numéro global de KPI (fondation round 10, `lib/axisLogic.ts`) — même calcul que `KpiPageClient.tsx`
  // et les cartes d'axe, pour que le "KPI n°<N>" affiché sur un levier soit toujours cohérent avec
  // le reste de la plateforme.
  const indicatorNumbers = useMemo(
    () => numberIndicators(data.axes, data.chantiers, data.indicators),
    [data.axes, data.chantiers, data.indicators]
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

  // Blocs "consommé" (round <n>) — pendants déclaratifs de "budget alloué" ci-dessus pour
  // `Chantier.consumedBudget`/`consumedFte` (voir leur commentaire dans `types/index.ts`) : EXACTE
  // même discipline de saisie (texte libre local, sauvegarde au blur, clé RETIRÉE via
  // `clearChantierField` si vidée plutôt que valoir `undefined`).
  const [consumedBudgetInput, setConsumedBudgetInput] = useState(
    chantier?.consumedBudget !== undefined ? String(chantier.consumedBudget) : ""
  );
  useEffect(() => {
    setConsumedBudgetInput(
      chantier?.consumedBudget !== undefined ? String(chantier.consumedBudget) : ""
    );
  }, [chantier?.id, chantier?.consumedBudget]);

  const [consumedFteInput, setConsumedFteInput] = useState(
    chantier?.consumedFte !== undefined ? String(chantier.consumedFte) : ""
  );
  useEffect(() => {
    setConsumedFteInput(chantier?.consumedFte !== undefined ? String(chantier.consumedFte) : "");
  }, [chantier?.id, chantier?.consumedFte]);

  const [actionForm, setActionForm] = useState<{
    mode: "create" | "edit";
    actionId?: string;
  } | null>(null);
  /** Suppression en deux temps (clic → « Confirmer »), plutôt qu'un `window.confirm()` natif —
   *  aucun autre écran de l'app n'utilise de dialogue natif. */
  const [pendingDeleteAction, setPendingDeleteAction] = useState<string | null>(null);
  const [pendingDeleteChantier, setPendingDeleteChantier] = useState(false);

  // ── Losanges de livrables sur l'onglet "Timeline" (round <n>) — modale de détail (clic sur un
  // losange) et modale de création (bouton "Ajouter un livrable" du `CardHeader`). État de session
  // pur, comme `actionForm`/`pendingDeleteAction` ci-dessus.
  const [openDeliverable, setOpenDeliverable] = useState<{
    actionId: string;
    deliverableId: string;
  } | null>(null);
  const [addDeliverableOpen, setAddDeliverableOpen] = useState(false);

  // ── Onglet "Timeline" (ex-"Progression", fusionné avec l'ex-onglet "Timeline" dédié aux phases
  // de livrables — round <n>, deux vues calendaires disjointes jugées peu lisibles) — une barre par
  // levier, sur son propre axe temporel `action.start` → `action.end`, complétée par un losange par
  // livrable ayant une `dueDate` déclarée (voir `deliverableStatusColor`, le rendu plus bas).
  const [progressionScale, setProgressionScale] = useState<TimelineScale>("quarter");
  const { minTime: progressionMinTime, maxTime: progressionMaxTime } = useMemo(
    () => timelineRange(chantierActions, progressionScale),
    [chantierActions, progressionScale]
  );
  const progressionColumns = useMemo(
    () =>
      chantierActions.length === 0
        ? []
        : timelineColumns(progressionMinTime, progressionMaxTime, progressionScale),
    [progressionMinTime, progressionMaxTime, progressionScale, chantierActions.length]
  );
  const progressionYearBands = useMemo(
    () => timelineYearBands(progressionColumns),
    [progressionColumns]
  );
  const progressionPctOfComputed = useMemo(
    () => timelinePctOf(progressionMinTime, progressionMaxTime),
    [progressionMinTime, progressionMaxTime]
  );

  // ── Onglets (round 10, point 2) — réduisent le long défilement vertical de la fiche ─────────
  // Toujours initialisé sur "leviers" si le panneau s'ouvre déjà avec un `focusActionId` (sinon le
  // surlignage/défilement ci-dessous serait invisible, l'onglet "Leviers" n'étant pas affiché).
  const [activeTab, setActiveTab] = useState<"overview" | "progression" | "leviers" | "staffing">(
    focusActionId ? "leviers" : "overview"
  );

  // Ciblage interne d'un levier depuis l'onglet "Timeline" (round 12) — pendant de
  // `focusActionId` (prop externe, pilotée par l'appelant via l'URL) mais déclenché DEPUIS ce
  // composant : cliquer une barre doit produire EXACTEMENT le même effet (bascule d'onglet +
  // surlignage + défilement) qu'ouvrir la fiche avec `?action=…`, sans que l'appelant n'ait à
  // connaître ce clic. Voir `effectiveFocusActionId` ci-dessous — priorité au ciblage interne le
  // plus récent, la prop externe ne reprenant la main qu'à son propre changement (effet suivant).
  const [clickedFocusActionId, setClickedFocusActionId] = useState("");
  const effectiveFocusActionId = clickedFocusActionId || focusActionId;

  // ── Bandeaux accordéon des leviers (round <n>) — état de SESSION pur (pas de persistance
  // Firestore, comme `pendingDeleteAction`) : tous fermés au chargement, un `Set` d'ids ouverts.
  // Forcé à s'ouvrir depuis 3 endroits : ciblage depuis l'onglet "Timeline"
  // (`focusLevierFromProgression`/l'effet sur `focusActionId` ci-dessous), et l'édition inline
  // d'un levier (`setActionForm({mode:"edit",...})`) — sans quoi le contenu vers lequel on
  // scrolle/édite resterait invisible, replié.
  const [openLeviers, setOpenLeviers] = useState<Set<string>>(new Set());
  const openLevier = (actionId: string) =>
    setOpenLeviers((s) => (s.has(actionId) ? s : new Set(s).add(actionId)));
  const toggleLevier = (actionId: string) =>
    setOpenLeviers((s) => {
      const next = new Set(s);
      if (next.has(actionId)) {
        next.delete(actionId);
      } else {
        next.add(actionId);
      }
      return next;
    });

  const focusLevierFromProgression = (actionId: string) => {
    setActiveTab("leviers");
    setClickedFocusActionId(actionId);
    openLevier(actionId);
  };

  // Même déclencheur que l'effet de défilement ci-dessous (`focusActionId`) : si le panneau reste
  // monté et qu'un NOUVEAU levier est ciblé (ex. l'utilisateur avait changé d'onglet, puis reclique
  // un autre levier depuis le dashboard), on rebascule sur "Leviers" à chaque changement.
  useEffect(() => {
    if (focusActionId) {
      setActiveTab("leviers");
      openLevier(focusActionId);
      // Un `focusActionId` FRAIS (prop externe, ex. lien depuis le dashboard) prime toujours sur un
      // ciblage interne resté en mémoire — sans quoi un clic précédent sur une barre de l'onglet
      // "Progression" masquerait indéfiniment tout changement ultérieur de cette prop.
      setClickedFocusActionId("");
    }
  }, [focusActionId]);

  // ── Ouverture ciblée sur une action (`effectiveFocusActionId`) — défilement + mise en avant ──
  const actionRefs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    if (!effectiveFocusActionId) return;
    const el = actionRefs.current[effectiveFocusActionId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [effectiveFocusActionId, chantierActions.length]);

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
  const clearChantierField = async (
    field: "confidentialityLevel" | "allocatedBudget" | "consumedBudget" | "consumedFte"
  ) => {
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

  /** Patch UN livrable d'UN levier (statut, date d'échéance, ajout de commentaire — round <n>) —
   *  même discipline d'auto-sauvegarde immédiate que `updateActionPrerequisites`/
   *  `updateActionMilestones` ci-dessus : réécrit le tableau `deliverables` COMPLET du levier
   *  (`updateChantierAction` fusionne un patch sur le document existant, pas de merge profond sur
   *  un tableau). */
  const updateDeliverable = async (
    actionId: string,
    deliverableId: string,
    patch: Partial<Deliverable>
  ) => {
    const action = chantierActions.find((a) => a.id === actionId);
    if (!action) return;
    const next = normalizeDeliverables(action.deliverables).map((d) =>
      d.id === deliverableId ? { ...d, ...patch } : d
    );
    try {
      await data.updateChantierAction(actionId, { deliverables: next });
    } catch (error) {
      console.error("[betrack] échec d'enregistrement du livrable :", error);
      showToast(
        t("strategicAxes.actionSaveErrorTitle"),
        t("strategicAxes.actionSaveError"),
        "error"
      );
    }
  };

  /** Crée un NOUVEAU livrable sur un levier existant, depuis le formulaire "Ajouter un livrable"
   *  de l'onglet "Timeline" (round <n>) — même discipline que `updateDeliverable` ci-dessus. */
  const addDeliverable = async (
    actionId: string,
    values: { label: string; dueDate: string; status: LevierKanbanStatus }
  ) => {
    const action = chantierActions.find((a) => a.id === actionId);
    if (!action) return;
    const newDeliverable: Deliverable = {
      id: makeDeliverableId(),
      label: values.label,
      phases: [],
      dueDate: values.dueDate,
      status: values.status,
    };
    const next = [...normalizeDeliverables(action.deliverables), newDeliverable];
    try {
      await data.updateChantierAction(actionId, { deliverables: next });
      showToast(t("strategicAxes.actionUpdated"), values.label, "success");
    } catch (error) {
      console.error("[betrack] échec de création du livrable :", error);
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
    indicator: t("strategicChantierDetail.indicatorSelect.label"),
    indicatorNone: t("strategicChantierDetail.indicatorSelect.none"),
    description: t("strategicAxes.actionDescription"),
    deliverables: t("strategicAxes.deliverables"),
    deliverablesHint: t("strategicAxes.deliverablesHint"),
    noDeliverables: t("strategicAxes.noDeliverables"),
    deliverableLabel: t("strategicAxes.deliverableLabel"),
    addDeliverable: t("strategicAxes.addDeliverable"),
    removeDeliverable: t("strategicAxes.removeDeliverable"),
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
    budget: t("strategicChantierDetail.actionForm.budgetLabel"),
    budgetExceedsChantier: t("strategicChantierDetail.actionForm.budgetExceedsChantier"),
    consumedBudget: t("strategicChantierDetail.actionForm.consumedBudgetLabel"),
    consumedFte: t("strategicChantierDetail.actionForm.consumedFteLabel"),
    fteUnit: t("staffing.fteUnit"),
    submit: t("common.save"),
    cancel: t("common.cancel"),
  };

  const editedAction =
    actionForm?.mode === "edit"
      ? chantierActions.find((a) => a.id === actionForm.actionId)
      : undefined;

  // ── Livrables (round <n>) — labels partagés par les 2 modales (détail + création) ────────────
  const deliverableKanbanLabels = {
    title: t("strategicChantierDetail.kanban.title"),
    todo: t("strategicChantierDetail.kanban.todo"),
    inProgress: t("strategicChantierDetail.kanban.inProgress"),
    done: t("strategicChantierDetail.kanban.done"),
  };
  const openDeliverableAction = openDeliverable
    ? chantierActions.find((a) => a.id === openDeliverable.actionId)
    : undefined;
  const openDeliverableItem = openDeliverableAction
    ? normalizeDeliverables(openDeliverableAction.deliverables).find(
        (d) => d.id === openDeliverable?.deliverableId
      )
    : undefined;

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

      {/* ── Onglets (round 10, point 2) — même langage visuel que `StrategicAxesView.tsx`
          (bouton actif `bg-black text-white`, inactif `bg-white text-secondary`) ────────────── */}
      <div className="mb-4 flex w-fit overflow-hidden rounded-md border border-border">
        {(
          [
            { id: "overview", label: t("strategicChantierDetail.tabs.overview", "Vue d'ensemble") },
            {
              // Round <n> : onglet renommé "Timeline" (fusion avec l'ex-onglet dédié aux phases de
              // livrables) — clé `tabs.progression` conservée telle quelle pour ne pas casser les
              // autres traductions qui la référencent (voir aussi le `CardHeader` plus bas), seule
              // sa VALEUR change dans les 4 dictionnaires.
              id: "progression",
              label: t("strategicChantierDetail.tabs.progression", "Timeline"),
            },
            { id: "leviers", label: t("strategicAxes.chantierActions") },
            { id: "staffing", label: t("strategicChantierDetail.tabs.staffing", "Effectifs") },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-semibold ${
              activeTab === tab.id ? "bg-black text-white" : "bg-white text-secondary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Onglet "Vue d'ensemble" : en-tête, critères de succès, grille d'effort ──────────── */}
      <div className={activeTab === "overview" ? undefined : "hidden"}>
        {/* ── En-tête : nom/étape, sponsor/pilote (éditables), période, avancement ────────────── */}
        <Card>
          <CardHeader
            title={
              <div className="flex flex-wrap items-center gap-2">
                <span>{chantier.name}</span>
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
                    // Round 12 : validation SYMÉTRIQUE de celle du formulaire de levier — le budget
                    // du CHANTIER ne peut pas descendre sous la somme des budgets de ses leviers
                    // ACTUELS (`chantierActions`, pas ce qui est en cours de saisie dans un
                    // formulaire de levier éventuellement ouvert par ailleurs). Rejet : ni écriture,
                    // ni tentative — l'input revient à la dernière valeur enregistrée, et un toast
                    // explique pourquoi (même canal que `updateChantierField`/`clearChantierField`).
                    const leviersBudgetSum = sumLevierBudgets(chantier.id, chantierActions);
                    if (parsed < leviersBudgetSum) {
                      setAllocatedBudgetInput(
                        chantier.allocatedBudget !== undefined
                          ? String(chantier.allocatedBudget)
                          : ""
                      );
                      showToast(
                        t("strategicAxes.chantierSaveErrorTitle"),
                        t("strategicChantierDetail.allocatedBudgetBelowLeviers"),
                        "error"
                      );
                      return;
                    }
                    updateChantierField({ allocatedBudget: parsed });
                  }}
                  className={INPUT_CLASS}
                />
              </div>
              {/* ── Budget consommé du chantier (round <n>) — pendant déclaratif de "budget alloué"
                ci-dessus pour `Chantier.consumedBudget` : EXACTE même discipline de saisie (texte
                libre local, sauvegarde au blur, clé retirée si vidée), voir `clearChantierField`. */}
              <div>
                <label
                  className="text-xs font-medium text-text-secondary"
                  htmlFor="chantier-consumed-budget"
                >
                  {t("strategicChantierDetail.consumedBudget")}
                  {activeProgram?.currency ? ` (${activeProgram.currency})` : ""}
                </label>
                <input
                  id="chantier-consumed-budget"
                  type="number"
                  inputMode="decimal"
                  value={consumedBudgetInput}
                  onChange={(e) => setConsumedBudgetInput(e.target.value)}
                  onBlur={() => {
                    const trimmed = consumedBudgetInput.trim();
                    if (trimmed === "") {
                      if (chantier.consumedBudget !== undefined)
                        clearChantierField("consumedBudget");
                      return;
                    }
                    const parsed = Number(trimmed);
                    if (Number.isNaN(parsed) || parsed === chantier.consumedBudget) return;
                    updateChantierField({ consumedBudget: parsed });
                  }}
                  className={INPUT_CLASS}
                />
                <BudgetVsActualBar
                  className="mt-2"
                  planned={chantier.allocatedBudget ?? 0}
                  consumed={chantier.consumedBudget ?? 0}
                  formatValue={(n) => formatBudgetAmount(n, activeProgram?.currency)}
                />
              </div>
              {/* ── ETP consommés du chantier (round <n>) — même pendant pour `Chantier.consumedFte`,
                comparé aux ETP PLANIFIÉS (`plannedFteTotal`, somme des lignes `ChantierStaffing` du
                chantier — voir son commentaire ci-dessus, pas de champ "ETP cible" déclaratif). */}
              <div>
                <label
                  className="text-xs font-medium text-text-secondary"
                  htmlFor="chantier-consumed-fte"
                >
                  {t("strategicChantierDetail.consumedFte")} ({t("staffing.fteUnit")})
                </label>
                <input
                  id="chantier-consumed-fte"
                  type="number"
                  inputMode="decimal"
                  value={consumedFteInput}
                  onChange={(e) => setConsumedFteInput(e.target.value)}
                  onBlur={() => {
                    const trimmed = consumedFteInput.trim();
                    if (trimmed === "") {
                      if (chantier.consumedFte !== undefined) clearChantierField("consumedFte");
                      return;
                    }
                    const parsed = Number(trimmed);
                    if (Number.isNaN(parsed) || parsed === chantier.consumedFte) return;
                    updateChantierField({ consumedFte: parsed });
                  }}
                  className={INPUT_CLASS}
                />
                <BudgetVsActualBar
                  className="mt-2"
                  planned={plannedFteTotal}
                  consumed={chantier.consumedFte ?? 0}
                  formatValue={(n) => `${formatFte(n)} ${t("staffing.fteUnit")}`}
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
                  <span className="shrink-0 text-[13px] font-bold text-primary">
                    {progressPct}%
                  </span>
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
      </div>

      {/* ── Onglet "Timeline" (ex-"Progression", round 12 ; fusionné round <n> avec l'ex-onglet
          dédié aux phases de livrables) : une barre par levier, façon Gantt, remplie/colorée selon
          son avancement — jalons E0→E4 pour tout levier, avec ou sans KPI rattaché (round 18, voir
          `progressionPctFor`/`progressionColorFor` en tête de fichier) — complétée d'un losange par
          livrable ayant une `dueDate` déclarée (`TimelineMarker`, couleur via
          `deliverableStatusColor`), sur le MÊME axe temporel que la barre de son levier parent (pas
          un axe séparé — c'est justement ce qui manquait à l'ancien onglet dédié). ─────────────── */}
      <div className={activeTab === "progression" ? undefined : "hidden"}>
        <Card>
          <CardHeader
            title={t("strategicChantierDetail.tabs.progression", "Timeline")}
            actions={
              <div className="flex items-center gap-2">
                {chantierActions.length > 0 && (
                  <>
                    <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
                      {t("strategicAxes.ganttScale")}
                    </span>
                    <TimelineScaleToggle
                      value={progressionScale}
                      onChange={setProgressionScale}
                      options={[
                        { value: "month", label: t("strategicAxes.ganttScaleMonth") },
                        { value: "quarter", label: t("strategicAxes.ganttScaleQuarter") },
                        { value: "semester", label: t("strategicAxes.ganttScaleSemester") },
                      ]}
                    />
                  </>
                )}
                {chantierActions.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setAddDeliverableOpen(true)}>
                    <Plus size={12} /> {t("strategicAxes.addDeliverable")}
                  </Button>
                )}
              </div>
            }
          />
          <CardBody>
            {chantierActions.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-tertiary">
                {t("strategicAxes.noActions")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  <TimelineHeaderRow
                    columns={progressionColumns}
                    yearBands={progressionYearBands}
                    labelWidthClassName={TIMELINE_LABEL_WIDTH}
                  />
                  {chantierActions.map((action) => {
                    const pct = progressionPctFor(action, data.chantiers, data.chantierActions);
                    const color = progressionColorFor(pct);
                    const left = progressionPctOfComputed(action.start);
                    const width = Math.max(1.5, progressionPctOfComputed(action.end) - left);
                    const dueDeliverables = normalizeDeliverables(action.deliverables).filter(
                      (d) => d.dueDate
                    );
                    const laneHeight =
                      dueDeliverables.length > 0
                        ? DELIVERABLE_LANE_HEIGHT + DELIVERABLE_MARKER_LANE_HEIGHT
                        : DELIVERABLE_LANE_HEIGHT;
                    return (
                      <div
                        key={action.id}
                        className="flex items-stretch gap-2 border-b border-border py-1.5 last:border-b-0"
                      >
                        <div className={`${TIMELINE_LABEL_WIDTH} shrink-0`}>
                          <div
                            className="truncate text-[11.5px] font-semibold text-primary"
                            title={action.name}
                          >
                            {action.name}
                          </div>
                        </div>
                        <div className="relative flex-1" style={{ height: laneHeight }}>
                          <TimelineGridColumns columns={progressionColumns} />
                          <TimelineBar
                            left={left}
                            width={width}
                            top={0}
                            height={DELIVERABLE_BAR_HEIGHT}
                            color={color}
                            variant="outline"
                            progressPct={pct}
                            onClick={() => focusLevierFromProgression(action.id)}
                            ariaLabel={action.name}
                            tooltipText={`${action.name} · ${pct}%`}
                            label={`${pct}%`}
                            labelClassName="min-w-0 flex-1 truncate text-[10px] font-semibold text-primary"
                          />
                          {dueDeliverables.map((d) => (
                            <TimelineMarker
                              key={d.id}
                              leftPct={progressionPctOfComputed(d.dueDate!)}
                              top={DELIVERABLE_LANE_HEIGHT + DELIVERABLE_MARKER_LANE_HEIGHT / 2}
                              color={deliverableStatusColor(d.status)}
                              onClick={() =>
                                setOpenDeliverable({ actionId: action.id, deliverableId: d.id })
                              }
                              ariaLabel={d.label}
                              tooltipText={`${d.label} · ${formatTimelineDay(d.dueDate!)}`}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Onglet "Leviers" : actions, prérequis, livrables ────────────────────────────────── */}
      <div className={activeTab === "leviers" ? undefined : "hidden"}>
        {/* ── Actions, prérequis, livrables ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title={t("strategicAxes.chantierActions")}
            actions={
              !actionForm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActionForm({ mode: "create" })}
                >
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
                  indicators={chantierAvailableIndicators}
                  currency={activeProgram?.currency}
                  chantierAllocatedBudget={chantier.allocatedBudget}
                  plannedFte={
                    actionForm.actionId ? plannedFteByAction.get(actionForm.actionId) : undefined
                  }
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
                  const isFocused = action.id === effectiveFocusActionId;
                  const isOpen = openLeviers.has(action.id);
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
                  // Round 12 : `milestoneProgressPct` prend désormais un 2ᵃᵌ argument
                  // (`autoValues`, voir son commentaire dans `lib/axisLogic.ts`) — sans lui les
                  // items `auto` du jalon courant comptent tous pour 0, sous-évaluant cette pastille
                  // dès qu'un item auto est réellement à 100. `actionMilestones.currentMilestone`
                  // porte déjà le défaut "E0" ci-dessus, pas besoin de le re-dériver.
                  const actionProgressPct = milestoneProgressPct(
                    action,
                    resolveMilestoneAutoFlags(
                      actionMilestones.currentMilestone,
                      action,
                      data.chantiers,
                      data.chantierActions
                    )
                  );
                  // Bucket d'affichage du levier (round <n>) — calculé UNE fois par ligne, réutilisé
                  // par la pastille de statut ET l'accent de bordure gauche ci-dessous, pour que les
                  // deux restent forcément en accord (jamais deux appels distincts à `progressBucket`
                  // qui pourraient diverger si l'un des deux oublie de suivre un futur changement).
                  const actionBucket = progressBucket(actionProgressPct);
                  // Moyenne déclarée du jalon COURANT SEUL (round 14) — pendant `MilestoneStepper`
                  // de la "tranche jalon courant" de `milestoneProgressPct` (lib/axisLogic.ts,
                  // étape 2 de son commentaire), répliquée ici plutôt que déplacée dans ce module
                  // partagé : contrairement à `actionProgressPct` ci-dessus (qui crédite aussi les
                  // jalons déjà franchis, `* 20`), le stepper ne veut QUE le remplissage du jalon
                  // actif, jamais le cumul. Un item auto sans valeur stockée reprend la même valeur
                  // live que la pastille auto de `MilestoneChecklistPanel` (`autoFlags`) ; un item
                  // manuel absent ou non répondu compte pour 0, comme partout ailleurs ce round.
                  const currentMilestoneAutoFlags = resolveMilestoneAutoFlags(
                    actionMilestones.currentMilestone,
                    action,
                    data.chantiers,
                    data.chantierActions
                  );
                  const currentMilestoneDefs =
                    MILESTONE_CHECKLISTS[actionMilestones.currentMilestone];
                  const currentMilestoneStoredItems =
                    actionMilestones.checklists[actionMilestones.currentMilestone] ?? [];
                  const currentMilestoneProgressPct =
                    currentMilestoneDefs.length > 0
                      ? Math.round(
                          currentMilestoneDefs.reduce((sum, def) => {
                            const stored = currentMilestoneStoredItems.find(
                              (i) => i.itemId === def.itemId
                            );
                            const value =
                              stored?.progressPct !== undefined
                                ? stored.progressPct
                                : ((def.auto ? currentMilestoneAutoFlags[def.itemId] : undefined) ??
                                  0);
                            return sum + value;
                          }, 0) / currentMilestoneDefs.length
                        )
                      : 0;
                  // KPI rattaché au levier (round 8, purement informatif depuis round 18 — voir
                  // `ChantierAction.indicatorId`) — résolu ici pour affichage round 10 (nom + numéro
                  // global).
                  const linkedIndicator = action.indicatorId
                    ? data.indicators.find((i) => i.id === action.indicatorId)
                    : undefined;
                  const linkedIndicatorNumber = linkedIndicator
                    ? indicatorNumbers.get(linkedIndicator.id)
                    : undefined;
                  return (
                    <li
                      key={action.id}
                      ref={(el) => {
                        actionRefs.current[action.id] = el;
                      }}
                      className={`rounded-md border p-3 border-l-4 ${
                        isFocused
                          ? "border-bp-coral ring-1 ring-bp-coral/40"
                          : `border-border bg-neutral-50 shadow-sm ${BUCKET_BORDER_CLASS[actionBucket]}`
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-label={
                            isOpen
                              ? t("strategicChantierDetail.leviers.collapse")
                              : t("strategicChantierDetail.leviers.expand")
                          }
                          onClick={() => toggleLevier(action.id)}
                          className="flex min-w-0 flex-1 items-start gap-2 text-left"
                        >
                          <ChevronDown
                            size={16}
                            aria-hidden
                            className={`mt-0.5 shrink-0 text-tertiary transition-transform ${isOpen ? "rotate-180" : ""}`}
                          />
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
                              {/* ── Résumé de statut sur le bandeau fermé (round <n>) : jalon
                                courant + pastille %, universellement pour tout levier (round 18) ── */}
                              <span
                                className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold ${BUCKET_PILL_CLASS[actionBucket]}`}
                              >
                                <span
                                  aria-hidden
                                  className={`h-2 w-2 rounded-full ${BUCKET_DOT_CLASS[actionBucket]}`}
                                />
                                {actionMilestones.currentMilestone} · {actionProgressPct}%
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-tertiary">
                              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-secondary">
                                {formatTimelineDay(action.start)}
                                <span className="mx-1 font-bold text-tertiary">→</span>
                                {formatTimelineDay(action.end)}
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
                            </div>
                            {startInfo.blocked && (
                              <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-rag-amber-light px-2 py-0.5 text-[10.5px] font-semibold text-rag-amber">
                                <Lock size={10} />{" "}
                                {t("strategicChantierDetail.prerequisites.blockedBy")}{" "}
                                {startInfo.reasons.join(", ")}
                              </div>
                            )}
                          </div>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setActionForm({ mode: "edit", actionId: action.id });
                              openLevier(action.id);
                            }}
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

                      {isOpen && (
                        <>
                          {action.description && (
                            <p className="mt-1.5 text-[12px] text-secondary">
                              {action.description}
                            </p>
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
                                    <div className="text-sm font-medium text-primary">
                                      {d.label}
                                    </div>
                                    {d.phases.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {d.phases.map((p) => (
                                          <span
                                            key={p.id}
                                            className="rounded-full border border-border bg-white px-2 py-0.5 text-xs text-secondary"
                                          >
                                            {formatRange(p.start, p.end)}
                                            {p.note ? ` · ${p.note}` : ""}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          {/* ── Suivi du LEVIER : jalons E0→E4, universellement pour tout levier
                        avec ou sans KPI rattaché (round 18 — l'ancien aiguillage vers un kanban
                        classique pour les leviers sans `indicatorId` a été supprimé) ─────────── */}
                          <div className="mt-3 border-t border-border pt-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11.5px] font-bold uppercase tracking-wide text-secondary">
                                {t("strategicChantierDetail.milestones.title")}
                              </span>
                              <span
                                className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold ${BUCKET_PILL_CLASS[actionBucket]}`}
                              >
                                <span
                                  aria-hidden
                                  className={`h-2 w-2 rounded-full ${BUCKET_DOT_CLASS[actionBucket]}`}
                                />
                                {actionProgressPct}%
                              </span>
                            </div>
                            {action.indicatorId && (
                              <div className="mt-1">
                                {linkedIndicator ? (
                                  <button
                                    onClick={() =>
                                      navigateAway(`/kpi?indicator=${action.indicatorId}`)
                                    }
                                    className="text-[11px] font-medium text-bp-coral hover:underline"
                                  >
                                    {t(
                                      "strategicChantierDetail.indicatorLink.label",
                                      "KPI n°{n} · {name}"
                                    )
                                      .replace("{n}", String(linkedIndicatorNumber ?? "?"))
                                      .replace("{name}", linkedIndicator.name)}
                                  </button>
                                ) : (
                                  <span className="text-[11px] text-tertiary">
                                    {t(
                                      "strategicChantierDetail.indicatorLink.notFound",
                                      "KPI introuvable"
                                    )}
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="mt-2">
                              <MilestoneStepper
                                currentMilestone={actionMilestones.currentMilestone}
                                passedMilestones={actionMilestones.passedMilestones}
                                currentMilestoneProgressPct={currentMilestoneProgressPct}
                              />
                            </div>
                            <div className="mt-3">
                              <MilestoneChecklistPanel
                                milestoneId={actionMilestones.currentMilestone}
                                items={
                                  actionMilestones.checklists[actionMilestones.currentMilestone] ??
                                  []
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
                                  const passedMilestones =
                                    actionMilestones.passedMilestones.includes(
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
                        inchangée volontairement, hors scope ici.
                        Round 9, point 2 : `border-t-2` (plus marqué que le `border-t` du bloc
                        jalons/kanban ci-dessus) pour que les deux sous-sections internes du levier
                        se distinguent d'un coup d'œil. */}
                          <div className="mt-3 border-t-2 border-border pt-3">
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
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ── Onglet "Effectifs" ───────────────────────────────────────────────────────────────── */}
      <div className={activeTab === "staffing" ? undefined : "hidden"}>
        {/* ── Effectifs mobilisés sur le chantier (composant autonome du lot « Effectifs ») ──── */}
        <div className="mt-4">
          <ChantierStaffingEditor
            companyId={user?.companyId ?? ""}
            programId={activeProgramId ?? ""}
            axisId={chantier.axisId}
            chantierId={chantier.id}
            chantierActions={chantierActions}
          />
        </div>
      </div>

      {/* ── Suppression du chantier — reste HORS onglets, action globale au chantier ─────────── */}
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

      {/* ── Modales livrables (round <n>) — détail (clic losange) et création ────────────────── */}
      {openDeliverableItem && openDeliverable && (
        <DeliverableDetailModal
          deliverable={openDeliverableItem}
          kanbanLabels={deliverableKanbanLabels}
          labels={{
            dueDate: t("strategicChantierDetail.deliverableModal.dueDate"),
            comments: t("strategicChantierDetail.deliverableModal.comments"),
            commentPlaceholder: t("strategicChantierDetail.deliverableModal.commentPlaceholder"),
            noComments: t("strategicChantierDetail.deliverableModal.noComments"),
            add: t("common.add"),
            close: t("common.close"),
          }}
          users={data.users}
          currentUsername={user?.username}
          onClose={() => setOpenDeliverable(null)}
          onPatch={(patch) =>
            updateDeliverable(openDeliverable.actionId, openDeliverable.deliverableId, patch)
          }
        />
      )}
      {addDeliverableOpen && (
        <AddDeliverableForm
          actions={chantierActions}
          kanbanLabels={deliverableKanbanLabels}
          labels={{
            title: t("strategicAxes.addDeliverable"),
            leverSelect: t("strategicChantierDetail.deliverableForm.leverSelect"),
            deliverableLabel: t("strategicAxes.deliverableLabel"),
            dueDate: t("strategicChantierDetail.deliverableModal.dueDate"),
            save: t("common.save"),
            cancel: t("common.cancel"),
          }}
          onCancel={() => setAddDeliverableOpen(false)}
          onSubmit={async (actionId, values) => {
            await addDeliverable(actionId, values);
            setAddDeliverableOpen(false);
          }}
        />
      )}
    </div>
  );
}
