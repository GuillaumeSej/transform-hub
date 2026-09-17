"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart } from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import {
  CostByHierarchyChart,
  CostCommitmentTimelineChart,
  CostEngagedVsUpcomingChart,
  InvestVsSavingsChart,
  OpexRecurrentChart,
} from "@/components/finance/FinanceCostCharts";
import { PnlBarChart } from "@/components/shared/charts/PnlBarChart";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { subscribeCompanies, subscribeHierarchyNodes } from "@/lib/firestore/admin";
import * as engine from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Company, HierarchyNode, Lever } from "@/types";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { type FilterDef } from "@/components/shared/FilterBar";
import { DropdownFilterBar } from "@/components/shared/DropdownFilterBar";
import { useFilterBarState } from "@/lib/hooks/useFilterBarState";

/**
 * Module Finance — le compte de résultat configuré (baseline P&L éditable, reforecast, waterfall)
 * reste un STRETCH ; en revanche le suivi des coûts (engagés/à venir, CAPEX/OPEX, engagement dans
 * le temps) est alimenté intégralement depuis `data.levers[].actions[].impacts[]` (voir
 * lib/financeCosts.ts) — aucune donnée en dur.
 */
export default function FinancePage() {
  const { t } = useTranslation();
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);

  // Arborescence financière (optionnelle) de l'entreprise — même pattern que le dashboard
  // (app/(app)/dashboard/DashboardPagePerformance.tsx) pour que le widget "Impact P&L par compte"
  // ci-dessous fasse foi sur les mêmes comptes que le tableau "Compte de résultat configuré".
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    const unsub = subscribeCompanies((companies) => {
      setCompany(companies.find((c) => c.id === user?.companyId) ?? null);
    }, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);
  const hierarchyLevels = useMemo(() => company?.hierarchyLevels ?? [], [company]);
  const [hierarchyNodes, setHierarchyNodes] = useState<HierarchyNode[]>([]);
  useEffect(() => {
    if (!user?.companyId || hierarchyLevels.length === 0) {
      setHierarchyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setHierarchyNodes, "financial");
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, hierarchyLevels.length]);

  const sortedHierarchyLevels = useMemo(
    () => [...hierarchyLevels].sort((a, b) => a.order - b.order),
    [hierarchyLevels]
  );

  // Un levier importé via Excel n'a souvent qu'un `pnlMap` (ancien matching par code), pas encore
  // de `hierarchyLeafId` — même repli que engine.pnlImpactDetailed / le dashboard exécutif.
  const resolveMacroPnlLabel = (l: Lever): string => {
    const macroLevel = sortedHierarchyLevels[0];
    if (!macroLevel) return "";
    const path = resolveHierarchyPath(
      l.hierarchyLeafId ?? "",
      hierarchyNodes,
      sortedHierarchyLevels
    );
    const viaLeaf = path.find((p) => p.levelKey === macroLevel.key)?.label;
    if (viaLeaf) return viaLeaf;
    return (
      hierarchyNodes.find((n) => n.levelKey === macroLevel.key && n.code === l.pnlMap)?.label ?? ""
    );
  };

  // Un filtre par niveau d'arborescence financière configuré (Division > Direction > Centre de
  // coût, etc.) — même principe que `hierarchyFilterDefs` du dashboard exécutif
  // (app/(app)/dashboard/DashboardPagePerformance.tsx), pour permettre de filtrer les données
  // financières de cette page par n'importe quel niveau, pas seulement le total consolidé.
  const hierarchyFilterDefs: FilterDef<Lever>[] = useMemo(
    () =>
      sortedHierarchyLevels.map((level, index) => ({
        key: `hierarchy_${level.key}`,
        label: level.label,
        getValue: (l: Lever) => {
          if (index === 0) return resolveMacroPnlLabel(l);
          const path = resolveHierarchyPath(
            l.hierarchyLeafId ?? "",
            hierarchyNodes,
            sortedHierarchyLevels
          );
          return path.find((p) => p.levelKey === level.key)?.label ?? "";
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedHierarchyLevels, hierarchyNodes]
  );

  const { activeFilters: pnlHierarchyFilters, setFilters: setPnlHierarchyFilters } =
    useFilterBarState(hierarchyFilterDefs, { namespace: "pnl" });

  // ── Widget "Impact P&L par compte" (déplacé depuis le dashboard Performance) ──
  // Filtres géographiques (cascade Région → Pays → Entité).
  const [pnlFilterGeo, setPnlFilterGeo] = useState("");
  const [pnlFilterCountry, setPnlFilterCountry] = useState("");
  const [pnlFilterEntity, setPnlFilterEntity] = useState("");

  const pnlFilteredLevers = useMemo(() => {
    let levers = data.levers.filter((l) => l.status !== "cancelled");
    if (pnlFilterGeo) levers = levers.filter((l) => l.geography === pnlFilterGeo);
    if (pnlFilterCountry) levers = levers.filter((l) => l.country === pnlFilterCountry);
    if (pnlFilterEntity) levers = levers.filter((l) => l.entity === pnlFilterEntity);
    Object.entries(pnlHierarchyFilters).forEach(([key, value]) => {
      if (!value) return;
      const def = hierarchyFilterDefs.find((d) => d.key === key);
      if (def) levers = levers.filter((l) => def.getValue(l) === value);
    });
    return levers;
  }, [
    data,
    pnlFilterGeo,
    pnlFilterCountry,
    pnlFilterEntity,
    pnlHierarchyFilters,
    hierarchyFilterDefs,
  ]);

  const pnlGeoOptions = useMemo(() => {
    const vals = new Set<string>();
    data.levers.forEach((l) => {
      if (l.geography) vals.add(l.geography);
    });
    return Array.from(vals).sort();
  }, [data]);
  const pnlCountryOptions = useMemo(() => {
    const vals = new Set<string>();
    data.levers
      .filter((l) => !pnlFilterGeo || l.geography === pnlFilterGeo)
      .forEach((l) => {
        if (l.country) vals.add(l.country);
      });
    return Array.from(vals).sort();
  }, [data, pnlFilterGeo]);
  const pnlEntityOptions = useMemo(() => {
    const vals = new Set<string>();
    data.levers
      .filter((l) => !pnlFilterGeo || l.geography === pnlFilterGeo)
      .filter((l) => !pnlFilterCountry || l.country === pnlFilterCountry)
      .forEach((l) => {
        if (l.entity) vals.add(l.entity);
      });
    return Array.from(vals).sort();
  }, [data, pnlFilterGeo, pnlFilterCountry]);

  const pnlFilteredData = useMemo(
    () => ({ ...data, levers: pnlFilteredLevers }),
    [data, pnlFilteredLevers]
  );

  // Filtre temporel (cascade Année → Trimestre → Mois).
  const fyYear = new Date(data.program.fyStart).getFullYear().toString();
  const [pnlYear, setPnlYear] = useState(fyYear);
  const [pnlQuarter, setPnlQuarter] = useState("");
  const [pnlMonth, setPnlMonth] = useState("");

  const pnlPeriodFilter: engine.PnlPeriodFilter | undefined = useMemo(() => {
    if (!pnlYear) return undefined;
    return {
      year: pnlYear,
      ...(pnlQuarter ? { quarter: pnlQuarter } : {}),
      ...(pnlMonth ? { month: pnlMonth } : {}),
    };
  }, [pnlYear, pnlQuarter, pnlMonth]);

  const pnlQuarterMonths: string[] = useMemo(() => {
    if (!pnlQuarter) return engine.MONTH_LABELS;
    const qIdx = parseInt(pnlQuarter.replace("Q", "")) - 1;
    return engine.MONTH_LABELS.slice(qIdx * 3, qIdx * 3 + 3);
  }, [pnlQuarter]);

  const pnlDetailedData = useMemo(
    () =>
      engine.pnlImpactDetailed(pnlFilteredData, pnlPeriodFilter, hierarchyNodes, hierarchyLevels),
    [pnlFilteredData, pnlPeriodFilter, hierarchyNodes, hierarchyLevels]
  );
  const pnlData = useMemo(
    () =>
      pnlDetailedData.map((d) => ({
        account: d.accountName,
        plan: d.plan,
        realized: d.realized,
      })),
    [pnlDetailedData]
  );

  // Bucket "Gains non attribués" (engine.UNALLOCATED_ACCOUNT_ID) — n'existe pas dans
  // `data.pnlAccounts` (référentiel de comptes), donc n'apparaît jamais via la boucle qui itère
  // sur ce référentiel ci-dessous : on l'affiche séparément, uniquement si plan/réalisé != 0 pour
  // ne pas polluer l'affichage d'une entreprise où tout est bien attribué.
  const unallocatedRow = pnlDetailedData.find(
    (row) => row.accountId === engine.UNALLOCATED_ACCOUNT_ID
  );
  const showUnallocatedRow =
    !!unallocatedRow && (unallocatedRow.plan !== 0 || unallocatedRow.realized !== 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <LineChart size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">
          {t("nav.financeModule", "Finance Module")}
        </h1>
      </div>

      {/* Filtres par arborescence financière (Division > Direction > Centre de coût, etc.) —
          n'apparaît que si l'entreprise a configuré des niveaux ; filtre le widget "Impact P&L
          par compte" ET le tableau "Compte de résultat configuré" ci-dessous (même donnée
          filtrée, voir `pnlFilteredLevers`). */}
      {hierarchyFilterDefs.length > 0 && (
        <DropdownFilterBar
          items={data.levers.filter((l) => l.status !== "cancelled")}
          defs={hierarchyFilterDefs}
          active={pnlHierarchyFilters}
          onChange={setPnlHierarchyFilters}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CostEngagedVsUpcomingChart data={data} />
        <CostByHierarchyChart
          data={data}
          hierarchyLevels={hierarchyLevels}
          hierarchyNodes={hierarchyNodes}
        />
      </div>

      <InvestVsSavingsChart data={data} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CostCommitmentTimelineChart data={data} />
        <OpexRecurrentChart data={data} />
      </div>

      <Card className="mb-0">
        <CardHeader
          title={t("dashboard.widgets.pnl")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                value={pnlFilterGeo}
                onChange={(e) => {
                  setPnlFilterGeo(e.target.value);
                  setPnlFilterCountry("");
                  setPnlFilterEntity("");
                }}
              >
                <option value="">{t("pnl.allRegions")}</option>
                {pnlGeoOptions.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <select
                className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                value={pnlFilterCountry}
                onChange={(e) => {
                  setPnlFilterCountry(e.target.value);
                  setPnlFilterEntity("");
                }}
              >
                <option value="">{t("pnl.allCountries")}</option>
                {pnlCountryOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                value={pnlFilterEntity}
                onChange={(e) => setPnlFilterEntity(e.target.value)}
              >
                <option value="">{t("pnl.allEntities")}</option>
                {pnlEntityOptions.map((ent) => (
                  <option key={ent} value={ent}>
                    {ent}
                  </option>
                ))}
              </select>
              {/* Filtres temporels : Année → Trimestre → Mois */}
              <span className="mx-1 text-[10px] text-tertiary">|</span>
              <select
                className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                value={pnlYear}
                onChange={(e) => {
                  setPnlYear(e.target.value);
                  setPnlQuarter("");
                  setPnlMonth("");
                }}
              >
                <option value={fyYear}>{fyYear}</option>
              </select>
              <select
                className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                value={pnlQuarter}
                onChange={(e) => {
                  setPnlQuarter(e.target.value);
                  setPnlMonth("");
                }}
              >
                <option value="">{t("pnl.allQuarters")}</option>
                {["Q1", "Q2", "Q3", "Q4"].map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
              {pnlQuarter && (
                <select
                  className="rounded-sm border border-border bg-white px-1.5 py-0.5 text-[10.5px] font-semibold text-secondary focus:border-bp-coral focus:outline-none"
                  value={pnlMonth}
                  onChange={(e) => setPnlMonth(e.target.value)}
                >
                  <option value="">{t("pnl.allMonths")}</option>
                  {pnlQuarterMonths.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
          }
        />
        <CardBody>
          <PnlBarChart
            data={pnlData}
            labelPlan={t("chart.pnl.plan")}
            labelRealized={t("chart.pnl.realized")}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={t("finance.pnlConfiguredTitle", "Compte de résultat configuré")} />
        <CardBody>
          <p className="mb-4 text-sm text-text-secondary">
            {t(
              "finance.pnlConfiguredHint",
              "Les lignes ci-dessous proviennent directement de l'arborescence financière définie par l'administrateur global. Les impacts des leviers sont consolidés automatiquement."
            )}
          </p>
          <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-xs text-secondary">
                <tr>
                  <th className="px-3 py-2 text-left">{t("finance.pnlLine", "Ligne P&L")}</th>
                  <th className="px-3 py-2 text-right">{t("finance.baseline", "Baseline")}</th>
                  <th className="px-3 py-2 text-right">{t("chart.pnl.plan", "Plan")}</th>
                  <th className="px-3 py-2 text-right">{t("levers.realized", "Réalisé")}</th>
                </tr>
              </thead>
              <tbody>
                {data.pnlAccounts.map((account) => {
                  const impact = pnlDetailedData.find((row) => row.accountId === account.id);
                  return (
                    <tr key={account.id} className="border-t border-border">
                      <td className="px-3 py-2 font-semibold text-primary">
                        {account.name}
                        {account.selectable === false ? (
                          <span className="ml-2 text-[10px] font-normal text-tertiary">
                            {t("finance.notAllocatable", "Non imputable")}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">{engine.fmtCurr(account.baseline)}</td>
                      <td className="px-3 py-2 text-right">{engine.fmtCurr(impact?.plan ?? 0)}</td>
                      <td className="px-3 py-2 text-right">
                        {engine.fmtCurr(impact?.realized ?? 0)}
                      </td>
                    </tr>
                  );
                })}
                {showUnallocatedRow && unallocatedRow ? (
                  <tr className="border-t border-border bg-neutral-50 italic">
                    <td className="px-3 py-2 font-semibold text-secondary">
                      {unallocatedRow.accountName}
                      <span className="ml-2 text-[10px] font-normal text-tertiary">
                        {t("finance.unallocatedHint", "Rattachement financier à préciser")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-tertiary">—</td>
                    <td className="px-3 py-2 text-right">{engine.fmtCurr(unallocatedRow.plan)}</td>
                    <td className="px-3 py-2 text-right">
                      {engine.fmtCurr(unallocatedRow.realized)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 sm:hidden">
            {data.pnlAccounts.map((account) => {
              const impact = pnlDetailedData.find((row) => row.accountId === account.id);
              return (
                <div key={account.id} className="rounded-lg border border-border p-3">
                  <div className="font-semibold text-primary">{account.name}</div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-tertiary">{t("finance.baseline", "Baseline")}</dt>
                      <dd>{engine.fmtCurr(account.baseline)}</dd>
                    </div>
                    <div>
                      <dt className="text-tertiary">{t("chart.pnl.plan", "Plan")}</dt>
                      <dd>{engine.fmtCurr(impact?.plan ?? 0)}</dd>
                    </div>
                    <div>
                      <dt className="text-tertiary">{t("levers.realized", "Réalisé")}</dt>
                      <dd>{engine.fmtCurr(impact?.realized ?? 0)}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
            {showUnallocatedRow && unallocatedRow ? (
              <div className="rounded-lg border border-border bg-neutral-50 p-3 italic">
                <div className="font-semibold text-secondary">
                  {unallocatedRow.accountName}
                  <span className="ml-2 text-[10px] font-normal text-tertiary">
                    {t("finance.unallocatedHint", "Rattachement financier à préciser")}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-tertiary">{t("finance.baseline", "Baseline")}</dt>
                    <dd>—</dd>
                  </div>
                  <div>
                    <dt className="text-tertiary">{t("chart.pnl.plan", "Plan")}</dt>
                    <dd>{engine.fmtCurr(unallocatedRow.plan)}</dd>
                  </div>
                  <div>
                    <dt className="text-tertiary">{t("levers.realized", "Réalisé")}</dt>
                    <dd>{engine.fmtCurr(unallocatedRow.realized)}</dd>
                  </div>
                </dl>
              </div>
            ) : null}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
