"use client";

import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { BudgetDonutChart } from "@/components/shared/charts/BudgetDonutChart";
import { CostDrilldownModal } from "@/components/finance/CostDrilldownModal";
import { FinanceDrillBreadcrumb } from "@/components/finance/FinanceDrillBreadcrumb";
import { useTranslation } from "@/lib/i18n/useTranslation";
import * as engine from "@/lib/engine";
import {
  costsByHierarchyNode,
  flattenCostImpacts,
  groupCostsByWorkstream,
  isInvestNature,
  sortedHierarchyLevels,
  type HierarchyCostSlice,
  type WorkstreamCostGroup,
} from "@/lib/financeCosts";
import {
  drillLevelInfo,
  pruneDrillPath,
  shouldDrillDown,
  truncateDrillPath,
  type DrillStep,
} from "@/lib/financeDrilldown";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode, Lever } from "@/types";

/**
 * Les deux donuts côte à côte du module Finance, avec le MÊME drill-down en place :
 * un clic sur une part redessine le donut au niveau suivant, le fil d'Ariane
 * (`FinanceDrillBreadcrumb` : chemin cliquable, "← Retour", "Niveau n/N : …", consigne de clic)
 * permet de remonter, et la modale de détail (`CostDrilldownModal`) ne s'ouvre QU'AU DERNIER
 * NIVEAU (feuille). Ré-exportés par FinanceCostCharts.tsx (point d'import inchangé pour la page).
 */

const fmt = (v: number) => engine.fmtCurr(v);

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

type Segment = "engaged" | "upcoming";

/** #1 — Coûts Invest (CAPEX + OPEX one-off) déjà engagés vs à venir. Hiérarchie à 3 niveaux :
 *  Engagé / À venir → Chantier → Levier. Les deux premiers niveaux descendent en place ; au niveau
 *  Levier (feuille), un clic ouvre `CostDrilldownModal` sur CE levier (chantier + montant + accès à
 *  la fiche levier). */
export function CostEngagedVsUpcomingChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [rawPath, setRawPath] = useState<DrillStep[]>([]);
  const [leafLever, setLeafLever] = useState<{ wsId: string; leverId: string } | null>(null);

  // "Engagé" reflète la MÊME notion que le KPI héros "CAPEX & coûts one-off" du dashboard exécutif
  // (`engine.programSummary(data).engagedCosts`) : facteur d'avancement par levier (100% si livré,
  // sinon `progress`%) appliqué à chaque ligne de coût "Invest" — répartit chaque ligne entre
  // "engagé" et "à venir" au prorata de l'avancement ; le total reste inchangé.
  const split = useMemo(() => {
    const investRows = flattenCostImpacts(data).filter(({ impact }) =>
      isInvestNature(impact.nature)
    );
    const engagedRows: { lever: Lever; amount: number }[] = [];
    const upcomingRows: { lever: Lever; amount: number }[] = [];
    let engaged = 0;
    let upcoming = 0;
    for (const { impact, lever } of investRows) {
      const engagedFactor = lever.status === "delivered" ? 1 : lever.progress / 100;
      const engagedAmount = impact.amount * engagedFactor;
      const upcomingAmount = impact.amount - engagedAmount;
      if (engagedAmount !== 0) engagedRows.push({ lever, amount: engagedAmount });
      if (upcomingAmount !== 0) upcomingRows.push({ lever, amount: upcomingAmount });
      engaged += engagedAmount;
      upcoming += upcomingAmount;
    }
    return {
      engagedRows,
      upcomingRows,
      engaged: round2(engaged),
      upcoming: round2(upcoming),
      total: round2(engaged + upcoming),
    };
  }, [data]);

  const engagedLabel = t("finance.chart.engaged", "Déjà engagé");
  const upcomingLabel = t("finance.chart.upcoming", "À venir");
  const levels = [
    t("finance.drill.levelCommitment", "Engagé / À venir"),
    t("finance.drill.levelWorkstream", "Chantier"),
    t("finance.drill.levelLever", "Levier"),
  ];

  const groupsFor = (segment: string | undefined): WorkstreamCostGroup[] =>
    segment === "engaged" || segment === "upcoming"
      ? groupCostsByWorkstream(
          segment === "engaged" ? split.engagedRows : split.upcomingRows,
          data.workstreams
        )
      : [];

  // Chemin effectif : coupé au premier élément qui n'existe plus (ex. filtre de page qui retire
  // un chantier déjà ouvert) plutôt que d'afficher un donut vide.
  const path = useMemo(
    () =>
      pruneDrillPath(rawPath, (step, depth) => {
        if (depth === 0) return step.id === "engaged" || step.id === "upcoming";
        if (depth === 1) return groupsFor(rawPath[0]?.id).some((g) => g.wsId === step.id);
        return false;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rawPath, split, data.workstreams]
  );
  const segment = path[0]?.id as Segment | undefined;
  const groups = useMemo(
    () => groupsFor(segment),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segment, split, data.workstreams]
  );
  const wsGroup = path[1] ? (groups.find((g) => g.wsId === path[1].id) ?? null) : null;
  const info = drillLevelInfo(path.length, levels.length);

  // Données du donut au niveau courant : { id, name, value }.
  const slices: { id: string; name: string; value: number }[] =
    path.length === 0
      ? [
          { id: "engaged", name: engagedLabel, value: split.engaged },
          { id: "upcoming", name: upcomingLabel, value: split.upcoming },
        ]
      : path.length === 1
        ? groups.map((g) => ({ id: g.wsId, name: g.wsName, value: g.amount }))
        : (wsGroup?.levers ?? []).map((l) => ({
            id: l.leverId,
            name: `${l.leverCode} — ${l.leverName}`,
            value: l.amount,
          }));

  const handleSliceClick = (name: string) => {
    const slice = slices.find((s) => s.name === name);
    if (!slice) return;
    if (shouldDrillDown(path.length, levels.length, true)) {
      setRawPath([...path, { id: slice.id, label: slice.name }]);
    } else if (wsGroup) {
      setLeafLever({ wsId: wsGroup.wsId, leverId: slice.id });
    }
  };

  // Modale feuille : le chantier réduit au seul levier cliqué (même contenu que la sous-vue
  // "leviers d'un chantier" de `CostDrilldownModal`, ouverte directement via `initialWsId`).
  const leafGroups = useMemo<WorkstreamCostGroup[]>(() => {
    if (!leafLever) return [];
    const g = groups.find((x) => x.wsId === leafLever.wsId);
    const lever = g?.levers.find((l) => l.leverId === leafLever.leverId);
    if (!g || !lever) return [];
    return [{ ...g, amount: lever.amount, levers: [lever] }];
  }, [leafLever, groups]);
  const leafLeverData = leafGroups[0]?.levers[0];

  return (
    <Card>
      <CardHeader title={t("finance.chart.engagedTitle", "Coûts engagés vs à venir")} />
      <CardBody>
        {split.total === 0 ? (
          <EmptyState />
        ) : (
          <>
            <FinanceDrillBreadcrumb
              levels={levels}
              path={path}
              onNavigate={(index) => setRawPath(truncateDrillPath(path, index))}
            />
            {slices.length === 0 ? (
              <EmptyState />
            ) : (
              <BudgetDonutChart
                key={path.map((s) => s.id).join("/") || "root"}
                data={slices.map(({ name, value }) => ({ name, value }))}
                formatValue={fmt}
                centerLabel={levels[info.levelNumber - 1]}
                onSliceClick={handleSliceClick}
                clickHint={
                  info.isLastLevel
                    ? t("finance.drill.tooltipLeaf", "Cliquez pour ouvrir le détail")
                    : t("finance.drill.tooltipNext", "Cliquez pour détailler")
                }
              />
            )}
          </>
        )}
      </CardBody>
      <CostDrilldownModal
        open={leafLever !== null && leafGroups.length > 0}
        onOpenChange={(open) => {
          if (!open) setLeafLever(null);
        }}
        title={[
          path[0]?.label,
          leafLeverData ? `${leafLeverData.leverCode} — ${leafLeverData.leverName}` : "",
        ]
          .filter(Boolean)
          .join(" · ")}
        groups={leafGroups}
        initialWsId={leafLever?.wsId ?? null}
        formatValue={fmt}
      />
    </Card>
  );
}

