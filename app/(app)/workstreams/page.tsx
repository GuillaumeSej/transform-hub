"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";
import { useLifecycleLabels } from "@/lib/hooks/useLifecycleLabels";
import { usePerformanceProgramSelector } from "@/lib/hooks/usePerformanceProgramSelector";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { ProgramTypeMismatchNotice } from "@/components/shared/ProgramTypeMismatchNotice";
import * as engine from "@/lib/engine";
import { Card, CardBody } from "@/components/shared/Card";
import { StageBadge } from "@/components/shared/StageBadge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { Avatar } from "@/components/shared/Avatar";
import { EditableTable, type ColumnDef } from "@/components/shared/EditableTable";
import type { Company, Lever } from "@/types";
import { subscribeCompanies } from "@/lib/firestore/admin";
import {
  canUserViewLever,
  filterAggregateVisibleLevers,
  filterProgramScopedLevers,
} from "@/lib/leversLogic";
import { generateAlerts } from "@/lib/alertEngine";
import { leverHealthCounts } from "@/lib/leverHealth";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatAmountM } from "@/lib/format";

type Row = Lever & {
  realized: number;
  /** Cible RÉACTUALISÉE du levier (`engine.displayedReforecastNet`) — référence de comparaison. */
  reforecastNet: number;
  /** « Avancement » — `engine.leverProgressPct(l)`, même valeur que la bibliothèque des leviers. */
  progressPct: number;
  wsName: string;
  statusLabel: string;
};

/**
 * Dashboard du Workstream Sponsor, avec un bandeau d'indicateurs de suivi au-dessus. Un
 * utilisateur avec le rôle "sponsor" ne voit ici que les leviers de son/ses workstream(s) sponsors
 * + ceux où il est identifié individuellement comme sponsor (voir `isLeverSponsoredBy`,
 * lib/leversLogic.ts, appliqué via `canUserViewLever` ci-dessous) — les autres rôles voient la
 * bibliothèque complète, comme avant.
 */
