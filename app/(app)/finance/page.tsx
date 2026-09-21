"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LineChart } from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import {
  CostByHierarchyChart,
  CostCommitmentTimelineChart,
  CostEngagedVsUpcomingChart,
  InvestVsSavingsChart,
} from "@/components/finance/FinanceCostCharts";
import { FinanceHierarchyTable } from "@/components/finance/FinanceHierarchyTable";
import { PnlBarChart } from "@/components/shared/charts/PnlBarChart";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { subscribeCompanies, subscribeHierarchyNodes } from "@/lib/firestore/admin";
import * as engine from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Company, HierarchyLevelDef, HierarchyNode, Lever } from "@/types";
import { resolveHierarchyPath } from "@/lib/hierarchyLogic";
import { type FilterDef } from "@/components/shared/FilterBar";
import { DropdownFilterBar } from "@/components/shared/DropdownFilterBar";
import { useMultiFilterBarState } from "@/lib/hooks/useMultiFilterBarState";
import { matchesFilter } from "@/lib/filterUtils";
import { MultiSelect } from "@/components/shared/MultiSelect";

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

  // Arborescence géographique (optionnelle) — même pattern que le dashboard exécutif
  // (app/(app)/dashboard/DashboardPagePerformance.tsx) : un filtre par niveau configuré, utile
  // pour isoler les coûts/savings d'une région/pays/entité. Contrairement à l'arborescence
  // FINANCIÈRE (P&L/centre de coût, ci-dessus) qui ne sert plus qu'à résoudre les comptes P&L
  // eux-mêmes (voir `pnlImpactDetailed`/`CostByHierarchyChart`), pas à filtrer la page — un retour
  // métier a signalé ce filtre financier comme peu utile en pratique, retiré ci-dessous.
  const [geographyHierarchyLevels, setGeographyHierarchyLevels] = useState<HierarchyLevelDef[]>([]);
  const [geographyNodes, setGeographyNodes] = useState<HierarchyNode[]>([]);
  useEffect(() => {
    setGeographyHierarchyLevels(company?.geographyHierarchyLevels ?? []);
  }, [company]);
  useEffect(() => {
    if (!user?.companyId || geographyHierarchyLevels.length === 0) {
      setGeographyNodes([]);
      return;
    }
    const unsub = subscribeHierarchyNodes(user.companyId, setGeographyNodes, "geographic");
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.companyId, geographyHierarchyLevels.length]);
  const sortedGeographyHierarchyLevels = useMemo(
    () => [...geographyHierarchyLevels].sort((a, b) => a.order - b.order),
    [geographyHierarchyLevels]
  );
  const geographyFilterDefs: FilterDef<Lever>[] = useMemo(
    () =>
      sortedGeographyHierarchyLevels.map((level) => ({
        key: `geo_${level.key}`,
        label: level.label,
        getValue: (l: Lever) => {
          const path = resolveHierarchyPath(
            l.geographyLeafId ?? "",
            geographyNodes,
            sortedGeographyHierarchyLevels
          );
          return path.find((p) => p.levelKey === level.key)?.label ?? "";
        },
      })),
    [sortedGeographyHierarchyLevels, geographyNodes]
  );

  // Filtres globaux de la page Finance : géographie (arborescence si configurée, sinon champ
  // simple), département (fonction) et workstream — appliqués à TOUS les graphiques de la page
  // (voir `filteredData` ci-dessous), pas seulement au widget "Impact P&L par compte".
  const filterDefs: FilterDef<Lever>[] = useMemo(
    () => [
      ...(geographyFilterDefs.length > 0
        ? geographyFilterDefs
        : [
            {
              key: "geography",
              label: t("dashboard.geography", "Géographie"),
              getValue: (l: Lever) => l.geography,
            },
          ]),
      {
        key: "function",
        label: t("dashboard.leverDepartment", "Département"),
        getValue: (l: Lever) => l.function,
      },
      {
        key: "ws",
        label: "Chantier",
        getValue: (l: Lever) => data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws,
      },
    ],
    [geographyFilterDefs, data.workstreams, t]
  );

  const { activeFilters: financeFilters, setFilters: setFinanceFilters } = useMultiFilterBarState(
    filterDefs,
    { namespace: "finance" }
  );

  const filteredLevers = useMemo(() => {
    let levers = data.levers.filter((l) => l.status !== "cancelled");
    Object.entries(financeFilters).forEach(([key, value]) => {
      if (!value || value.length === 0) return;
      const def = filterDefs.find((d) => d.key === key);
      if (def) levers = levers.filter((l) => matchesFilter(def.getValue(l), value));
    });
    return levers;
  }, [data, financeFilters, filterDefs]);

  const filteredData = useMemo(() => ({ ...data, levers: filteredLevers }), [data, filteredLevers]);

  // ── Widget "Impact P&L par compte" (déplacé depuis le dashboard Performance) ──
  // Filtres géographiques (cascade Région → Pays → Entité).
  const [pnlFilterGeo, setPnlFilterGeo] = useState<string[]>([]);
  const [pnlFilterCountry, setPnlFilterCountry] = useState<string[]>([]);
  const [pnlFilterEntity, setPnlFilterEntity] = useState<string[]>([]);

  // Repart des leviers déjà filtrés par les filtres globaux de la page (géographie/département/
  // workstream, voir `filteredLevers` ci-dessus) — cette cascade géo locale au widget reste pour
  // affiner encore par pays/entité, sans dupliquer le filtre région déjà couvert globalement.
  const pnlFilteredLevers = useMemo(() => {
    let levers = filteredLevers;
    if (pnlFilterGeo.length)
      levers = levers.filter((l) => matchesFilter(l.geography, pnlFilterGeo));
    if (pnlFilterCountry.length)
      levers = levers.filter((l) => matchesFilter(l.country, pnlFilterCountry));
    if (pnlFilterEntity.length)
      levers = levers.filter((l) => matchesFilter(l.entity, pnlFilterEntity));
    return levers;
  }, [filteredLevers, pnlFilterGeo, pnlFilterCountry, pnlFilterEntity]);

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
      .filter((l) => matchesFilter(l.geography, pnlFilterGeo))
      .forEach((l) => {
        if (l.country) vals.add(l.country);
      });
    return Array.from(vals).sort();
  }, [data, pnlFilterGeo]);
  const pnlEntityOptions = useMemo(() => {
    const vals = new Set<string>();
    data.levers
      .filter((l) => matchesFilter(l.geography, pnlFilterGeo))
      .filter((l) => matchesFilter(l.country, pnlFilterCountry))
      .forEach((l) => {
        if (l.entity) vals.add(l.entity);
      });
    return Array.from(vals).sort();
  }, [data, pnlFilterGeo, pnlFilterCountry]);

  const pnlFilteredData = useMemo(
    () => ({ ...data, levers: pnlFilteredLevers }),
    [data, pnlFilteredLevers]
  );

  // Filtre temporel (cascade Année → Trimestre → Mois). `data.program.fyStart` (ProgramConfig,
  // legacy mono-programme) est un vestige souvent vide/invalide pour une entreprise qui utilise
  // le système de Programme moderne (voir useActiveProgram) — s'y fier en premier produisait un
  // `pnlYear` littéralement "NaN" (aucune ligne ne matchait alors jamais aucune période, tout le
  // tableau "Compte de résultat configuré" et le graphique "Impact P&L par compte" affichaient
  // 0 partout). Priorité : Programme actif (moderne) > ProgramConfig (legacy) > année courante.
  const { activeProgram } = useActiveProgram();
  const fyYear = useMemo(() => {
    const fromActiveProgram = activeProgram?.fyStart ? new Date(activeProgram.fyStart) : null;
    if (fromActiveProgram && !isNaN(fromActiveProgram.getTime())) {
      return String(fromActiveProgram.getFullYear());
    }
    const fromLegacy = data.program.fyStart ? new Date(data.program.fyStart) : null;
    if (fromLegacy && !isNaN(fromLegacy.getTime())) {
      return String(fromLegacy.getFullYear());
    }
    return String(new Date().getFullYear());
  }, [activeProgram, data.program.fyStart]);
  const [pnlYear, setPnlYear] = useState(fyYear);
  // `activeProgram` se résout de façon asynchrone (souscription Firestore) : au tout premier
  // rendu il peut encore être `null`, donc `fyYear` initial retombe sur le legacy/l'année
  // courante. Une fois le Programme actif résolu, réaligne `pnlYear` UNE SEULE FOIS (pas à
  // chaque recalcul de `fyYear`, pour ne pas écraser une année choisie manuellement ensuite par
  // l'utilisateur).
  const fyYearSyncedRef = useRef(false);
  useEffect(() => {
    if (fyYearSyncedRef.current) return;
    if (!activeProgram) return;
    fyYearSyncedRef.current = true;
    setPnlYear(fyYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProgram]);
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

      {/* Filtres globaux de la page (géographie/département/workstream) — s'appliquent à tous les
          graphiques ci-dessous ET au widget "Impact P&L par compte"/tableau "Compte de résultat
          configuré" (voir `filteredData`/`pnlFilteredLevers`). */}
      <DropdownFilterBar
        items={data.levers.filter((l) => l.status !== "cancelled")}
        multiple
        defs={filterDefs}
        active={financeFilters}
        onChange={setFinanceFilters}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CostEngagedVsUpcomingChart data={filteredData} />
        <CostByHierarchyChart
          data={filteredData}
          hierarchyLevels={hierarchyLevels}
          hierarchyNodes={hierarchyNodes}
        />
      </div>

      <FinanceHierarchyTable
        data={filteredData}
        hierarchyLevels={hierarchyLevels}
        hierarchyNodes={hierarchyNodes}
      />

      <InvestVsSavingsChart data={filteredData} />

      <CostCommitmentTimelineChart data={filteredData} />

      <Card className="mb-0">
        <CardHeader
          title={t("dashboard.widgets.pnl")}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <MultiSelect
                label={t("pnl.filterRegion", "Région")}
                placeholder={t("pnl.allRegions")}
                values={pnlFilterGeo}
                onChange={(vals) => {
                  setPnlFilterGeo(vals);
                  setPnlFilterCountry([]);
                  setPnlFilterEntity([]);
                }}
                options={pnlGeoOptions.map((g) => ({ value: g, label: g }))}
              />
              <MultiSelect
                label={t("pnl.filterCountry", "Pays")}
                placeholder={t("pnl.allCountries")}
                values={pnlFilterCountry}
                onChange={(vals) => {
                  setPnlFilterCountry(vals);
                  setPnlFilterEntity([]);
                }}
                options={pnlCountryOptions.map((c) => ({ value: c, label: c }))}
              />
              <MultiSelect
                label={t("pnl.filterEntity", "Entité")}
                placeholder={t("pnl.allEntities")}
                values={pnlFilterEntity}
                onChange={setPnlFilterEntity}
                options={pnlEntityOptions.map((ent) => ({ value: ent, label: ent }))}
              />
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
                  <th className="px-3 py-2 text-right">
                    {t("finance.pnlRealizedNet", "Réalisé (net)")}
                  </th>
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
                      <dt className="text-tertiary">
                        {t("finance.pnlRealizedNet", "Réalisé (net)")}
                      </dt>
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
                    <dt className="text-tertiary">
                      {t("finance.pnlRealizedNet", "Réalisé (net)")}
                    </dt>
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
