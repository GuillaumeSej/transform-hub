"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LayoutGrid, Plus, Table2 } from "lucide-react";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useToast } from "@/lib/hooks/useToast";
import * as engine from "@/lib/engine";
import { Card, CardBody } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { ExportButton } from "@/components/shared/ExportButton";
import { ExcelUploadButton } from "@/components/shared/ExcelUploadButton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StageBadge } from "@/components/shared/StageBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { Kanban } from "@/components/shared/Kanban";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import { Modal } from "@/components/shared/Modal";
import { LeverForm, type LeverFormValues } from "@/components/shared/LeverForm";
import type { Lever } from "@/types";

type LeverRow = Lever & { realized: number; wsName: string };

export default function LeversPage() {
  const data = useBeTrackData();
  const router = useRouter();
  const { showToast } = useToast();
  const searchParams = useSearchParams();
  const [view, setView] = useState<"table" | "kanban">(
    (searchParams.get("view") as "table" | "kanban") ?? "table"
  );
  const [newLeverOpen, setNewLeverOpen] = useState(false);

  const wsFilter = searchParams.get("ws") ?? "";
  const statusFilter = searchParams.get("status") ?? "";
  const riskFilter = searchParams.get("risk") ?? "";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`/levers?${next.toString()}`);
  };

  const filteredLevers = useMemo(() => {
    let levers = data.levers.slice();
    if (wsFilter) levers = levers.filter((l) => l.ws === wsFilter);
    if (statusFilter) levers = levers.filter((l) => l.status === statusFilter);
    if (riskFilter) levers = levers.filter((l) => l.risk === riskFilter);
    return levers;
  }, [data.levers, wsFilter, statusFilter, riskFilter]);

  const rows: LeverRow[] = filteredLevers.map((l) => ({
    ...l,
    realized: engine.realizedSavings(l, data),
    wsName: data.workstreams.find((w) => w.id === l.ws)?.name.split(" ")[0] ?? l.ws,
  }));

  const totalNet = filteredLevers.reduce((s, l) => s + l.netSavings, 0);
  const totalReal = filteredLevers.reduce((s, l) => s + engine.realizedSavings(l, data), 0);

  const columns: ColumnDef<LeverRow>[] = [
    {
      key: "code",
      label: "Code",
      render: (r) => <span className="font-mono text-[11px] text-secondary">{r.code}</span>,
    },
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
    { key: "geography", label: "Géo" },
    { key: "function", label: "Function" },
    { key: "netSavings", label: "Net €M", align: "right", render: (r) => r.netSavings.toFixed(1) },
    { key: "realized", label: "Réalisé", align: "right", render: (r) => r.realized.toFixed(1) },
    { key: "progress", label: "Progress", render: (r) => <ProgressBar pct={r.progress} /> },
    { key: "fteImpact", label: "FTE", align: "right" },
    { key: "risk", label: "Risk", render: (r) => <StatusBadge risk={r.risk} /> },
    { key: "status", label: "Status", render: (r) => <StageBadge status={r.status} /> },
  ];

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            Lever Library
          </h1>
          <div className="mt-2.5 text-[13px] text-secondary">
            {filteredLevers.length} leviers · Net savings affiché :{" "}
            <strong>{engine.fmtCurr(totalNet)}</strong> · Réalisé :{" "}
            <strong>{engine.fmtCurr(totalReal)}</strong>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton type="excel" data={data} />
          <ExcelUploadButton data={data} />
          <Button variant="primary" onClick={() => setNewLeverOpen(true)}>
            <Plus size={13} /> New lever
          </Button>
        </div>
      </div>

      <Modal
        open={newLeverOpen}
        onOpenChange={setNewLeverOpen}
        title="Nouveau levier"
        maxWidth="760px"
      >
        <LeverForm
          data={data}
          submitLabel="Créer le levier"
          onCancel={() => setNewLeverOpen(false)}
          onSubmit={(values: LeverFormValues) => {
            const created = data.createLever({ ...values, dependencies: [] });
            setNewLeverOpen(false);
            showToast("Levier créé", created.name, "success");
            router.push(`/levers/detail?id=${created.id}`);
          }}
        />
      </Modal>

      <Card>
        <CardBody flush>
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <select
              value={wsFilter}
              onChange={(e) => setParam("ws", e.target.value)}
              className="rounded-sm border border-border px-2.5 py-1.5 text-xs"
            >
              <option value="">Tous workstreams</option>
              {data.workstreams.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setParam("status", e.target.value)}
              className="rounded-sm border border-border px-2.5 py-1.5 text-xs"
            >
              <option value="">Tous statuts</option>
              {data.leverStatuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={riskFilter}
              onChange={(e) => setParam("risk", e.target.value)}
              className="rounded-sm border border-border px-2.5 py-1.5 text-xs"
            >
              <option value="">Tous risques</option>
              {data.riskLevels.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <div className="ml-auto flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => {
                  setView("table");
                  setParam("view", "table");
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${view === "table" ? "bg-bp-coral text-white" : "bg-white text-secondary"}`}
              >
                <Table2 size={13} /> Table
              </button>
              <button
                onClick={() => {
                  setView("kanban");
                  setParam("view", "kanban");
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold ${view === "kanban" ? "bg-bp-coral text-white" : "bg-white text-secondary"}`}
              >
                <LayoutGrid size={13} /> Kanban
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {view === "table" ? (
        <EditableTable
          data={rows}
          columns={columns}
          onRowClick={(row) => router.push(`/levers/detail?id=${row.id}`)}
          searchPlaceholder="Rechercher (nom, code, owner...)"
          defaultSort={{ key: "risk", direction: "desc" }}
        />
      ) : (
        <Kanban
          levers={filteredLevers}
          onCardClick={(id) => router.push(`/levers/detail?id=${id}`)}
        />
      )}
    </div>
  );
}