export default function WorkstreamsPage() {
  const { t } = useTranslation();
  const { user } = useRole();
  const data = useBeTrackData(user?.companyId ?? null, user);
  // Périmètre = programme actif GLOBAL (sélecteur du Topbar, décision PO audit fix #1) — plus de
  // sélecteur local. `usePerformanceProgramSelector` n'est qu'une vue « Performance » de
  // `useActiveProgram` ; la vue consolidée agrège les programmes du périmètre consolidé (même règle
  // que Finance, `filterProgramScopedLevers`).
  const {
    performancePrograms,
    selectedProgramId,
    activeIsStrategic,
    loaded: programsLoaded,
  } = usePerformanceProgramSelector();
  const { isConsolidatedView, consolidatedPrograms } = useActiveProgram();
  // Référentiel de cycle de vie : programme actif, ou premier programme consolidé.
  const lifecycle = useLifecycleLabels(selectedProgramId ?? consolidatedPrograms[0]?.id);
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
  // Périmètre = MÊME périmètre que le dashboard exécutif (programme sélectionné, `programId`
  // strict, + règle de visibilité des vues agrégées), pour que KPI et totaux se recoupent — puis
  // restreint au périmètre du RÔLE (porteur : ses leviers ; sponsor : ses chantiers), raison d'être
  // de cette page (`canUserViewLever`). Leviers orphelins (sans programme / programme supprimé) :
  // vue consolidée seule, comme partout (audit fix #2).
  const scopedLevers = filterProgramScopedLevers(
    filterAggregateVisibleLevers(data.levers, user, company),
    {
      programId: selectedProgramId,
      isConsolidatedView,
      consolidatedProgramIds: consolidatedPrograms.map((p) => p.id),
      performanceProgramIds: performancePrograms.map((p) => p.id),
    }
  ).filter((lever) =>
    canUserViewLever(
      user,
      lever,
      company?.roleClearance,
      data.workstreams,
      company?.confidentialityLevels
    )
  );
  // Leviers abandonnés : exclus du KPI (`programSummary`) ET de la table (audit fix #2 — la table
  // les listait alors que le KPI « Leviers » ne les comptait pas) ; leur nombre est rappelé en note.
  const visibleLevers = scopedLevers.filter((l) => l.status !== "cancelled");
  const cancelledCount = scopedLevers.length - visibleLevers.length;
  const summary = engine.programSummary({ ...data, levers: visibleLevers });

  // Même définition que partout (`engine.realizationPct` : cible ≤ 0 ou réalisé négatif → 0 %).
  const reforecastPct = engine.realizationPct(summary.realized, summary.reforecastTarget);

  // Risque RECALCULÉ depuis les alertes (`engine.computeLeverRisk`, même source que la bibliothèque
  // des leviers et la fiche levier) — pas le champ stocké `Lever.risk`, figé à l'import.
  const alerts = useMemo(() => generateAlerts(data), [data]);
  // Compteurs de santé : même source et mêmes libellés que la matrice « Santé des initiatives »
  // du dashboard (alertes ouvertes, audit C6).
  const healthCounts = leverHealthCounts(visibleLevers, alerts, company?.riskThresholds);

  const rows: Row[] = visibleLevers.map((l) => ({
    ...l,
    risk: engine.computeLeverRisk(l.id, alerts, company?.riskThresholds).level,
    realized: engine.realizedSavings(l),
    reforecastNet: engine.displayedReforecastNet(l).value,
    progressPct: engine.leverProgressPct(l),
    wsName: data.workstreams.find((w) => w.id === l.ws)?.name.split(" ")[0] ?? l.ws,
    statusLabel: lifecycle.label(l.status),
  }));

  const columns: ColumnDef<Row>[] = [
    { key: "code", label: t("levers.column.code", "Code"), width: "90px" },
    {
      key: "name",
      label: t("levers.columnName", "Levier"),
      render: (r) => <strong>{r.name}</strong>,
    },
    { key: "wsName", label: t("leverForm.workstream", "Chantier") },
    {
      key: "owner",
      label: t("leverForm.owner", "Responsable"),
      render: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Avatar initials={r.ownerInit} size="sm" /> {r.owner}
        </span>
      ),
    },
    { key: "sponsor", label: t("leverForm.sponsor", "Responsable de chantier") },
    {
      key: "reforecastNet",
      label: t("workstreams.reforecastTarget", "Cible réactualisée"),
      align: "right",
      render: (r) => formatAmountM(r.reforecastNet),
    },
    {
      key: "realized",
      label: t("levers.realized", "Réalisé"),
      align: "right",
      render: (r) => formatAmountM(r.realized),
    },
    {
      key: "progressPct",
      label: t("levers.column.progress", "Avancement"),
      render: (r) => <ProgressBar pct={r.progressPct} />,
    },
    {
      key: "risk",
      label: t("leverForm.risk", "Risque"),
      render: (r) => <StatusBadge risk={r.risk} />,
    },
    {
      key: "statusLabel",
      label: t("levers.columnMaturity", "Maturité"),
      render: (r) => <StageBadge status={r.status} label={lifecycle.label(r.status)} />,
    },
  ];

  // Programme actif = Plan Stratégique (page réservée au Plan Performance) : message + bascule
  // plutôt qu'un choix silencieux d'un autre programme.
  if (activeIsStrategic) {
    return (
      <ProgramTypeMismatchNotice
        expected="performance"
        title={t("nav.workstreamDashboard", "Suivi des chantiers")}
      />
    );
  }

  // Entreprise sans aucun Plan Performance : pas de programme sur lequel scoper la table, donc
  // rien à afficher (même repli que le dashboard exécutif, voir DashboardPagePerformance).
  if (programsLoaded && performancePrograms.length === 0) {
    return (
      <div className="animate-fade-up">
        <div className="mb-5">
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("nav.workstreamDashboard", "Suivi des chantiers")}
          </h1>
        </div>
        <div className="rounded-lg border border-border bg-white p-10 text-center">
          <p className="mx-auto max-w-md text-sm text-secondary">
            {t(
              "workstreams.noProgram",
              "Aucun Plan de performance n'a encore été créé pour votre entreprise. Créez-en un dans Admin > Entreprises > Programmes, puis rattachez-y des leviers."
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
          {t("nav.workstreamDashboard", "Suivi des chantiers")}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[13px] text-secondary">
          {t(
            "workstreams.subtitle",
            "Vue de tous les leviers du programme, tous chantiers confondus."
          )}
          {/* Programme = celui du Topbar (lecture seule ici, pas de sélecteur concurrent). */}
          <strong className="text-primary">
            {isConsolidatedView
              ? t("topbar.consolidatedViewShort", "Vue consolidée")
              : (performancePrograms.find((p) => p.id === selectedProgramId)?.name ?? "")}
          </strong>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 min-[400px]:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label={t("dashboard.tableHeader.leverCount", "Leviers")}
          value={String(summary.leverCount)}
        />
        <Kpi
          label={t("workstreams.savingsRealizedTarget", "Réalisé / cible réactualisée")}
          value={`${engine.fmtCurr(summary.realized)} / ${engine.fmtCurr(summary.reforecastTarget)}`}
          sub={`${reforecastPct}% ${t("workstreams.vsReforecast", "de la cible réactualisée")}`}
        />
        <Kpi
          label={t("dashboard.widgets.healthOnTrack", "Dans les temps")}
          value={String(healthCounts.onTrack)}
          tone="green"
        />
        <Kpi
          label={t("dashboard.widgets.healthWatch", "À surveiller")}
          value={String(healthCounts.watch)}
          tone="amber"
        />
        <Kpi
          label={t("dashboard.widgets.healthCritical", "Alertes critiques")}
          value={String(healthCounts.critical)}
          tone="red"
        />
      </div>

      {cancelledCount > 0 && (
        <p className="mb-2 text-[11.5px] text-tertiary">
          {t(
            "dashboard.workstreamsCancelledHidden",
            "{n} levier(s) abandonné(s) masqué(s) — exclus des indicateurs et de la table."
          ).replace("{n}", String(cancelledCount))}
        </p>
      )}
      <Card>
        <CardBody flush>
          <EditableTable
            data={rows}
            columns={columns}
            onRowClick={(row) => router.push(`/levers/detail?id=${row.id}`)}
            searchPlaceholder={t(
              "workstreams.searchPlaceholder",
              "Rechercher (nom, code, responsable...)"
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
