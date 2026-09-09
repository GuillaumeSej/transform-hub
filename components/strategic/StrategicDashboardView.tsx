"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  Layers,
  LayoutGrid,
  ListChecks,
  Maximize2,
  Plus,
  RotateCcw,
  Target,
  TriangleAlert,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useMaturityStages } from "@/lib/hooks/useMaturityStages";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  chantierDependencyAlerts,
  colorForChantier,
  countOnTrackAtRisk,
  numberIndicators,
  programBlockedActions,
} from "@/lib/axisLogic";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import type { LevierKanbanStatus, MilestoneId } from "@/types";
import {
  STRATEGIC_DASHBOARD_WIDGET_REGISTRY,
  SPAN_COL_CLASS,
  addWidget,
  buildDefaultLayout,
  cycleSpan,
  getStrategicWidgetDef,
  loadStrategicDashboardLayout,
  moveWidget,
  removeWidget,
  saveStrategicDashboardLayout,
  setWidgetSpan,
  type StrategicDashboardWidgetInstance,
} from "@/lib/strategicDashboardWidgets";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { DependencyTypeBadge } from "@/components/shared/DependencyTypeBadge";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { Modal } from "@/components/shared/Modal";
import { Popover } from "@/components/shared/Popover";
import { ChantierDetailPanel } from "@/components/strategic/ChantierDetailPanel";
import {
  BusinessKpiCards,
  IndicatorStatusSummary,
} from "@/components/strategic/IndicatorStatusSummary";
import {
  LevierMilestoneBoard,
  type LevierBoardCard,
  type LevierBoardGroup,
} from "@/components/strategic/LevierMilestoneBoard";
import { LevierKanbanBoard } from "@/components/strategic/LevierKanbanBoard";

/**
 * Dashboard du PLAN STRATÉGIQUE — pendant de `DashboardPagePerformance.tsx` pour un programme de
 * type "strategic" (le routeur `app/(app)/dashboard/page.tsx` branche l'un ou l'autre selon le
 * programme actif).
 *
 * Même MÉCANIQUE de personnalisation que le dashboard exécutif (mode édition, drag & drop,
 * redimensionnement, ajout/suppression, persistance localStorage) — le PO exige que cette
 * fonctionnalité reste disponible pour le Plan Stratégique — mais sur un registre de widgets
 * DISJOINT (`lib/strategicDashboardWidgets.ts`, clé de stockage propre) : aucune métrique
 * financière ici, donc aucun widget de l'exécutif n'est réutilisable. Le code de la mécanique est
 * volontairement re-écrit plutôt que factorisé avec l'exécutif : ce dernier est la zone la plus
 * sensible de l'app (zéro régression tolérée) et porte en plus un builder générique
 * métrique × dimensions qui n'a pas d'équivalent stratégique.
 *
 * Les alertes de cascade de retard entre chantiers sont mises en évidence (bordure d'accent + tri
 * par retard décroissant) : c'est la fonctionnalité explicitement jugée « super importante » par
 * le PO, elle ne doit pas se noyer dans la grille.
 */

/** Puce de statistique d'en-tête (icône + valeur + libellé) — remplace l'ancienne ligne de texte
 *  brute « Programme X · N axes · M chantiers · K indicateurs » par des chips visuellement
 *  distinctes, dans le même esprit que le bandeau d'en-tête du Plan Performance (passe de polish
 *  round 4, point 1). Purement présentationnel, local à ce fichier : ne mérite pas un composant
 *  partagé pour un seul appelant. */
function DashboardStatChip({
  icon: Icon,
  value,
  label,
  tone = "neutral",
}: {
  icon: LucideIcon;
  /** Chaîne déjà formatée acceptée en plus d'un nombre brut — round 7, point 2 : la puce budget
   *  affiche une somme suffixée de la devise du programme, pas un simple compteur entier. */
  value: number | string;
  label: string;
  /** "amber" réservé au signal "à risque" — même token que `IndicatorStatusBadge`, jamais un
   *  vert/rouge littéral (charte BearingPoint, voir skill dataviz). */
  tone?: "neutral" | "amber";
}) {
  return (
    <span
      className={
        tone === "amber"
          ? "inline-flex items-center gap-1.5 rounded-full bg-rag-amber-light px-2.5 py-1 text-[11px] font-semibold text-rag-amber"
          : "inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-[11px] font-semibold text-secondary"
      }
    >
      <Icon
        size={12}
        className={tone === "amber" ? "text-rag-amber" : "text-tertiary"}
        aria-hidden
      />
      <span className={tone === "amber" ? "text-rag-amber" : "text-primary"}>{value}</span>
      {label}
    </span>
  );
}

