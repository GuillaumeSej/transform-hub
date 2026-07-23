"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, TriangleAlert, Users, Wallet } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import * as hr from "@/lib/hrEngine";
import { fmtCurr } from "@/lib/engine";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { KPICard } from "@/components/shared/KPICard";
import { RadialProgress } from "@/components/shared/RadialProgress";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import {
  FteWaterfallChart,
  FteWaterfallLegend,
} from "@/components/shared/charts/FteWaterfallChart";
import {
  DepartmentMovementsChart,
  HrDonutChart,
} from "@/components/shared/charts/HrBreakdownCharts";
import type { MovementAlertKind } from "@/lib/hrEngine";

const ALERT_LABELS: Record<MovementAlertKind, string> = {
  overdue: "En retard",
  leverMismatch: "Désynchronisé levier",
  toValidate: "À valider",
  due: "Échéance proche",
};

/**
 * Dashboard RH — pilotage visuel de la transformation effectifs : waterfall baseline → cible
 * cliquable (décomposition par levier), mouvements par département/pays, impact masse salariale,
 * suivi PSE et alertes de réconciliation avec les leviers. La donnée détaillée vit dans la
 * Base ETP (/hr/etp).
 */
export default function HrDashboardPage() {
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const router = useRouter();
  const [granularity, setGranularity] = useState<"month" | "quarter">("quarter");
  const [drillBucket, setDrillBucket] = useState<string | null>(null);

  const wf = data.workforce;
  const alerts = useMemo(() => hr.movementAlerts(wf, data.levers), [wf, data.levers]);
  const bridge = useMemo(() => hr.fteBridge(wf, granularity), [wf, granularity]);
  const salary = useMemo(() => hr.salaryBridge(wf, "quarter"), [wf]);
  const byDept = useMemo(() => hr.movementsByDepartment(wf), [wf]);
  const byCountry = useMemo(() => hr.movementsByCountry(wf), [wf]);
  const deptDeltas = useMemo(() => hr.deltaByDepartment(wf), [wf]);
  const pse = useMemo(() => hr.pseSummary(wf), [wf]);

  const current = hr.currentFTE(wf);
  const target = hr.targetFTE(wf);
  const landing = hr.plannedFTE(wf);
  const reductionGoal = wf.totalFTE - target;
  const reductionDone = wf.totalFTE - current;
  const goalPct = reductionGoal > 0 ? Math.round((reductionDone / reductionGoal) * 100) : 100;

  const alertCounts = (Object.keys(ALERT_LABELS) as MovementAlertKind[])
    .map((kind) => ({ kind, count: alerts.filter((a) => a.kind === kind).length }))
    .filter((a) => a.count > 0);

  const drill = useMemo(() => {
    if (!drillBucket) return [];
    const bucket = bridge.find((b) => b.label === drillBucket);
    return bucket ? hr.bucketByLever(bucket, data.levers) : [];
  }, [drillBucket, bridge, data.levers]);

  const realizedMovements = wf.movements.filter((m) => m.status === "Réalisé").length;

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            Dashboard RH
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            Trajectoire effectifs {wf.totalFTE.toLocaleString("fr-FR")} →{" "}
            {target.toLocaleString("fr-FR")} ETP · {wf.movements.length} mouvements ·{" "}
            {realizedMovements} réalisés
          </div>
        </div>
        <Button variant="primary" onClick={() => router.push("/hr/etp")}>
          <Users size={13} /> Ouvrir la Base ETP
        </Button>
      </div>

      {/* Alertes RH — réconciliation avec les leviers */}
      {alerts.length > 0 && (
        <div className="mb-4 rounded-lg border border-rag-amber-light bg-rag-amber-light/30 p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-primary">
              <TriangleAlert size={14} className="text-rag-amber" /> {alerts.length} alerte(s)
              mouvement
            </span>
            {alertCounts.map(({ kind, count }) => (
              <button
                key={kind}
                onClick={() =>
                  router.push(`/hr/etp?f_alert=${encodeURIComponent(ALERT_LABELS[kind])}`)
                }
                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:border-black ${
                  kind === "overdue" || kind === "leverMismatch"
                    ? "border-rag-red-light bg-rag-red-light/60 text-rag-red"
                    : "border-border bg-white text-secondary"
                }`}
              >
                {ALERT_LABELS[kind]} · {count}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {alerts.slice(0, 3).map((a, i) => (
              <div key={i} className="text-xs text-secondary">
                <span className="font-mono text-[10px] text-tertiary">{a.movement.id}</span>{" "}
                {a.message}
              </div>
            ))}
            {alerts.length > 3 && (
              <button
                onClick={() => router.push("/hr/etp")}
                className="text-xs font-medium text-bp-coral hover:underline"
              >
                Voir les {alerts.length - 3} autres dans la Base ETP →
              </button>
            )}
          </div>
        </div>
      )}

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-[auto_1fr_1fr_1fr_1fr] gap-3.5 max-[1100px]:grid-cols-2">
        <div className="flex items-center justify-center rounded-lg border border-border bg-white px-5 shadow-sm">
          <RadialProgress
            pct={goalPct}
            size={104}
            label={`${goalPct}%`}
            sublabel="objectif réalisé"
          />
        </div>
        <KPICard
          label="Effectif actuel"
          value={current.toLocaleString("fr-FR")}
          icon={Users}
          sub={`baseline ${wf.totalFTE.toLocaleString("fr-FR")} ETP`}
        />
        <KPICard
          label="Cible fin 2026"
          value={target.toLocaleString("fr-FR")}
          icon={Users}
          accent="green"
          sub={`atterrissage plan : ${landing.toLocaleString("fr-FR")} (${landing - target > 0 ? "+" : ""}${(landing - target).toLocaleString("fr-FR")} vs cible)`}
        />
        <KPICard
          label="Masse salariale"
          value={`€${wf.massSalary.toFixed(1)}M`}
          icon={Wallet}
          accent="brown"
          sub={`budget €${wf.budgetSalary.toFixed(1)}M`}
        />
        <KPICard
          label="Économies salariales réalisées"
          value={fmtCurr(hr.realizedSalarySavings(wf) / 1_000_000)}
          icon={Banknote}
          accent="green"
          sub="annualisées · mouvements réalisés"
        />
      </div>

      {/* Waterfall ETP */}
      <Card>
        <CardHeader
          title="Trajectoire des effectifs — waterfall des mouvements"
          actions={
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["month", "quarter"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGranularity(g)}
                  className={`px-3 py-1.5 text-xs font-semibold ${granularity === g ? "bg-black text-white" : "bg-white text-secondary"}`}
                >
                  {g === "month" ? "Mois" : "Trimestre"}
                </button>
              ))}
            </div>
          }
        />
        <CardBody>
          <FteWaterfallChart
            buckets={bridge}
            baseline={wf.totalFTE}
            target={target}
            onBarClick={(label) => setDrillBucket(label)}
          />
          <FteWaterfallLegend />
        </CardBody>
      </Card>

      {/* Breakdowns département / pays */}
      <div className="mb-4 grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
        <Card className="mb-0">
          <CardHeader title="Mouvements par département (ETP)" />
          <CardBody>
            <DepartmentMovementsChart data={byDept} />
          </CardBody>
        </Card>
        <Card className="mb-0">
          <CardHeader title="Mouvements par pays (ETP)" />
          <CardBody>
            <HrDonutChart
              data={byCountry.map((c) => ({ name: c.country, value: c.fte }))}
              onSliceClick={(country) =>
                router.push(`/hr/etp?f_country=${encodeURIComponent(country)}`)
              }
            />
            <p className="mt-1 text-center text-[10.5px] text-tertiary">
              Cliquer sur un pays pour ouvrir la Base ETP filtrée
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Masse salariale + PSE */}
      <div className="mb-4 grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
        <Card className="mb-0">
          <CardHeader title="Impact masse salariale (€M, annualisé)" />
          <CardBody>
            <FteWaterfallChart
              buckets={salary}
              baseline={wf.massSalary}
              target={wf.massSalary + salary.reduce((s, b) => s + b.delta, 0)}
              unit="€M"
              decimals={1}
              height={240}
            />
            <FteWaterfallLegend downLabel="Économies" upLabel="Recrutements (coûts)" />
          </CardBody>
        </Card>
        <Card className="mb-0">
          <CardHeader title="Suivi du PSE (Plan de Sauvegarde de l'Emploi)" />
          <CardBody>
            <div className="mb-4 flex items-end gap-3">
              {[
                { label: "Postes concernés", value: pse.postes, color: "bg-neutral-300" },
                { label: "En cours", value: pse.enCours, color: "bg-rag-amber" },
                { label: "Réalisés", value: pse.realises, color: "bg-bp-coral" },
                { label: "Validés RH", value: pse.valides, color: "bg-rag-green" },
              ].map((stage) => {
                const max = Math.max(1, pse.postes);
                return (
                  <div key={stage.label} className="flex flex-1 flex-col items-center gap-1.5">
                    <span className="text-lg font-bold text-primary">{stage.value}</span>
                    <div
                      className={`w-full rounded-t-sm ${stage.color}`}
                      style={{ height: `${Math.max(8, (Number(stage.value) / max) * 90)}px` }}
                    />
                    <span className="text-center text-[10px] uppercase tracking-wide text-tertiary">
                      {stage.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1.5 border-t border-border pt-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-secondary">Coût social engagé / provision</span>
                <strong>
                  {fmtCurr(pse.coutEngage / 1_000_000)} / {fmtCurr(pse.coutTotal / 1_000_000)}
                </strong>
              </div>
              <ProgressBar
                pct={pse.coutTotal > 0 ? Math.round((pse.coutEngage / pse.coutTotal) * 100) : 0}
              />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Départements : actuel / cible / atterrissage */}
      <Card>
        <CardHeader title="Effectifs par département — actuel vs cible vs atterrissage" />
        <CardBody flush>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr>
                {[
                  "Département",
                  "Actuel",
                  "Cible",
                  "Atterrissage plan",
                  "Écart vs cible",
                  "Avancement",
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
              {deptDeltas.map((d) => {
                const toDo = d.fte - d.fteTarget;
                const done = d.fte - d.landing;
                const pct = toDo !== 0 ? Math.round((done / toDo) * 100) : 100;
                return (
                  <tr
                    key={d.name}
                    className="border-b border-border last:border-b-0 hover:bg-neutral-50"
                  >
                    <td className="px-3 py-2.5 font-semibold text-primary">{d.name}</td>
                    <td className="px-3 py-2.5 tabular-nums">{d.fte.toLocaleString("fr-FR")}</td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {d.fteTarget.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {d.landing.toLocaleString("fr-FR")}
                    </td>
                    <td
                      className={`px-3 py-2.5 font-semibold tabular-nums ${d.gapToTarget > 0 ? "text-rag-red" : "text-rag-green-dark"}`}
                    >
                      {d.gapToTarget > 0 ? "+" : ""}
                      {d.gapToTarget.toLocaleString("fr-FR")}
                    </td>
                    <td className="w-[180px] px-3 py-2.5">
                      <ProgressBar pct={Math.max(0, Math.min(100, pct))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* Drill-down waterfall par levier */}
      <Modal
        open={drillBucket !== null}
        onOpenChange={(open) => !open && setDrillBucket(null)}
        title={`Mouvements ${granularity === "month" ? "du mois de" : "du"} ${drillBucket ?? ""} — décomposition par levier`}
        maxWidth="640px"
      >
        {drill.length === 0 ? (
          <p className="py-6 text-center text-sm text-tertiary">
            Aucun mouvement sur cette période.
          </p>
        ) : (
          <div className="space-y-3">
            {drill.map((entry) => {
              const lever = data.levers.find((l) => l.id === entry.leverId);
              return (
                <div
                  key={entry.leverId}
                  className="rounded-md border border-border bg-neutral-50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => router.push(`/levers/detail?id=${entry.leverId}`)}
                      className="text-left text-xs font-semibold text-primary hover:text-primary hover:underline"
                    >
                      <span className="font-mono text-[10px] text-tertiary">{entry.leverCode}</span>{" "}
                      {entry.leverName}
                    </button>
                    <span className={`text-sm font-bold text-primary`}>
                      {entry.fte > 0 ? "+" : ""}
                      {entry.fte} ETP
                    </span>
                  </div>
                  {lever && (
                    <div className="mt-0.5 text-[10.5px] text-tertiary">
                      {lifecycle.label(lever.status)} · fin prévue {lever.end}
                    </div>
                  )}
                  <div className="mt-2 space-y-1">
                    {entry.movements.map((m) => (
                      <div key={m.id} className="flex items-center justify-between text-[11px]">
                        <span className="text-secondary">
                          {m.type} · {m.label}
                        </span>
                        <span className="text-tertiary">
                          {m.plannedDate} · {m.status}
                          {m.hrValidated ? " ✓RH" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </div>
  );
}
