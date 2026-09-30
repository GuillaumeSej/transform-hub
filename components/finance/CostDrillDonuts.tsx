"use client";

import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import {
  BudgetDonutChart,
  type BudgetDonutPreviewSlice,
} from "@/components/shared/charts/BudgetDonutChart";
import { CostSlicePreview, type PreviewListItem } from "@/components/finance/FinancePreviews";
import { topContributors } from "@/lib/chartPreview";
import { costCommitmentSplit, leverAmounts } from "@/lib/financePreview";
import { CostDrilldownModal } from "@/components/finance/CostDrilldownModal";
import { FinanceDrillBreadcrumb } from "@/components/finance/FinanceDrillBreadcrumb";
import { useTranslation } from "@/lib/i18n/useTranslation";
import * as engine from "@/lib/engine";
import {
  costsByHierarchyNode,
  flattenCostImpacts,
  groupCostsByWorkstream,
  isCostEngaged,
  isInvestNature,
  sortedHierarchyLevels,
  recurringOpexReconciliation,
  splitByNature,
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

/** Seuil des « principaux » contributeurs des aperçus (M€) : 5 k€, les coûts sont souvent petits. */
const TOP_MIN = 0.005;

type Segment = "engaged" | "upcoming";

/** #1 — Coûts Invest (CAPEX + OPEX one-off) déjà engagés vs à venir. Hiérarchie à 3 niveaux :
 *  Engagé / À venir → Chantier → Levier. Les deux premiers niveaux descendent en place ; au niveau
 *  Levier (feuille), un clic ouvre `CostDrilldownModal` sur CE levier (chantier + montant + accès à
 *  la fiche levier). */
export function CostEngagedVsUpcomingChart({ data }: { data: BeTrackData }) {
  const { t } = useTranslation();
  const [rawPath, setRawPath] = useState<DrillStep[]>([]);
  const [leafLever, setLeafLever] = useState<{ wsId: string; leverId: string } | null>(null);

  // "Engagé" = règle DATÉE unique (`isCostEngaged` → `engine.isInvestCostEngaged`), la MÊME que le
  // KPI héros "CAPEX & coûts one-off" du dashboard (`programSummary.engagedCosts`) — audit M8 :
  // avant, chaque ligne était proratisée par le champ stocké et périmé `lever.progress`.
  const split = useMemo(() => {
    const investRows = flattenCostImpacts(data).filter(({ impact }) =>
      isInvestNature(impact.nature)
    );
    const today = new Date();
    const engagedRows: { lever: Lever; amount: number }[] = [];
    const upcomingRows: { lever: Lever; amount: number }[] = [];
    let engaged = 0;
    let upcoming = 0;
    for (const row of investRows) {
      if (row.impact.amount === 0) continue;
      if (isCostEngaged(row, today)) {
        engagedRows.push({ lever: row.lever, amount: row.impact.amount });
        engaged += row.impact.amount;
      } else {
        upcomingRows.push({ lever: row.lever, amount: row.impact.amount });
        upcoming += row.impact.amount;
      }
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

  // Aperçu au survol d'une part (retour PO) : engagé vs à venir de l'élément survolé (tous segments
  // confondus pour un chantier / un levier) et ses 3 principaux contributeurs du niveau suivant.
  const previewContext = useMemo(() => {
    const sumBy = (rows: { lever: Lever; amount: number }[], match: (l: Lever) => boolean) =>
      round2(rows.reduce((s, r) => (match(r.lever) ? s + r.amount : s), 0));
    const out = new Map<
      string,
      {
        split: { engaged: number; upcoming: number };
        top?: { title: string; items: PreviewListItem[] };
      }
    >();
    for (const slice of slices) {
      if (path.length === 0) {
        out.set(slice.id, {
          split: { engaged: split.engaged, upcoming: split.upcoming },
          top: {
            title: t("finance.preview.topWorkstreams", "Principaux chantiers"),
            items: topContributors(
              groupsFor(slice.id).map((g) => ({ id: g.wsId, name: g.wsName, value: g.amount })),
              3,
              TOP_MIN
            ),
          },
        });
      } else if (path.length === 1) {
        const match = (l: Lever) => l.ws === slice.id;
        out.set(slice.id, {
          split: {
            engaged: sumBy(split.engagedRows, match),
            upcoming: sumBy(split.upcomingRows, match),
          },
          top: {
            title: t("finance.preview.topLevers", "Principaux leviers"),
            items: topContributors(
              (groups.find((g) => g.wsId === slice.id)?.levers ?? []).map((l) => ({
                id: l.leverId,
                code: l.leverCode,
                name: l.leverName,
                value: l.amount,
              })),
              3,
              TOP_MIN
            ),
          },
        });
      } else {
        const match = (l: Lever) => l.id === slice.id;
        out.set(slice.id, {
          split: {
            engaged: sumBy(split.engagedRows, match),
            upcoming: sumBy(split.upcomingRows, match),
          },
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, split, groups, wsGroup, t]);
  const previewSubtitle = [levels[info.levelNumber - 1], ...path.map((s) => s.label)].join(" › ");
  const renderPreview = (p: BudgetDonutPreviewSlice) => {
    const slice = slices.find((s) => s.name === p.name);
    if (!slice) return null;
    const ctx = previewContext.get(slice.id);
    return (
      <CostSlicePreview
        name={p.name}
        subtitle={previewSubtitle}
        value={p.value}
        share={p.share}
        color={p.color}
        split={ctx?.split}
        top={ctx?.top}
        clickHint={
          info.isLastLevel
            ? t("finance.preview.clickLeaf", "Cliquer pour ouvrir le détail →")
            : t("finance.preview.clickNext", "Cliquer pour détailler →")
        }
        format={fmt}
      />
    );
  };

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
      <CardHeader
        title={t(
          "finance.chart.engagedTitleOneOff",
          "Coûts ponctuels (CAPEX + OPEX ponctuel) : engagés vs à venir"
        )}
      />
      <CardBody>
        {/* Périmètre explicite (audit fix #2) : OPEX récurrent EXCLU — même total que le
            « Réactualisé » du KPI « CAPEX & coûts ponctuels » du dashboard, et même « engagé ». */}
        <p className="mb-2 text-[11.5px] text-secondary">
          {t(
            "finance.chart.engagedScopeNote",
            "Total {total} (engagé {engaged} · à venir {upcoming}) — OPEX récurrent exclu, même périmètre que le KPI « CAPEX & coûts ponctuels » du dashboard."
          )
            .replace("{total}", fmt(split.total))
            .replace("{engaged}", fmt(split.engaged))
            .replace("{upcoming}", fmt(split.upcoming))}
        </p>
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
                renderPreview={renderPreview}
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

  const rawSlices = useMemo(() => {
    if (!currentLevelKey) return [];
    return costsByHierarchyNode(data, hierarchyNodes, currentLevelKey, currentParentId);
  }, [data, hierarchyNodes, currentLevelKey, currentParentId]);
  // Part « (direct) » (coûts rattachés au nœud parent lui-même, audit M9) : libellé suffixé pour la
  // distinguer du parent dans le donut et le fil d'Ariane.
  const slices = useMemo(
    () =>
      rawSlices.map((s) => ({
        ...s,
        displayLabel: s.isDirect
          ? t("finance.drill.directSlice", "{name} (direct)").replace("{name}", s.node.label)
          : s.node.label,
      })),
    [rawSlices, t]
  );

  const groups = useMemo(() => {
    if (!leafSlice) return [];
    return groupCostsByWorkstream(leafSlice.rows, data.workstreams);
  }, [leafSlice, data.workstreams]);

  // Aperçu au survol d'une part (retour PO) : engagé / à venir / OPEX récurrent de la part (règle
  // `isCostEngaged`), puis ses 3 principaux centres du niveau suivant (part avec enfants) ou ses 3
  // principaux leviers (maille la plus fine / part « (direct) »).
  const nextLevel = levels[path.length + 1];
  const previewContext = useMemo(() => {
    const today = new Date();
    return new Map(
      slices.map((s) => {
        const top =
          s.hasChildren && nextLevel
            ? {
                title: t("finance.preview.topNodes", "Principaux — {level}").replace(
                  "{level}",
                  nextLevel.label
                ),
                items: topContributors(
                  costsByHierarchyNode(data, hierarchyNodes, nextLevel.key, s.node.id).map((c) => ({
                    id: c.node.id,
                    name: c.isDirect
                      ? t("finance.drill.directSlice", "{name} (direct)").replace(
                          "{name}",
                          c.node.label
                        )
                      : c.node.label,
                    value: c.amount,
                  })),
                  3,
                  TOP_MIN
                ),
              }
            : {
                title: t("finance.preview.topLevers", "Principaux leviers"),
                items: topContributors(leverAmounts(s.rows), 3, TOP_MIN),
              };
        return [s.displayLabel, { split: costCommitmentSplit(s.rows, today), top }] as const;
      })
    );
  }, [slices, nextLevel, data, hierarchyNodes, t]);

  const title = t(
    "finance.chart.hierarchyTitleAllCosts",
    "Coûts totaux yc OPEX récurrent, par compte P&L / centre de coût"
  );

  // Réconciliation avec le donut « Coûts ponctuels » (audit fix #2) : ce donut-ci compte TOUTES les
  // natures de coût (CAPEX + OPEX ponctuel + OPEX récurrent) — d'où un total supérieur. Les lignes
  // sans rattachement à l'arborescence n'apparaissent dans aucune part : leur montant est signalé.
  const natureTotals = useMemo(() => splitByNature(data), [data]);
  // OPEX récurrent : ce donut ne ventile que les LIGNES DE COÛT récurrentes ; la cascade du
  // dashboard (« − OPEX récurrent annuel ») y ajoute les salaires chargés des recrutements ETP —
  // même base annuelle, périmètre différent : on l'écrit pour que 1,7 ≠ 2 se lise sans enquête.
  const opexRecRecon = useMemo(() => recurringOpexReconciliation(data), [data]);
  const allCostsTotal = natureTotals.capex + natureTotals.oneoff + natureTotals.opexRec;
  const rootTotal = useMemo(() => {
    const rootKey = levels[0]?.key;
    if (!rootKey) return 0;
    return costsByHierarchyNode(data, hierarchyNodes, rootKey, null).reduce(
      (sum, s) => sum + s.amount,
      0
    );
  }, [data, hierarchyNodes, levels]);
  const unattached = round2(allCostsTotal - rootTotal);

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
        <p className="mb-2 text-[11.5px] text-secondary">
          {t(
            "finance.chart.hierarchyScopeNote",
            "Total {total} = coûts ponctuels (CAPEX + OPEX ponctuel) {oneOff} + OPEX récurrent annuel (lignes de coût) {rec}. Chaque coût est affecté au compte P&L de son centre de coût (ligne de coût, sinon levier) : un compte de produits (ex. Revenue) peut donc porter les coûts des leviers qui l'impactent."
          )
            .replace("{total}", fmt(round2(allCostsTotal)))
            .replace("{oneOff}", fmt(round2(natureTotals.capex + natureTotals.oneoff)))
            .replace("{rec}", fmt(natureTotals.opexRec))}
          {(opexRecRecon.fteHires > 0.005 || Math.abs(opexRecRecon.other) > 0.005) &&
            ` ${t(
              "finance.chart.hierarchyOpexRecReconNote",
              "L'OPEX récurrent annuel de la cascade du dashboard ({dashboard}) inclut en plus les salaires chargés des recrutements ETP ({fte}){other}, qui ne sont pas des lignes de coût."
            )
              .replace("{dashboard}", fmt(opexRecRecon.dashboard))
              .replace("{fte}", fmt(opexRecRecon.fteHires))
              .replace(
                "{other}",
                Math.abs(opexRecRecon.other) > 0.005
                  ? t(
                      "finance.chart.hierarchyOpexRecReconOther",
                      " et {amount} saisis au niveau du levier sans ligne d'impact"
                    ).replace("{amount}", fmt(opexRecRecon.other))
                  : ""
              )}`}
          {unattached > 0.005 &&
            ` ${t(
              "finance.chart.hierarchyUnattachedNote",
              "Dont {amount} sans rattachement à l'arborescence (absent du graphique)."
            ).replace("{amount}", fmt(unattached))}`}
        </p>
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
            data={slices.map((s) => ({ name: s.displayLabel, value: s.amount }))}
            formatValue={fmt}
            centerLabel={levels[info.levelNumber - 1]?.label}
            renderPreview={(p) => {
              const slice = slices.find((s) => s.displayLabel === p.name);
              const ctx = previewContext.get(p.name);
              const drills =
                !!slice && shouldDrillDown(path.length, levels.length, slice.hasChildren);
              return (
                <CostSlicePreview
                  name={p.name}
                  subtitle={[levels[info.levelNumber - 1]?.label, ...path.map((s) => s.label)]
                    .filter(Boolean)
                    .join(" › ")}
                  value={p.value}
                  share={p.share}
                  color={p.color}
                  split={ctx?.split}
                  top={ctx?.top}
                  clickHint={
                    drills
                      ? t("finance.preview.clickNext", "Cliquer pour détailler →")
                      : t("finance.preview.clickLeaf", "Cliquer pour ouvrir le détail →")
                  }
                  format={fmt}
                />
              );
            }}
            onSliceClick={(name) => {
              const slice = slices.find((s) => s.displayLabel === name);
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
        title={[
          ...path.map((s) => s.label),
          leafSlice?.isDirect
            ? t("finance.drill.directSlice", "{name} (direct)").replace(
                "{name}",
                leafSlice.node.label
              )
            : (leafSlice?.node.label ?? ""),
        ]
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
