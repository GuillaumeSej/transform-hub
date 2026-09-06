"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import { usePerformanceProgramSelector } from "@/lib/hooks/usePerformanceProgramSelector";
import * as engine from "@/lib/engine";
import { Card, CardBody } from "@/components/shared/Card";
import { StageBadge } from "@/components/shared/StageBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import type { Company, Lever } from "@/types";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { canUserViewLever } from "@/lib/leversLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";

type Row = Lever & { realized: number; wsName: string; statusLabel: string };

/**
 * Dashboard du Workstream Sponsor : mêmes leviers que la bibliothèque complète (pas de filtre
 * owner, contrairement au Lever Owner), avec un bandeau d'indicateurs de suivi au-dessus.
 */
export default function WorkstreamsPage() {
  const { t } = useTranslation();
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null);
  // Vue scopée à UN programme Performance sélectionnable (voir le sélecteur plus bas) : le cycle
  // de vie étant désormais configuré par programme (lib/hooks/useLifecycleLabels.ts), il faut un
  // scope unique pour résoudre le bon référentiel — d'où `usePerformanceProgramSelector`, qui
  // porte à la fois la liste des programmes Performance et la sélection courante.
  const {
    performancePrograms,
    selectedProgramId,
    setSelectedProgramId,
    loaded: programsLoaded,
  } = usePerformanceProgramSelector(user?.companyId);
  const lifecycle = useLifecycleLabels(selectedProgramId);
  const router = useRouter();
  const [company, setCompany] = useState<Company | undefined>();
  useEffect(
    () =>
      subscribeCompanies(
        (items) => setCompany(items.find((item) => item.id === user?.companyId)),
        user?.companyId ?? null
      ),
    [user?.companyId]
  );
  // Scope au programme Performance sélectionné (voir usePerformanceProgramSelector plus haut) —
  // même principe que le dashboard exécutif et LeversPagePerformance : cette page affiche UN
  // programme à la fois, pas l'ensemble de l'entreprise.
  const visibleLevers = data.levers.filter(
    (lever) =>
      lever.programId === selectedProgramId && canUserViewLever(user, lever, company?.roleClearance)
  );
  const summary = engine.programSummary({ ...data, levers: visibleLevers });

  const rows: Row[] = visibleLevers.map((l) => ({
    ...l,
    realized: engine.realizedSavings(l),
    wsName: data.workstreams.find((w) => w.id === l.ws)?.name.split(" ")[0] ?? l.ws,
    statusLabel: lifecycle.label(l.status),
  }));

  const columns: ColumnDef<Row>[] = [
    { key: "code", label: "Code", width: "90px" },
    {
      key: "name",
      label: t("levers.columnName", "Levier"),
      render: (r) => <strong>{r.name}</strong>,
    },
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
    {
      key: "realized",
      label: t("levers.realized", "Réalisé"),
      align: "right",
      render: (r) => r.realized.toFixed(1),
    },
    { key: "progress", label: "Progress", render: (r) => <ProgressBar pct={r.progress} /> },
    {
      key: "risk",
      label: t("leverForm.risk", "Risque"),
      render: (r) => <StatusBadge risk={r.risk} />,
    },
    {
      key: "statusLabel",
      label: t("levers.columnStatus", "Niveau"),
      render: (r) => <StageBadge status={r.status} label={lifecycle.label(r.status)} />,
    },
  ];

  // Entreprise sans aucun Plan Performance : pas de programme sur lequel scoper la table, donc
  // rien à afficher (même repli que le dashboard exécutif, voir DashboardPagePerformance).
  if (programsLoaded && performancePrograms.length === 0) {
    return (
      <div className="animate-fade-up">
        <div className="mb-5">
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("nav.workstreamDashboard", "Workstream Dashboard")}
          </h1>
        </div>
        <div className="rounded-lg border border-border bg-white p-10 text-center">
          <p className="mx-auto max-w-md text-sm text-secondary">
            {t(
              "workstreams.noProgram",
              "Aucun Plan Performance n'a encore été créé pour votre entreprise. Créez-en un dans Admin > Entreprises > Programmes, puis rattachez-y des leviers."
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="mb-5">
        <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
          {t("nav.workstreamDashboard", "Workstream Dashboard")}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-secondary">
          {t(
            "workstreams.subtitle",
            "Vue de tous les leviers du programme, tous workstreams confondus."
          )}
          {performancePrograms.length > 1 ? (
            <select
              value={selectedProgramId ?? ""}
              onChange={(e) => setSelectedProgramId(e.target.value)}
              className="ml-1 rounded-sm border border-border bg-white px-2 py-0.5 text-[12px] font-semibold text-primary focus:border-bp-coral focus:outline-none"
            >
              {performancePrograms.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            performancePrograms[0] && (
              <strong className="text-primary">{performancePrograms[0].name}</strong>
            )
          )}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label={t("dashboard.tableHeader.leverCount", "Leviers")}
          value={String(summary.leverCount)}
        />
        <Kpi
          label={t("workstreams.savingsRealizedTarget", "Savings réalisés / cible")}
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
            searchPlaceholder={t(
              "workstreams.searchPlaceholder",
              "Rechercher (nom, code, owner...)"
            )}
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
