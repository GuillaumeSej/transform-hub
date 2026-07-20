"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useGlobalFilters, matchesGlobalFilters } from "@/lib/hooks/useGlobalFilters";
import { FilterBar, type ActiveFilters, type FilterDef } from "@/components/shared/FilterBar";
import { Banknote, CircleCheck, TriangleAlert, TrendingUp, Users } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import * as engine from "@/lib/engine";
import { STATUS_LABEL } from "@/lib/status-config";
import { KPICard } from "@/components/shared/KPICard";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { AlertItem } from "@/components/shared/AlertItem";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { ExcelUploadButton } from "@/components/shared/ExcelUploadButton";
import { ExportButton } from "@/components/shared/ExportButton";
import { SCurveChart } from "@/components/shared/charts/SCurveChart";
import { WorkstreamBarChart } from "@/components/shared/charts/WorkstreamBarChart";
import { GeoDonutChart } from "@/components/shared/charts/GeoDonutChart";
import { PnlBarChart } from "@/components/shared/charts/PnlBarChart";
import { StageFunnel } from "@/components/shared/charts/StageFunnel";
import { SankeyChart } from "@/components/shared/charts/SankeyChart";
import { MarimekkoChart } from "@/components/shared/charts/MarimekkoChart";
import { QuarterlyBridgeChart } from "@/components/shared/charts/QuarterlyBridgeChart";
import type { Lever, LeverStatus } from "@/types";

