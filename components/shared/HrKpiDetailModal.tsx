"use client";

import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { Modal } from "@/components/shared/Modal";
import {
  UnderlineTabs,
  underlineTabId,
  type UnderlineTabItem,
} from "@/components/shared/UnderlineTabs";
import { fmtCurr } from "@/lib/engine";
import { formatDateShort } from "@/lib/format";
import { formatFteValue } from "@/lib/hrEngine";
import type { FteCoverage } from "@/lib/fteCoverage";
import type {
  HrKpiBreakdownRow,
  HrKpiDetail,
  HrKpiKey,
  HrKpiMovementRow,
  LeverCoverageRow,
} from "@/lib/hrKpiDetailTypes";
import { movementStatusLabel, movementTypeLabel } from "@/lib/hrMovementLabels";
import { etpMovementDeepLink } from "@/lib/hrMovementLink";
import { useTranslation } from "@/lib/i18n/useTranslation";

export type HrKpiDetailTab = "lever" | "type" | "department" | "movements" | "coverage";

type T = (key: string, fallback?: string) => string;

const PANEL_ID = "hr-kpi-detail-panel";

function kpiTitle(t: T, kpi: HrKpiKey | undefined): string {
  switch (kpi) {
    case "fte":
      return t("hr.kpi.fteImpact", "Impact ETP");
    case "salarySavings":
      return t("hr.kpi.netSalarySavings", "Économies nettes de masse salariale");
    case "socialCost":
      return t("hr.kpi.socialCostsConsumed", "Coûts sociaux consommés");
    case "netEconomy":
      return t("hr.kpi.netSavings", "Économies nettes");
    default:
      return t("hr.kpiDetail.title", "Détail de l'indicateur");
  }
}

function kpiDefinition(t: T, kpi: HrKpiKey): string {
  switch (kpi) {
    case "fte":
      return t(
        "hr.kpiDetail.def.fte",
        "Variation d'effectif portée par les mouvements : départs en négatif, recrutements en positif, mobilités internes neutres, au prorata du temps de travail."
      );
    case "salarySavings":
      return t(
        "hr.kpiDetail.def.salarySavings",
        "Masse salariale annuelle chargée économisée par les départs, nette du coût des recrutements."
      );
    case "socialCost":
      return t(
        "hr.kpiDetail.def.socialCost",
        "Coûts de départ des mouvements (indemnités, autres coûts non récurrents)."
      );
    case "netEconomy":
      return t(
        "hr.kpiDetail.def.netEconomy",
        "Économies de masse salariale diminuées des coûts sociaux engagés."
      );
  }
}

/** Ratio réalisé / cible borné à [0, 1] — 0 si la cible est nulle ou de signe opposé. */
function ratio(realized: number, target: number): number {
  if (!target || Math.sign(realized) !== Math.sign(target)) return 0;
  return Math.max(0, Math.min(1, realized / target));
}