/** #3 — Répartition des coûts par centre de coût / P&L, branchée sur l'arborescence financière de
 *  l'entreprise (`Company.hierarchyLevels` + `HierarchyNode`, voir lib/financeCosts.ts). Le donut
 *  affiche d'abord la maille la plus macro (`order` le plus petit), un clic descend d'un niveau en
 *  place ; à la maille la plus fine (ou sur un nœud sans enfant), un clic ouvre la décomposition
 *  par chantier → levier (`CostDrilldownModal`). */
export function CostByHierarchyChart({
  data,
  hierarchyLevels,
  hierarchyNodes,
}: {
  data: BeTrackData;
  hierarchyLevels: HierarchyLevelDef[];
  hierarchyNodes: HierarchyNode[];
}) {
  const { t } = useTranslation();
  const levels = useMemo(() => sortedHierarchyLevels(hierarchyLevels), [hierarchyLevels]);
  const [rawPath, setRawPath] = useState<DrillStep[]>([]);
  const [leafSlice, setLeafSlice] = useState<HierarchyCostSlice | null>(null);

  // Chemin effectif : coupé si un nœud a disparu ou si la config d'arborescence a changé
  // (ex. changement d'entreprise, niveau supprimé).
  const path = useMemo(() => {
    const nodesById = new Map(hierarchyNodes.map((n) => [n.id, n]));
    return pruneDrillPath(
      rawPath,
      (step, depth) =>
        depth < levels.length - 1 && nodesById.get(step.id)?.levelKey === levels[depth]?.key
    );
  }, [rawPath, hierarchyNodes, levels]);

  const currentLevelKey = levels[path.length]?.key;
  const currentParentId = path.length > 0 ? path[path.length - 1].id : null;

  const slices = useMemo(() => {
    if (!currentLevelKey) return [];
    return costsByHierarchyNode(data, hierarchyNodes, currentLevelKey, currentParentId);
  }, [data, hierarchyNodes, currentLevelKey, currentParentId]);

  const groups = useMemo(() => {
    if (!leafSlice) return [];
    return groupCostsByWorkstream(leafSlice.rows, data.workstreams);
  }, [leafSlice, data.workstreams]);

  const title = t("finance.chart.hierarchyTitle", "Répartition des coûts par centre de coût / P&L");

  if (levels.length === 0) {
    return (
      <Card>
        <CardHeader title={title} />
        <CardBody>
          <p className="py-10 text-center text-sm text-tertiary">
            {t(
              "finance.chart.hierarchyNoConfig",
              "Aucune arborescence financière n'est configurée pour cette entreprise."
            )}
          </p>
        </CardBody>
      </Card>
    );
  }

  const info = drillLevelInfo(path.length, levels.length);

  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <FinanceDrillBreadcrumb
          levels={levels.map((l) => l.label)}
          path={path}
          onNavigate={(index) => setRawPath(truncateDrillPath(path, index))}
        />
        {slices.length === 0 ? (
          <EmptyState />
        ) : (
          <BudgetDonutChart
            key={currentParentId ?? "root"}
            data={slices.map((s) => ({ name: s.node.label, value: s.amount }))}
            formatValue={fmt}
            centerLabel={levels[info.levelNumber - 1]?.label}
            clickHint={
              info.isLastLevel || slices.every((s) => !s.hasChildren)
                ? t("finance.drill.tooltipLeaf", "Cliquez pour ouvrir le détail")
                : t("finance.drill.tooltipNext", "Cliquez pour détailler")
            }
            onSliceClick={(name) => {
              const slice = slices.find((s) => s.node.label === name);
              if (!slice) return;
              if (shouldDrillDown(path.length, levels.length, slice.hasChildren)) {
                setRawPath([...path, { id: slice.node.id, label: slice.node.label }]);
              } else {
                setLeafSlice(slice);
              }
            }}
          />
        )}
      </CardBody>
      <CostDrilldownModal
        open={leafSlice !== null}
        onOpenChange={(open) => {
          if (!open) setLeafSlice(null);
        }}
        title={[...path.map((s) => s.label), leafSlice?.node.label ?? ""]
          .filter(Boolean)
          .join(" › ")}
        groups={groups}
        formatValue={fmt}
      />
    </Card>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <p className="py-10 text-center text-sm text-tertiary">
      {t("finance.chart.empty", "Aucun coût saisi sur les actions des leviers.")}
    </p>
  );
}