export default function DashboardPage() {
  const data = useBeTrackData();
  const router = useRouter();
  const { filters, setFilter, resetFilters } = useGlobalFilters();

  const filterDefs: FilterDef<Lever>[] = useMemo(
    () => [
      { key: "status", label: "Statut", getValue: (l) => STATUS_LABEL[l.status] },
      { key: "ws", label: "Workstream", getValue: (l) => data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws },
      { key: "owner", label: "Owner", getValue: (l) => l.owner },
      { key: "geography", label: "Géographie", getValue: (l) => l.geography },
      { key: "function", label: "Fonction", getValue: (l) => l.function },
      { key: "type", label: "Type", getValue: (l) => l.type },
    ],
    [data.workstreams],
  );

  const activeForBar: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    if (filters.f_status) result.status = filters.f_status.split(",").filter(Boolean);
    if (filters.f_ws) result.ws = filters.f_ws.split(",").filter(Boolean);
    if (filters.f_owner) result.owner = filters.f_owner.split(",").filter(Boolean);
    if (filters.f_geography) result.geography = filters.f_geography.split(",").filter(Boolean);
    if (filters.f_function) result.function = filters.f_function.split(",").filter(Boolean);
    if (filters.f_type) result.type = filters.f_type.split(",").filter(Boolean);
    return result;
  }, [filters]);

  const handleFilterChange = (next: ActiveFilters) => {
    resetFilters();
    const map: Record<string, keyof typeof filters> = {
      status: "f_status",
      ws: "f_ws",
      owner: "f_owner",
      geography: "f_geography",
      function: "f_function",
      type: "f_type",
    };
    Object.entries(next).forEach(([key, values]) => {
      const globalKey = map[key];
      if (globalKey && values.length > 0) setFilter(globalKey, values.join(","));
    });
  };

  const filteredLevers = useMemo(() => {
    return data.levers.filter((l) =>
      matchesGlobalFilters(
        {
          status: STATUS_LABEL[l.status],
          ws: data.workstreams.find((w) => w.id === l.ws)?.name ?? l.ws,
          function: l.function,
          geography: l.geography,
          country: l.country,
          owner: l.owner,
          type: l.type,
          priority: l.priority,
          risk: l.risk,
          end: l.end,
        },
        filters,
      ),
    );
  }, [data.levers, data.workstreams, filters]);

  const filteredData = useMemo(() => ({ ...data, levers: filteredLevers }), [data, filteredLevers]);

  const summary = engine.programSummary(filteredData);
  const sCurve = engine.sCurve3(data);
  const stages = engine.stageCounts(filteredData);
  const sankey = engine.sankeyData(filteredData);
  const sankeyChrono = engine.sankeyChronology(filteredData);
  const mekko = engine.marimekko(filteredData);
  const bridge = engine.quarterlyBridge(filteredData);

  const goToLevers = (params: Record<string, string>) => {
    const globalParams: Record<string, string> = {};
    Object.entries(filters).forEach(([key, value]) => {
      if (value) globalParams[key] = value;
    });
    const merged = { ...globalParams, ...params };
    const qs = new URLSearchParams(merged).toString();
    router.push(`/levers${qs ? `?${qs}` : ""}`);
  };
  const goToStage = (status: LeverStatus) => goToLevers({ f_status: STATUS_LABEL[status] });
  const goToStageLabel = (label: string) => {
    const stage = stages.find((s) => s.label === label);
    if (stage) goToStage(stage.status);
  };
  const goToAlert = (alert: (typeof data.alerts)[number]) => {
    if (alert.scope.startsWith("WS-")) {
      const ws = data.workstreams.find((w) => w.id === alert.scope);
      goToLevers(ws ? { f_ws: ws.name } : {});
    } else if (data.getLeverById(alert.scope)) {
      router.push(`/levers/detail?id=${alert.scope}`);
    } else {
      goToLevers({});
    }
  };
  const currentYear = new Date(data.program.fyStart).getFullYear();
  const goToMonth = (month: string) => goToLevers({ f_endMonth: `${month} ${currentYear}` });
  const goToQuarter = (quarter: string) => goToLevers({ f_endQuarter: quarter });

  const wsBars = data.workstreams.map((w) => ({
    label: w.name.split(" ")[0],
    realized: engine.workstreamSummary(data, w.id).realized,
    target: w.target,
  }));
  const geoMap = engine.byGeo(filteredData);
  const geoData = Object.entries(geoMap).map(([name, value]) => ({ name, value }));
  const pnlMap = engine.pnlImpact(filteredData);
  const pnlData = Object.entries(pnlMap).map(([id, impact]) => ({
    account: data.pnlAccounts.find((a) => a.id === id)?.name ?? id,
    impact,
  }));
  const activeScenario = data.scenarios.find((s) => s.id === data.activeScenario);

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            Executive Dashboard
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            Programme <strong>{data.program.name}</strong> · {summary.leverCount} leviers actifs ·
            Scénario : {activeScenario?.name}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExcelUploadButton data={data} />
          <ExportButton type="pptx" />
          <select
            value={data.activeScenario}
            onChange={(e) => data.setActiveScenario(e.target.value)}
            className="rounded-md border border-border-strong bg-white px-3 py-2 text-[13px] font-semibold text-primary"
          >
            {data.scenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                Scénario : {sc.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4">
        <FilterBar
          items={data.levers}
          defs={filterDefs}
          active={activeForBar}
          onChange={handleFilterChange}
        />
      </div>

      <div className="mb-4 grid grid-cols-5 gap-3.5 max-[1100px]:grid-cols-2">
        <KPICard
          label="Savings réalisés YTD"
          value={engine.fmtCurr(summary.realized)}
          icon={Banknote}
          sub={`vs. cible ${engine.fmtCurr(summary.target)} · ${summary.progressPct}%`}
          barPct={summary.progressPct}
        />
        <KPICard
          label="Leviers Delivered"
          value={`${summary.delivered} / ${summary.leverCount}`}
          icon={CircleCheck}
          accent="green"
        />
        <KPICard
          label="Leviers At Risk"
          value={String(summary.atRisk)}
          icon={TriangleAlert}
          accent="amber"
          sub={`${summary.critical} critiques · à surveiller`}
        />
        <KPICard
          label="CAPEX engagé"
          value={engine.fmtCurr(summary.capex)}
          icon={TrendingUp}
          accent="brown"
          sub={`+ ${engine.fmtCurr(summary.opex)} OPEX`}
        />
        <KPICard
          label="ETP impactés"
          value={String(summary.fteImpact)}
          icon={Users}
          sub={`${engine.fmtInt(summary.popImpacted)} pers. concernées`}
        />
      </div>

      <div className="mb-4 grid grid-cols-[1.4fr_1fr] gap-4 max-[1100px]:grid-cols-1">
        <Card className="mb-0">
          <CardHeader title="Avancement des leviers (L1 → L5)" />
          <CardBody>
            <StageFunnel data={stages} onStageClick={goToStage} />
          </CardBody>
        </Card>
        <Card className="mb-0">
          <CardHeader title="Alerts & Notifications" />
          <CardBody>
            {data.alerts.slice(0, 5).map((a) => (
              <AlertItem key={a.id} alert={a} onClick={() => goToAlert(a)} />
            ))}
            {data.alerts.length === 0 && (
              <p className="py-6 text-center text-sm text-tertiary">Aucune alerte active</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mb-4">
        <CardHeader title="S-Curve — Plan initial / Réalisé / Réactualisé" />
        <CardBody>
          <SCurveChart data={sCurve} height={360} onPointClick={goToMonth} />
        </CardBody>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Économies par trimestre → cible" />
        <CardBody>
          <QuarterlyBridgeChart
            data={bridge}
            target={summary.target}
            height={340}
            onBarClick={goToQuarter}
          />
        </CardBody>
      </Card>

      <div className="mb-4 grid grid-cols-[1.4fr_1fr] gap-4 max-[1100px]:grid-cols-1">
        <Card className="mb-0">
          <CardHeader title="Flux des leviers par étape (Sankey)" />
          <CardBody>
            <SankeyChart data={sankey} chronologyData={sankeyChrono} height={300} onNodeClick={goToStageLabel} />
          </CardBody>
        </Card>
        <Card className="mb-0">
          <CardHeader title="Savings par fonction (Marimekko)" />
          <CardBody>
            <MarimekkoChart
              data={mekko}
              height={300}
              onSegmentClick={(func) => goToLevers({ f_function: func })}
            />
          </CardBody>
        </Card>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
        <Card className="mb-0">
          <CardHeader title="Savings par Workstream" />
          <CardBody>
            <WorkstreamBarChart data={wsBars} />
          </CardBody>
        </Card>
        <Card className="mb-0">
          <CardHeader title="Savings par Géographie" />
          <CardBody>
            <GeoDonutChart data={geoData} />
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Synthèse des Workstreams" />
        <CardBody flush>
          <div className="overflow-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  {[
                    "Workstream",
                    "Sponsor",
                    "Leviers",
                    "Réalisé / Cible",
                    "Progression",
                    "Risque",
                    "CAPEX",
                    "OPEX/an",
                  ].map((h) => (
                    <th
                      key={h}
                      className="border-b border-border bg-neutral-50 px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-secondary"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.workstreams.map((ws) => {
                  const ss = engine.workstreamSummary(data, ws.id);
                  return (
                    <tr
                      key={ws.id}
                      onClick={() => goToLevers({ f_ws: ws.name })}
                      className="cursor-pointer border-b border-border last:border-b-0 hover:bg-neutral-50"
                    >
                      <td className="px-3 py-2.5 font-semibold text-primary">{ws.name}</td>
                      <td className="px-3 py-2.5">
                        <Avatar
                          initials={ws.sponsor
                            .split(" ")
                            .map((x) => x[0])
                            .join("")
                            .slice(0, 2)}
                          size="sm"
                        />{" "}
                        {ws.sponsor}
                      </td>
                      <td className="px-3 py-2.5">{ss.leverCount}</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        <strong>{engine.fmtCurr(ss.realized)}</strong> / {engine.fmtCurr(ss.target)}
                      </td>
                      <td className="px-3 py-2.5">
                        <ProgressBar pct={ss.progressPct} />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge risk={ss.worstRisk} />
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{engine.fmtCurr(ss.capex)}</td>
                      <td className="px-3 py-2.5 tabular-nums">{engine.fmtCurr(ss.opex)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
        <Card className="mb-0">
          <CardHeader title="Dépendances inter-leviers (top 5)" />
          <CardBody>
            {data.levers
              .filter((l) => l.dependencies.length)
              .slice(0, 5)
              .map((l) => (
                <div
                  key={l.id}
                  className="flex items-center gap-2.5 border-b border-border py-2 text-[12.5px] last:border-b-0"
                >
                  <Avatar initials={l.ownerInit} size="sm" />
                  <div className="flex-1">
                    <strong>{l.name}</strong> <span className="text-tertiary">({l.code})</span>
                  </div>
                  <div className="flex gap-1">
                    {l.dependencies.map((d) => (
                      <span
                        key={d.targetId}
                        className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-secondary"
                      >
                        {d.targetId}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
          </CardBody>
        </Card>
        <Card className="mb-0">
          <CardHeader title="Impact P&L par compte" />
          <CardBody>
            <PnlBarChart data={pnlData} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