/** Enveloppe une `DashboardStatChip` dans un `Popover` (round 12) pour la rendre cliquable : la
 *  puce déclenche une petite liste (axes/chantiers/indicateurs/lignes de budget), chaque ligne
 *  naviguant ou ouvrant le panneau adapté. `Popover` ne fournit `toggle` qu'au render-prop
 *  `trigger` (pas à `children`) — on le capture donc dans un ref à chaque rendu du déclencheur
 *  pour pouvoir fermer le panneau depuis le clic sur une ligne de la liste, sans dupliquer l'état
 *  d'ouverture ni toucher à `Popover.tsx`. */
function ChipPopover({
  chip,
  title,
  emptyLabel,
  items,
}: {
  chip: ReactNode;
  title: string;
  emptyLabel: string;
  items: { key: string; label: ReactNode; onClick: () => void }[];
}) {
  const toggleRef = useRef<() => void>(() => {});
  return (
    <Popover
      trigger={({ toggle }) => {
        toggleRef.current = toggle;
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggle();
            }}
            className="cursor-pointer"
          >
            {chip}
          </button>
        );
      }}
      panelClassName="max-h-64 overflow-y-auto"
    >
      <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-secondary">
        {title}
      </div>
      {items.length === 0 ? (
        <p className="py-2 text-center text-[11px] text-tertiary">{emptyLabel}</p>
      ) : (
        <div className="space-y-0.5">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                item.onClick();
                toggleRef.current();
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-primary hover:bg-neutral-50"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export function StrategicDashboardView() {
  const { user } = useRole();
  const { activeProgram, activeProgramId, programs, loading: programsLoading } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const strategic = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  // Référentiel d'étapes de maturité du programme actif — nécessaire à `programBlockedActions`
  // (round 9, alimente la sous-section "Prérequis en attente" ci-dessous), même appel que
  // `StrategicAxesView.tsx`.
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);

  const { axes, chantiers, chantierActions, indicators, measurements } = strategic;

  /** Panneau chantier INLINE (round 10, point 1 — remplace l'ancienne vraie navigation vers
   *  `/levers?chantier=…`, qui faisait quitter le dashboard) : même mécanisme que
   *  `StrategicAxesView.tsx`.openChantierPanel — pose `?chantier=`/`&action=` sur CETTE MÊME page
   *  (`router.push`, garde l'historique — le bouton "retour" referme le panneau), monté juste en
   *  dessous via `<ChantierDetailPanel>`. Réutilisé par la vue E0→E4 par axe
   *  (`LevierMilestoneBoard`/`LevierKanbanBoard`, round 8) et la ligne "Prérequis en attente" — un
   *  levier n'a pas de panneau propre, cliquer dessus ouvre toujours le panneau de son CHANTIER
   *  parent, désormais focalisé sur ce levier précis. */
  const openChantierPanel = (chantierId: string, focusActionId?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("chantier", chantierId);
    if (focusActionId) params.set("action", focusActionId);
    else params.delete("action");
    router.push(`/dashboard?${params.toString()}`);
  };

  /** Ferme le panneau chantier — `router.replace` (pas `push`) pour ne pas empiler une entrée
   *  d'historique par fermeture, même convention que `StrategicAxesView.tsx`. */
  const closeChantierPanel = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("chantier");
    params.delete("action");
    const qs = params.toString();
    router.replace(qs ? `/dashboard?${qs}` : "/dashboard");
  };

  const openChantierId = searchParams.get("chantier");
  const focusActionId = searchParams.get("action") ?? undefined;
  const openChantierEntity = openChantierId
    ? chantiers.find((c) => c.id === openChantierId)
    : undefined;

  // ─── Agrégats (toute la logique de calcul vient de lib/axisLogic.ts) ──────────────────────
  const counts = useMemo(() => countOnTrackAtRisk(indicators), [indicators]);

  /** Round 7, point 2 : somme du budget alloué (`Chantier.allocatedBudget`, fondation) sur tout le
   *  programme actif — puce supplémentaire du bandeau d'en-tête, même esprit que les compteurs
   *  axes/chantiers/indicateurs juste à côté. Pas de nouveau widget : un chiffre agrégé de plus. */
  const allocatedBudgetTotal = useMemo(
    () => chantiers.reduce((sum, chantier) => sum + (chantier.allocatedBudget ?? 0), 0),
    [chantiers]
  );

  /** Numérotation globale 3-5-15 des indicateurs (`numberIndicators`, lib/axisLogic.ts) — alimente
   *  UNIQUEMENT la liste de la puce "indicateurs" du bandeau d'en-tête (round 12) : chaque ligne
   *  affiche "#N · nom", même convention de numérotation que le reste de l'app. */
  const indicatorNumbers = useMemo(
    () => numberIndicators(axes, chantiers, indicators),
    [axes, chantiers, indicators]
  );

  /** Budget alloué total PAR AXE (round 12) — alimente la liste de la puce "budget" du bandeau
   *  d'en-tête : un simple regroupement/somme, pas de graphique (une répartition en camembert est
   *  ajoutée en parallèle sur la page Axes stratégiques elle-même). */
  const axisBudgets = useMemo(
    () =>
      axes.map((axis) => ({
        axis,
        total: chantiers
          .filter((chantier) => chantier.axisId === axis.id)
          .reduce((sum, chantier) => sum + (chantier.allocatedBudget ?? 0), 0),
      })),
    [axes, chantiers]
  );

  /** Une ligne par axe : volumétrie (chantiers/indicateurs), part d'indicateurs sur la trajectoire
   *  ET la liste de SES chantiers (round 6, point 3-4 : imbriqués via `ChantierProgressRow`, même
   *  composant que le Kanban et l'onglet "Chantiers" — une seule lecture de l'avancement). */
  const axisBreakdown = useMemo(
    () =>
      axes
        .map((axis) => {
          const axisIndicators = indicators.filter((i) => i.axisId === axis.id);
          const { total, onTrack, atRisk } = countOnTrackAtRisk(axisIndicators);
          const axisChantiers = chantiers.filter((c) => c.axisId === axis.id);
          return {
            axis,
            chantiers: axisChantiers,
            chantierCount: axisChantiers.length,
            total,
            onTrack,
            atRisk,
            onTrackPct: total > 0 ? Math.round((onTrack / total) * 100) : 0,
          };
        })
        .sort((a, b) => b.atRisk - a.atRisk || b.total - a.total),
    [axes, chantiers, indicators]
  );

  const dependencyAlerts = useMemo(
    () =>
      chantierDependencyAlerts(chantiers, chantierActions).sort(
        (a, b) => b.delayDays - a.delayDays
      ),
    [chantiers, chantierActions]
  );

  /** Round 9, point 1 : leviers dont au moins un prérequis n'est pas satisfait
   *  (`programBlockedActions`, lib/axisLogic.ts) — même parti pris purement informatif que
   *  `dependencyAlerts` ci-dessus, alimente la deuxième sous-section du widget
   *  "chantier-dependency-alerts". */
  const blockedActions = useMemo(
    () => programBlockedActions(chantierActions, stages),
    [chantierActions, stages]
  );

  /** Nom de chantier par id — la sous-section "Prérequis en attente" doit afficher le CHANTIER
   *  parent d'un levier bloqué (le levier seul ne dit pas de quel chantier il relève, contrairement
   *  au message déjà formaté de `dependencyAlerts`). */
  const chantierNameById = useMemo(
    () => new Map(chantiers.map((chantier) => [chantier.id, chantier.name])),
    [chantiers]
  );

  /** Groupes (un par axe) de la vue E0→E4 par levier (round 8, remplace l'ancienne matrice de
   *  santé PAR CHANTIER) — alimente `LevierMilestoneBoard`/`LevierKanbanBoard`. Un axe sans aucun
   *  chantier n'ouvre pas de section vide (même filtre que `axisBreakdown` ci-dessus, dont ce calcul
   *  dérive). Pour chaque axe :
   *   - `milestones` : leviers RATTACHÉS À UN KPI (`action.indicatorId` défini) de tous les
   *     chantiers de l'axe, groupés par `action.milestones?.currentMilestone ?? "E0"` (5 colonnes) ;
   *   - `withoutKpi` : leviers SANS KPI, à plat — c'est `LevierKanbanBoard` qui les reboucle par
   *     `kanbanStatus` (mêmes 3 colonnes que le kanban classique du Plan Performance).
   *  Chaque entrée porte `chantierColor` (`colorForChantier`, lib/axisLogic.ts) pour que le même
   *  chantier affiche systématiquement la même couleur dans les deux blocs (E0-E4 et kanban). */
  const levierBoardGroups = useMemo<(LevierBoardGroup & { withoutKpi: LevierBoardCard[] })[]>(
    () =>
      axisBreakdown
        .filter((row) => row.chantiers.length > 0)
        .map((row) => {
          const chantierById = new Map(row.chantiers.map((chantier) => [chantier.id, chantier]));

          const milestones = MILESTONE_ORDER.reduce(
            (acc, milestoneId) => ({ ...acc, [milestoneId]: [] as LevierBoardCard[] }),
            {} as Record<MilestoneId, LevierBoardCard[]>
          );
          const withoutKpi: LevierBoardCard[] = [];

          for (const action of chantierActions) {
            const chantier = chantierById.get(action.chantierId);
            if (!chantier) continue; // Levier d'un chantier hors de cet axe.
            const card: LevierBoardCard = {
              action,
              chantier,
              chantierColor: colorForChantier(chantier.id),
            };
            if (action.indicatorId) {
              const milestoneId = action.milestones?.currentMilestone ?? "E0";
              milestones[milestoneId].push(card);
            } else {
              withoutKpi.push(card);
            }
          }

          return {
            key: row.axis.id,
            label: row.axis.name,
            color: row.axis.color,
            milestones,
            // Round 10, point 1 : reporté vers `LevierMilestoneBoard` pour la légende de couleur
            // des chantiers sous l'en-tête d'axe (déjà disponible dans cette closure via
            // `axisBreakdown`, juste pas transmis jusqu'ici avant ce round).
            chantiers: row.chantiers,
            withoutKpi,
          };
        }),
    [axisBreakdown, chantierActions]
  );

  const summaryLabels = {
    tracked: t("strategicDashboard.tracked"),
    onTrack: t("strategicDashboard.onTrack"),
    atRisk: t("strategicDashboard.atRisk"),
    indicatorsSuffix: t("strategicDashboard.indicatorsSuffix"),
  };

  const businessKpiLabels = {
    empty: t("businessKpis.empty"),
    noValue: t("businessKpis.noValue"),
    objective: t("kpi.objectiveValue"),
    onTrack: t("indicatorStatus.onTrack"),
    atRisk: t("indicatorStatus.atRisk"),
    atRiskTooltip: t("strategicAxes.atRiskTooltip"),
    fullHistory: t("kpi.chart.fullHistory"),
    progressToTarget: t("kpi.chart.progressToTarget"),
  };

  /** Placeholder d'une colonne de jalon E0-E4 sans levier (round 8) — un texte discret plutôt que
   *  rien du tout, pour que la structure à 5 colonnes reste lisible même quand une colonne est
   *  vide. */
  const levierMilestoneLabels = {
    emptyColumn: t("strategicDashboard.levierBoard.emptyColumn"),
  };

  /** En-têtes des 3 colonnes du kanban classique des leviers sans KPI — MÊMES clés que le kanban
   *  de la fiche chantier (`ChantierDetailPanel.tsx`, fondation round 8) : deux lectures du même
   *  statut ne doivent jamais diverger sur leur vocabulaire. */
  const levierKanbanLabels: Record<LevierKanbanStatus, string> = {
    todo: t("strategicChantierDetail.kanban.todo"),
    in_progress: t("strategicChantierDetail.kanban.inProgress"),
    done: t("strategicChantierDetail.kanban.done"),
  };

  // ─── Layout personnalisable (même mécanique que le dashboard exécutif) ────────────────────
  const [editMode, setEditMode] = useState(false);
  const [layout, setLayout] = useState<StrategicDashboardWidgetInstance[]>(buildDefaultLayout);
  const [dragInstanceId, setDragInstanceId] = useState<string | null>(null);
  const [dragOverInstanceId, setDragOverInstanceId] = useState<string | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  // Chargement APRÈS le premier rendu : `localStorage` n'existe pas au prerender statique
  // (output: "export"), l'état initial doit donc rester le layout par défaut.
  useEffect(() => {
    setLayout(loadStrategicDashboardLayout());
  }, []);

  const updateLayout = (next: StrategicDashboardWidgetInstance[]) => {
    setLayout(next);
    saveStrategicDashboardLayout(next);
  };

  const moveWidgetBy = (instanceId: string, direction: "up" | "down") => {
    const fromIndex = layout.findIndex((w) => w.instanceId === instanceId);
    if (fromIndex === -1) return;
    const toIndex = direction === "up" ? fromIndex - 1 : fromIndex + 1;
    if (toIndex < 0 || toIndex >= layout.length) return;
    updateLayout(moveWidget(layout, fromIndex, toIndex));
  };

  const handleDrop = (targetInstanceId: string) => {
    if (dragInstanceId && dragInstanceId !== targetInstanceId) {
      const fromIndex = layout.findIndex((w) => w.instanceId === dragInstanceId);
      const toIndex = layout.findIndex((w) => w.instanceId === targetInstanceId);
      if (fromIndex !== -1 && toIndex !== -1) {
        updateLayout(moveWidget(layout, fromIndex, toIndex));
      }
    }
    setDragInstanceId(null);
    setDragOverInstanceId(null);
  };

  /** Coquille commune : largeur de colonne + barre d'outils du mode édition, sans toucher au
   *  contenu métier du widget. Identique en comportement à celle du dashboard exécutif (poignée
   *  de glisser sur desktop, boutons haut/bas au doigt). */
  const renderWidgetShell = (instance: StrategicDashboardWidgetInstance, children: ReactNode) => {
    const def = getStrategicWidgetDef(instance.type);
    if (!def) return null;
    const isDragOver = editMode && dragOverInstanceId === instance.instanceId;
    return (
      <div
        key={instance.instanceId}
        data-widget-id={instance.instanceId}
        data-widget-title={t(def.label)}
        className={`relative ${SPAN_COL_CLASS[instance.span]} ${
          isDragOver ? "outline outline-2 outline-offset-2 outline-bp-coral" : ""
        }`}
        draggable={editMode}
        onDragStart={() => setDragInstanceId(instance.instanceId)}
        onDragOver={(e) => {
          if (!editMode) return;
          e.preventDefault();
          setDragOverInstanceId(instance.instanceId);
        }}
        onDragLeave={() => {
          if (dragOverInstanceId === instance.instanceId) setDragOverInstanceId(null);
        }}
        onDrop={(e) => {
          if (!editMode) return;
          e.preventDefault();
          handleDrop(instance.instanceId);
        }}
      >
        {editMode && (
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border-strong bg-white/95 px-1.5 py-1 text-[11px] font-semibold text-secondary shadow-sm">
            <span
              className="hidden cursor-grab px-0.5 text-tertiary active:cursor-grabbing sm:inline-flex"
              title={t("strategicDashboard.dragToReorder")}
            >
              <GripVertical size={14} />
            </span>
            <div className="flex items-center sm:hidden">
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "up")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title={t("strategicDashboard.moveUp")}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                onClick={() => moveWidgetBy(instance.instanceId, "down")}
                className="rounded p-0.5 text-tertiary hover:bg-neutral-100 hover:text-primary"
                title={t("strategicDashboard.moveDown")}
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                updateLayout(
                  setWidgetSpan(
                    layout,
                    instance.instanceId,
                    cycleSpan(instance.span, def.allowedSpans)
                  )
                )
              }
              className="hidden items-center gap-1 rounded px-1.5 py-0.5 hover:bg-neutral-100 hover:text-primary sm:flex"
              title={t("strategicDashboard.resizeWidget")}
            >
              <Maximize2 size={12} />
              {instance.span}
            </button>
            <button
              type="button"
              onClick={() => updateLayout(removeWidget(layout, instance.instanceId))}
              className="flex items-center rounded px-1 py-0.5 text-tertiary hover:bg-neutral-100 hover:text-bp-coral"
              title={t("strategicDashboard.removeWidget")}
            >
              <X size={13} />
            </button>
          </div>
        )}
        <div className={editMode ? "pointer-events-none select-none" : ""}>{children}</div>
      </div>
    );
  };

  const emptyLine = (label: string) => (
    <p className="py-6 text-center text-xs text-tertiary">{label}</p>
  );

  const renderWidget = (instance: StrategicDashboardWidgetInstance): ReactNode => {
    switch (instance.type) {
      // ── Compteur global on-track / à risque (carte héro) ──────────────────────────────────
      case "indicator-status":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.indicatorStatus")} />
            <CardBody>
              {indicators.length === 0 ? (
                emptyLine(t("strategicDashboard.noIndicators"))
              ) : (
                <IndicatorStatusSummary
                  indicators={indicators}
                  measurements={measurements}
                  showTotal={false}
                  labels={summaryLabels}
                  // Round 6, point 1 : le widget passe en XL (largeur pleine) mais cette grille
                  // interne restait plafonnée à 2 colonnes quelle que soit la coquille — seulement
                  // 2 cartes ici (sur la trajectoire / à risque), `lg:grid-cols-3` laisse une
                  // marge inoffensive plutôt que d'étirer les cartes elles-mêmes.
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                  radialHero
                />
              )}
            </CardBody>
          </Card>
        );

      // ── KPI business : indicateurs de niveau axe (remplace l'ancien widget « cumul des
      //    indicateurs », retiré — sommer des indicateurs hétérogènes n'a pas de sens sur un plan
      //    stratégique, contrairement aux économies d'un Plan Performance) ─────────────────────
      case "business-kpis":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.businessKpis")} />
            <CardBody>
              <BusinessKpiCards
                indicators={indicators}
                measurements={measurements}
                labels={businessKpiLabels}
                // Round 6, point 1 : idem `IndicatorStatusSummary` ci-dessus. Le jeu de démo
                // (`scripts/seed-strategic-demo.js`) compte 5 KPI business (un macro-indicateur par
                // axe) — `xl:grid-cols-4` remplit une coquille XL sans jamais forcer plus de 4
                // cartes par ligne (elles restent lisibles, sparkline comprise).
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              />
            </CardBody>
          </Card>
        );

      // ── Vue E0→E4 par levier, une section par axe + kanban classique pour les leviers sans
      //    KPI (round 8, remplace l'ancienne matrice de santé PAR CHANTIER — le grain de lecture
      //    passe du chantier au levier, voir `levierBoardGroups` ci-dessus) ────────────────────
      case "chantier-health":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.chantierHealth")} />
            <CardBody>
              {levierBoardGroups.length === 0 ? (
                emptyLine(t("strategicAxes.axisNoChantier"))
              ) : (
                <div className="space-y-6">
                  {levierBoardGroups.map((group) => (
                    <div key={group.key}>
                      <LevierMilestoneBoard
                        groups={[group]}
                        labels={levierMilestoneLabels}
                        onLevierClick={openChantierPanel}
                      />
                      {/* Ligne kanban classique — seulement si cet axe a au moins un levier sans
                          KPI (pas de ligne vide, demande PO explicite). */}
                      {group.withoutKpi.length > 0 && (
                        <LevierKanbanBoard
                          items={group.withoutKpi}
                          labels={levierKanbanLabels}
                          onLevierClick={openChantierPanel}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        );

      // ── Alertes de cascade de retard entre chantiers (mise en évidence) ───────────────────
      case "chantier-dependency-alerts":
        return renderWidgetShell(
          instance,
          <Card
            className={`mb-0 h-full ${
              dependencyAlerts.length > 0 ? "border-bp-coral/60 shadow-md" : ""
            }`}
          >
            <CardHeader
              title={
                <>
                  {dependencyAlerts.length > 0 && (
                    <TriangleAlert size={14} className="flex-shrink-0 text-bp-coral" />
                  )}
                  {t("strategicDashboard.widget.chantierDependencyAlerts")}
                </>
              }
              actions={
                dependencyAlerts.length > 0 ? (
                  <span className="rounded-full bg-bp-coral px-2 py-0.5 text-[10.5px] font-bold text-white">
                    {dependencyAlerts.length}
                  </span>
                ) : undefined
              }
            />
            <CardBody>
              {/* Sous-section 1 : dépendances entre chantiers (inchangée, round 6). */}
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
                  {t("strategicDashboard.dependencyAlertsHeading")}
                </span>
              </div>
              {dependencyAlerts.length === 0
                ? emptyLine(t("strategicDashboard.noDependencyAlerts"))
                : dependencyAlerts.map((alert) => (
                    <div
                      key={`${alert.sourceId}-${alert.targetId}-${alert.type}`}
                      className="border-b border-border py-2.5 last:border-0 first:pt-0"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <DependencyTypeBadge type={alert.type} />
                        <span className="text-[11px] font-semibold text-bp-coral">
                          {alert.delayDays} {t("strategicDashboard.delayDays")}
                        </span>
                      </div>
                      <p className="mt-1 text-[12px] leading-snug text-secondary">
                        {alert.message}
                      </p>
                    </div>
                  ))}

              {/* Sous-section 2 (round 9, point 1) : prérequis non satisfaits (`programBlockedActions`,
                  lib/axisLogic.ts) — même carte que les alertes de dépendance pour rester un seul
                  repère visuel "alertes" sur le dashboard, mais visuellement DISTINCTE (séparateur
                  renforcé + teinte amber plutôt que corail) pour ne pas fusionner deux types
                  d'alerte différents en une liste indifférenciée. */}
              <div className="mt-4 border-t-2 border-border pt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
                    {t("strategicDashboard.pendingPrerequisitesHeading")}
                  </span>
                  {blockedActions.length > 0 && (
                    <span className="rounded-full bg-rag-amber px-2 py-0.5 text-[10.5px] font-bold text-white">
                      {blockedActions.length}
                    </span>
                  )}
                </div>
                {blockedActions.length === 0
                  ? emptyLine(t("strategicDashboard.noPrerequisiteAlerts"))
                  : blockedActions.map(({ action, reasons }) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={() => openChantierPanel(action.chantierId, action.id)}
                        className="block w-full border-b border-border py-2.5 text-left transition last:border-0 first:pt-0 hover:bg-neutral-50"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-semibold text-rag-amber">
                            {action.name}
                          </span>
                          <span className="text-[10.5px] text-tertiary">
                            {chantierNameById.get(action.chantierId) ?? action.chantierId}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] leading-snug text-secondary">
                          {reasons.join(", ")}
                        </p>
                      </button>
                    ))}
              </div>
            </CardBody>
          </Card>
        );

      default:
        return null;
    }
  };

  // ─── Écrans d'attente / vides ─────────────────────────────────────────────────────────────
  if (programsLoading || strategic.loading) {
    return (
      <div className="animate-fade-up p-6 text-sm text-secondary">
        {t("strategicDashboard.loading")}
      </div>
    );
  }

  if (programs.length === 0 || !activeProgram) {
    return (
      <div className="animate-fade-up">
        <Card>
          <CardBody>
            <p className="text-sm text-secondary">{t("strategicDashboard.noProgram")}</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("strategicDashboard.title")}
          </h1>
          <div className="mt-2 text-[13px] text-secondary">
            {t("dashboard.program")} <strong className="text-primary">{activeProgram.name}</strong>
          </div>
          {/* Bandeau "ambition" (round 12) — rappel permanent du programme, réglé une fois par un
              admin (ProgramsPanel.tsx) et affiché à quiconque ouvre ce dashboard. Volontairement
              DISTINCT des puces de stats juste en dessous (barre bordée pleine largeur plutôt
              qu'une pastille) pour se lire comme un rappel plutôt qu'une métrique — masqué quand le
              champ n'est pas encore renseigné (pas de placeholder). */}
          {activeProgram.ambition && activeProgram.ambition.trim() !== "" && (
            <div className="mt-3 max-w-2xl rounded-lg border-l-4 border-bp-coral bg-bp-coral/5 px-4 py-2.5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-bp-coral">
                {t("strategicDashboard.ambitionLabel")}
              </div>
              <div className="mt-0.5 text-[13px] font-medium leading-snug text-primary">
                {activeProgram.ambition}
              </div>
            </div>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <ChipPopover
              chip={
                <DashboardStatChip
                  icon={Target}
                  value={axes.length}
                  label={t("strategicDashboard.axesSuffix")}
                />
              }
              title={t("strategicDashboard.popover.axesTitle")}
              emptyLabel={t("strategicDashboard.popover.emptyAxes")}
              items={axes.map((axis) => ({
                key: axis.id,
                label: axis.name,
                onClick: () => router.push("/levers"),
              }))}
            />
            <ChipPopover
              chip={
                <DashboardStatChip
                  icon={Layers}
                  value={chantiers.length}
                  label={t("strategicDashboard.chantiersSuffix")}
                />
              }
              title={t("strategicDashboard.popover.chantiersTitle")}
              emptyLabel={t("strategicDashboard.popover.emptyChantiers")}
              items={chantiers.map((chantier) => ({
                key: chantier.id,
                label: chantier.name,
                onClick: () => openChantierPanel(chantier.id),
              }))}
            />
            <ChipPopover
              chip={
                <DashboardStatChip
                  icon={ListChecks}
                  value={counts.total}
                  label={t("strategicDashboard.indicatorsSuffix")}
                />
              }
              title={t("strategicDashboard.popover.indicatorsTitle")}
              emptyLabel={t("strategicDashboard.popover.emptyIndicators")}
              items={indicators.map((indicator) => ({
                key: indicator.id,
                label: `#${indicatorNumbers.get(indicator.id) ?? "?"} · ${indicator.name}`,
                onClick: () => router.push(`/kpi?indicator=${indicator.id}`),
              }))}
            />
            <ChipPopover
              chip={
                <DashboardStatChip
                  icon={Wallet}
                  value={`${allocatedBudgetTotal.toLocaleString()} ${activeProgram.currency}`}
                  label={t("strategicDashboard.allocatedBudget")}
                />
              }
              title={t("strategicDashboard.popover.budgetTitle")}
              emptyLabel={t("strategicDashboard.popover.emptyBudget")}
              items={axisBudgets.map(({ axis, total }) => ({
                key: axis.id,
                label: `${axis.name} — ${total.toLocaleString()} ${activeProgram.currency}`,
                onClick: () => router.push("/levers"),
              }))}
            />
          </div>
        </div>
        {/* Personnalisation : desktop uniquement, comme sur le dashboard exécutif (le
            glisser-déposer n'a pas de sens au doigt). */}
        <div className="hidden items-center gap-2 lg:flex">
          <Button
            variant={editMode ? "dark" : "outline"}
            size="md"
            onClick={() => setEditMode((v) => !v)}
          >
            <LayoutGrid size={14} />
            {editMode ? t("dashboard.done") : t("dashboard.customize")}
          </Button>
        </div>
      </div>

      {editMode && (
        <div className="mb-4 rounded-lg border-2 border-bp-coral/30 bg-bp-coral/[0.04]">
          <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-bp-coral/20 bg-white/95 p-4 shadow-sm backdrop-blur">
            <div>
              <div className="text-[13px] font-bold text-primary">
                {t("dashboard.editModeTitle")}
              </div>
              <div className="text-[11.5px] text-secondary">{t("dashboard.editModeHint")}</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant={addPanelOpen ? "dark" : "primary"}
                size="sm"
                onClick={() => setAddPanelOpen((v) => !v)}
              >
                <Plus size={13} />
                {t("dashboard.addWidget")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateLayout(buildDefaultLayout())}
              >
                <RotateCcw size={13} />
                {t("dashboard.reset")}
              </Button>
              <Button variant="dark" size="sm" onClick={() => setEditMode(false)}>
                <LayoutGrid size={13} />
                {t("dashboard.done")}
              </Button>
            </div>
          </div>

          {addPanelOpen && (
            <div className="grid grid-cols-2 gap-2 p-4 pt-3.5 sm:grid-cols-3 lg:grid-cols-4">
              {STRATEGIC_DASHBOARD_WIDGET_REGISTRY.map((def) => {
                // `Sigma` n'est pas dans ICON_REGISTRY (registre partagé avec la nav, que ce
                // workstream ne modifie pas) — repli neutre plutôt qu'un widget sans icône.
                const Icon = ICON_REGISTRY[def.icon] ?? LayoutGrid;
                const alreadyPresent = layout.some((w) => w.type === def.type);
                return (
                  <button
                    key={def.type}
                    type="button"
                    onClick={() => {
                      updateLayout(addWidget(layout, def.type));
                      setAddPanelOpen(false);
                    }}
                    className="flex flex-col items-start gap-2 rounded-md border border-border-strong bg-white p-3 text-left transition hover:border-bp-coral hover:shadow-sm"
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-primary">
                      <Icon size={16} />
                    </span>
                    <span className="text-[12px] font-semibold leading-tight text-primary">
                      {t(def.label)}
                    </span>
                    {alreadyPresent && (
                      <span className="text-[10px] font-medium text-tertiary">
                        {t("dashboard.alreadyOnBoard")}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {axes.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-secondary">{t("strategicDashboard.noAxesHint")}</p>
          </CardBody>
        </Card>
      )}

      <div
        data-dashboard-widget-grid
        className="grid grid-cols-1 grid-flow-row-dense gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        {layout.map((instance) => renderWidget(instance))}
      </div>

      {/* ── Panneau chantier inline (round 10, point 1) — même Modal que `StrategicAxesView.tsx`
          (1100px), pour rester sur le dashboard au lieu de naviguer vers `/levers`. ─────────── */}
      <Modal
        open={!!openChantierId}
        onOpenChange={(open) => {
          if (!open) closeChantierPanel();
        }}
        title={openChantierEntity?.name ?? t("strategicChantierDetail.title")}
        maxWidth="1100px"
      >
        {openChantierId && (
          <ChantierDetailPanel
            chantierId={openChantierId}
            focusActionId={focusActionId}
            onClose={closeChantierPanel}
          />
        )}
      </Modal>
    </div>
  );
}
