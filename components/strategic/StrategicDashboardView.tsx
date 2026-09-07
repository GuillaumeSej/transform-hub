"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
  chantierHealthState,
  countOnTrackAtRisk,
  milestoneProgressPct,
} from "@/lib/axisLogic";
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
import { ProgressBar } from "@/components/shared/ProgressBar";
import { DependencyTypeBadge } from "@/components/shared/DependencyTypeBadge";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import {
  BusinessKpiCards,
  IndicatorStatusSummary,
} from "@/components/strategic/IndicatorStatusSummary";
import { ChantierHealthMatrix } from "@/components/strategic/ChantierHealthMatrix";
import { ChantierProgressRow } from "@/components/strategic/ChantierProgressRow";

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
  value: number;
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

export function StrategicDashboardView() {
  const { user } = useRole();
  const { activeProgram, activeProgramId, programs, loading: programsLoading } = useActiveProgram();
  const { t } = useTranslation();
  const router = useRouter();
  const strategic = useStrategicData(user?.companyId ?? null, activeProgramId, user);
  const stages = useMaturityStages(activeProgramId, user?.companyId ?? null);

  const { axes, chantiers, chantierActions, indicators, measurements } = strategic;

  /** Navigation vers le panneau chantier (`ChantierDetailPanel`, round 6, point 0) — le dashboard
   *  est une page DIFFÉRENTE de `/levers` (Kanban/Cartes/Chantiers), donc contrairement à ces vues
   *  qui ne font qu'ajuster `?chantier=` sur la page courante, ouvrir le panneau depuis ici exige
   *  une vraie navigation. Réutilisé par le widget "Répartition par axe" (`ChantierProgressRow`)
   *  ET par la nouvelle matrice de santé (`ChantierHealthMatrix`, point 5) — même destination. */
  const openChantierPanel = (chantierId: string) => router.push(`/levers?chantier=${chantierId}`);

  // ─── Agrégats (toute la logique de calcul vient de lib/axisLogic.ts) ──────────────────────
  const counts = useMemo(() => countOnTrackAtRisk(indicators), [indicators]);

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

  /** Groupes (un par axe, colonnes) de cellules de santé (une par chantier) — alimente
   *  `ChantierHealthMatrix` (round 6, point 5, remplace l'ancien "Avancement par étape de
   *  maturité"). Un axe sans aucun chantier n'ouvre pas de colonne vide. */
  const chantierHealthGroups = useMemo(
    () =>
      axisBreakdown
        .filter((row) => row.chantiers.length > 0)
        .map((row) => ({
          key: row.axis.id,
          label: row.axis.name,
          color: row.axis.color,
          cells: row.chantiers.map((chantier) => ({
            chantier,
            health: chantierHealthState(
              chantier,
              indicators,
              measurements,
              chantiers,
              chantierActions
            ),
            progressPct: milestoneProgressPct(chantier),
          })),
        })),
    [axisBreakdown, indicators, measurements, chantiers, chantierActions]
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

  /** Libellés de `ChantierProgressRow` (nom + badge d'étape + barre + pastille "N à risque") —
   *  mêmes clés que `AxisKanban`/`StrategicAxesView` (round 6, point 0/5) : trois lectures du même
   *  avancement ne doivent jamais diverger sur leur vocabulaire. */
  const chantierRowLabels = {
    atRisk: t("strategicAxes.atRiskCount"),
    atRiskPopoverTitle: t("strategicAxes.atRiskPopoverTitle"),
    atRiskTooltip: t("strategicAxes.atRiskTooltip"),
    progress: t("kpi.chart.progressToTarget"),
  };

  const chantierHealthLabels = {
    onTrack: t("strategicDashboard.onTrack"),
    watch: t("strategicDashboard.chantierHealth.watch"),
    critical: t("strategicDashboard.chantierHealth.critical"),
    empty: t("strategicAxes.axisNoChantier"),
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

      // ── Répartition des indicateurs par axe, chantiers de chaque axe imbriqués ────────────
      case "axis-breakdown":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.axisBreakdown")} />
            <CardBody>
              {axisBreakdown.length === 0
                ? emptyLine(t("strategicDashboard.noAxes"))
                : axisBreakdown.map((row) => (
                    <div
                      key={row.axis.id}
                      // Accent coloré propre à l'axe (`StrategicAxis.color`, round 6, point 3) —
                      // même bordure gauche que `AxisKanban`/vue "Cartes", pour que la couleur d'un
                      // axe se lise pareil partout où il apparaît.
                      className="mb-3 overflow-hidden rounded-md border border-border bg-white last:mb-0"
                      style={{
                        borderLeft: `4px solid ${row.axis.color ?? "var(--bp-warm-taupe)"}`,
                      }}
                    >
                      {/* En-tête cliquable → fiche de l'axe (navigation inchangée). `div
                          role="button"` plutôt qu'un `<button>` : les lignes `ChantierProgressRow`
                          imbriquées ci-dessous portent elles-mêmes un `AtRiskCountPill`
                          (`<button>`), un bouton dans un bouton étant une imbrication invalide. */}
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => router.push(`/levers/detail?id=${row.axis.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(`/levers/detail?id=${row.axis.id}`);
                          }
                        }}
                        className="flex cursor-pointer items-start gap-2 p-2.5 text-left transition hover:bg-neutral-50"
                      >
                        <span
                          aria-hidden
                          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: row.axis.color ?? "var(--bp-warm-taupe)" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-3">
                            <span className="truncate text-[12.5px] font-semibold text-primary">
                              {row.axis.name}
                            </span>
                            <span className="flex-shrink-0 text-[11px] text-tertiary">
                              {row.chantierCount} {t("strategicDashboard.chantiersSuffix")} ·{" "}
                              {row.total} {t("strategicDashboard.indicatorsSuffix")}
                            </span>
                          </span>
                          <span className="mt-1.5 flex items-center gap-3">
                            <ProgressBar pct={row.onTrackPct} className="flex-1" />
                            {row.atRisk > 0 && (
                              <span className="flex-shrink-0 text-[11px] font-semibold text-rag-amber">
                                {row.atRisk} {t("strategicDashboard.atRisk").toLowerCase()}
                              </span>
                            )}
                          </span>
                        </span>
                      </div>
                      {/* Chantiers de l'axe (round 6, point 3) — même composant que le Kanban et
                          l'onglet "Chantiers" (`ChantierProgressRow`), chaque ligne ouvre le
                          panneau chantier plutôt que la fiche d'axe. */}
                      <div className="space-y-1.5 border-t border-border bg-neutral-50/60 p-2.5">
                        {row.chantiers.length === 0 ? (
                          <p className="py-1 text-center text-[11px] text-tertiary">
                            {t("strategicAxes.axisNoChantier")}
                          </p>
                        ) : (
                          row.chantiers.map((chantier) => (
                            <ChantierProgressRow
                              key={chantier.id}
                              chantier={chantier}
                              stages={stages}
                              indicators={indicators}
                              measurements={measurements}
                              onOpen={openChantierPanel}
                              labels={chantierRowLabels}
                              className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-white p-2 text-left transition hover:-translate-y-px hover:border-black hover:shadow-sm"
                            />
                          ))
                        )}
                      </div>
                    </div>
                  ))}
            </CardBody>
          </Card>
        );

      // ── Matrice de santé par chantier (colonnes = axes) ───────────────────────────────────
      // Round 6, point 5 : remplace l'ancien "Avancement par étape de maturité" (répartition déjà
      // lisible via le badge d'étape de chaque `ChantierProgressRow' ci-dessus) par un signal de
      // RISQUE, croisant indicateurs à risque et alertes de cascade de retard (`chantierHealthState`,
      // lib/axisLogic.ts) — première apparition d'un état à 3 niveaux côté Plan Stratégique.
      case "chantier-health":
        return renderWidgetShell(
          instance,
          <Card className="mb-0 h-full">
            <CardHeader title={t("strategicDashboard.widget.chantierHealth")} />
            <CardBody>
              <ChantierHealthMatrix
                groups={chantierHealthGroups}
                labels={chantierHealthLabels}
                onChantierClick={openChantierPanel}
              />
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
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <DashboardStatChip
              icon={Target}
              value={axes.length}
              label={t("strategicDashboard.axesSuffix")}
            />
            <DashboardStatChip
              icon={Layers}
              value={chantiers.length}
              label={t("strategicDashboard.chantiersSuffix")}
            />
            <DashboardStatChip
              icon={ListChecks}
              value={counts.total}
              label={t("strategicDashboard.indicatorsSuffix")}
            />
            {counts.atRisk > 0 && (
              <DashboardStatChip
                icon={TriangleAlert}
                value={counts.atRisk}
                label={t("strategicDashboard.atRisk").toLowerCase()}
                tone="amber"
              />
            )}
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
    </div>
  );
}
