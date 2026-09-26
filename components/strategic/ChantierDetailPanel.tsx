"use client";

import { DateInput } from "@/components/shared/DateInput";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Lock,
  Pencil,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { BudgetVsActualBar } from "@/components/shared/BudgetVsActualBar";
import { Button } from "@/components/shared/Button";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Modal } from "@/components/shared/Modal";
import { ChantierStaffingEditor, formatFte } from "@/components/strategic/ChantierStaffingEditor";
import {
  StaffingDraftTable,
  type StaffingDraftRow,
} from "@/components/strategic/StaffingDraftTable";
import { EffortScoringGrid } from "@/components/strategic/EffortScoringGrid";
import { MilestoneChecklistPanel } from "@/components/strategic/MilestoneChecklistPanel";
import { MilestonePreviewEditor } from "@/components/strategic/MilestonePreviewEditor";
import { MilestoneStepper } from "@/components/strategic/MilestoneStepper";
import { MilestoneTransitionBadge } from "@/components/strategic/MilestoneTransitionBadge";
import { ProjetWeightsEditor } from "@/components/strategic/ProjetWeightsEditor";
import { DeleteRequestModal } from "@/components/strategic/DeleteRequestModal";
import { SuccessKpiList } from "@/components/strategic/SuccessKpiList";
import {
  formatTimelineDay,
  hexToRgb,
  timelineColumns,
  timelinePctOf,
  timelineRange,
  timelineYearBands,
  withAlpha,
  TimelineBar,
  TimelineGridColumns,
  TimelineHeaderRow,
  TimelineMarker,
  TimelineScaleToggle,
  type TimelineScale,
} from "@/components/strategic/TimelineBars";
import { UserPicker } from "@/components/strategic/UserPicker";
import {
  DELIVERABLE_MARKER_STYLE,
  DeliverableDiamond,
  DeliverableMarkerLegend,
  useDeliverableStateText,
} from "@/components/strategic/deliverableMarker";
import {
  countDeliverableStates,
  deliverableLateDays,
  deliverableState,
  isDeliverableDone,
} from "@/lib/deliverableState";
import {
  canStartAction,
  chantierBounds,
  chantierDeclaredProgress,
  chantierDependencyAlerts,
  chantierShadesForAxis,
  displayMilestoneId,
  effectiveDueDate,
  currentMilestoneFillPct,
  isProjetMember,
  milestoneTransitionState,
  numberIndicators,
  progressBucket,
  sumProjetBudgets,
  type ProgressBucket,
} from "@/lib/axisLogic";
import { EMPTY_BUDGET, rollupBudgets } from "@/lib/budgetRollup";
import { aggregateLinkedKpis, readKpi } from "@/lib/chantierKpis";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import {
  approverLabel,
  createProjetFlow,
  deleteFlow,
  directGate,
  milestoneFlow,
  newProjetId,
  pendingApprovals,
  updateChantierFlow,
  updateProjetFlow,
  type UpdateFlowResult,
} from "@/lib/strategicApprovalFlows";
import {
  canEditStaffing,
  hierarchyContextFor,
  isLegacyMilestoneMarker,
  isPendingOn,
  isPilotOrAdmin,
  stripUndefined,
  type GatedCategory,
  type StrategicApprovalKind,
  type StrategicApprovalPayload,
  type StrategicApprovalTarget,
} from "@/lib/strategicApprovals";
import {
  chainLabel,
  chantierRights,
  conflictingFields,
  displayName,
  fillTemplate,
  flowOutcomeMessage,
  gatedCategoriesOf,
  pendingRequestsOn,
  projetRights,
  type FlowResultLike,
} from "@/lib/strategicFiche";
import { MultiUserPicker } from "@/components/strategic/MultiUserPicker";
import { PendingApprovalBadge } from "@/components/strategic/PendingApprovalBadge";
import { cn } from "@/lib/utils";
import { addDays, parseISO, todayISO } from "@/lib/dateUtils";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { saveChantierStaffing } from "@/lib/firestore/chantierStaffing";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useRole } from "@/lib/hooks/useRole";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { isAnyAdmin, isReadOnlyUser } from "@/lib/roleProfiles";
import type {
  ActionPrerequisite,
  ActionPrerequisiteKind,
  AuthUser,
  Chantier,
  ChantierAction,
  ChantierMilestoneState,
  ChantierStaffing,
  Deliverable,
  Indicator,
  MilestoneCustomAction,
  MilestoneId,
  MaturityStageConfig,
} from "@/types";
import { formatCurrency, formatNumber, intlTag } from "@/lib/format";

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
  | "contributors"
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

/** Champs optionnels du formulaire projet qu'une édition doit pouvoir EFFACER — voir l'appel
 *  `updateChantierAction` du mode édition. `consumedFte` n'est volontairement pas listé : le
 *  formulaire ne l'édite plus (valeur historique préservée). */
const CLEARABLE_PROJET_FIELDS: Partial<ChantierAction> = {
  description: undefined,
  owner: undefined,
  contributors: undefined,
  sponsor: undefined,
  indicatorId: undefined,
  budget: undefined,
  consumedBudget: undefined,
  deliverables: undefined,
  prerequisites: undefined,
};

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

// Losanges de livrable : code visuel partagé `deliverableMarker.tsx` (Fait plein encre, À faire
// creux, En retard plein rouge corail) — livrable = échéance unique + statut binaire.

/** Largeur de la colonne d'identité des lignes de la timeline de livrables — légèrement plus
 *  étroite que celle du Gantt (`w-64`) : chaque ligne ne porte que le nom du livrable + celui de
 *  son action, pas d'avancement ni d'étape. */
const TIMELINE_LABEL_WIDTH = "w-56";
/** Hauteur d'une ligne de projet sur l'onglet "Timeline" et de sa barre. Les losanges de livrable
 *  sont posés DIRECTEMENT sur la barre (même centre vertical), comme sur la feuille de route
 *  programme (`ProgramRoadmap.tsx`) — plus de sous-piste dédiée sous la barre. */
const DELIVERABLE_LANE_HEIGHT = 30;
const DELIVERABLE_BAR_HEIGHT = 24;
/** Repli de couleur de barre quand l'axe primaire n'a pas de couleur valide — même taupe que
 *  `ProgramRoadmap.tsx` (`FALLBACK_COLOR`). */
const TIMELINE_FALLBACK_COLOR = "#a99e9a";

/** Date ISO ("2026-09-03") → « 03/09/2026 » — même analyse de date que `formatTimelineDay`
 *  (`parseISO`, `lib/dateUtils.ts`) mais rendu numérique DD/MM/YYYY, jour/mois zéro-paddés, plus
 *  compact et plus lisible en gros caractère que le format abrégé "3 sept. 2026" utilisé ailleurs
 *  (infobulles Gantt/Timeline via `formatTimelineDay`, volontairement inchangé). Réservé aux 3
 *  emplacements de cette fiche qui affichent des dates en évidence (en-tête de ligne de levier,
 *  échéances "Livrables attendus", "Période" de l'onglet "Vue d'ensemble" — voir `formatRange`
 *  ci-dessous). */
