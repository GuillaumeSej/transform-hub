"use client";

import { useRouter } from "next/navigation";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import * as engine from "@/lib/engine";
import { Card, CardBody } from "@/components/shared/Card";
import { StageBadge } from "@/components/shared/StageBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import type { Lever } from "@/types";

type Row = Lever & { realized: number; wsName: string; statusLabel: string };

/**
 * Dashboard du Workstream Sponsor : mêmes leviers que la bibliothèque complète (pas de filtre
 * owner, contrairement au Lever Owner), avec un bandeau d'indicateurs de suivi au-dessus.
 */
export default function WorkstreamsPage() {
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  const lifecycle = useLifecycleLabels(user?.companyId);
  const router = useRouter();
  const summary = engine.programSummary(data);

  const rows: Row[] = data.levers.map((l) => ({
    ...l,
    realized: engine.realizedSavings(l, data),
    wsName: data.workstreams.find((w) => w.id === l.ws)?.name.split(" ")[0] ?? l.ws,
    statusLabel: lifecycle.label(l.status),
  }));

  const columns: ColumnDef<Row>[] = [
    { key: "code", label: "Code", width: "90px" },
    { key: "name", label: "Levier", render: (r) => <strong>{r.name}</strong> },
    { key: "wsName", label: "Workstream" },
    {
      key: "owner",
      label: "Owner",
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Avatar initials={r.ownerInit} size="sm" /> {r.owner}
        </span>
      ),
    },
    { key: "sponsor", label: "Sponsor" },
    {
      key: "netSavings",
      label: "Net €M",
      align: "right",
      render: (r) => r.netSavings.toFixed(1),
    },
    { key: "realized", label: "Réalisé", align: "right", render: (r) => r.realized.toFixed(1) },
    { key: "progress", label: "Progress", render: (r) => <ProgressBar pct={r.progress} /> },
    { key: "risk", label: "Risque", render: (r) => <StatusBadge risk={r.risk} /> },
    {
      key: "statusLabel",
      label: "Niveau",
      render: (r) => <StageBadge status={r.status} label={lifecycle.label(r.status)} />,
    },
  ];

  return (
    <div className="animate-fade-up">
      <div className="mb-5">
        <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
          Workstream Dashboard
        </h1>
        <div className="mt-2.5 text-[13px] text-secondary">
          Vue de tous les leviers du programme, tous workstreams confondus.
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Leviers" value={String(summary.leverCount)} />
        <Kpi
          label="Savings réalisés / cible"
          value={`${engine.fmtCurr(summary.realized)} / ${engine.fmtCurr(summary.target)}`}
          sub={`${summary.progressPct}%`}
        />
        <Kpi label="On track" value={String(summary.onTrack)} tone="green" />
        <Kpi label="At risk" value={String(summary.atRisk)} tone="amber" />
        <Kpi label="Critical" value={String(summary.critical)} tone="red" />
      </div>

      <Card>
        <CardBody flush>
          <EditableTable
            data={rows}
            columns={columns}
            onRowClick={(row) => router.push(`/levers/detail?id=${row.id}`)}
            searchPlaceholder="Rechercher (nom, code, owner...)"
            defaultSort={{ key: "risk", direction: "desc" }}
          />
        </CardBody>
      </Card>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "green" | "amber" | "red";
}) {
  const toneClass =
    tone === "green"
      ? "text-rag-green-dark"
      : tone === "amber"
        ? "text-rag-amber"
        : tone === "red"
          ? "text-rag-red"
          : "text-primary";
  return (
    <div className="rounded-lg border border-border bg-white p-3.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
        {label}
      </div>
      <div className={`mt-1 text-lg font-bold ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-tertiary">{sub}</div>}
    </div>
  );
}