/** Barre inline carrée (charte BP : pas d'arrondi). */
function MiniBar({ value, title }: { value: number; title?: string }) {
  return (
    <div className="h-1.5 w-16 bg-neutral-100" title={title} aria-hidden>
      <div className="h-full bg-bp-coral" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

/** Ligne de tableau cliquable accessible au clavier (Entrée / Espace). */
function ClickableRow({
  onActivate,
  label,
  children,
}: {
  onActivate: () => void;
  label: string;
  children: ReactNode;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  };
  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label={label}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      className="group cursor-pointer border-b border-border transition-colors last:border-b-0 hover:bg-bp-coral/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bp-coral"
    >
      {children}
    </tr>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-tertiary">{children}</p>;
}

const TH = "px-2 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary";
const TD = "px-2 py-2 align-middle";

/**
 * Fiche détaillée d'un KPI du Dashboard RH (Impact ETP, Économies nettes de masse salariale, Coûts
 * sociaux consommés, Économies nettes). Aucun calcul métier : l'appelant fournit un `HrKpiDetail`
 * déjà agrégé (lib/hrKpiDetail.ts) et, pour l'Impact ETP, la couverture des leviers.
 *
 * Chaque ligne est cliquable :
 * - répartition par levier / couverture → fiche levier (`/levers/detail?id=…`) ;
 * - répartition par type / département → Base ETP filtrée sur ces mouvements (`etpMovementDeepLink`) ;
 * - mouvement → Base ETP, modale d'édition du mouvement ; lien secondaire vers son levier.
 */
export function HrKpiDetailModal({
  open,
  onOpenChange,
  detail,
  coverageRows,
  coverageTotal,
  initialTab,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  detail: HrKpiDetail | null;
  /** Uniquement pour le KPI « fte » : couverture de l'ambition ETP des leviers. */
  coverageRows?: LeverCoverageRow[];
  /** Couverture globale affichée sur la carte ETP (`fteCoverage`) — sert à réconcilier la somme
   *  des restes par levier avec le reste global, qui est un NET (compensations entre leviers). */
  coverageTotal?: FteCoverage;
  initialTab?: HrKpiDetailTab;
}) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const [tab, setTab] = useState<HrKpiDetailTab>(initialTab ?? "lever");

  useEffect(() => {
    if (open) setTab(initialTab ?? "lever");
  }, [open, initialTab]);

  const kpi = detail?.kpi;
  const isFte = kpi === "fte";
  const fteUnit = t("etp.column.fte", "ETP");

  const fmt = (n: number): string =>
    isFte ? `${n > 0 ? "+" : ""}${formatFteValue(n, locale)} ${fteUnit}` : fmtCurr(n / 1_000_000);
  const fmtFte = (n: number): string =>
    `${n > 0 ? "+" : ""}${formatFteValue(n, locale)} ${fteUnit}`;

  const hasCoverage = isFte && !!coverageRows;
  const activeTab: HrKpiDetailTab = tab === "coverage" && !hasCoverage ? "lever" : tab;

  const leverCodeById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of detail?.byLever ?? []) {
      if (row.leverId) map.set(row.leverId, row.leverCode ?? row.label);
    }
    return map;
  }, [detail]);

  const navigate = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const goLever = (leverId: string) => navigate(`/levers/detail?id=${encodeURIComponent(leverId)}`);
  const goEtp = (ids: string[]) => navigate(etpMovementDeepLink(ids));

  const title = kpiTitle(t, kpi);

  if (!detail) {
    return (
      <Modal open={open} onOpenChange={onOpenChange} title={title} maxWidth="760px">
        <EmptyState>{t("hr.kpiDetail.empty", "Aucune donnée pour cet indicateur.")}</EmptyState>
      </Modal>
    );
  }

  const { totals } = detail;
  const showReforecast = fmt(totals.reforecast) !== fmt(totals.target);

  const figures: { label: string; value: string; strong?: boolean }[] = [
    { label: t("hr.kpiDetail.realized", "Réalisé"), value: fmt(totals.realized), strong: true },
    {
      label: t("hr.kpiDetail.targetLong", "Cible (réalisé + planifié)"),
      value: fmt(totals.target),
    },
    ...(showReforecast
      ? [{ label: t("hr.kpiDetail.reforecast", "Réactualisé"), value: fmt(totals.reforecast) }]
      : []),
    {
      label: t("hr.kpiDetail.progress", "Progression"),
      value: `${Math.round(totals.progressPct)} %`,
    },
  ];

  const tabs: UnderlineTabItem<HrKpiDetailTab>[] = [
    { id: "lever", label: t("hr.kpiDetail.tab.lever", "Par levier"), count: detail.byLever.length },
    { id: "type", label: t("hr.kpiDetail.tab.type", "Par type"), count: detail.byType.length },
    {
      id: "department",
      label: t("hr.kpiDetail.tab.department", "Par département"),
      count: detail.byDepartment.length,
    },
    {
      id: "movements",
      label: t("hr.kpiDetail.tab.movements", "Mouvements"),
      count: detail.movements.length,
    },
    ...(hasCoverage
      ? [
          {
            id: "coverage" as const,
            label: t("hr.kpiDetail.tab.coverage", "Couverture leviers"),
            count: coverageRows?.length ?? 0,
          },
        ]
      : []),
  ];

  const renderBreakdown = (
    rows: HrKpiBreakdownRow[],
    mode: "lever" | "etp",
    labelHeader: string
  ) => {
    if (rows.length === 0) {
      return (
        <EmptyState>{t("hr.kpiDetail.emptyBreakdown", "Aucun mouvement contributif.")}</EmptyState>
      );
    }
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12px] tabular-nums">
          <thead>
            <tr className="border-b border-border text-left">
              <th className={TH}>{labelHeader}</th>
              <th className={`${TH} text-right`}>{t("hr.kpiDetail.realized", "Réalisé")}</th>
              <th className={`${TH} text-right`}>{t("hr.target", "Cible")}</th>
              <th className={TH}>
                <span className="sr-only">{t("hr.kpiDetail.progress", "Progression")}</span>
              </th>
              <th className={`${TH} text-right`}>{t("hr.kpiDetail.movementCount", "Mvts")}</th>
              <th className={TH} aria-hidden />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const toLever = mode === "lever" && !!row.leverId;
              const activate = () =>
                toLever && row.leverId ? goLever(row.leverId) : goEtp(row.movementIds);
              const label =
                mode === "lever" && !row.key
                  ? row.label || t("hr.kpiDetail.noLever", "Sans levier")
                  : // Le code levier est déjà affiché à part : on ne garde que le nom.
                    row.leverCode && row.label.startsWith(`${row.leverCode} — `)
                    ? row.label.slice(row.leverCode.length + 3)
                    : row.label;
              const r = ratio(row.realized, row.target);
              return (
                <ClickableRow
                  key={row.key || "__none__"}
                  onActivate={activate}
                  label={
                    toLever
                      ? `${t("hr.kpiDetail.openLever", "Ouvrir la fiche levier")} ${row.leverCode ?? ""} ${label}`
                      : `${t("hr.kpiDetail.openInEtp", "Voir dans la Base ETP")} ${label}`
                  }
                >
                  <td className={`${TD} max-w-[260px]`}>
                    <span className="flex min-w-0 items-baseline gap-1.5">
                      {row.leverCode && (
                        <span className="shrink-0 text-[11px] font-semibold text-tertiary">
                          {row.leverCode}
                        </span>
                      )}
                      <span className="truncate font-semibold text-primary" title={label}>
                        {label}
                      </span>
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right font-semibold text-primary`}>
                    {fmt(row.realized)}
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right text-secondary`}>
                    {fmt(row.target)}
                  </td>
                  <td className={TD}>
                    <MiniBar value={r} title={`${Math.round(r * 100)} %`} />
                  </td>
                  <td className={`${TD} text-right text-secondary`}>{row.count}</td>
                  <td className={`${TD} w-6 text-right`}>
                    <ArrowUpRight
                      size={14}
                      className="inline text-tertiary transition-colors group-hover:text-bp-coral"
                    />
                  </td>
                </ClickableRow>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderMovements = (rows: HrKpiMovementRow[]) => {
    if (rows.length === 0) {
      return (
        <EmptyState>{t("hr.kpiDetail.emptyBreakdown", "Aucun mouvement contributif.")}</EmptyState>
      );
    }
    return (
      <div className="flex flex-col gap-3">
        {rows.length >= 2 && (
          <button
            type="button"
            onClick={() => goEtp(rows.map((r) => r.movement.id))}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-bp-coral/40 bg-bp-coral/5 px-3 py-1.5 text-[12px] font-semibold text-bp-coral transition hover:border-bp-coral hover:bg-bp-coral/10"
          >
            {t("hr.drilldown.seeAllInEtp", "Voir ces {n} mouvements dans la Base ETP").replace(
              "{n}",
              String(rows.length)
            )}
            <ArrowUpRight size={13} />
          </button>
        )}
        <div className="space-y-1.5">
          {rows.map(({ movement: m, realized, target }) => {
            const leverCode = m.leverId ? leverCodeById.get(m.leverId) : undefined;
            return (
              <div
                key={m.id}
                className="flex items-stretch overflow-hidden rounded-md border border-border bg-neutral-50 transition hover:border-bp-coral hover:bg-white"
              >
                <button
                  type="button"
                  onClick={() => goEtp([m.id])}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bp-coral"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold text-primary">
                      {movementTypeLabel(t, m.type)} · {m.label}
                    </span>
                    <span className="text-[11px] text-tertiary">
                      {formatDateShort(m.actualDate ?? m.plannedDate, locale)} ·{" "}
                      {movementStatusLabel(t, m.status)}
                      {m.department ? ` · ${m.department}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-right text-[11px] tabular-nums leading-tight">
                      <span className="block font-semibold text-primary">{fmt(realized)}</span>
                      <span className="block text-tertiary">
                        {t("hr.target", "Cible")} {fmt(target)}
                      </span>
                    </span>
                    <ArrowUpRight size={14} className="text-tertiary" />
                  </span>
                </button>
                {m.leverId && (
                  <button
                    type="button"
                    onClick={() => goLever(m.leverId)}
                    title={t("hr.kpiDetail.openLever", "Ouvrir la fiche levier")}
                    className="flex shrink-0 items-center gap-1 border-l border-border px-2.5 text-[11px] font-semibold text-tertiary transition hover:text-bp-coral focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bp-coral"
                  >
                    <span className="hidden sm:inline">
                      {leverCode ?? t("hr.kpiDetail.lever", "Levier")}
                    </span>
                    <span className="sm:hidden">{t("hr.kpiDetail.lever", "Levier")}</span>
                    <ArrowUpRight size={12} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderCoverage = (rows: LeverCoverageRow[]) => (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-secondary">
        {t(
          "hr.kpiDetail.coverageIntro",
          "Ambition ETP déclarée sur chaque levier comparée à l'impact ETP cible des mouvements qui lui sont rattachés : le reste à couvrir est l'écart encore sans mouvement."
        )}
      </p>
      {rows.length === 0 ? (
        <EmptyState>
          {t("hr.kpiDetail.emptyCoverage", "Aucun levier avec une ambition ETP.")}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] text-[12px] tabular-nums">
            <thead>
              <tr className="border-b border-border text-left">
                <th className={TH}>{t("hr.kpiDetail.lever", "Levier")}</th>
                <th className={`${TH} text-right`}>
                  {t("hr.kpiDetail.coverage.target", "Visé (leviers)")}
                </th>
                <th className={`${TH} text-right`}>
                  {t("hr.kpiDetail.coverage.covered", "Couvert (mouvements)")}
                </th>
                <th className={`${TH} text-right`}>
                  {t("hr.kpiDetail.coverage.remaining", "Reste à couvrir")}
                </th>
                <th className={TH}>
                  <span className="sr-only">{t("hr.kpiDetail.progress", "Progression")}</span>
                </th>
                <th className={TH} aria-hidden />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const ambition = Math.abs(row.leverFte);
                const r =
                  ambition > 0
                    ? Math.max(0, Math.min(1, (ambition - row.remaining) / ambition))
                    : 0;
                return (
                  <ClickableRow
                    key={row.leverId}
                    onActivate={() => goLever(row.leverId)}
                    label={`${t("hr.kpiDetail.openLever", "Ouvrir la fiche levier")} ${row.leverCode} ${row.leverName}`}
                  >
                    <td className={`${TD} max-w-[240px]`}>
                      <span className="flex min-w-0 items-baseline gap-1.5">
                        <span className="shrink-0 text-[11px] font-semibold text-tertiary">
                          {row.leverCode}
                        </span>
                        <span className="truncate font-semibold text-primary" title={row.leverName}>
                          {row.leverName}
                        </span>
                      </span>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right text-secondary`}>
                      {fmtFte(row.leverFte)}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right text-secondary`}>
                      {fmtFte(row.movementFte)}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-right font-bold text-primary`}>
                      {formatFteValue(row.remaining, locale)} {fteUnit}
                    </td>
                    <td className={TD}>
                      <MiniBar value={r} title={`${Math.round(r * 100)} %`} />
                    </td>
                    <td className={`${TD} w-6 text-right`}>
                      <ArrowUpRight
                        size={14}
                        className="inline text-tertiary transition-colors group-hover:text-bp-coral"
                      />
                    </td>
                  </ClickableRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {coverageTotal && rows.length > 0 && (
        <CoverageReconciliation rows={rows} total={coverageTotal} />
      )}
    </div>
  );

  let panel: ReactNode;
  switch (activeTab) {
    case "lever":
      panel = renderBreakdown(detail.byLever, "lever", t("hr.kpiDetail.lever", "Levier"));
      break;
    case "type":
      panel = renderBreakdown(detail.byType, "etp", t("hr.kpiDetail.type", "Type"));
      break;
    case "department":
      panel = renderBreakdown(detail.byDepartment, "etp", t("hr.department", "Département"));
      break;
    case "movements":
      panel = renderMovements(detail.movements);
      break;
    case "coverage":
      panel = renderCoverage(coverageRows ?? []);
      break;
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} maxWidth="760px">
      <div className="flex flex-col gap-4">
        <div>
          <div
            className={`grid grid-cols-2 gap-px border border-border bg-border ${
              figures.length === 4 ? "sm:grid-cols-4" : "sm:grid-cols-3"
            }`}
          >
            {figures.map((f) => (
              <div key={f.label} className="bg-white px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-tertiary">
                  {f.label}
                </div>
                <div
                  className={`mt-0.5 tabular-nums ${
                    f.strong
                      ? "text-lg font-bold text-primary"
                      : "text-base font-semibold text-primary"
                  }`}
                >
                  {f.value}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 h-1 w-full bg-neutral-100" aria-hidden>
            <div
              className="h-full bg-bp-coral"
              style={{ width: `${Math.max(0, Math.min(100, totals.progressPct))}%` }}
            />
          </div>
          {kpi && <p className="mt-2 text-[12px] text-secondary">{kpiDefinition(t, kpi)}</p>}
        </div>

        <div>
          <UnderlineTabs
            label={t("hr.kpiDetail.tabsLabel", "Répartition de l'indicateur")}
            items={tabs}
            value={activeTab}
            onChange={setTab}
            panelId={PANEL_ID}
            className="mb-3"
          />
          <div role="tabpanel" id={PANEL_ID} aria-labelledby={underlineTabId(PANEL_ID, activeTab)}>
            {panel}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** Réconcilie la somme des « reste à couvrir » par levier avec le reste global de la carte ETP :
 *  le global est un net (un levier « à la hausse » ou des mouvements rattachés à un levier sans
 *  ambition compensent d'autres leviers), le détail par levier ne compense pas. */
function CoverageReconciliation({ rows, total }: { rows: LeverCoverageRow[]; total: FteCoverage }) {
  const { t, locale } = useTranslation();
  const fmt = (n: number) => formatFteValue(n, locale);
  const sum = Math.round(rows.reduce((acc, r) => acc + r.remaining, 0) * 10) / 10;
  const global = total.status === "exceeded" ? -total.exceeded : total.remaining;
  const offset = Math.round((global - sum) * 10) / 10;
  if (offset === 0) return null;
  return (
    <div className="mt-3 border-t border-neutral-200 pt-2 text-[11.5px] tabular-nums text-secondary">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          {t("hr.kpiDetail.reco.sum", "Somme des restes par levier")}{" "}
          <strong className="text-primary">{fmt(sum)}</strong>
        </span>
        <span>
          {t("hr.kpiDetail.reco.offset", "Compensations entre leviers")}{" "}
          <strong className="text-primary">{fmt(offset)}</strong>
        </span>
        <span>
          {t("hr.kpiDetail.reco.global", "Reste global (carte ETP)")}{" "}
          <strong className="text-primary">{fmt(global)}</strong>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-tertiary">
        {t(
          "hr.kpiDetail.reco.explain",
          "Le reste global est un solde net : les leviers visant une hausse d'effectif et les mouvements rattachés à des leviers sans ambition ETP viennent en déduction."
        )}
      </p>
    </div>
  );
}