function formatDateNumeric(iso: string): string {
  const time = parseISO(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleDateString(intlTag(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** « 03/09/2026 → 31/12/2027 ». */
function formatRange(start: string, end: string): string {
  return `${formatDateNumeric(start)} → ${formatDateNumeric(end)}`;
}

/** Formatage d'un montant budgétaire pour `BudgetVsActualBar` (round <n>, blocs "consommé"
 *  chantier/levier) — jusqu'ici aucun montant `allocatedBudget`/`budget` de cette fiche n'était
 *  formaté au-delà du champ de saisie brut (`<input type="number">`), donc pas de convention
 *  d'affichage existante à reprendre à l'identique ; séparateurs de milliers (`Intl.NumberFormat`,
 *  même bibliothèque que `formatFte` de `ChantierStaffingEditor.tsx`) pour rester lisible dans une
 *  barre compacte, devise du programme actif en suffixe (même convention que le libellé du champ
 *  `allocatedBudget` : `{label} ({currency})`). */
function formatBudgetAmount(value: number, currency?: string): string {
  return currency
    ? formatCurrency(value, { currency })
    : formatNumber(value, { maximumFractionDigits: 0 });
}

/** « 10/09/2026 10:33 » — horodatage d'un commentaire de livrable (round <n>), à partir d'un ISO
 *  datetime COMPLET (`Deliverable.comments[].createdAt`). Distinct de `formatTimelineDay` : celui-
 *  ci attend une date ISO simple ("2026-09-03") et ajoute `T00:00:00`, ce qui produit une chaîne
 *  invalide sur un datetime déjà complet (avec heure/millisecondes/`Z`). Même patron que
 *  `formatTimestamp` (app/(app)/admin/history/page.tsx). */
function formatCommentTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(intlTag(), {
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

/** Livrables tels que le formulaire projet les ÉCRIT (échéance effective pré-remplie, intitulé
 *  rogné, sous-étapes à borne vide écartées, livrables sans intitulé ignorés) — partagé par le
 *  submit du formulaire et par la détection « livrables inchangés » du mode édition (sans quoi une
 *  simple normalisation d'un livrable historique partirait en demande de validation). */
function parseFormDeliverables(list: Deliverable[]): Deliverable[] {
  return list
    .map((d) => ({
      ...d,
      label: d.label.trim(),
      phases: d.phases.filter((p) => p.start.length > 0 && p.end.length > 0),
    }))
    .filter((d) => d.label.length > 0);
}
function formDeliverablesOf(raw: ChantierAction["deliverables"]): Deliverable[] {
  return parseFormDeliverables(
    normalizeDeliverables(raw).map((d) => {
      const due = effectiveDueDate(d);
      return due ? { ...d, dueDate: due } : d;
    })
  );
}

/** Prérequis tels que le formulaire les ÉCRIT : EXACTEMENT les clés pertinentes à leur `kind`,
 *  lignes vides ignorées. */
function parseFormPrerequisites(list: ActionPrerequisite[]): ActionPrerequisite[] {
  return list.flatMap((p): ActionPrerequisite[] => {
    if (p.kind === "action") {
      return p.targetActionId
        ? [{ id: p.id, kind: "action", targetActionId: p.targetActionId }]
        : [];
    }
    const label = (p.label ?? "").trim();
    return label ? [{ id: p.id, kind: "external", label, done: p.done ?? false }] : [];
  });
}

/** Retire du patch d'édition les listes (livrables, prérequis) que le formulaire n'a fait que
 *  NORMALISER sans réelle modification — évite une demande de validation « planning » fantôme. */
function dropUnchangedFormLists(
  action: ChantierAction,
  patch: Partial<ChantierAction>
): Partial<ChantierAction> {
  const next = { ...patch };
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(stripUndefined(a ?? [])) === JSON.stringify(stripUndefined(b ?? []));
  if ("deliverables" in next && same(formDeliverablesOf(action.deliverables), next.deliverables)) {
    delete next.deliverables;
  }
  if (
    "prerequisites" in next &&
    same(parseFormPrerequisites(action.prerequisites ?? []), next.prerequisites)
  ) {
    delete next.prerequisites;
  }
  return next;
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
  contributors: string;
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
  /** Titre de la section "ETP mobilisés" du brouillon de staffing (round 29, création uniquement)
   *  — même clé i18n que le titre affiché sur la fiche projet déjà créée (`staffing.projetSectionTitle`,
   *  voir plus bas dans ce fichier), gardé cohérent entre les deux moments. */
  staffingSectionTitle: string;
  description: string;
  deliverables: string;
  deliverablesHint: string;
  noDeliverables: string;
  deliverableLabel: string;
  addDeliverable: string;
  removeDeliverable: string;
  deliverableDueDate: string;
  deliverableDone: string;
  deliverableDueDateMissing: string;
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
  readOnly = false,
}: {
  value: ActionPrerequisite[];
  /** Autres actions du MÊME chantier (l'action éditée exclue) — univers du sélecteur de prérequis
   *  "action". Un prérequis ne référence jamais l'action qui le porte elle-même. */
  otherActions: ChantierAction[];
  labels: PrerequisitesEditorLabels;
  onChange: (next: ActionPrerequisite[]) => void;
  /** Round 25 (gate d'édition COMEX) : cet éditeur est monté DEUX fois — dans `ChantierActionForm`
   *  (déjà inaccessible à un utilisateur en lecture seule, voir le bouton qui ouvre ce formulaire)
   *  et directement sur la ligne de chaque levier (auto-sauvegarde immédiate, PAS derrière un
   *  bouton d'ouverture) — c'est CET usage-là qui a besoin de ce prop. `false` par défaut pour ne
   *  rien changer à l'usage existant dans `ChantierActionForm`. Masque le sélecteur de nature, le
   *  bouton de suppression de ligne et le bouton d'ajout ; les champs restants (cible, libellé,
   *  case "fait") passent en lecture seule (`disabled`) plutôt que d'être retirés, pour que
   *  l'information déjà saisie reste visible. */
  readOnly?: boolean;
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
      <div className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
        {labels.prerequisitesTitle}
      </div>
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
                disabled={readOnly}
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
                    disabled={readOnly}
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
                    disabled={readOnly}
                    onChange={(e) => patchPrerequisite(p.id, { label: e.target.value })}
                    placeholder={labels.prerequisiteExternalPlaceholder}
                    className={`${SMALL_INPUT_CLASS} min-w-0 flex-1`}
                  />
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-secondary">
                    <input
                      type="checkbox"
                      checked={p.done ?? false}
                      disabled={readOnly}
                      onChange={(e) => patchPrerequisite(p.id, { done: e.target.checked })}
                    />
                    {labels.prerequisiteDone}
                  </label>
                </>
              )}

              {!readOnly && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={labels.prerequisiteRemoveRow}
                  title={labels.prerequisiteRemoveRow}
                  onClick={() => removePrerequisite(p.id)}
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={addPrerequisite}>
            <Plus size={12} /> {labels.prerequisiteAddRow}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Case « Fait » d'un livrable — décision PO : un livrable est une ÉCHÉANCE avec un statut BINAIRE
 * Fait / À faire (l'ancien contrôle kanban 3 états « À faire / En cours / Terminé » est supprimé).
 * Purement contrôlé ; écrit `"done"` ou `"todo"` (un `"in_progress"` historique est lu comme « à
 * faire », voir `isDeliverableDone`, lib/deliverableState.ts).
 */
function DeliverableDoneToggle({
  done,
  onChange,
  label,
  disabled = false,
  id,
}: {
  done: boolean;
  onChange: (done: boolean) => void;
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex select-none items-center gap-1.5 text-[12px] font-semibold text-primary",
        disabled ? "cursor-default opacity-60" : "cursor-pointer"
      )}
    >
      <input
        id={id}
        type="checkbox"
        className="h-3.5 w-3.5 accent-black"
        checked={done}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/** « {done}/{total} faits · {late} en retard » — décompte binaire + retard dérivé. */
function DeliverableCountsSummary({
  deliverables,
  labels,
}: {
  deliverables: Deliverable[];
  labels: { doneCount: string; lateCount: string };
}) {
  if (deliverables.length === 0) return null;
  const counts = countDeliverableStates(deliverables);
  return (
    <span className="text-[11px] font-medium normal-case tracking-normal text-tertiary">
      {labels.doneCount
        .replace("{done}", String(counts.done))
        .replace("{total}", String(counts.total))}
      {counts.late > 0 && (
        <span className="text-bp-coral">
          {" · "}
          {labels.lateCount.replace("{n}", String(counts.late))}
        </span>
      )}
    </span>
  );
}

/**
 * Modale de détail d'UN livrable (round <n>, onglet "Timeline" fusionné) — ouverte au clic sur son
 * losange. Échéance (seule date d'un livrable, obligatoire : une saisie vidée n'est pas écrite),
 * case « Fait » (`DeliverableDoneToggle`, statut binaire) et fil de commentaires en écriture
 * directe (`onPatch`, auto-sauvegarde immédiate comme
 * `updateActionPrerequisites`/`updateActionKanbanStatus`). Rendu via `Modal` (portal Radix) plutôt
 * qu'un `Popover` : le contenu est trop riche pour un panneau ancré, et un losange proche du bord
 * droit du Gantt scrollable couperait un popover non-porté.
 */
function DeliverableDetailModal({
  deliverable,
  labels,
  users,
  currentUsername,
  readOnly = false,
  onClose,
  onPatch,
}: {
  deliverable: Deliverable;
  labels: {
    dueDate: string;
    done: string;
    comments: string;
    commentPlaceholder: string;
    noComments: string;
    add: string;
    close: string;
  };
  users: AuthUser[];
  currentUsername?: string;
  /** Pas de droit d'édition sur le projet (ou champ en attente de validation) : échéance et case
   *  « Fait » désactivées, ajout de commentaire masqué. */
  readOnly?: boolean;
  onClose: () => void;
  onPatch: (patch: Partial<Deliverable>) => void;
}) {
  const [commentText, setCommentText] = useState("");
  const { stateLabel } = useDeliverableStateText();
  const comments = [...(deliverable.comments ?? [])].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
  const state = deliverableState(deliverable);
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
        {labels.dueDate} <span className="text-bp-coral">*</span>
        <DateInput
          required
          disabled={readOnly}
          className={INPUT_CLASS}
          value={effectiveDueDate(deliverable) ?? ""}
          // Échéance obligatoire : une saisie vidée n'est jamais écrite (pas de `undefined` envoyé
          // à Firestore, et un livrable reste toujours daté).
          onChange={(v) => {
            if (v) onPatch({ dueDate: v });
          }}
        />
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <DeliverableDoneToggle
          id={`deliverable-done-${deliverable.id}`}
          done={isDeliverableDone(deliverable)}
          label={labels.done}
          disabled={readOnly}
          onChange={(done) => onPatch({ status: done ? "done" : "todo" })}
        />
        <span className="inline-flex items-center gap-1.5 text-[11.5px] text-secondary">
          <DeliverableDiamond state={state} size={8} />
          {stateLabel(state, deliverableLateDays(deliverable))}
        </span>
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
        <div className={cn("mt-2 flex gap-2", readOnly && "hidden")}>
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
  labels,
  onCancel,
  onSubmit,
}: {
  actions: ChantierAction[];
  labels: {
    title: string;
    leverSelect: string;
    deliverableLabel: string;
    dueDate: string;
    done: string;
    save: string;
    cancel: string;
  };
  onCancel: () => void;
  onSubmit: (
    actionId: string,
    values: { label: string; dueDate: string; status: "done" | "todo" }
  ) => void;
}) {
  const [actionId, setActionId] = useState(actions.length === 1 ? actions[0].id : "");
  const [label, setLabel] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [done, setDone] = useState(false);
  const status = done ? "done" : "todo";
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
        {labels.dueDate} <span className="text-bp-coral">*</span>
        <DateInput
          required
          className={INPUT_CLASS}
          value={dueDate}
          onChange={(v) => setDueDate(v)}
        />
      </label>

      <div className="mt-3">
        <DeliverableDoneToggle
          id="add-deliverable-done"
          done={done}
          label={labels.done}
          onChange={setDone}
        />
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
/** Convertit une ligne du brouillon ETP de création (`StaffingDraftTable.tsx`, round 29) en vraie
 *  `ChantierStaffing` rattachée à un projet réel. Même génération d'id que la fonction homonyme
 *  (non exportée) de `ChantierStaffingEditor.tsx` — dupliquée ici à l'identique plutôt
 *  qu'exportée, cette dernière n'ayant pas vocation à devenir une API publique de ce fichier.
 *
 * `projectDates` (retour PO : une ligne ETP saisie à la création d'un projet n'apparaissait ni sur
 * la page globale `/effectifs` ni sur les vues « par période » de l'onglet Effectifs du chantier)
 * — `Début`/`Fin` sont FACULTATIFS dans `StaffingDraftTable` (même choix que le formulaire d'ajout
 * de `ChantierStaffingEditor`, une ligne peut légitimement n'avoir aucune échéance connue), mais
 * TOUTE vue « par période » de la page `/effectifs` (`lib/staffingNeed.ts`, `staffingPeriodBuckets`
 * dans `lib/axisLogic.ts`) ignore silencieusement une ligne sans `startDate` — par conception,
 * documentée sur place, pas un bug de ces fonctions-là. Une ligne rattachée à un projet a toujours
 * une période de référence évidente et déjà saisie obligatoirement (`start`/`end` du projet lui-même,
 * champs requis du formulaire) : on l'utilise comme valeur par défaut plutôt que de laisser la ligne
 * sans date par simple oubli de l'utilisateur dans le mini-tableau ETP. Un `startDate`/`endDate`
 * explicitement saisi dans le brouillon reste toujours prioritaire. */
export function draftRowToStaffing(
  row: StaffingDraftRow,
  ids: { companyId: string; programId: string; chantierId: string; actionId: string },
  projectDates: { start: string; end: string }
): ChantierStaffing {
  return {
    id: `ST-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    companyId: ids.companyId,
    programId: ids.programId,
    chantierId: ids.chantierId,
    actionId: ids.actionId,
    function: row.function,
    fte: row.fte,
    ...(row.note ? { note: row.note } : {}),
    startDate: row.startDate || projectDates.start,
    endDate: row.endDate || projectDates.end,
    createdAt: todayISO(),
  };
}

function ChantierActionForm({
  initial,
  stages,
  users,
  otherActions,
  indicators,
  currency,
  chantierAllocatedBudget,
  companyId,
  showStaffingDraft = false,
  designation,
  pendingField,
  approvalHint,
  onSubmit,
  onCancel,
  labels,
}: {
  initial?: Partial<ChantierActionFormValues>;
  /** Droits de désignation (lib/strategicFiche.ts) : responsable projet (sponsor de chantier et
   *  au-dessus) et contributeurs (responsable projet et au-dessus). Champ en lecture seule, avec
   *  infobulle expliquant qui peut le modifier, quand le droit manque. Absent = tout éditable. */
  designation?: {
    canOwner: boolean;
    canContributors: boolean;
    ownerTooltip: string;
    contributorsTooltip: string;
  };
  /** Champ déjà en attente de validation (édition) : badge rendu sous le champ, et champ
   *  désactivé pour éviter une seconde demande conflictuelle. `null` = rien en attente. */
  pendingField?: (field: keyof ChantierActionFormValues) => ReactNode | null;
  /** Aperçu « Sera validé par X puis Y » calculé sur les valeurs courantes (vide = appliqué
   *  directement). */
  approvalHint?: (values: ChantierActionFormValues) => string;
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
  /** Entreprise active — nécessaire au tableau ETP brouillon (`StaffingDraftTable`, round 29) pour
   *  résoudre les équipes proposables (`useCompanyDepartments`), exactement comme
   *  `ChantierStaffingEditor` en a besoin ailleurs sur cette fiche. Non lu quand
   *  `showStaffingDraft` est `false` (mode édition, voir ce prop). */
  companyId: string;
  /** `true` UNIQUEMENT depuis l'appel "Nouveau projet" (round 29 — retour PO : « il me faut le
   *  tableau ETP directement dans le formulaire de création, pas juste un total »). `false` en
   *  édition : le projet existe déjà, son VRAI tableau ETP (`ChantierStaffingEditor`, avec
   *  `scopedToActionId`) est déjà affiché ailleurs sur cette même fiche, pas la peine d'en dupliquer
   *  un second, buffé, ici. */
  showStaffingDraft?: boolean;
  /** `draftStaffing` : lignes ETP saisies dans le tableau brouillon ci-dessus (vide si
   *  `showStaffingDraft` est `false`, ou si l'utilisateur n'a rien ajouté) — l'appelant les convertit
   *  en vraies `ChantierStaffing` une fois le projet réellement créé/approuvé (voir
   *  `ChantierDetailPanel.tsx`, l'`onSubmit` du "Nouveau projet"). Volontairement PAS ajouté à
   *  `ChantierActionFormValues` : ce type est aussi celui de l'édition, où ce brouillon n'a pas de
   *  sens (après création, le staffing se modifie UNIQUEMENT dans l'onglet "Effectifs" du chantier —
   *  règle PO — la fiche projet n'en montre qu'une vue en lecture seule). */
  /** `draftCustomMilestoneActions` : actions personnalisées ajoutées jalon par jalon dans l'aperçu
   *  J0→J4 ci-dessous (round "aperçu jalons création", `MilestonePreviewEditor`) — vide si
   *  `showStaffingDraft` est `false`, ou si l'utilisateur n'a rien ajouté. Même discipline que
   *  `draftStaffing` : bufferisé en mémoire ici, converti par l'appelant en
   *  `ChantierAction.customMilestoneActions` une fois le projet réellement créé/approuvé.
   *
   *  `draftExcludedMilestoneItems` : items FIXES exclus jalon par jalon dans le même aperçu J0→J4
   *  (round "exclusion jalons création") — même discipline exacte que `draftCustomMilestoneActions`
   *  ci-dessus, converti par l'appelant en `ChantierAction.excludedMilestoneItems`. */
  onSubmit: (
    values: ChantierActionFormValues,
    draftStaffing: StaffingDraftRow[],
    draftCustomMilestoneActions: Partial<Record<MilestoneId, MilestoneCustomAction[]>>,
    draftExcludedMilestoneItems: Partial<Record<MilestoneId, string[]>>
  ) => void | Promise<void>;
  onCancel: () => void;
  labels: ChantierActionFormLabels;
}) {
  const today = todayISO();
  const [name, setName] = useState(initial?.name ?? "");
  const [owner, setOwner] = useState<string | undefined>(initial?.owner);
  const [contributors, setContributors] = useState<string[]>(initial?.contributors ?? []);
  // Plus de « sponsor » de projet saisissable (décision PO : pas de sponsor COMEX, seul le
  // Membre du COMEX existe, en vue seule) — valeur historique conservée telle quelle à l'édition.
  const sponsor = initial?.sponsor;
  const [start, setStart] = useState(initial?.start ?? today);
  const [end, setEnd] = useState(initial?.end ?? addDays(today, 30));
  // Round <n> : le champ "Étape" (MaturityStageConfig, Défini/Validé/Planifié/Exécuté/Réalisé)
  // n'est plus saisi dans ce formulaire — retour PO : le suivi d'un projet passe désormais
  // ENTIÈREMENT par ses jalons J0→J4 (`ChantierAction.milestones`), cette étape historique n'a
  // plus aucun rôle dans l'affichage (voir `chantierProgress()`, lib/axisLogic.ts, qui la
  // consommait mais n'est plus appelé nulle part depuis round 18/26 — laissé dans le code pour
  // compat des documents existants). `status` reste dans le TYPE (encore requis) et vaut
  // silencieusement la première étape configurée, sans jamais être exposé/modifiable ici.
  const [status] = useState(initial?.status ?? stages[0]?.id ?? "");
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
  // Round <n> : le champ "ETP consommés" (un seul nombre déclaratif) a été retiré de ce
  // formulaire — la table ETP scopée au projet (`StaffingDraftTable` à la création,
  // `ChantierStaffingEditor scopedToActionId` en édition, round 28/29) est désormais la SEULE
  // source pour le suivi ETP du projet, plus précise (qui/équipe/dates/taux) et déjà affichée à
  // l'écran juste après. `ChantierAction.consumedFte` reste dans le type (compat des documents
  // existants) mais n'est plus jamais écrit par CE formulaire, ni en création ni en édition —
  // `updateChantierAction` fusionne son patch sur le document existant (jamais un remplacement
  // intégral), une valeur déjà enregistrée n'est donc pas effacée en éditant un projet via ce
  // formulaire pour un autre champ.
  // Brouillon ETP (round 29, `showStaffingDraft` uniquement) — jamais réinitialisé depuis `initial`
  // (l'édition ne passe pas `showStaffingDraft`, donc ne rend jamais `StaffingDraftTable` et ne lit
  // jamais cet état).
  const [staffingDraft, setStaffingDraft] = useState<StaffingDraftRow[]>([]);
  // Brouillon d'actions personnalisées J0→J4 (round "aperçu jalons création", `showStaffingDraft`
  // uniquement, même garde que `staffingDraft` ci-dessus) — jamais réinitialisé depuis `initial`
  // pour la même raison : l'édition ne rend jamais `MilestonePreviewEditor`.
  const [customMilestoneActionsDraft, setCustomMilestoneActionsDraft] = useState<
    Partial<Record<MilestoneId, MilestoneCustomAction[]>>
  >({});
  // Brouillon d'exclusion d'items fixes J0→J4 (round "exclusion jalons création"), même garde
  // `showStaffingDraft` et même non-réinitialisation depuis `initial` que
  // `customMilestoneActionsDraft` ci-dessus.
  const [excludedMilestoneItemsDraft, setExcludedMilestoneItemsDraft] = useState<
    Partial<Record<MilestoneId, string[]>>
  >({});
  const [description, setDescription] = useState(initial?.description ?? "");
  // Un champ de saisie PAR livrable (plus de convention « une ligne = un livrable »). Livrable =
  // ÉCHÉANCE (décision PO) : une seule date, pré-remplie depuis l'échéance effective d'un livrable
  // historique (fin de sa dernière phase si pas de `dueDate`), et une case « Fait ».
  const [deliverables, setDeliverables] = useState<Deliverable[]>(() =>
    normalizeDeliverables(initial?.deliverables).map((d) => {
      const due = effectiveDueDate(d);
      return due ? { ...d, dueDate: due } : d;
    })
  );
  const [prerequisites, setPrerequisites] = useState<ActionPrerequisite[]>(
    initial?.prerequisites ?? []
  );
  const [submitting, setSubmitting] = useState(false);

  const requiredFieldsMissing = name.trim().length === 0 || start.length === 0 || end.length === 0;

  // Validation du budget levier (round 12) — voir le commentaire du prop `chantierAllocatedBudget`.
  // Une saisie vide ou non numérique compte pour 0 dans la projection, même parti pris que
  // `sumProjetBudgets` ("un levier sans budget renseigné compte pour 0, jamais exclu").
  const trimmedBudget = budgetInput.trim();
  const parsedBudget = trimmedBudget === "" ? undefined : Number(trimmedBudget);
  const otherLeviersBudgetSum = otherActions.reduce((sum, a) => sum + (a.budget ?? 0), 0);
  const projectedLeviersBudgetTotal =
    otherLeviersBudgetSum +
    (parsedBudget !== undefined && !Number.isNaN(parsedBudget) ? parsedBudget : 0);
  // `budgetExceeds` reste calculé (signal utile, affiché en information près du champ budget
  // ci-dessous) mais NE bloque plus jamais la création/l'enregistrement du projet (retour PO : un
  // dépassement de budget est possible, ce n'est pas une erreur — les responsables du chantier et
  // de l'axe le verront à la validation de la double approbation "projet_create", voir
  // `lib/strategicApprovals.ts`). Même principe déjà appliqué au consommé juste en dessous.
  const budgetExceeds =
    chantierAllocatedBudget !== undefined && projectedLeviersBudgetTotal > chantierAllocatedBudget;

  // Consommé (round <n>) — même parti pris de parsing que `parsedBudget` ci-dessus, pas de
  // validation de plafond (le dépassement est une information, pas une erreur bloquante : voir
  // `BudgetVsActualBar` qui le signale déjà visuellement en rouge).
  const trimmedConsumedBudget = consumedBudgetInput.trim();
  const parsedConsumedBudget =
    trimmedConsumedBudget === "" ? undefined : Number(trimmedConsumedBudget);

  // Échéance OBLIGATOIRE pour tout livrable ayant un intitulé (un livrable sans intitulé est
  // simplement ignoré au submit, voir plus bas).
  const deliverableDueDateMissing = deliverables.some(
    (d) => d.label.trim().length > 0 && !d.dueDate
  );

  const canSubmit = !requiredFieldsMissing && !deliverableDueDateMissing && !submitting;

  const patchDeliverable = (id: string, patch: Partial<Deliverable>) =>
    setDeliverables((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));

  /** Échéance saisie : une valeur vidée RETIRE la clé (jamais `dueDate: undefined`, que `setDoc`
   *  rejetterait) — le submit reste de toute façon bloqué tant qu'elle manque. */
  const setDeliverableDueDate = (id: string, value: string) =>
    setDeliverables((list) =>
      list.map((d) => {
        if (d.id !== id) return d;
        if (value) return { ...d, dueDate: value };
        const { dueDate: _removed, ...rest } = d;
        void _removed;
        return rest;
      })
    );

  const addDeliverable = () =>
    setDeliverables((list) => [
      ...list,
      { id: makeDeliverableId(), label: "", phases: [], status: "todo" },
    ]);

  const removeDeliverable = (id: string) =>
    setDeliverables((list) => list.filter((d) => d.id !== id));

  /** Valeurs telles qu'écrites au submit (aussi utilisées pour l'aperçu de validation). */
  const buildValues = (): ChantierActionFormValues => {
    // Même esprit que l'ancien `.filter(Boolean)` sur les lignes : un livrable sans intitulé
    // n'est pas écrit. Les `phases` historiques (legacy, plus éditables) sont conservées telles
    // quelles — seule une sous-étape à borne vide est écartée, comme avant.
    const parsedDeliverables = parseFormDeliverables(deliverables);
    // Reconstruit chaque prérequis avec EXACTEMENT les clés pertinentes à son `kind` — jamais de
    // clé `undefined` (voir note "clés OMISES" plus bas) : un prérequis "action" sans cible ou
    // "external" sans libellé est simplement ignoré (ligne laissée vide par l'utilisateur).
    const parsedPrerequisites = parseFormPrerequisites(prerequisites);
    // Clés OMISES (jamais `undefined`) quand vides : `setDoc` rejette toute valeur `undefined`,
    // voir `optionalIndicatorFields` dans `components/admin/IndicatorsEditor.tsx` — c'est la
    // cause racine du bug "le formulaire ne fait rien" sur un champ optionnel laissé vide.
    return {
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(owner ? { owner } : {}),
      ...(contributors.length > 0 ? { contributors } : {}),
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
      ...(parsedDeliverables.length > 0 ? { deliverables: parsedDeliverables } : {}),
      ...(parsedPrerequisites.length > 0 ? { prerequisites: parsedPrerequisites } : {}),
    };
  };

  const hint = approvalHint ? approvalHint(buildValues()) : "";
  const pendingOf = (field: keyof ChantierActionFormValues) => pendingField?.(field) ?? null;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(
        buildValues(),
        staffingDraft,
        customMilestoneActionsDraft,
        excludedMilestoneItemsDraft
      );
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
        <div>
          <UserPicker
            users={users}
            value={owner}
            onChange={setOwner}
            label={`${labels.owner} ${labels.optional}`}
            id="ca-owner"
            disabled={(designation ? !designation.canOwner : false) || !!pendingOf("owner")}
            title={designation && !designation.canOwner ? designation.ownerTooltip : undefined}
          />
          {pendingOf("owner")}
        </div>
        <div>
          <MultiUserPicker
            users={users}
            value={contributors}
            onChange={setContributors}
            label={`${labels.contributors} ${labels.optional}`}
            id="ca-contributors"
            disabled={
              (designation ? !designation.canContributors : false) || !!pendingOf("contributors")
            }
            title={designation?.contributorsTooltip}
          />
          {pendingOf("contributors")}
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-indicator">
            {labels.indicator} {labels.optional}
          </label>
          <select
            id="ca-indicator"
            value={indicatorId ?? ""}
            disabled={!!pendingOf("indicatorId")}
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
          {pendingOf("indicatorId")}
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-start">
            {labels.start} <span className="text-bp-coral">*</span>
          </label>
          <DateInput
            id="ca-start"
            value={start}
            disabled={!!pendingOf("start")}
            onChange={(v) => setStart(v)}
            className={INPUT_CLASS}
          />
          {pendingOf("start")}
        </div>
        <div>
          <label className="text-xs font-medium text-secondary" htmlFor="ca-end">
            {labels.end} <span className="text-bp-coral">*</span>
          </label>
          <DateInput
            id="ca-end"
            value={end}
            disabled={!!pendingOf("end")}
            onChange={(v) => setEnd(v)}
            className={INPUT_CLASS}
          />
          {pendingOf("end")}
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
            disabled={!!pendingOf("budget")}
            onChange={(e) => setBudgetInput(e.target.value)}
            className={INPUT_CLASS}
          />
          {pendingOf("budget")}
          {/* Information, pas un blocage (voir `budgetExceeds` ci-dessus) : le dépassement est
              possible, il sera simplement visible des responsables à la validation. */}
          {budgetExceeds && (
            <p className="mt-1.5 text-[11px] text-tertiary">{labels.budgetExceedsChantier}</p>
          )}
        </div>
        {/* ── Consommé du levier (round <n>) — pendant déclaratif de "budget" ci-dessus pour
          `ChantierAction.consumedBudget`, EXACTE même discipline de saisie (bufferisé jusqu'au
          submit, comme le reste de ce formulaire). Pas d'équivalent ETP ici : voir la note sur
          `consumedFte` près de sa déclaration d'état plus haut dans ce composant. ────────────── */}
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
            disabled={!!pendingOf("consumedBudget")}
            onChange={(e) => setConsumedBudgetInput(e.target.value)}
            className={INPUT_CLASS}
          />
          {pendingOf("consumedBudget")}
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
      </div>

      {/* ── Brouillon ETP (round 29) — SEULEMENT à la création : retour PO explicite, « il me faut
        le tableau ETP directement dans le formulaire, comme sur la fiche d'un projet déjà créé »
        (jusque-là un simple champ "ETP consommés" ci-dessus). Buffé en mémoire (`staffingDraft`) :
        converti en vraies lignes `ChantierStaffing` par l'appelant une fois le projet
        réellement créé/approuvé, jamais écrit directement par ce formulaire. ────────────────── */}
      {showStaffingDraft && (
        <div>
          <span className="text-xs font-medium text-secondary">{labels.staffingSectionTitle}</span>
          <div className="mt-1">
            <StaffingDraftTable
              companyId={companyId}
              rows={staffingDraft}
              onChange={setStaffingDraft}
              projectDates={{ start, end }}
            />
          </div>
        </div>
      )}

      {/* ── Aperçu J0→J4 (round "aperçu jalons création") — SEULEMENT à la création, même garde
        que le brouillon ETP ci-dessus : retour PO explicite, « je veux voir et ajuster les actions
        de chaque jalon AVANT de valider la création de mon projet ». Structure fixe en lecture
        seule (`MILESTONE_CHECKLISTS`, inchangée pour tout projet) + actions personnalisées
        bufferisées ici, converties par l'appelant en `ChantierAction.customMilestoneActions` une
        fois le projet réellement créé/approuvé (voir `MilestonePreviewEditor.tsx`). ───────────── */}
      {showStaffingDraft && (
        <MilestonePreviewEditor
          value={customMilestoneActionsDraft}
          onChange={setCustomMilestoneActionsDraft}
          excludedValue={excludedMilestoneItemsDraft}
          onExcludedChange={setExcludedMilestoneItemsDraft}
        />
      )}

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

                {/* Livrable = ÉCHÉANCE (décision PO) : une seule date obligatoire + case « Fait »
                    (plus de sous-étapes début/fin). */}
                <div className="mt-2 flex flex-wrap items-end gap-3 border-l border-border pl-2.5">
                  <div>
                    <label
                      className="text-[10.5px] font-medium text-tertiary"
                      htmlFor={`ca-deliverable-${d.id}-due`}
                    >
                      {labels.deliverableDueDate} <span className="text-bp-coral">*</span>
                    </label>
                    <DateInput
                      id={`ca-deliverable-${d.id}-due`}
                      required
                      value={d.dueDate ?? ""}
                      onChange={(v) => setDeliverableDueDate(d.id, v)}
                      className={cn(
                        `block ${SMALL_INPUT_CLASS}`,
                        d.label.trim() && !d.dueDate && "border-bp-coral"
                      )}
                    />
                  </div>
                  <div className="pb-1">
                    <DeliverableDoneToggle
                      id={`ca-deliverable-${d.id}-done`}
                      done={isDeliverableDone(d)}
                      label={labels.deliverableDone}
                      onChange={(done) =>
                        patchDeliverable(d.id, { status: done ? "done" : "todo" })
                      }
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

      {(pendingOf("deliverables") || pendingOf("prerequisites")) && (
        <div className="flex flex-wrap items-center gap-2">
          {pendingOf("deliverables")}
          {pendingOf("prerequisites")}
        </div>
      )}

      <div>
        {hint && (
          <p className="mb-2 rounded-md border border-rag-amber-light bg-rag-amber-light/30 px-2 py-1 text-[11.5px] font-medium text-secondary">
            {hint}
          </p>
        )}
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={submit} disabled={!canSubmit}>
            {labels.submit}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {labels.cancel}
          </Button>
        </div>
        {!canSubmit && !submitting && requiredFieldsMissing && (
          <p className="mt-1.5 text-[11px] text-tertiary">{labels.missingHint}</p>
        )}
        {!canSubmit && !submitting && deliverableDueDateMissing && (
          <p className="mt-1.5 text-[11px] text-tertiary">{labels.deliverableDueDateMissing}</p>
        )}
      </div>
    </div>
  );
}

export function ChantierDetailPanel({
  chantierId,
  focusActionId = "",
  initialOpenDeliverable,
  onClose,
}: {
  /** Id du chantier affiché — remplace l'ancien `?id=…` de la route dédiée. */
  chantierId: string;
  /** Action à mettre en évidence à l'ouverture (ex. venant d'un clic sur le Gantt) — remplace
   *  l'ancien `?action=…`. */
  focusActionId?: string;
  /** Livrable précis à ouvrir DIRECTEMENT dans sa propre modale (`DeliverableDetailModal`) dès
   *  l'arrivée sur ce panneau (round <n>) — sourcé depuis un clic sur un livrable de l'accordéon
   *  "Vue par axe" (`AxisChantierProjetAccordion.tsx`, via `StrategicAxesView.tsx`), qui vise un
   *  livrable précis plutôt qu'un simple levier entier (`focusActionId` ci-dessus). Pendant externe
   *  du state interne `openDeliverable` déjà alimenté depuis l'onglet "Timeline" (clic sur un
   *  losange) — voir l'effet qui l'initialise plus bas, même mécanique de prop "fraîche" que
   *  `focusActionId`. */
  initialOpenDeliverable?: { actionId: string; deliverableId: string };
  /** Ferme le panneau (typiquement : retire `?chantier=`/`&action=` de l'URL de la page appelante).
   *  Appelé par tout ce qui, sur l'ancienne route, naviguait AILLEURS (lien retour, suppression) —
   *  voir `navigateAway` ci-dessous pour le cas où il faut en plus une VRAIE navigation. */
  onClose: () => void;
}) {
  const { user } = useRole();
  const { activeProgram, activeProgramId } = useActiveProgram();
  const readOnly = isReadOnlyUser(user, activeProgramId, "strategic");
  const { t, locale } = useTranslation();
  const { tooltip: deliverableTooltip, stateLabel: deliverableStateLabel } =
    useDeliverableStateText();
  const router = useRouter();
  const { showToast } = useToast();

  const data = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const sa = useStrategicApprovalsApi();
  /** Porte des flux : l'API de validation, ou — hors contexte — application directe pour le
   *  pilote/admin SEULEMENT (les autres sont refusés, jamais d'application directe par défaut). */
  const gate = sa ?? directGate(user, activeProgramId);
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);

  /** Ferme le panneau PUIS navigue vers une page réellement différente (ex. la fiche d'axe) — le
   *  panneau ne doit pas rester ouvert « au-dessus » d'une page que l'utilisateur vient de quitter
   *  si jamais il revient en arrière (round 6, point 0). */
  // ── Validation hiérarchique (lib/strategicHierarchy.ts, lib/strategicApprovals.ts) ───────────
  // Toute modification d'un projet passe par `updateProjetFlow`, d'un chantier par
  // `updateChantierFlow` : champs libres appliqués, pilotage → 2 validations, dates/livrables/
  // désignations → 1 validation ; pilote/admin appliquent directement (chaîne vide). Les saisies
  // « au fil de l'eau » (check-lists, prérequis, livrables, poids, champs du chantier) d'un acteur
  // soumis à validation sont BUFFERISÉES dans un brouillon (`projetDrafts` / `chantierDraft`) puis
  // envoyées en UNE demande par catégorie via la barre « Envoyer en validation » — jamais une
  // demande par frappe.
  const isAdmin = !!user && isAnyAdmin(user);
  const approvalData = useMemo(
    () => ({
      programId: activeProgramId,
      axes: data.axes,
      chantiers: data.chantiers,
      chantierActions: data.chantierActions,
      indicators: data.indicators,
      users: data.users,
    }),
    [activeProgramId, data.axes, data.chantiers, data.chantierActions, data.indicators, data.users]
  );
  const rightsFor = (action: ChantierAction) =>
    projetRights({
      username: user?.username,
      isAdmin,
      readOnly,
      ctx: hierarchyContextFor("projet_update", { type: "projet", id: action.id }, approvalData),
    });
  const chainJoiner = t("strategicFiche.chain.then", "puis");
  const chainOf = (steps: { usernames: string[] }[] | undefined) =>
    chainLabel(steps, data.users, chainJoiner);
  const previewTemplate = t("strategicFiche.chain.preview", "Sera validé par {chain}");
  /** « Sera validé par X puis Y » d'une demande de ce kind (vide = appliqué directement). */
  const previewChainText = (
    kind: StrategicApprovalKind,
    target: StrategicApprovalTarget,
    payload?: StrategicApprovalPayload
  ) => {
    if (!sa) return "";
    const label = chainOf(sa.previewChain(kind, target, payload));
    return label ? fillTemplate(previewTemplate, { chain: label }) : "";
  };
  const categoryPayload = (category: GatedCategory) =>
    ({ patch: {}, before: {}, category }) as unknown as StrategicApprovalPayload;
  /** Même aperçu pour une modification de champs touchant ces catégories. */
  const categoriesPreview = (
    kind: "projet_update" | "chantier_update",
    target: StrategicApprovalTarget,
    categories: GatedCategory[]
  ) => {
    if (!sa) return "";
    const labels = Array.from(
      new Set(
        categories
          .map((c) => chainOf(sa.previewChain(kind, target, categoryPayload(c))))
          .filter(Boolean)
      )
    );
    return labels.length ? fillTemplate(previewTemplate, { chain: labels.join(" ; ") }) : "";
  };
  const categoryIsDirect = (
    kind: "projet_update" | "chantier_update",
    target: StrategicApprovalTarget,
    category: GatedCategory
  ) =>
    sa
      ? sa.route(kind, target, categoryPayload(category)).mode === "direct"
      : isPilotOrAdmin(user, activeProgramId);
  const toastOutcome = (
    result: FlowResultLike,
    subject: string,
    fallbackChain?: { usernames: string[] }[]
  ) => {
    const message = flowOutcomeMessage(
      result,
      data.users,
      {
        applied: t("strategicFiche.toast.applied", "Appliqué"),
        pending: t("strategicFiche.toast.pending", "Envoyé en validation : {chain}"),
        partial: t(
          "strategicFiche.toast.partial",
          "Appliqué en partie — le reste est envoyé en validation : {chain}"
        ),
        joiner: chainJoiner,
      },
      fallbackChain
    );
    if (message) showToast(message, subject, "success");
  };
  /** Libellé lisible d'un champ (badges « en attente », conflits). */
  const fieldLabel = (field: string): string => {
    const keys: Record<string, [string, string]> = {
      name: ["strategicAxes.actionName", "Nom"],
      description: ["strategicAxes.actionDescription", "Description"],
      owner: ["strategicAxes.actionOwner", "Responsable"],
      contributors: ["strategicFiche.contributors.label", "Contributeurs"],
      start: ["strategicAxes.actionStart", "Début"],
      end: ["strategicAxes.actionEnd", "Fin"],
      deliverables: ["strategicAxes.deliverables", "Livrables"],
      prerequisites: ["strategicChantierDetail.prerequisites.title", "Prérequis"],
      milestones: ["strategicChantierDetail.milestones.title", "Jalons"],
      customMilestoneActions: ["strategicChantierDetail.milestones.title", "Jalons"],
      budget: ["strategicChantierDetail.actionForm.budgetLabel", "Budget"],
      consumedBudget: ["strategicChantierDetail.actionForm.consumedBudgetLabel", "Consommé"],
      chantierWeightPct: ["projetWeights.weight", "Poids (%)"],
      indicatorId: ["strategicChantierDetail.indicatorSelect.label", "KPI"],
      pilote: ["strategicChantierDetail.pilote", "Pilote"],
      allocatedBudget: ["strategicChantierDetail.envelope", "Enveloppe du chantier"],
      consumedFte: ["strategicChantierDetail.consumedFte", "ETP consommés"],
      confidentialityLevel: [
        "strategicChantierDetail.confidentialityLevel",
        "Niveau de confidentialité",
      ],
      successKpis: ["strategicChantierDetail.successCriteria", "Critères de succès"],
      effort: ["strategicChantierDetail.effort.title", "Grille d'effort"],
    };
    const entry = keys[field];
    return entry ? t(entry[0], entry[1]) : field;
  };
  const conflictToast = (fields: string[]) =>
    showToast(
      t("strategicFiche.pending.conflictTitle", "Déjà en attente de validation"),
      Array.from(new Set(fields.map(fieldLabel))).join(", "),
      "error"
    );

  /** Handler `onRequestDeleteChantier` : suppression directe si l'utilisateur est l'approbateur,
   *  sinon demande d'approbation (à brancher). */
  const onRequestDeleteChantier = async (reason: string) => {
    if (!chantier) return;
    try {
      const preview = sa
        ? sa.previewChain(
            "chantier_delete",
            { type: "chantier", id: chantier.id, name: chantier.name },
            { name: chantier.name }
          )
        : [];
      const outcome = await deleteFlow(
        gate,
        "chantier",
        { id: chantier.id, name: chantier.name },
        reason,
        async () => {
          // Les actions du chantier sont retirées d'abord : elles ne portent pas de `programId`
          // et ne seraient plus rattachables à rien une fois le chantier parti.
          for (const action of chantierActions) {
            await data.removeChantierAction(action.id);
          }
          await data.removeChantier(chantier.id);
        }
      );
      setDeleteTarget(null);
      if (outcome === "pending") {
        toastOutcome({ outcome }, chantier.name, preview);
        return;
      }
      showToast(t("strategicAxes.chantierDeleted"), chantier.name, "success");
      onClose();
    } catch (error) {
      showToast(
        t("leverDetail.approval.error", "Action impossible"),
        error instanceof Error ? error.message : String(error),
        "error"
      );
    }
  };

  /** Handler `onRequestDeleteProjet` : même logique, approbateur = responsable du chantier. */
  const onRequestDeleteProjet = async (actionId: string, reason: string) => {
    const action = chantierActions.find((a) => a.id === actionId);
    if (!action || !chantier) return;
    try {
      const preview = sa
        ? sa.previewChain(
            "projet_delete",
            { type: "projet", id: action.id, name: action.name },
            { name: action.name }
          )
        : [];
      const outcome = await deleteFlow(
        gate,
        "projet",
        { id: action.id, name: action.name },
        reason,
        () => data.removeChantierAction(action.id)
      );
      setDeleteTarget(null);
      if (outcome === "pending") toastOutcome({ outcome }, action.name, preview);
      else showToast(t("strategicAxes.actionDeleted"), action.name, "success");
    } catch (error) {
      showToast(
        t("leverDetail.approval.error", "Action impossible"),
        error instanceof Error ? error.message : String(error),
        "error"
      );
    }
  };

  /** Suppression en attente d'approbation (chantier / projet) — désactive le bouton Supprimer. */
  const pendingChantierDeleteOf = (chantierIdValue: string) =>
    pendingApprovals(sa?.approvals, "chantier_delete", chantierIdValue)[0];
  const pendingProjetDelete = (actionId: string) =>
    pendingApprovals(sa?.approvals, "projet_delete", actionId)[0];
  const pendingDeleteLabel = (a: { approverUsername?: string; approverUsernames: string[] }) =>
    t("strategicDelete.pendingBy", "Suppression en attente d'approbation de {approver}").replace(
      "{approver}",
      approverLabel(a)
        .split(", ")
        .filter(Boolean)
        .map((u) => displayName(u, data.users))
        .join(", ") || "—"
    );

  // ── Passage de jalon d'un projet ──────────────────────────────────────────────────────────────
  // Handlers FACTORISÉS : utilisés à la fois par la check-list du projet (`MilestoneChecklistPanel`)
  // et par la ligne d'état affichée sur la carte du projet dès que la check-list du jalon courant est
  // à 100 %. Flux UNIQUE (plus de circuit à approbateur unique) : un membre du projet (responsable
  // OU contributeur) ou un niveau au-dessus DEMANDE le passage (`milestoneFlow` → demande
  // "milestone" à chaîne N+1 puis N+2, le hook pose le marqueur d'affichage `milestoneApproval`) ;
  // le décideur du palier COURANT confirme/refuse (`sa.approve` / `sa.reject`). Pilote/admin :
  // passage appliqué directement. Marqueur SANS demande à chaîne = reliquat de l'ancien circuit :
  // lecture seule, effaçable par un admin (`sa.clearLegacyMilestone`).
  const milestonePermsFor = (action: ChantierAction) => {
    const hasPendingDecidable = pendingApprovals(sa?.pending, "milestone", action.id).length > 0;
    const legacyPending = isLegacyMilestoneMarker(action, sa?.approvals);
    const canApprove = !readOnly && !!user && !!chantier && hasPendingDecidable;
    const isMember = !!user && isProjetMember(action, user.username);
    return {
      // Contributeurs compris (décision PO) ; au-dessus : sponsors de chantier/d'axe, pilote, admin.
      canSubmit: !readOnly && !!user && (isAnyAdmin(user) || isMember || cRights.canEdit),
      canApprove,
      // Refuser : décideur du palier courant ; reliquat de l'ancien circuit : admin (effacement).
      canReject: canApprove || (!readOnly && legacyPending && isAnyAdmin(user)),
    };
  };

  const requestMilestoneTransition = async (action: ChantierAction) => {
    try {
      if (!user) return;
      const target = { type: "projet" as const, id: action.id, name: action.name };
      const preview = sa ? sa.previewChain("milestone", target) : [];
      const outcome = await milestoneFlow(
        gate,
        action,
        user,
        data.chantiers,
        data.chantierActions,
        (patch) => data.updateChantierAction(action.id, patch)
      );
      if (outcome === "pending") {
        // Demande à paliers créée (le hook pose lui-même le marqueur `milestoneApproval`).
        toastOutcome({ outcome }, action.name, preview);
        return;
      }
      // Admin / pilote du programme : passage APPLIQUÉ directement.
      showToast(
        t("strategicFiche.toast.milestoneApplied", "Passage de jalon appliqué"),
        action.name,
        "success"
      );
    } catch (error) {
      showToast(
        t("leverDetail.approval.error", "Action impossible"),
        error instanceof Error ? error.message : String(error),
        "error"
      );
    }
  };

  const confirmMilestoneTransition = async (action: ChantierAction) => {
    try {
      const pending = pendingApprovals(sa?.approvals, "milestone", action.id)[0];
      if (!sa || !pending) {
        throw new Error(
          t(
            "strategicApprovals.legacyMilestone.notDecidable",
            "Aucune demande de passage de jalon à valider sur ce projet"
          )
        );
      }
      await sa.approve(pending.id);
      showToast(
        t("strategicChantierDetail.milestones.transition.confirmed", "Passage de jalon confirmé"),
        action.name,
        "success"
      );
    } catch (error) {
      showToast(
        t("leverDetail.approval.error", "Action impossible"),
        error instanceof Error ? error.message : String(error),
        "error"
      );
    }
  };

  const refuseMilestoneTransition = async (action: ChantierAction, comment?: string) => {
    try {
      const pending = pendingApprovals(sa?.approvals, "milestone", action.id)[0];
      if (sa && pending) {
        // `sa.reject` exige un commentaire : texte par défaut quand le refus n'en porte pas.
        await sa.reject(
          pending.id,
          comment?.trim() ||
            t("strategicApprovals.rejectedFromSheet", "Refusé depuis la fiche du projet")
        );
      } else if (sa && isLegacyMilestoneMarker(action, sa.approvals)) {
        // Reliquat de l'ancien circuit : effacement (admin), le projet redemandera le passage.
        await sa.clearLegacyMilestone(action.id);
      } else {
        throw new Error(
          t(
            "strategicApprovals.legacyMilestone.notDecidable",
            "Aucune demande de passage de jalon à valider sur ce projet"
          )
        );
      }
      showToast(
        t("leverDetail.approval.rejected", "Demande de validation rejetée"),
        action.name,
        "success"
      );
    } catch (error) {
      showToast(
        t("leverDetail.approval.error", "Action impossible"),
        error instanceof Error ? error.message : String(error),
        "error"
      );
    }
  };

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
  // Round "projet weighting" : autorisation RÉELLE, scopée au propriétaire NOMMÉ du chantier
  // (`Chantier.pilote`) — contrairement au placeholder Performance de `LeverForm.tsx`'s
  // `canEditWorkstreamWeight` ("quiconque peut éditer ce levier"), volontairement plus lâche et
  // documenté comme tel. Suit le même motif que `readOnly`/`isReadOnlyUser` déjà utilisé pour le
  // reste de cette fiche (lecture seule l'emporte toujours), affiné ici par la propriété nommée :
  // seul le pilote opérationnel de CE chantier précis, ou un admin, peut repondérer ses projets.
  // Hiérarchie de validation : sponsor de chantier ET AU-DESSUS (sponsor d'axe, pilote du plan) —
  // les poids étant du pilotage, la saisie d'un sponsor de chantier part en validation.
  const cRights = chantierRights({
    username: user?.username,
    isAdmin,
    readOnly,
    ctx: hierarchyContextFor("chantier_update", { type: "chantier", id: chantierId }, approvalData),
  });
  const canEditProjetWeights = !!chantier && cRights.canEdit;
  // Brouillon ETP à la création d'un projet (staffing = pilotage, `canEditStaffing`) : ligne projet
  // → responsable projet et au-dessus. Un créateur qui ne désigne pas le responsable en devient le
  // responsable (valeur initiale du formulaire) ; comex/RH : jamais. Les lignes voyagent dans la
  // demande "projet_create" (2 validations) ou sont écrites directement par le pilote/admin.
  const canDraftCreationStaffing =
    !!chantier &&
    !readOnly &&
    canEditStaffing(
      user,
      chantier,
      cRights.canDesignateProjectOwner || !user ? null : { owner: user.username, contributors: [] },
      data.axes
    );
  // Round 24 : un chantier appartient désormais potentiellement à PLUSIEURS axes (`axisIds`) —
  // toutes les résolutions ci-dessous, dans l'ordre de `data.axes` (même convention que
  // `chantiersByAxis` ailleurs dans le code).
  const chantierAxes = useMemo(
    () => (chantier ? data.axes.filter((a) => chantier.axisIds.includes(a.id)) : []),
    [data.axes, chantier]
  );
  // Axe PRIMAIRE (`axisIds[0]`, jamais exposé comme tel à l'utilisateur — voir `types/index.ts`) :
  // utilisé UNIQUEMENT ici pour la couleur d'accent de la carte "Vue d'ensemble", qui ne peut
  // structurellement porter qu'une seule couleur (choix de conception non couvert explicitement par
  // le brief round 24, tranché pour rester cohérent avec les autres usages "primaires" du modèle).
  const primaryAxis = chantierAxes[0];

  /** Couleur d'accent (liséré + fond teinté) de la carte "Vue d'ensemble" ci-dessous — même hex
   *  brut que celui déjà consommé par `TimelineBar` (`hexToRgb`/`withAlpha`), avec repli sur le
   *  même gris neutre que `ProgramRoadmap.tsx` (`FALLBACK_COLOR`) quand l'axe n'a pas de couleur
   *  valide, pour rester cohérent avec le reste de l'appli plutôt que d'inventer un nouveau gris. */
  const axisAccentColor = useMemo(
    () => (primaryAxis?.color && hexToRgb(primaryAxis.color) ? primaryAxis.color : "#a99e9a"),
    [primaryAxis]
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

  // ETP PLANIFIÉS (round <n>) — pendant de `sumProjetBudgets`/`allocatedBudget` pour l'ETP : il
  // n'existe pas de champ "ETP cible" déclaratif sur `Chantier` (contrairement au budget), le seul
  // planifié disponible est la somme des lignes de staffing (`ChantierStaffing`, même collection
  // que `ChantierStaffingEditor.tsx`, déjà abonnée via `data.staffing`). Sert de "planned" à la
  // `BudgetVsActualBar` ETP du CHANTIER ci-dessous (round <n> : le pendant PAR LEVIER a été retiré
  // avec le champ "ETP consommés" de `ChantierActionForm`, voir sa note — la table ETP scopée au
  // projet fait déjà foi pour ce niveau, une comparaison planifié/consommé redondante n'y a plus sa
  // place).
  const chantierStaffing = useMemo(
    () => (chantier ? data.staffing.filter((s) => s.chantierId === chantier.id) : []),
    [data.staffing, chantier]
  );
  const plannedFteTotal = chantierStaffing.reduce((sum, s) => sum + (s.fte || 0), 0);

  // KPI proposables au sélecteur optionnel d'un levier (round 8) — même filtre que `KpiPageClient.tsx`
  // (`grouped` useMemo, `macro`/`byChantier`) : indicateurs macro d'UN DES AXES du chantier (pas de
  // `chantierId`) + indicateurs déjà rattachés à CE chantier précis. Jamais un indicateur d'un axe
  // totalement étranger au chantier. Round 24 : un chantier multi-axe propose les macro-KPI de
  // CHACUN de ses axes (`chantier.axisIds.includes(i.axisId)`), décision produit explicite.
  const chantierAvailableIndicators = useMemo(
    () =>
      chantier
        ? data.indicators.filter(
            (i) =>
              (chantier.axisIds.includes(i.axisId) && !i.chantierId) || i.chantierId === chantier.id
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

  // KPI des projets/leviers du chantier (dédupliqués), hors KPI déjà affichés comme critères de succès.
  const linkedKpis = useMemo(
    () =>
      aggregateLinkedKpis(
        chantierActions,
        data.indicators,
        new Set(
          (chantier?.successKpis ?? []).map((k) => k.indicatorId).filter((x): x is string => !!x)
        )
      ),
    [chantierActions, data.indicators, chantier?.successKpis]
  );

  const bounds = useMemo(
    () => (chantier ? chantierBounds(chantier.id, chantierActions) : undefined),
    [chantier, chantierActions]
  );
  // Round "projet weighting" : moyenne PONDÉRÉE des projets (`chantierDeclaredProgress`, par
  // `ChantierAction.chantierWeightPct` — voir `ProjetWeightsEditor.tsx` plus bas) — remplace
  // l'ancienne moyenne simple `chantierMilestoneProgressPct` (round 7) comme figure de progression
  // affichée en tête de fiche chantier, qui elle-même remplaçait la lecture directe de
  // `chantier.milestones` (@deprecated, le suivi E0→E4 vit désormais par levier).
  const progressPct = useMemo(
    () =>
      chantier ? chantierDeclaredProgress(chantier.id, chantierActions, data.projetProgress) : 0,
    [chantier, chantierActions, data.projetProgress]
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
  // Budget alloué/consommé du chantier = somme de ses projets (`rollupBudgets`, même règle que le
  // dashboard et la page Effectifs) — `Chantier.consumedBudget` n'est plus saisi ni lu ici.
  const chantierBudget = useMemo(
    () =>
      chantier
        ? (rollupBudgets([], [chantier], chantierActions).chantiers.get(chantier.id) ??
          EMPTY_BUDGET)
        : EMPTY_BUDGET,
    [chantier, chantierActions]
  );

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
  /** Brouillons de saisie soumise à validation (voir `editProjet` / `editChantier`) : patchs non
   *  encore envoyés, par projet, et pour le chantier. Affichés à la place des valeurs publiées. */
  const [projetDrafts, setProjetDrafts] = useState<Record<string, Partial<ChantierAction>>>({});
  const [chantierDraft, setChantierDraft] = useState<Partial<Chantier>>({});
  /** Suppression en deux temps (clic → « Confirmer »), plutôt qu'un `window.confirm()` natif —
   *  aucun autre écran de l'app n'utilise de dialogue natif. */
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "chantier" } | { kind: "projet"; actionId: string } | null
  >(null);

  // ── Losanges de livrables sur l'onglet "Timeline" (round <n>) — modale de détail (clic sur un
  // losange) et modale de création (bouton "Ajouter un livrable" du `CardHeader`). État de session
  // pur, comme `actionForm`/`pendingDeleteAction` ci-dessus.
  const [openDeliverable, setOpenDeliverable] = useState<{
    actionId: string;
    deliverableId: string;
  } | null>(null);
  const [addDeliverableOpen, setAddDeliverableOpen] = useState(false);

  // Ouverture initiale ciblée sur UN livrable (`initialOpenDeliverable`, prop externe) — même
  // mécanique que l'effet sur `focusActionId` plus bas : keyé sur les valeurs PRIMITIVES de la prop
  // (pas l'objet lui-même, recréé à chaque rendu de l'appelant) pour ne se déclencher qu'à un
  // changement de livrable ciblé réel, jamais à chaque rendu — sans quoi cet effet raflerait la main
  // à chaque fermeture manuelle de la modale par l'utilisateur (`setOpenDeliverable(null)` serait
  // immédiatement écrasé). Une prop FRAÎCHE (ex. un second clic, depuis l'accordéon, sur un autre
  // livrable pendant que le panneau reste monté) prime toujours sur une fermeture manuelle
  // précédente, même parti pris que `focusActionId`.
  useEffect(() => {
    if (initialOpenDeliverable) {
      setOpenDeliverable(initialOpenDeliverable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenDeliverable?.actionId, initialOpenDeliverable?.deliverableId]);

  // ── Onglet "Timeline" (ex-"Progression", fusionné avec l'ex-onglet "Timeline" dédié aux phases
  // de livrables — round <n>, deux vues calendaires disjointes jugées peu lisibles) — une barre par
  // levier, sur son propre axe temporel `action.start` → `action.end`, complétée par un losange par
  // livrable ayant une `dueDate` déclarée (voir `deliverableMarker.tsx`, le rendu plus bas).
  const [progressionScale, setProgressionScale] = useState<TimelineScale>("quarter");
  // Bornes = plages des projets PLUS l'échéance effective de chaque livrable : un livrable daté
  // après la fin de son projet ne doit pas tomber hors de la grille (losange rogné au bord droit).
  const { minTime: progressionMinTime, maxTime: progressionMaxTime } = useMemo(
    () =>
      timelineRange(
        [
          ...chantierActions,
          ...chantierActions.flatMap((a) =>
            normalizeDeliverables(a.deliverables).flatMap((d) => {
              const due = effectiveDueDate(d);
              return due ? [{ start: due, end: due }] : [];
            })
          ),
        ],
        progressionScale
      ),
    [chantierActions, progressionScale]
  );
  /** Couleur des barres de projet de l'onglet "Timeline" — nuance du chantier dans son axe
   *  primaire (`chantierShadesForAxis`), EXACTEMENT celle de ses barres sur la feuille de route
   *  programme (`ProgramRoadmap.tsx`, variante `"soft"`). */
  const progressionBarColor = useMemo(() => {
    if (!chantier || !primaryAxis) return TIMELINE_FALLBACK_COLOR;
    const axisColor =
      primaryAxis.color && hexToRgb(primaryAxis.color)
        ? primaryAxis.color
        : TIMELINE_FALLBACK_COLOR;
    return (
      chantierShadesForAxis(
        axisColor,
        data.chantiers.filter((c) => c.axisIds.includes(primaryAxis.id))
      ).get(chantier.id) ?? axisColor
    );
  }, [chantier, primaryAxis, data.chantiers]);
  const progressionColumns = useMemo(
    () =>
      chantierActions.length === 0
        ? []
        : timelineColumns(progressionMinTime, progressionMaxTime, progressionScale, locale),
    [progressionMinTime, progressionMaxTime, progressionScale, chantierActions.length, locale]
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

  // Règle PO « ETP gérés au niveau chantier » : la fiche d'un projet n'affiche plus ses lignes ETP
  // qu'en lecture seule, avec un lien qui bascule ici sur l'onglet "Effectifs" en y mettant ce
  // projet en avant (pré-sélection du formulaire d'ajout + surlignage de ses lignes). `key`
  // incrémentée à chaque clic pour re-déclencher la pré-sélection même sur le même projet.
  const [staffingFocus, setStaffingFocus] = useState<{ actionId: string; key: number } | undefined>(
    undefined
  );
  const staffingTabRef = useRef<HTMLDivElement>(null);
  const manageStaffingInTab = (actionId: string) => {
    setStaffingFocus((prev) => ({ actionId, key: (prev?.key ?? 0) + 1 }));
    setActiveTab("staffing");
    // Le lien est cliqué au fond d'une carte projet : on ramène la vue sur l'onglet affiché.
    requestAnimationFrame(() =>
      staffingTabRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    );
  };

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

  // ── Écritures : TOUJOURS via les flux de validation (lib/strategicApprovalFlows.ts) ───────────
  const chantierTarget: StrategicApprovalTarget = {
    type: "chantier",
    id: chantier.id,
    name: chantier.name,
  };
  const projetTarget = (action: ChantierAction): StrategicApprovalTarget => ({
    type: "projet",
    id: action.id,
    name: action.name,
  });
  const logSaveError = (error: unknown, what: "chantier" | "projet") => {
    console.error(`[betrack] échec d'enregistrement (${what}) :`, error);
    showToast(
      t(
        what === "chantier"
          ? "strategicAxes.chantierSaveErrorTitle"
          : "strategicAxes.actionSaveErrorTitle"
      ),
      error instanceof Error && error.message
        ? error.message
        : t(
            what === "chantier"
              ? "strategicAxes.chantierSaveError"
              : "strategicAxes.actionSaveError"
          ),
      "error"
    );
  };

  /** Projet tel qu'affiché : valeurs publiées + brouillon non envoyé. */
  const effectiveAction = (action: ChantierAction): ChantierAction =>
    projetDrafts[action.id] ? { ...action, ...projetDrafts[action.id] } : action;
  const discardProjetDraft = (actionId: string) =>
    setProjetDrafts((d) => {
      const next = { ...d };
      delete next[actionId];
      return next;
    });

  /** Envoie un patch de projet via `updateProjetFlow` (refus si un champ modifié a déjà une demande
   *  en attente). `quiet` : pas de toast « Appliqué » (saisie au fil de l'eau). `null` = refusé. */
  const submitProjetPatch = async (
    action: ChantierAction,
    patch: Partial<ChantierAction>,
    quiet = false
  ): Promise<UpdateFlowResult<ChantierAction> | null> => {
    const conflicts = conflictingFields(
      sa?.approvals,
      projetTarget(action),
      "projet",
      action,
      patch
    );
    if (conflicts.length) {
      conflictToast(conflicts);
      return null;
    }
    const result = await updateProjetFlow(gate, action, patch, (p) =>
      data.updateChantierAction(action.id, p)
    );
    if (!(quiet && result.outcome === "applied")) toastOutcome(result, action.name);
    return result;
  };

  /** Saisie AU FIL DE L'EAU sur un projet (check-list, prérequis, livrable, poids…) : appliquée
   *  tout de suite si l'acteur n'a besoin d'aucune validation pour ces champs (pilote, admin,
   *  champs libres), sinon accumulée dans le brouillon du projet, envoyé par sa barre dédiée. */
  const editProjet = (action: ChantierAction, patch: Partial<ChantierAction>) => {
    if (!rightsFor(action).canEdit) return;
    if (!projetDrafts[action.id]) {
      const categories = gatedCategoriesOf("projet", action, patch);
      if (categories.every((c) => categoryIsDirect("projet_update", projetTarget(action), c))) {
        submitProjetPatch(action, patch, true).catch((error) => logSaveError(error, "projet"));
        return;
      }
    }
    setProjetDrafts((d) => ({ ...d, [action.id]: { ...d[action.id], ...patch } }));
  };

  const submitProjetDraft = async (action: ChantierAction) => {
    const draft = projetDrafts[action.id];
    if (!draft) return;
    try {
      const result = await submitProjetPatch(action, draft);
      if (result) discardProjetDraft(action.id);
    } catch (error) {
      logSaveError(error, "projet");
    }
  };

  /** Chantier tel qu'affiché : valeurs publiées + brouillon non envoyé. */
  const effectiveChantier: Chantier = { ...chantier, ...chantierDraft };

  const submitChantierPatch = async (
    patch: Partial<Chantier>,
    quiet = false
  ): Promise<UpdateFlowResult<Chantier> | null> => {
    const conflicts = conflictingFields(sa?.approvals, chantierTarget, "chantier", chantier, patch);
    if (conflicts.length) {
      conflictToast(conflicts);
      return null;
    }
    const result = await updateChantierFlow(gate, chantier, patch, (p) =>
      data.updateChantier(chantier.id, p)
    );
    if (!(quiet && result.outcome === "applied")) toastOutcome(result, chantier.name);
    return result;
  };

  /** Pendant de `editProjet` pour les champs du CHANTIER (le sponsor de chantier ne fait jamais
   *  bouger son chantier seul : ses saisies de pilotage passent en brouillon puis en validation).
   *  Une valeur `undefined` EFFACE le champ (le hook retire la clé avant `setDoc`). */
  const updateChantierField = (patch: Partial<Chantier>) => {
    if (!cRights.canEdit) return;
    if (Object.keys(chantierDraft).length === 0) {
      const categories = gatedCategoriesOf("chantier", chantier, patch);
      if (categories.every((c) => categoryIsDirect("chantier_update", chantierTarget, c))) {
        submitChantierPatch(patch, true).catch((error) => logSaveError(error, "chantier"));
        return;
      }
    }
    setChantierDraft((d) => ({ ...d, ...patch }));
  };

  const discardChantierDraft = () => {
    setChantierDraft({});
    setAllocatedBudgetInput(
      chantier.allocatedBudget !== undefined ? String(chantier.allocatedBudget) : ""
    );
    setConsumedFteInput(chantier.consumedFte !== undefined ? String(chantier.consumedFte) : "");
  };
  const submitChantierDraft = async () => {
    if (Object.keys(chantierDraft).length === 0) return;
    try {
      const result = await submitChantierPatch(chantierDraft);
      if (result) setChantierDraft({});
    } catch (error) {
      logSaveError(error, "chantier");
    }
  };

  /** Champ du chantier / d'un projet déjà en attente de validation. */
  const chantierFieldPending = (field: string) => isPendingOn(sa?.approvals, chantierTarget, field);
  const projetFieldPending = (action: ChantierAction, field: string) =>
    isPendingOn(sa?.approvals, projetTarget(action), field);
  const conflictTooltip = t(
    "strategicFiche.pending.conflictTooltip",
    "Une demande de validation est déjà en attente sur ce champ : attendez sa décision avant de le modifier à nouveau."
  );

  /** Barre « modifications non envoyées » d'un brouillon : aperçu de la chaîne, envoi, abandon. */
  const renderDraftBar = (
    hint: string,
    onSubmit: () => void,
    onDiscard: () => void,
    conflicts: string[]
  ) => (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-rag-amber bg-rag-amber-light/40 px-2.5 py-1.5 text-[11.5px]">
      <span className="font-semibold text-primary">
        {t("strategicFiche.draft.title", "Modifications non envoyées")}
      </span>
      {hint && <span className="text-secondary">· {hint}</span>}
      {conflicts.length > 0 && (
        <span className="font-semibold text-rag-red">
          ·{" "}
          {fillTemplate(
            t("strategicFiche.draft.conflict", "Déjà en attente de validation : {fields}"),
            { fields: Array.from(new Set(conflicts.map(fieldLabel))).join(", ") }
          )}
        </span>
      )}
      <span className="ml-auto flex gap-1.5">
        <Button
          variant="primary"
          size="sm"
          onClick={onSubmit}
          disabled={conflicts.length > 0}
          title={conflicts.length > 0 ? conflictTooltip : undefined}
        >
          <Send size={12} /> {t("strategicFiche.draft.submit", "Envoyer en validation")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          {t("strategicFiche.draft.discard", "Annuler les modifications")}
        </Button>
      </span>
    </div>
  );

  /** Écrit l'état de jalons (check-lists) d'UN projet — via `editProjet` (pilotage). */
  const updateActionMilestones = (action: ChantierAction, nextState: ChantierMilestoneState) =>
    editProjet(action, { milestones: nextState });

  /** Écrit les prérequis d'UN projet depuis sa carte "Dépendances / Prérequis" — TOUJOURS le
   *  tableau complet, y compris vide (une suppression de la dernière ligne doit persister). */
  const updateActionPrerequisites = (action: ChantierAction, next: ActionPrerequisite[]) =>
    editProjet(action, { prerequisites: next });

  /** Poids déclarés des projets (`ProjetWeightsEditor`) : un patch par projet réellement modifié,
   *  chacun via `editProjet` (pilotage : brouillon pour qui doit être validé). */
  const updateProjetWeights = (next: ChantierAction[]) => {
    // Re-vérifie l'habilitation ICI, pas seulement via la prop `canEdit` de l'éditeur.
    if (!canEditProjetWeights) return;
    for (const a of next) {
      const stored = chantierActions.find((b) => b.id === a.id);
      if (!stored) continue;
      if (effectiveAction(stored).chantierWeightPct === a.chantierWeightPct) continue;
      editProjet(stored, { chantierWeightPct: a.chantierWeightPct });
    }
  };

  /** Patch UN livrable d'UN projet (statut, échéance, commentaire) — réécrit le tableau COMPLET
   *  (`updateChantierAction` fusionne un patch, pas de merge profond sur un tableau). Commentaire
   *  seul = libre ; échéance/statut = planning (1 validation). */
  const updateDeliverable = (
    actionId: string,
    deliverableId: string,
    patch: Partial<Deliverable>
  ) => {
    const action = chantierActions.find((a) => a.id === actionId);
    if (!action) return;
    const next = normalizeDeliverables(effectiveAction(action).deliverables).map((d) =>
      d.id === deliverableId ? { ...d, ...patch } : d
    );
    editProjet(action, { deliverables: next });
  };

  /** Crée un NOUVEAU livrable sur un projet existant (bouton "Ajouter un livrable" de l'onglet
   *  "Timeline") — même discipline que `updateDeliverable`. */
  const addDeliverable = (
    actionId: string,
    values: { label: string; dueDate: string; status: "done" | "todo" }
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
    editProjet(action, {
      deliverables: [
        ...normalizeDeliverables(effectiveAction(action).deliverables),
        newDeliverable,
      ],
    });
  };

  /** Projets que l'utilisateur peut modifier (responsable, contributeur, et au-dessus). */
  const editableActions = chantierActions.filter((a) => rightsFor(a).canEdit);
  /** Création de projet : sponsor de chantier et au-dessus, ou responsable d'un projet du chantier
   *  (la création part de toute façon en validation à 2 niveaux). */
  const canCreateProjet =
    !readOnly &&
    !!user &&
    (cRights.canEdit || chantierActions.some((a) => a.owner === user.username));
  const draftedActions = chantierActions.filter((a) => projetDrafts[a.id]);
  const whoCanTooltip = {
    projectOwner: t(
      "strategicFiche.rights.projectOwner",
      "Le responsable projet est désigné par le sponsor de chantier (ou au-dessus)."
    ),
    contributors: t(
      "strategicFiche.rights.contributors",
      "Les contributeurs sont désignés par le responsable projet (ou au-dessus)."
    ),
    chantierSponsor: t(
      "strategicFiche.rights.chantierSponsor",
      "Le sponsor de chantier est désigné par le pilote du plan (ou un administrateur)."
    ),
    projetEdit: t(
      "strategicFiche.rights.projetEdit",
      "Seuls le responsable, les contributeurs du projet et les niveaux supérieurs peuvent le modifier."
    ),
  };

  /** Badge « en attente de validation » d'un champ du chantier. */
  const chantierPendingBadge = (field: string) => (
    <PendingApprovalBadge
      approvals={sa?.approvals}
      target={chantierTarget}
      field={field}
      users={data.users}
      className="mt-1"
    />
  );

  /** Désignation du sponsor de chantier (`pilote`) : éditable par le pilote du plan / un admin
   *  seulement (`canDesignate`), lecture seule avec infobulle sinon. */
  const renderChantierPerson = (field: "pilote", label: string, id: string) => {
    const value = effectiveChantier[field];
    const pending = chantierFieldPending(field);
    const editable = cRights.canDesignateSponsor && !pending;
    return (
      <div>
        {editable ? (
          <UserPicker
            users={data.users}
            value={value}
            onChange={(v) => updateChantierField({ [field]: v })}
            label={label}
            placeholder={t("strategicAxes.unassigned")}
            id={id}
          />
        ) : (
          <div
            title={readOnly ? undefined : pending ? conflictTooltip : whoCanTooltip.chantierSponsor}
          >
            <span className="text-xs font-medium text-text-secondary">{label}</span>
            <div className="mt-1.5 text-[14px] font-semibold text-primary">
              {value ? resolveUserLabel(value, data.users) : t("strategicAxes.unassigned")}
            </div>
          </div>
        )}
        {chantierPendingBadge(field)}
      </div>
    );
  };

  const actionFormLabels: ChantierActionFormLabels = {
    name: t("strategicAxes.actionName"),
    owner: t("strategicAxes.actionOwner"),
    contributors: t("strategicFiche.contributors.label", "Contributeurs"),
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
    deliverableDueDate: t("strategicChantierDetail.deliverableModal.dueDate", "Échéance"),
    deliverableDone: t("strategicChantierDetail.deliverableState.done", "Fait"),
    deliverableDueDateMissing: t(
      "strategicChantierDetail.deliverableState.dueDateMissing",
      "Chaque livrable doit avoir une échéance."
    ),
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
    staffingSectionTitle: t("staffing.projetSectionTitle", "ETP mobilisés sur ce projet"),
    submit: t("common.save"),
    cancel: t("common.cancel"),
  };

  const editedStored =
    actionForm?.mode === "edit"
      ? chantierActions.find((a) => a.id === actionForm.actionId)
      : undefined;
  // Le formulaire d'édition part des valeurs AFFICHÉES (brouillon inclus).
  const editedAction = editedStored ? effectiveAction(editedStored) : undefined;
  const editedRights = editedStored ? rightsFor(editedStored) : undefined;
  /** Droits de désignation, champs en attente et aperçu de validation du formulaire projet. */
  const projetFormGating =
    editedStored && editedRights
      ? {
          designation: {
            canOwner: editedRights.canDesignateOwner,
            canContributors: editedRights.canDesignateContributors,
            ownerTooltip: whoCanTooltip.projectOwner,
            contributorsTooltip: whoCanTooltip.contributors,
          },
          pendingField: (field: keyof ChantierActionFormValues) =>
            projetFieldPending(editedStored, field) ? (
              <PendingApprovalBadge
                approvals={sa?.approvals}
                target={projetTarget(editedStored)}
                field={field}
                users={data.users}
                className="mt-1"
              />
            ) : null,
          approvalHint: (values: ChantierActionFormValues) =>
            categoriesPreview(
              "projet_update",
              projetTarget(editedStored),
              gatedCategoriesOf(
                "projet",
                editedStored,
                dropUnchangedFormLists(editedStored, {
                  ...projetDrafts[editedStored.id],
                  ...CLEARABLE_PROJET_FIELDS,
                  ...values,
                })
              )
            ),
        }
      : {
          // Création : le responsable est désigné par le sponsor de chantier (ou au-dessus) ;
          // sinon le créateur en est le responsable. Contributeurs libres (la création entière
          // part en validation).
          designation: {
            canOwner: cRights.canDesignateProjectOwner,
            canContributors: true,
            ownerTooltip: whoCanTooltip.projectOwner,
            contributorsTooltip: whoCanTooltip.contributors,
          },
          approvalHint: (values: ChantierActionFormValues) =>
            previewChainText("projet_create", chantierTarget, {
              action: { ...values, chantierId: chantier.id } as ChantierAction,
            }),
        };

  // ── Livrables — échéance unique + statut binaire (Fait / À faire, retard dérivé) ───────────
  const deliverableDoneLabel = t("strategicChantierDetail.deliverableState.done", "Fait");
  const deliverableCountLabels = {
    doneCount: t("strategicChantierDetail.deliverableState.doneCount", "{done}/{total} faits"),
    lateCount: t("strategicChantierDetail.deliverableState.lateCount", "{n} en retard"),
  };
  const openDeliverableAction = openDeliverable
    ? chantierActions.find((a) => a.id === openDeliverable.actionId)
    : undefined;
  const openDeliverableItem = openDeliverableAction
    ? normalizeDeliverables(effectiveAction(openDeliverableAction).deliverables).find(
        (d) => d.id === openDeliverable?.deliverableId
      )
    : undefined;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium text-secondary transition hover:border-bp-coral hover:text-bp-coral"
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
              label: t("strategicChantierDetail.tabs.progression", "Chronologie"),
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
        {/* Liséré gauche + fond légèrement teinté de la couleur de l'axe (round <n>) — même patron
            que la carte d'axe de `ProgramRoadmap.tsx` (`borderLeft` + `withAlpha(axisColor, …)`
            en inline `style`, une couleur d'axe arbitraire n'ayant pas de classe Tailwind statique
            correspondante) : la PO trouvait cet onglet "très blanc" comparé au reste de la fiche,
            qui a déjà de la couleur (barre "Avancement", radar "Grille de notation d'effort"). La
            bordure/le fond neutres portés par défaut par `Card` sont neutralisés ci-dessous
            (`border-0 bg-transparent`) pour que ce seul conteneur dessine le cadre de la carte. */}
        <div
          className="mb-4 overflow-hidden rounded-lg border border-border"
          style={{
            borderLeft: `4px solid ${axisAccentColor}`,
            backgroundColor: withAlpha(axisAccentColor, 0.04),
          }}
        >
          <Card className="mb-0 border-0 bg-transparent shadow-none">
            <CardHeader
              title={
                <div className="flex flex-wrap items-center gap-2">
                  <span>{chantier.name}</span>
                </div>
              }
              actions={
                chantierAxes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {chantierAxes.map((a) => (
                      <button
                        key={a.id}
                        onClick={() => navigateAway(`/levers/detail?id=${a.id}`)}
                        className="text-xs font-medium text-secondary hover:text-primary hover:underline"
                      >
                        {a.name}
                      </button>
                    ))}
                  </div>
                )
              }
            />
            <CardBody>
              {Object.keys(chantierDraft).length > 0 &&
                renderDraftBar(
                  categoriesPreview(
                    "chantier_update",
                    chantierTarget,
                    gatedCategoriesOf("chantier", chantier, chantierDraft)
                  ),
                  () => void submitChantierDraft(),
                  discardChantierDraft,
                  conflictingFields(
                    sa?.approvals,
                    chantierTarget,
                    "chantier",
                    chantier,
                    chantierDraft
                  )
                )}
              {pendingRequestsOn(sa?.approvals, chantierTarget)
                .filter((a) => a.kind === "chantier_update")
                .map((a) => (
                  <div key={a.id} className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <PendingApprovalBadge approval={a} users={data.users} />
                    <span className="text-tertiary">
                      {Object.keys((a.payload as { patch?: object }).patch ?? {})
                        .map(fieldLabel)
                        .join(", ")}
                    </span>
                  </div>
                ))}
              {chantier.description && (
                <p className="mb-3 mt-2 max-w-2xl text-[13px] text-secondary">
                  {chantier.description}
                </p>
              )}
              <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {renderChantierPerson(
                  "pilote",
                  t("strategicChantierDetail.pilote"),
                  "chantier-pilote"
                )}
                <div>
                  <span className="text-xs font-medium text-text-secondary">
                    {t("strategicAxes.chantierPeriod")}
                  </span>
                  <div className="mt-1.5 text-[14px] font-semibold text-primary">
                    {bounds
                      ? formatRange(bounds.start, bounds.end)
                      : t("strategicAxes.chantierNoDates")}
                  </div>
                </div>
                <div>
                  <label
                    className="flex items-center gap-1.5 text-xs font-medium text-text-secondary"
                    htmlFor="chantier-allocated-budget"
                  >
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: axisAccentColor }}
                    />
                    {t("strategicChantierDetail.envelope", "Enveloppe du chantier")}
                    {activeProgram?.currency ? ` (${activeProgram.currency})` : ""}
                  </label>
                  <input
                    id="chantier-allocated-budget"
                    type="number"
                    inputMode="decimal"
                    value={allocatedBudgetInput}
                    disabled={!cRights.canEdit || chantierFieldPending("allocatedBudget")}
                    title={chantierFieldPending("allocatedBudget") ? conflictTooltip : undefined}
                    onChange={(e) => setAllocatedBudgetInput(e.target.value)}
                    onBlur={() => {
                      const trimmed = allocatedBudgetInput.trim();
                      const currentEnvelope = effectiveChantier.allocatedBudget;
                      if (trimmed === "") {
                        if (currentEnvelope !== undefined)
                          updateChantierField({ allocatedBudget: undefined });
                        return;
                      }
                      const parsed = Number(trimmed);
                      if (Number.isNaN(parsed) || parsed === currentEnvelope) return;
                      // Round 12 : validation SYMÉTRIQUE de celle du formulaire de levier — le budget
                      // du CHANTIER ne peut pas descendre sous la somme des budgets de ses leviers
                      // ACTUELS (`chantierActions`, pas ce qui est en cours de saisie dans un
                      // formulaire de levier éventuellement ouvert par ailleurs). Rejet : ni écriture,
                      // ni tentative — l'input revient à la dernière valeur enregistrée, et un toast
                      // explique pourquoi (même canal que `updateChantierField`/`clearChantierField`).
                      // Règle symétrique : on refuse seulement de FIXER/BAISSER l'enveloppe sous le
                      // total des projets. Relever l'enveloppe reste toujours possible (même si elle
                      // reste sous ce total — la situation s'améliore), comme un projet peut
                      // toujours dépasser l'enveloppe (information, pas blocage).
                      const leviersBudgetSum = sumProjetBudgets(chantier.id, chantierActions);
                      const isRaise =
                        chantier.allocatedBudget !== undefined && parsed > chantier.allocatedBudget;
                      if (parsed < leviersBudgetSum && !isRaise) {
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
                  {chantierPendingBadge("allocatedBudget")}
                </div>
                {/* ── Budget alloué / consommé du chantier — LECTURE SEULE, somme de ses projets
                (`rollupBudgets`, lib/budgetRollup.ts), même règle que dashboard/Effectifs. La saisie
                manuelle `Chantier.consumedBudget` n'est plus proposée ni lue (le consommé se saisit
                par projet). L'enveloppe ci-dessus n'est qu'un plafond indicatif. */}
                <div>
                  <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: axisAccentColor }}
                    />
                    {t("strategicChantierDetail.allocatedBudget")}
                    {" / "}
                    {t("strategicChantierDetail.consumedBudget")}
                  </span>
                  <div className="mt-1.5 text-[14px] font-semibold text-primary">
                    {formatBudgetAmount(chantierBudget.allocated, activeProgram?.currency)}
                    <span className="font-normal text-text-secondary">
                      {" · "}
                      {formatBudgetAmount(chantierBudget.consumed, activeProgram?.currency)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-tertiary">
                    {t(
                      "strategicChantierDetail.budgetFromProjets",
                      "Somme des budgets de ses projets"
                    )}
                  </p>
                  <BudgetVsActualBar
                    className="mt-2"
                    planned={chantierBudget.allocated}
                    consumed={chantierBudget.consumed}
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
                    disabled={!cRights.canEdit || chantierFieldPending("consumedFte")}
                    title={chantierFieldPending("consumedFte") ? conflictTooltip : undefined}
                    onChange={(e) => setConsumedFteInput(e.target.value)}
                    onBlur={() => {
                      const trimmed = consumedFteInput.trim();
                      const currentFte = effectiveChantier.consumedFte;
                      if (trimmed === "") {
                        if (currentFte !== undefined)
                          updateChantierField({ consumedFte: undefined });
                        return;
                      }
                      const parsed = Number(trimmed);
                      if (Number.isNaN(parsed) || parsed === currentFte) return;
                      updateChantierField({ consumedFte: parsed });
                    }}
                    className={INPUT_CLASS}
                  />
                  {chantierPendingBadge("consumedFte")}
                  <BudgetVsActualBar
                    className="mt-2"
                    planned={plannedFteTotal}
                    consumed={effectiveChantier.consumedFte ?? 0}
                    formatValue={(n) => `${formatFte(n)} ${t("staffing.fteUnit")}`}
                  />
                </div>
                <div>
                  <span className="text-xs font-medium text-text-secondary">
                    {t("strategicAxes.progress")}
                  </span>
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className="h-2.5 flex-1 overflow-hidden rounded-full"
                      style={{ backgroundColor: withAlpha(axisAccentColor, 0.15) }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${progressPct}%`,
                          backgroundColor: primaryAxis?.color ?? "var(--bp-warm-taupe)",
                        }}
                      />
                    </div>
                    <span className="shrink-0 text-[15px] font-bold text-primary">
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
                      {t(
                        "strategicChantierDetail.confidentialityLevel",
                        "Niveau de confidentialité"
                      )}
                    </label>
                    <select
                      id="chantier-confidentiality"
                      className={INPUT_CLASS}
                      value={effectiveChantier.confidentialityLevel ?? ""}
                      disabled={!cRights.canEdit || chantierFieldPending("confidentialityLevel")}
                      title={
                        chantierFieldPending("confidentialityLevel") ? conflictTooltip : undefined
                      }
                      onChange={(e) =>
                        updateChantierField({ confidentialityLevel: e.target.value || undefined })
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
                    {chantierPendingBadge("confidentialityLevel")}
                  </div>
                )}
              </div>
            </CardBody>
          </Card>
        </div>

        {/* ── Critères de succès ──────────────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader title={t("strategicChantierDetail.successCriteria")} />
          <CardBody>
            <textarea
              value={successCriteria}
              disabled={!cRights.canEdit}
              onChange={(e) => setSuccessCriteria(e.target.value)}
              onBlur={() => {
                const trimmed = successCriteria.trim();
                if (trimmed === (effectiveChantier.successCriteria ?? "").trim()) return;
                updateChantierField({ successCriteria: trimmed || undefined });
              }}
              rows={3}
              placeholder={t("strategicChantierDetail.successCriteria.placeholder")}
              className={INPUT_CLASS}
            />
            {chantierPendingBadge("successKpis")}
            <SuccessKpiList
              value={effectiveChantier.successKpis ?? []}
              onChange={(next) => updateChantierField({ successKpis: next })}
              indicators={chantierAvailableIndicators}
              measurements={data.measurements}
              indicatorNumbers={indicatorNumbers}
              linkedKpis={linkedKpis}
              onOpenIndicator={(id) => navigateAway(`/kpi?indicator=${id}`)}
              readOnly={!cRights.canEdit || chantierFieldPending("successKpis")}
            />
          </CardBody>
        </Card>

        {/* ── Grille de notation d'effort (round 4, point 7 — SEUL endroit qui l'importe) ────── */}
        <Card>
          <CardHeader title={t("strategicChantierDetail.effort.title")} />
          <CardBody>
            {chantierPendingBadge("effort")}
            <EffortScoringGrid
              value={effectiveChantier.effort ?? {}}
              onChange={(next) => updateChantierField({ effort: next })}
              disabled={!cRights.canEdit || chantierFieldPending("effort")}
            />
          </CardBody>
        </Card>
      </div>

      {/* ── Onglet "Timeline" (ex-"Progression", round 12 ; fusionné round <n> avec l'ex-onglet
          dédié aux phases de livrables) : une barre par levier, même style que la feuille de route
          programme (variante `"soft"`, nuance du chantier) avec son avancement en % — jalons E0→E4
          (round 18, voir `progressionPctFor` en tête de fichier) — complétée d'un losange par
          livrable ayant une échéance EFFECTIVE (`effectiveDueDate`, `lib/axisLogic.ts` : `dueDate`
          déclarée, ou repli sur la fin de sa dernière phase si aucune `dueDate` autonome n'est
          renseignée) (`TimelineMarker`, code visuel via `deliverableMarker.tsx`), sur le MÊME axe
          temporel que la barre de son levier parent (pas un axe séparé — c'est justement ce qui
          manquait à l'ancien onglet dédié). ─────────────────────────────────────────────────────── */}
      <div className={activeTab === "progression" ? undefined : "hidden"}>
        <Card>
          <CardHeader
            title={t("strategicChantierDetail.tabs.progression", "Chronologie")}
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
                {editableActions.length > 0 && (
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
              // `pr-3` : réserve la demi-largeur d'un losange (12px pivoté ≈ 17px) au-delà du bord
              // droit de la piste — un livrable échu pile en fin de grille reste entier au lieu
              // d'être rogné par `overflow-x-auto`. Côté gauche, la colonne d'identité joue ce rôle.
              <>
                <div className="overflow-x-auto">
                  <div className="min-w-[560px] pr-3">
                    <TimelineHeaderRow
                      columns={progressionColumns}
                      yearBands={progressionYearBands}
                      labelWidthClassName={TIMELINE_LABEL_WIDTH}
                    />
                    {chantierActions.map((action) => {
                      const pct = data.projetProgress(action);
                      const left = progressionPctOfComputed(action.start);
                      const width = Math.max(1.5, progressionPctOfComputed(action.end) - left);
                      const dueDeliverables = normalizeDeliverables(action.deliverables).filter(
                        (d) => effectiveDueDate(d) !== undefined
                      );
                      const barTop = (DELIVERABLE_LANE_HEIGHT - DELIVERABLE_BAR_HEIGHT) / 2;
                      return (
                        <div
                          key={action.id}
                          className="flex items-stretch gap-2 border-b border-border/60 py-1 last:border-b-0"
                        >
                          <div
                            className={`${TIMELINE_LABEL_WIDTH} flex shrink-0 items-center truncate text-[12.5px] font-medium text-primary`}
                            title={action.name}
                          >
                            <span className="min-w-0 truncate">{action.name}</span>
                          </div>
                          <div
                            className="relative flex-1"
                            style={{ height: DELIVERABLE_LANE_HEIGHT }}
                          >
                            <TimelineGridColumns columns={progressionColumns} />
                            {/* Même barre que la feuille de route programme (`ProgramRoadmap.tsx`) :
                              variante `"soft"` teintée de la nuance du chantier — l'avancement reste
                              affiché en clair dans la barre et dans l'infobulle. */}
                            <TimelineBar
                              left={left}
                              width={width}
                              top={barTop}
                              height={DELIVERABLE_BAR_HEIGHT}
                              color={progressionBarColor}
                              variant="soft"
                              progressPct={pct}
                              onClick={() => focusLevierFromProgression(action.id)}
                              ariaLabel={action.name}
                              tooltipText={`${action.name} · ${formatTimelineDay(action.start, locale)} → ${formatTimelineDay(
                                action.end,
                                locale
                              )} · ${pct}%`}
                              label={`${pct}%`}
                              labelClassName="min-w-0 flex-1 truncate text-[11px] font-semibold"
                            />
                            {/* Losanges de livrable posés DIRECTEMENT sur la barre (même centre
                              vertical), comme sur la feuille de route programme. */}
                            {dueDeliverables.map((d) => {
                              const due = effectiveDueDate(d)!;
                              const state = deliverableState(d);
                              const markerStyle = DELIVERABLE_MARKER_STYLE[state];
                              return (
                                <TimelineMarker
                                  key={d.id}
                                  leftPct={Math.min(
                                    100,
                                    Math.max(0, progressionPctOfComputed(due))
                                  )}
                                  top={DELIVERABLE_LANE_HEIGHT / 2}
                                  color={markerStyle.fill}
                                  borderColor={markerStyle.border}
                                  onClick={() =>
                                    setOpenDeliverable({ actionId: action.id, deliverableId: d.id })
                                  }
                                  ariaLabel={d.label}
                                  tooltipText={deliverableTooltip(
                                    d.label,
                                    due,
                                    state,
                                    deliverableLateDays(d)
                                  )}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <DeliverableMarkerLegend className="mt-2" />
              </>
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
              !actionForm &&
              canCreateProjet && (
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
                  initial={
                    editedAction ??
                    (cRights.canDesignateProjectOwner || !user
                      ? undefined
                      : { owner: user.username })
                  }
                  stages={stages}
                  users={data.users}
                  otherActions={chantierActions.filter((a) => a.id !== actionForm.actionId)}
                  indicators={chantierAvailableIndicators}
                  currency={activeProgram?.currency}
                  chantierAllocatedBudget={chantier.allocatedBudget}
                  companyId={user?.companyId ?? ""}
                  showStaffingDraft={actionForm.mode === "create" && canDraftCreationStaffing}
                  labels={actionFormLabels}
                  {...projetFormGating}
                  onCancel={() => setActionForm(null)}
                  onSubmit={async (
                    values,
                    draftStaffing,
                    draftCustomMilestoneActions,
                    draftExcludedMilestoneItems
                  ) => {
                    try {
                      if (actionForm.mode === "edit" && actionForm.actionId) {
                        // Le formulaire OMET les champs optionnels vidés : sans cette base de
                        // clés explicitement `undefined`, la fusion de `updateChantierAction`
                        // conservait l'ancienne valeur (impossible d'effacer une description, un
                        // budget, un KPI…). Le hook retire les clés `undefined` avant `setDoc`
                        // (écrasement intégral), ce qui supprime réellement le champ.
                        // Hiérarchie de validation : `updateProjetFlow` (libre / 1 / 2 validations
                        // selon les champs), brouillon au fil de l'eau du projet inclus.
                        const stored = chantierActions.find((a) => a.id === actionForm.actionId);
                        if (!stored) return;
                        const result = await submitProjetPatch(
                          stored,
                          dropUnchangedFormLists(stored, {
                            ...projetDrafts[stored.id],
                            ...CLEARABLE_PROJET_FIELDS,
                            ...values,
                          })
                        );
                        if (!result) return; // conflit : formulaire laissé ouvert
                        discardProjetDraft(stored.id);
                      } else {
                        // `customMilestoneActions`/`excludedMilestoneItems` (round "aperçu jalons
                        // création" / "exclusion jalons création") ne sont ajoutés que si
                        // l'utilisateur a réellement saisi au moins une action/exclusion dans
                        // l'aperçu — jamais une clé vide `{}` par défaut, même discipline "clés
                        // OMISES" que le reste de ce formulaire (voir `ChantierActionForm`'s
                        // `submit`).
                        const hasCustomMilestoneActions =
                          Object.keys(draftCustomMilestoneActions).length > 0;
                        const hasExcludedMilestoneItems =
                          Object.keys(draftExcludedMilestoneItems).length > 0;
                        const action = {
                          ...values,
                          chantierId: chantier.id,
                          id: newProjetId(),
                          companyId: user?.companyId ?? "",
                          ...(hasCustomMilestoneActions
                            ? { customMilestoneActions: draftCustomMilestoneActions }
                            : {}),
                          ...(hasExcludedMilestoneItems
                            ? { excludedMilestoneItems: draftExcludedMilestoneItems }
                            : {}),
                        } as ChantierAction;
                        // Côté demande d'approbation, `action.id` (pré-généré ci-dessus) EST l'id
                        // définitif du projet une fois approuvé (`applyApprovedPayload`, cas
                        // "projet_create") : c'est celui-là qu'on rattache aux lignes ETP du payload.
                        // `customMilestoneActions`/`excludedMilestoneItems` posés directement sur
                        // `action` ci-dessus voyagent avec elle sans plomberie supplémentaire :
                        // `applyApprovedPayload` pousse `payload.action` tel quel dans
                        // `effects.saveActions` (vérifié, contrairement au brouillon ETP round 29,
                        // qui a besoin d'un champ de payload séparé car `ChantierStaffing` est une
                        // collection distincte).
                        // Garde-fou : jamais de lignes ETP sans droit de staffing.
                        if (!canDraftCreationStaffing) draftStaffing = [];
                        const pendingStaffing = draftStaffing.map((row) =>
                          draftRowToStaffing(
                            row,
                            {
                              companyId: user?.companyId ?? "",
                              programId: activeProgramId ?? "",
                              chantierId: chantier.id,
                              actionId: action.id,
                            },
                            { start: values.start, end: values.end }
                          )
                        );
                        const createPreview = sa
                          ? sa.previewChain(
                              "projet_create",
                              { type: "chantier", id: chantier.id, name: chantier.name },
                              { action }
                            )
                          : [];
                        const outcome = await createProjetFlow(
                          gate,
                          chantier,
                          action,
                          async () => {
                            const created = await data.createChantierAction({
                              ...values,
                              chantierId: chantier.id,
                              ...(hasCustomMilestoneActions
                                ? { customMilestoneActions: draftCustomMilestoneActions }
                                : {}),
                              ...(hasExcludedMilestoneItems
                                ? { excludedMilestoneItems: draftExcludedMilestoneItems }
                                : {}),
                            });
                            // Révèle immédiatement le nouveau projet (retour PO : « je ne vois pas
                            // où renseigner J0/J1/J2 » après création) — ses jalons E0→E4 sont déjà
                            // là, juste repliés sous ce même bandeau accordéon.
                            openLevier(created.id);
                            // Côté création DIRECTE, `created.id` (généré par
                            // `data.createChantierAction`, INDÉPENDANT de `action.id` ci-dessus —
                            // voir le commentaire de tête de `newProjetId`) est le SEUL id réel du
                            // projet : les lignes ETP s'y rattachent, jamais à `action.id`.
                            for (const row of draftStaffing) {
                              await saveChantierStaffing(
                                draftRowToStaffing(
                                  row,
                                  {
                                    companyId: user?.companyId ?? "",
                                    programId: activeProgramId ?? "",
                                    chantierId: chantier.id,
                                    actionId: created.id,
                                  },
                                  { start: values.start, end: values.end }
                                )
                              );
                            }
                            return created;
                          },
                          pendingStaffing
                        );
                        if (outcome === "pending") {
                          toastOutcome({ outcome }, values.name, createPreview);
                        } else {
                          showToast(t("strategicAxes.actionCreated"), values.name, "success");
                        }
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

            {pendingApprovals(sa?.approvals, "projet_create")
              .filter(
                (a) => (a.payload as { action: ChantierAction }).action.chantierId === chantier.id
              )
              .map((a) => (
                <div
                  key={a.id}
                  className="mb-2 flex items-center gap-1.5 rounded-md border border-dashed border-border bg-bg-surface/60 px-2 py-1 text-xs italic text-text-secondary opacity-80"
                >
                  <Lock size={11} className="text-rag-amber" />
                  <span className="font-medium">
                    {(a.payload as { action: ChantierAction }).action.name}
                  </span>
                  <span className="ml-auto text-[10.5px]">
                    {t("strategicAxes.pendingCreation", "Création en attente de validation")}
                  </span>
                  <PendingApprovalBadge approval={a} users={data.users} />
                </div>
              ))}

            {/* Brouillons non envoyés (saisies au fil de l'eau soumises à validation) : envoi
                groupé — chaque projet garde aussi sa propre barre sur sa carte. */}
            {draftedActions.length > 1 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-rag-amber bg-rag-amber-light/40 px-2.5 py-1.5 text-[11.5px]">
                <span className="font-semibold text-primary">
                  {fillTemplate(
                    t(
                      "strategicFiche.draft.projetsCount",
                      "{count} projets avec des modifications non envoyées"
                    ),
                    { count: draftedActions.length }
                  )}
                </span>
                <span className="ml-auto flex gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      void (async () => {
                        for (const a of draftedActions) await submitProjetDraft(a);
                      })();
                    }}
                  >
                    <Send size={12} /> {t("strategicFiche.draft.submitAll", "Tout envoyer")}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setProjetDrafts({})}>
                    {t("strategicFiche.draft.discardAll", "Tout annuler")}
                  </Button>
                </span>
              </div>
            )}

            {chantierActions.length > 0 && (
              <div className="mb-3">
                <ProjetWeightsEditor
                  actions={chantierActions.map(effectiveAction)}
                  onChange={updateProjetWeights}
                  canEdit={
                    canEditProjetWeights &&
                    !chantierActions.some((a) => projetFieldPending(a, "chantierWeightPct"))
                  }
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
                  // Droits sur CE projet (responsable, contributeurs et au-dessus) et valeurs
                  // affichées = publiées + brouillon non envoyé.
                  const rights = rightsFor(action);
                  const eff = effectiveAction(action);
                  const draft = projetDrafts[action.id];
                  const deliverablesPending = projetFieldPending(action, "deliverables");
                  const actionDeliverables = normalizeDeliverables(eff.deliverables);
                  const startInfo = canStartAction(
                    action,
                    data.chantierActions,
                    data.projetProgress
                  );
                  // Défaut défensif pour un levier créé avant l'introduction des jalons E0→E4 (round
                  // 5, déplacé au levier round 7) — ou jamais encore touché : "encore à E0, rien de
                  // répondu". N'est écrit en base qu'à la première interaction réelle.
                  const actionMilestones: ChantierMilestoneState = eff.milestones ?? {
                    currentMilestone: "E0",
                    passedMilestones: [],
                    checklists: {},
                  };
                  // Round 12 : `milestoneProgressPct` prend désormais un 2ᵃᵌ argument
                  // (`autoValues`, voir son commentaire dans `lib/axisLogic.ts`) — sans lui les
                  // items `auto` du jalon courant comptent tous pour 0, sous-évaluant cette pastille
                  // dès qu'un item auto est réellement à 100. `actionMilestones.currentMilestone`
                  // porte déjà le défaut "E0" ci-dessus, pas besoin de le re-dériver.
                  // Même chiffre partout (board, Gantt, accordéon, feuille de route) : résolveur du
                  // hook, items auto résolus sur tout le programme.
                  const actionProgressPct = data.projetProgress(action);
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
                  const currentMilestoneAutoFlags = data.projetAutoFlags(action);
                  // Même liste que la porte de validation (exclusions + actions personnalisées).
                  const currentMilestoneProgressPct = Math.round(
                    currentMilestoneFillPct(action, currentMilestoneAutoFlags)
                  );
                  // KPI rattaché au levier (round 8, purement informatif depuis round 18 — voir
                  // `ChantierAction.indicatorId`) — résolu ici pour affichage round 10 (nom + numéro
                  // global).
                  const linkedIndicator = action.indicatorId
                    ? data.indicators.find((i) => i.id === action.indicatorId)
                    : undefined;
                  const linkedIndicatorNumber = linkedIndicator
                    ? indicatorNumbers.get(linkedIndicator.id)
                    : undefined;
                  // Actuel/Cible du KPI rattaché (round 28) — même lecture que `SuccessKpiList`
                  // (`readKpi`, sans `targetOverride` ici : ce n'est pas un critère de succès du
                  // chantier avec sa propre cible, juste l'`objectiveValue` natif de l'indicateur).
                  const linkedIndicatorReading = linkedIndicator
                    ? readKpi(linkedIndicator, data.measurements)
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
                              ? t("strategicChantierDetail.projets.collapse")
                              : t("strategicChantierDetail.projets.expand")
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
                                {displayMilestoneId(actionMilestones.currentMilestone)} ·{" "}
                                {actionProgressPct}%
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-tertiary">
                              <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[14px] font-semibold text-secondary">
                                {formatDateNumeric(action.start)}
                                <span className="mx-1 font-bold text-tertiary">→</span>
                                {formatDateNumeric(action.end)}
                              </span>
                              {action.owner && (
                                <>
                                  <span className="text-[11px] text-tertiary">· </span>
                                  <span className="text-[13px] font-semibold text-primary">
                                    {resolveUserLabel(action.owner, data.users)}
                                  </span>
                                </>
                              )}
                              {(action.contributors?.length ?? 0) > 0 && (
                                <span>
                                  · {t("strategicFiche.contributors.label", "Contributeurs")} :{" "}
                                  {action
                                    .contributors!.map((u) => resolveUserLabel(u, data.users))
                                    .join(", ")}
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
                        {!readOnly && (
                          <div className="flex shrink-0 items-center gap-1">
                            {rights.canEdit && (
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
                            )}
                            {!rights.canEdit && (
                              <span
                                className="inline-flex items-center gap-1 text-[10.5px] text-tertiary"
                                title={whoCanTooltip.projetEdit}
                              >
                                <Lock size={10} />{" "}
                                {t("strategicFiche.rights.readOnlyBadge", "Lecture seule")}
                              </span>
                            )}
                            {pendingProjetDelete(action.id) ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full bg-rag-amber-light px-2 py-0.5 text-[10.5px] font-semibold text-rag-amber"
                                title={pendingDeleteLabel(pendingProjetDelete(action.id)!)}
                              >
                                <Lock size={10} />{" "}
                                {pendingDeleteLabel(pendingProjetDelete(action.id)!)}
                              </span>
                            ) : null}
                            {rights.canDelete && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={!!pendingProjetDelete(action.id)}
                                onClick={() =>
                                  setDeleteTarget({ kind: "projet", actionId: action.id })
                                }
                              >
                                <Trash2 size={12} /> {t("common.delete")}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ── Demandes de validation en attente sur ce projet (étape x/2) ── */}
                      {pendingRequestsOn(sa?.approvals, projetTarget(action))
                        .filter((a) => a.kind === "projet_update" || a.kind === "milestone")
                        .map((a) => (
                          <div
                            key={a.id}
                            className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]"
                          >
                            <PendingApprovalBadge approval={a} users={data.users} />
                            <span className="text-tertiary">
                              {a.kind === "milestone"
                                ? fieldLabel("milestones")
                                : Object.keys((a.payload as { patch?: object }).patch ?? {})
                                    .map(fieldLabel)
                                    .join(", ")}
                            </span>
                          </div>
                        ))}

                      {/* ── Brouillon non envoyé (saisies soumises à validation) ── */}
                      {draft &&
                        renderDraftBar(
                          categoriesPreview(
                            "projet_update",
                            projetTarget(action),
                            gatedCategoriesOf("projet", action, draft)
                          ),
                          () => void submitProjetDraft(action),
                          () => discardProjetDraft(action.id),
                          conflictingFields(
                            sa?.approvals,
                            projetTarget(action),
                            "projet",
                            action,
                            draft
                          )
                        )}

                      {/* ── Passage de jalon (round "passage de jalon explicite") : dès que la
                        check-list du jalon courant est à 100 % — ou qu'une demande est en cours —
                        la carte dit ce qui se passe ensuite, même repliée : demander le passage
                        (propriétaire/admin), attente de confirmation, ou confirmer (pilote du
                        chantier/admin). Le refus (commentaire optionnel) se fait dans la
                        check-list du projet, ouverte par "Refuser…". ─────────────────────────── */}
                      {(() => {
                        const transition = milestoneTransitionState(
                          action,
                          currentMilestoneAutoFlags
                        );
                        if (transition.status !== "ready" && transition.status !== "pending") {
                          return null;
                        }
                        const perms = milestonePermsFor(action);
                        return (
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-white px-2.5 py-1.5">
                            <MilestoneTransitionBadge state={transition} users={data.users} />
                            {transition.status === "ready" &&
                              (perms.canSubmit ? (
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => void requestMilestoneTransition(action)}
                                >
                                  <Send size={12} />{" "}
                                  {t(
                                    "strategicChantierDetail.milestones.transition.request",
                                    "Demander la validation du passage en {milestone}"
                                  ).replace("{milestone}", displayMilestoneId(transition.to))}
                                </Button>
                              ) : (
                                <span className="text-[11px] text-tertiary">
                                  {t(
                                    "strategicChantierDetail.milestones.transition.readyNotOwner",
                                    "Le responsable du projet doit demander la validation du passage en {milestone}."
                                  ).replace("{milestone}", displayMilestoneId(transition.to))}
                                </span>
                              ))}
                            {transition.status === "pending" && perms.canApprove && (
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => void confirmMilestoneTransition(action)}
                              >
                                <CheckCircle2 size={12} />{" "}
                                {t(
                                  "strategicChantierDetail.milestones.transition.confirm",
                                  "Confirmer le passage en {milestone}"
                                ).replace("{milestone}", displayMilestoneId(transition.to))}
                              </Button>
                            )}
                            {transition.status === "pending" && perms.canReject && !isOpen && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openLevier(action.id)}
                              >
                                {perms.canApprove
                                  ? t(
                                      "strategicChantierDetail.milestones.transition.refuseOpen",
                                      "Refuser…"
                                    )
                                  : t(
                                      "strategicChantierDetail.milestones.transition.cancelOpen",
                                      "Annuler la demande…"
                                    )}
                              </Button>
                            )}
                          </div>
                        );
                      })()}

                      {isOpen && (
                        <>
                          {action.description && (
                            <p className="mt-1.5 text-[12px] text-secondary">
                              {action.description}
                            </p>
                          )}

                          <div className="mt-3 rounded-lg border border-border bg-neutral-50/50 p-3">
                            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                              <span className="flex flex-wrap items-center gap-1.5">
                                {t("strategicAxes.deliverables")}
                                <PendingApprovalBadge
                                  approvals={sa?.approvals}
                                  target={projetTarget(action)}
                                  field="deliverables"
                                  users={data.users}
                                  showValue={false}
                                  className="normal-case tracking-normal"
                                />
                              </span>
                              <DeliverableCountsSummary
                                deliverables={actionDeliverables}
                                labels={deliverableCountLabels}
                              />
                            </div>
                            {actionDeliverables.length === 0 ? (
                              <p className="text-[12px] text-tertiary">
                                {t("strategicAxes.noDeliverables")}
                              </p>
                            ) : (
                              // Livrable = ÉCHÉANCE + statut binaire : losange d'état, échéance,
                              // état (Fait / À faire / En retard de N j) et case « Fait » directe.
                              <ul className="mt-1 space-y-2">
                                {actionDeliverables.map((d) => {
                                  const due = effectiveDueDate(d);
                                  const state = deliverableState(d);
                                  return (
                                    <li
                                      key={d.id}
                                      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-neutral-50 p-2"
                                    >
                                      <DeliverableDiamond state={state} size={9} />
                                      <button
                                        type="button"
                                        className="min-w-0 flex-1 truncate text-left text-sm font-medium text-primary hover:underline"
                                        title={deliverableTooltip(
                                          d.label,
                                          due,
                                          state,
                                          deliverableLateDays(d)
                                        )}
                                        onClick={() =>
                                          setOpenDeliverable({
                                            actionId: action.id,
                                            deliverableId: d.id,
                                          })
                                        }
                                      >
                                        {d.label}
                                      </button>
                                      {due && (
                                        <span className="rounded-full border border-border bg-white px-2 py-0.5 text-[12px] font-semibold text-secondary">
                                          {t(
                                            "strategicChantierDetail.deliverableModal.dueDate",
                                            "Échéance"
                                          )}{" "}
                                          {formatDateNumeric(due)}
                                        </span>
                                      )}
                                      <span
                                        className={cn(
                                          "text-[11.5px] font-semibold",
                                          state === "late" ? "text-bp-coral" : "text-secondary"
                                        )}
                                      >
                                        {deliverableStateLabel(state, deliverableLateDays(d))}
                                      </span>
                                      <DeliverableDoneToggle
                                        id={`levier-${action.id}-deliverable-${d.id}-done`}
                                        done={isDeliverableDone(d)}
                                        label={deliverableDoneLabel}
                                        disabled={!rights.canEdit || deliverablesPending}
                                        onChange={(done) =>
                                          updateDeliverable(action.id, d.id, {
                                            status: done ? "done" : "todo",
                                          })
                                        }
                                      />
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>

                          {/* ── KPI associé au LEVIER (round <n> — EXTRAIT du bloc "Méthode de
                        jalons" ci-dessous, où il était trop discret et mal placé selon le PO : « je
                        ne sais pas si c'est vraiment au bon endroit ») : sa propre carte, MÊME
                        convention que "Livrables attendus" ci-dessus (`rounded-lg border
                        border-border bg-neutral-50/50 p-3`), placée juste avant les jalons pour
                        l'ordre de lecture description → livrables → KPI associé → ETP mobilisés →
                        jalons → dépendances. Absente du tout si le levier n'a pas de `indicatorId`
                        (même parti pris qu'avant l'extraction — pas de carte vide). Round 28 :
                        gagne l'actuel/cible (`readKpi`, même lecture que `SuccessKpiList`) sous le
                        lien — rien n'est affiché quand la mesure ou la cible manque plutôt qu'une
                        valeur fabriquée (`readKpi` encode déjà cette règle via `undefined`). ── */}
                          {action.indicatorId && (
                            <div className="mt-3 rounded-lg border border-border bg-neutral-50/50 p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                                {t("strategicChantierDetail.linkedIndicatorTitle", "KPI associé")}
                              </div>
                              <div className="mt-1">
                                {linkedIndicator ? (
                                  <>
                                    <button
                                      onClick={() =>
                                        navigateAway(`/kpi?indicator=${action.indicatorId}`)
                                      }
                                      className="text-[13px] font-medium text-bp-coral hover:underline"
                                    >
                                      {t(
                                        "strategicChantierDetail.indicatorLink.label",
                                        "KPI n°{n} · {name}"
                                      )
                                        .replace("{n}", String(linkedIndicatorNumber ?? "?"))
                                        .replace("{name}", linkedIndicator.name)}
                                    </button>
                                    {linkedIndicatorReading?.current !== undefined &&
                                      linkedIndicatorReading?.target !== undefined && (
                                        <div className="mt-1 text-[11.5px] text-secondary">
                                          {t(
                                            "strategicChantierDetail.successKpis.current",
                                            "Actuel"
                                          )}{" "}
                                          : {linkedIndicatorReading.current}
                                          {linkedIndicator.unit ? ` ${linkedIndicator.unit}` : ""}
                                          {" · "}
                                          {t(
                                            "strategicChantierDetail.successKpis.target",
                                            "Cible"
                                          )}{" "}
                                          : {linkedIndicatorReading.target}
                                          {linkedIndicator.unit ? ` ${linkedIndicator.unit}` : ""}
                                          {linkedIndicatorReading.progressPct !== undefined
                                            ? ` · ${linkedIndicatorReading.approximate ? "≈" : ""}${linkedIndicatorReading.progressPct} %`
                                            : ""}
                                        </div>
                                      )}
                                  </>
                                ) : (
                                  <span className="text-[13px] text-tertiary">
                                    {t(
                                      "strategicChantierDetail.indicatorLink.notFound",
                                      "KPI introuvable"
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* ── ETP mobilisés sur CE projet (round 28) — instance SCOPÉE
                        (`scopedToActionId`) du même composant que l'onglet "Effectifs" (vue
                        transverse au chantier entier, voir plus bas dans ce fichier). Règle PO :
                        LECTURE SEULE ici (plus d'ajout/édition/suppression après création du
                        projet), lien « Gérer les ETP… » vers l'onglet "Effectifs", seul point de
                        saisie, qui met ce projet en avant (`manageStaffingInTab`).
                        Pas de `border` ici, même motif que le bloc "Suivi du LEVIER" juste en
                        dessous : `ChantierStaffingEditor` dessine déjà son propre cadre, un second
                        cadre autour ferait un double-cadre. ─────────────────────────────────── */}
                          <div className="mt-3 rounded-lg bg-neutral-50/50 p-3">
                            <div className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                              {t("staffing.projetSectionTitle", "ETP mobilisés sur ce projet")}
                            </div>
                            <div className="mt-1.5">
                              <ChantierStaffingEditor
                                companyId={user?.companyId ?? ""}
                                programId={activeProgramId ?? ""}
                                chantierId={chantier.id}
                                chantierActions={chantierActions}
                                scopedToActionId={action.id}
                                onManageInStaffingTab={() => manageStaffingInTab(action.id)}
                                chantier={chantier}
                                axes={data.axes}
                                users={data.users}
                              />
                            </div>
                          </div>

                          {/* ── Suivi du LEVIER : jalons E0→E4, universellement pour tout levier
                        avec ou sans KPI rattaché (round 18 — l'ancien aiguillage vers un kanban
                        classique pour les leviers sans `indicatorId` a été supprimé) ─────────── */}
                          {/* Round polish UX : pas de `border` ici (contrairement aux 2 autres
                        sous-sections du levier) pour éviter un double-cadre avec la carte blanche
                        déjà dessinée par `MilestoneStepper` juste en dessous — seul le fond
                        `bg-neutral-50/50` + `p-3` est repris pour garder un poids visuel cohérent. */}
                          <div className="mt-3 rounded-lg bg-neutral-50/50 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
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
                                autoFlags={currentMilestoneAutoFlags}
                                customActions={
                                  eff.customMilestoneActions?.[actionMilestones.currentMilestone] ??
                                  []
                                }
                                excludedItemIds={
                                  eff.excludedMilestoneItems?.[actionMilestones.currentMilestone] ??
                                  []
                                }
                                users={data.users}
                                // Avancement déclaré = PILOTAGE (2 validations) : droits projet
                                // requis, et aucune seconde demande tant qu'une est en attente.
                                readOnly={
                                  !rights.canEdit ||
                                  projetFieldPending(action, "milestones") ||
                                  projetFieldPending(action, "customMilestoneActions")
                                }
                                onChange={(nextItems) => {
                                  updateActionMilestones(action, {
                                    currentMilestone: actionMilestones.currentMilestone,
                                    passedMilestones: actionMilestones.passedMilestones,
                                    checklists: {
                                      ...actionMilestones.checklists,
                                      [actionMilestones.currentMilestone]: nextItems,
                                    },
                                  });
                                }}
                                // Round "actions clés du jalon" : ajout/suppression bufferisés nulle
                                // part — écriture Firestore immédiate comme le reste de ce panneau
                                // (`onChange` ci-dessus), jamais de `undefined` dans le patch (une
                                // clé de jalon vidée de toute action est simplement omise, même
                                // discipline que `ChantierMilestoneState.checklists`).
                                onAddCustomAction={(label) => {
                                  const milestoneId = actionMilestones.currentMilestone;
                                  const newAction: MilestoneCustomAction = {
                                    id: `CUSTOM-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                                    label,
                                  };
                                  const existing = eff.customMilestoneActions?.[milestoneId] ?? [];
                                  editProjet(action, {
                                    customMilestoneActions: {
                                      ...eff.customMilestoneActions,
                                      [milestoneId]: [...existing, newAction],
                                    },
                                  });
                                }}
                                onRemoveCustomAction={(id) => {
                                  const milestoneId = actionMilestones.currentMilestone;
                                  const remaining = (
                                    eff.customMilestoneActions?.[milestoneId] ?? []
                                  ).filter((a) => a.id !== id);
                                  const nextByMilestone = { ...eff.customMilestoneActions };
                                  if (remaining.length > 0) {
                                    nextByMilestone[milestoneId] = remaining;
                                  } else {
                                    delete nextByMilestone[milestoneId];
                                  }
                                  editProjet(action, {
                                    customMilestoneActions: nextByMilestone,
                                  });
                                }}
                                milestoneApproval={action.milestoneApproval}
                                // Habilitations + handlers factorisés (voir `milestonePermsFor` et
                                // `requestMilestoneTransition`/`confirmMilestoneTransition`/
                                // `refuseMilestoneTransition` en tête de composant) — partagés avec
                                // la ligne d'état "passage de jalon" de la carte du projet.
                                canSubmitApproval={milestonePermsFor(action).canSubmit}
                                canApproveMilestone={milestonePermsFor(action).canApprove}
                                canRejectMilestoneApproval={milestonePermsFor(action).canReject}
                                onRequestApproval={() => void requestMilestoneTransition(action)}
                                onApproveMilestone={() => void confirmMilestoneTransition(action)}
                                onRejectMilestoneApproval={(comment) =>
                                  void refuseMilestoneTransition(action, comment)
                                }
                              />
                            </div>
                          </div>

                          {/* ── Dépendances / Prérequis du LEVIER (round 7 — fusion) ──────────────────
                        Round polish UX : la distinction entre sous-sections du levier se fait
                        maintenant via une carte `rounded-lg border ... bg-neutral-50/50 p-3`
                        uniforme (même traitement que le bloc "Livrables attendus" ci-dessus),
                        remplaçant l'ancien `border-t-2` ad hoc. Le titre visible de ce bloc est
                        rendu par `PrerequisitesEditor` lui-même via `labels.prerequisitesTitle`
                        (clé `strategicChantierDetail.prerequisites.title`, déjà existante et
                        réutilisée telle quelle — pas de nouvelle clé i18n nécessaire). */}
                          <div className="mt-3 rounded-lg border border-border bg-neutral-50/50 p-3">
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
                              value={eff.prerequisites ?? []}
                              otherActions={chantierActions.filter((a) => a.id !== action.id)}
                              labels={actionFormLabels}
                              onChange={(next) => updateActionPrerequisites(action, next)}
                              readOnly={
                                !rights.canEdit || projetFieldPending(action, "prerequisites")
                              }
                            />
                            <PendingApprovalBadge
                              approvals={sa?.approvals}
                              target={projetTarget(action)}
                              field="prerequisites"
                              users={data.users}
                              showValue={false}
                              className="mt-1.5"
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
      <div ref={staffingTabRef} className={activeTab === "staffing" ? undefined : "hidden"}>
        {/* ── Effectifs mobilisés sur le chantier (composant autonome du lot « Effectifs ») ──── */}
        <div className="mt-4">
          <ChantierStaffingEditor
            companyId={user?.companyId ?? ""}
            programId={activeProgramId ?? ""}
            chantierId={chantier.id}
            chantierActions={chantierActions}
            focusRequest={staffingFocus}
            chantier={chantier}
            axes={data.axes}
            users={data.users}
          />
        </div>
      </div>

      {/* ── Suppression du chantier — reste HORS onglets, action globale au chantier ─────────── */}
      {cRights.canEdit && (
        <div className="mt-4 border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={!!pendingChantierDeleteOf(chantier.id)}
            onClick={() => setDeleteTarget({ kind: "chantier" })}
          >
            <Trash2 size={12} /> {t("strategicAxes.deleteChantier")}
          </Button>
          {pendingChantierDeleteOf(chantier.id) && (
            <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-rag-amber">
              <Lock size={11} /> {pendingDeleteLabel(pendingChantierDeleteOf(chantier.id)!)}
            </p>
          )}
        </div>
      )}

      {/* ── Pop-up de suppression (chantier / projet) ───────────────────────────────────────── */}
      {deleteTarget && (
        <DeleteRequestModal
          open
          onOpenChange={(o) => {
            if (!o) setDeleteTarget(null);
          }}
          kind={deleteTarget.kind}
          name={
            deleteTarget.kind === "chantier"
              ? chantier.name
              : (chantierActions.find((a) => a.id === deleteTarget.actionId)?.name ?? "")
          }
          projetCount={deleteTarget.kind === "chantier" ? chantierActions.length : 1}
          milestoneCount={
            (deleteTarget.kind === "chantier" ? chantierActions.length : 1) * MILESTONE_ORDER.length
          }
          // Chaîne de validation prévue (« Sera validé par X puis Y ») — remplace l'ancienne liste
          // d'approbateurs `resolveDeleteApproval`.
          chainText={previewChainText(
            deleteTarget.kind === "chantier" ? "chantier_delete" : "projet_delete",
            deleteTarget.kind === "chantier"
              ? chantierTarget
              : { type: "projet", id: deleteTarget.actionId },
            {
              name:
                deleteTarget.kind === "chantier"
                  ? chantier.name
                  : (chantierActions.find((a) => a.id === deleteTarget.actionId)?.name ?? ""),
            }
          )}
          canApproveSelf={
            sa
              ? sa.route(
                  deleteTarget.kind === "chantier" ? "chantier_delete" : "projet_delete",
                  deleteTarget.kind === "chantier"
                    ? chantierTarget
                    : { type: "projet", id: deleteTarget.actionId }
                ).mode === "direct"
              : isPilotOrAdmin(user, activeProgramId)
          }
          onConfirm={(reason) =>
            deleteTarget.kind === "chantier"
              ? onRequestDeleteChantier(reason)
              : onRequestDeleteProjet(deleteTarget.actionId, reason)
          }
        />
      )}

      {/* ── Modales livrables (round <n>) — détail (clic losange) et création ────────────────── */}
      {openDeliverableItem && openDeliverable && (
        <DeliverableDetailModal
          deliverable={openDeliverableItem}
          labels={{
            dueDate: t("strategicChantierDetail.deliverableModal.dueDate"),
            done: deliverableDoneLabel,
            comments: t("strategicChantierDetail.deliverableModal.comments"),
            commentPlaceholder: t("strategicChantierDetail.deliverableModal.commentPlaceholder"),
            noComments: t("strategicChantierDetail.deliverableModal.noComments"),
            add: t("common.add"),
            close: t("common.close"),
          }}
          users={data.users}
          currentUsername={user?.username}
          readOnly={
            !openDeliverableAction ||
            !rightsFor(openDeliverableAction).canEdit ||
            projetFieldPending(openDeliverableAction, "deliverables")
          }
          onClose={() => setOpenDeliverable(null)}
          onPatch={(patch) =>
            updateDeliverable(openDeliverable.actionId, openDeliverable.deliverableId, patch)
          }
        />
      )}
      {addDeliverableOpen && (
        <AddDeliverableForm
          actions={editableActions.filter((a) => !projetFieldPending(a, "deliverables"))}
          labels={{
            title: t("strategicAxes.addDeliverable"),
            leverSelect: t("strategicChantierDetail.deliverableForm.leverSelect"),
            deliverableLabel: t("strategicAxes.deliverableLabel"),
            dueDate: t("strategicChantierDetail.deliverableModal.dueDate"),
            done: deliverableDoneLabel,
            save: t("common.save"),
            cancel: t("common.cancel"),
          }}
          onCancel={() => setAddDeliverableOpen(false)}
          onSubmit={(actionId, values) => {
            addDeliverable(actionId, values);
            setAddDeliverableOpen(false);
          }}
        />
      )}
    </div>
  );
}
