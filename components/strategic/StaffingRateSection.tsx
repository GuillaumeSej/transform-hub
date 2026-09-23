"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar as RBar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Modal } from "@/components/shared/Modal";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { hexToRgb } from "@/components/strategic/TimelineBars";
import { periodBoundsForDate, todayIso, type NeedGranularity } from "@/lib/staffingNeed";
import {
  STAFFING_OVER_THRESHOLD,
  STAFFING_TENSE_THRESHOLD,
  filterStaffingByAxes,
  monthsOfYear,
  staffingRatePoint,
  staffingRateSeries,
  teamStaffingMatrix,
  type StaffingRateLevel,
  type TeamPeriodCell,
} from "@/lib/staffingRate";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierStaffing, StrategicAxis } from "@/types";

/**
 * Section « Mobilisé vs disponible (base ETP) » de la page Budget & effectifs mobilisés —
 * remplace l'ancienne section « Besoin déclaré vs disponible » (demande PO) :
 *  - le graphique par équipe (2e graphique) est supprimé ;
 *  - le graphique par période ne montre plus que Disponible et Mobilisé, avec le TAUX DE STAFFING
 *    (mobilisé / disponible) en courbe, barres et points colorés par niveau ;
 *  - granularité Mois / Trimestre / Semestre / Année ;
 *  - filtre multi-axes (seules les mobilisations des chantiers des axes choisis sont comptées, le
 *    disponible reste celui des équipes) ;
 *  - heatmap équipe × mois (année navigable), cellules cliquables → projets contributeurs.
 * Toute la logique de calcul vit dans `lib/staffingRate.ts` (testée).
 */

type Granularity = Extract<NeedGranularity, "monthly" | "quarterly" | "semiannual" | "annual">;
const GRANULARITIES: Granularity[] = ["monthly", "quarterly", "semiannual", "annual"];

const FALLBACK_AXIS_COLOR = "#a99e9a";
const AVAILABLE_FILL = "#d4d0cd";
const MOBILISED_FILL = "#1a1a1a";

/** Couleurs de marque par niveau (app/globals.css) : coral = sur-staffé, coral-pink = tendu,
 *  violet (secours graphique) = OK. */
const LEVEL_COLOR: Record<StaffingRateLevel, string> = {
  over: "#ff3c47",
  tense: "#ff797b",
  ok: "#421799",
  none: "#c4c4c4",
};

/** Classes des cellules de heatmap — texte noir/blanc uniquement (charte). */
const LEVEL_CELL_CLASS: Record<StaffingRateLevel, string> = {
  over: "bg-bp-coral text-white font-bold",
  tense: "bg-bp-coral-pink text-black font-semibold",
  ok: "bg-neutral-100 text-black",
  none: "bg-white text-tertiary",
};

function axisColor(axis: StrategicAxis): string {
  return axis.color && hexToRgb(axis.color) ? axis.color : FALLBACK_AXIS_COLOR;
}

function formatPeriodLabel(label: string, g: Granularity, locale: string): string {
  if (g !== "monthly") return label;
  const [y, m] = label.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function formatMonthLong(label: string, locale: string): string {
  const [y, m] = label.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function StaffingRateSection({
  staffing,
  axes,
  axisIdsByChantier,
  fteByDept,
  chantierNamesById,
  actionNamesById,
  onTeamClick,
}: {
  staffing: ChantierStaffing[];
  axes: StrategicAxis[];
  axisIdsByChantier: Record<string, string[] | undefined>;
  fteByDept: Record<string, number>;
  chantierNamesById: Record<string, string>;
  actionNamesById: Record<string, string>;
  /** Clic sur le nom d'une équipe (heatmap) → détail des employés disponibles, géré par la page. */
  onTeamClick?: (team: string) => void;
}) {
  const { t, locale } = useTranslation();
  const today = useMemo(() => todayIso(new Date()), []);
  const currentYear = Number(today.slice(0, 4));

  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [selectedAxisIds, setSelectedAxisIds] = useState<string[]>([]);
  const [heatmapYear, setHeatmapYear] = useState(currentYear);
  const [openCell, setOpenCell] = useState<{ team: string; cell: TeamPeriodCell } | null>(null);

  const levelLabel = (level: StaffingRateLevel) => t(`effectifs.staffingRate.level.${level}`);
  const pctText = (pct: number | null) => (pct === null ? "—" : `${pct} %`);

  const filteredStaffing = useMemo(
    () => filterStaffingByAxes(staffing, axisIdsByChantier, selectedAxisIds),
    [staffing, axisIdsByChantier, selectedAxisIds]
  );
  const totalAvailable = useMemo(
    () => Object.values(fteByDept).reduce((sum, v) => sum + v, 0),
    [fteByDept]
  );

  const series = useMemo(
    () => staffingRateSeries(filteredStaffing, totalAvailable, granularity, today),
    [filteredStaffing, totalAvailable, granularity, today]
  );
  const chartData = useMemo(
    () =>
      series.map((p) => ({
        key: p.label,
        period: formatPeriodLabel(p.label, granularity, locale),
        available: Number(p.available.toFixed(2)),
        mobilised: Number(p.mobilised.toFixed(2)),
        ratePct: p.ratePct,
        level: p.level,
      })),
    [series, granularity, locale]
  );

  const currentPeriod = useMemo(
    () => periodBoundsForDate(today, granularity),
    [today, granularity]
  );
  const currentPoint = useMemo(
    () =>
      staffingRatePoint(
        filteredStaffing.filter((e) => e.startDate),
        totalAvailable,
        currentPeriod
      ),
    [filteredStaffing, totalAvailable, currentPeriod]
  );

  const currentMonth = useMemo(() => periodBoundsForDate(today, "monthly"), [today]);
  const overTeamsThisMonth = useMemo(
    () =>
      teamStaffingMatrix(filteredStaffing, fteByDept, [currentMonth]).filter(
        (r) => r.cells[0].level === "over"
      ).length,
    [filteredStaffing, fteByDept, currentMonth]
  );

  const months = useMemo(() => monthsOfYear(heatmapYear), [heatmapYear]);
  const matrix = useMemo(
    () => teamStaffingMatrix(filteredStaffing, fteByDept, months),
    [filteredStaffing, fteByDept, months]
  );

  const contributionName = (c: { actionId?: string; chantierId: string }) =>
    c.actionId
      ? (actionNamesById[c.actionId] ?? t("effectifs.staffingRate.unknownProjet"))
      : `${chantierNamesById[c.chantierId] ?? t("effectifs.chantierUnknown")} ${t("effectifs.staffingRate.transverse")}`;

  const cellTooltip = (team: string, cell: TeamPeriodCell) => {
    const lines = [
      `${team} — ${formatMonthLong(cell.label, locale)}`,
      t("effectifs.staffingRate.cellTooltip")
        .replace("{mobilised}", formatFte(cell.mobilised))
        .replace("{available}", formatFte(cell.available)),
      cell.available > 0
        ? `${t("effectifs.staffingRate.rate")} : ${pctText(cell.ratePct)} (${levelLabel(cell.level)})`
        : t("effectifs.staffingRate.noAvailability"),
    ];
    if (cell.contributions.length > 0) {
      lines.push(
        `${t("effectifs.staffingRate.topProjets")} : ${cell.contributions
          .slice(0, 3)
          .map((c) => `${contributionName(c)} (${formatFte(c.fte)})`)
          .join(", ")}`
      );
    }
    return lines.join("\n");
  };

  const toggleAxis = (axisId: string) =>
    setSelectedAxisIds((prev) =>
      prev.includes(axisId) ? prev.filter((id) => id !== axisId) : [...prev, axisId]
    );

  const hasData = series.length > 0 || matrix.length > 0;

  return (
    <>
      <Card className="mb-0">
        <CardHeader
          title={t("effectifs.staffingRate.title")}
          actions={
            <div className="flex overflow-hidden rounded-md border border-border">
              {GRANULARITIES.map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={granularity === g}
                  onClick={() => setGranularity(g)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition ${
                    granularity === g
                      ? "bg-black text-white"
                      : "bg-white text-secondary hover:text-primary"
                  }`}
                >
                  {t(`staffingPeriod.granularity.${g}`)}
                </button>
              ))}
            </div>
          }
        />
        <CardBody>
          <p className="mb-3 text-[11px] text-tertiary">{t("effectifs.staffingRate.hint")}</p>

          {/* Filtre multi-axes */}
          {axes.length > 0 && (
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
                  {t("effectifs.staffingRate.axisFilter")}
                </span>
                <button
                  type="button"
                  aria-pressed={selectedAxisIds.length === 0}
                  onClick={() => setSelectedAxisIds([])}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    selectedAxisIds.length === 0
                      ? "border-black bg-black text-white"
                      : "border-border bg-white text-secondary hover:border-black"
                  }`}
                >
                  {t("effectifs.staffingRate.allAxes")}
                </button>
                {axes.map((axis) => {
                  const active = selectedAxisIds.includes(axis.id);
                  return (
                    <button
                      key={axis.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleAxis(axis.id)}
                      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                        active
                          ? "border-black bg-black text-white"
                          : "border-border bg-white text-secondary hover:border-black"
                      }`}
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: axisColor(axis) }}
                      />
                      {axis.name}
                    </button>
                  );
                })}
              </div>
              {selectedAxisIds.length > 0 && (
                <p className="mt-1.5 text-[11px] text-tertiary">
                  {t("effectifs.staffingRate.axisFilterHint")}
                </p>
              )}
            </div>
          )}

          {!hasData ? (
            <p className="text-sm text-text-secondary">{t("effectifs.staffingRate.empty")}</p>
          ) : (
            <>
              {/* Synthèse période courante */}
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-secondary">
                <span>
                  {t("effectifs.staffingRate.headline")
                    .replace(
                      "{period}",
                      formatPeriodLabel(currentPeriod.label, granularity, locale)
                    )
                    .replace("{mobilised}", formatFte(currentPoint.mobilised))
                    .replace("{available}", formatFte(currentPoint.available))}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[12px] ${LEVEL_CELL_CLASS[currentPoint.level]}`}
                >
                  {t("effectifs.staffingRate.rate")} {pctText(currentPoint.ratePct)}
                  {currentPoint.level !== "none" && ` · ${levelLabel(currentPoint.level)}`}
                </span>
                {overTeamsThisMonth > 0 && (
                  <span className="rounded bg-bp-coral px-2 py-0.5 text-[12px] font-bold text-white">
                    {t("effectifs.staffingRate.overTeamsNow")
                      .replace("{n}", String(overTeamsThisMonth))
                      .replace("{period}", formatMonthLong(currentMonth.label, locale))}
                  </span>
                )}
              </div>

              {series.length > 0 && (
                <div className="mb-6">
                  <p className="mb-2 text-[12px] font-semibold text-secondary">
                    {t("effectifs.staffingRate.seriesTitle")}
                  </p>
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart
                      data={chartData}
                      margin={{ top: 8, right: 12, left: 4, bottom: 8 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="rgba(0,0,0,0.04)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="period"
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        interval={chartData.length > 18 ? "preserveStartEnd" : 0}
                      />
                      <YAxis
                        yAxisId="fte"
                        width={40}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="pct"
                        orientation="right"
                        width={44}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        domain={[0, (max: number) => Math.max(120, Math.ceil(max / 10) * 10)]}
                        tickFormatter={(v) => `${v}%`}
                      />
                      <ReferenceLine
                        yAxisId="pct"
                        y={STAFFING_OVER_THRESHOLD}
                        stroke={LEVEL_COLOR.over}
                        strokeDasharray="4 3"
                      />
                      <ReferenceLine
                        yAxisId="pct"
                        y={STAFFING_TENSE_THRESHOLD}
                        stroke={LEVEL_COLOR.tense}
                        strokeDasharray="2 3"
                      />
                      <RTooltip
                        content={({ active, payload }) => {
                          if (!active || !payload || payload.length === 0) return null;
                          const row = payload[0]?.payload as (typeof chartData)[number] | undefined;
                          if (!row) return null;
                          return (
                            <div className="rounded-md border border-border bg-white px-3 py-2 text-[12px] shadow-sm">
                              <p className="mb-1 font-bold text-primary">{row.period}</p>
                              <p className="flex justify-between gap-3 text-secondary">
                                <span>{t("effectifs.staffingRate.available")}</span>
                                <span className="font-semibold text-primary">
                                  {formatFte(row.available)} {t("staffing.fteUnit")}
                                </span>
                              </p>
                              <p className="flex justify-between gap-3 text-secondary">
                                <span>{t("effectifs.staffingRate.mobilised")}</span>
                                <span className="font-semibold text-primary">
                                  {formatFte(row.mobilised)} {t("staffing.fteUnit")}
                                </span>
                              </p>
                              <p className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1 font-bold text-primary">
                                <span>{t("effectifs.staffingRate.rate")}</span>
                                <span>
                                  {pctText(row.ratePct)}
                                  {row.level !== "none" && (
                                    <span
                                      className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] ${LEVEL_CELL_CLASS[row.level]}`}
                                    >
                                      {levelLabel(row.level)}
                                    </span>
                                  )}
                                </span>
                              </p>
                            </div>
                          );
                        }}
                      />
                      <Legend
                        verticalAlign="top"
                        wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                        formatter={(value) =>
                          value === "ratePct"
                            ? t("effectifs.staffingRate.rate")
                            : value === "available"
                              ? t("effectifs.staffingRate.available")
                              : t("effectifs.staffingRate.mobilised")
                        }
                      />
                      <RBar
                        yAxisId="fte"
                        dataKey="available"
                        fill={AVAILABLE_FILL}
                        radius={[3, 3, 0, 0]}
                      />
                      <RBar
                        yAxisId="fte"
                        dataKey="mobilised"
                        fill={MOBILISED_FILL}
                        radius={[3, 3, 0, 0]}
                      >
                        {chartData.map((row) => (
                          <Cell
                            key={row.key}
                            fill={
                              row.level === "over" || row.level === "tense"
                                ? LEVEL_COLOR[row.level]
                                : MOBILISED_FILL
                            }
                          />
                        ))}
                      </RBar>
                      <Line
                        yAxisId="pct"
                        dataKey="ratePct"
                        stroke={LEVEL_COLOR.ok}
                        strokeWidth={2}
                        connectNulls
                        dot={(props: {
                          cx?: number;
                          cy?: number;
                          index?: number;
                          payload?: (typeof chartData)[number];
                        }) => {
                          const { cx, cy, index, payload } = props;
                          if (cx === undefined || cy === undefined || !payload) {
                            return <g key={`dot-${index}`} />;
                          }
                          return (
                            <circle
                              key={`dot-${index}`}
                              cx={cx}
                              cy={cy}
                              r={payload.level === "ok" ? 3 : 4.5}
                              fill={LEVEL_COLOR[payload.level]}
                              stroke="#fff"
                              strokeWidth={1}
                            />
                          );
                        }}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <p className="mt-1 text-[11px] text-tertiary">
                    {t("effectifs.staffingRate.legend")}
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[420px] text-[11.5px]">
                      <thead>
                        <tr className="border-b border-border text-left text-tertiary">
                          <th className="py-1 pr-3 font-semibold">
                            {t("effectifs.staffingRate.periodCol")}
                          </th>
                          <th className="px-2 py-1 text-right font-semibold">
                            {t("effectifs.staffingRate.available")}
                          </th>
                          <th className="px-2 py-1 text-right font-semibold">
                            {t("effectifs.staffingRate.mobilised")}
                          </th>
                          <th className="py-1 pl-2 text-right font-semibold">
                            {t("effectifs.staffingRate.rate")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {series.map((p) => (
                          <tr
                            key={p.label}
                            className={`border-b border-border/50 ${p.label === currentPeriod.label ? "bg-neutral-50 font-semibold" : ""}`}
                          >
                            <td className="py-1 pr-3 text-primary">
                              {formatPeriodLabel(p.label, granularity, locale)}
                            </td>
                            <td className="px-2 py-1 text-right">{formatFte(p.available)}</td>
                            <td className="px-2 py-1 text-right">{formatFte(p.mobilised)}</td>
                            <td className="py-1 pl-2 text-right">
                              <span
                                className={`rounded px-1.5 py-0.5 ${p.level === "ok" || p.level === "none" ? "" : LEVEL_CELL_CLASS[p.level]}`}
                              >
                                {pctText(p.ratePct)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Heatmap équipe × mois */}
              {matrix.length > 0 && (
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[12px] font-semibold text-secondary">
                      {t("effectifs.staffingRate.heatmapTitle")}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setHeatmapYear((y) => y - 1)}
                        aria-label={t("effectifs.staffingRate.prevYear")}
                        title={t("effectifs.staffingRate.prevYear")}
                        className="flex h-7 w-7 items-center justify-center rounded border border-border bg-white text-secondary hover:border-black hover:text-primary"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <span className="min-w-[3rem] text-center text-[12px] font-bold text-primary">
                        {heatmapYear}
                      </span>
                      <button
                        type="button"
                        onClick={() => setHeatmapYear((y) => y + 1)}
                        aria-label={t("effectifs.staffingRate.nextYear")}
                        title={t("effectifs.staffingRate.nextYear")}
                        className="flex h-7 w-7 items-center justify-center rounded border border-border bg-white text-secondary hover:border-black hover:text-primary"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-separate border-spacing-[2px] text-[11px]">
                      <thead>
                        <tr className="text-tertiary">
                          <th className="py-1 pr-2 text-left font-semibold">
                            {t("effectifs.staffingRate.teamCol")}
                          </th>
                          <th className="px-1 py-1 text-right font-semibold">
                            {t("effectifs.staffingRate.available")}
                          </th>
                          {months.map((m) => (
                            <th
                              key={m.label}
                              className={`px-1 py-1 text-center font-semibold ${m.label === currentMonth.label ? "text-primary underline decoration-bp-coral decoration-2 underline-offset-4" : ""}`}
                            >
                              {new Date(`${m.start}T00:00:00Z`).toLocaleDateString(locale, {
                                month: "short",
                                timeZone: "UTC",
                              })}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.map((row) => (
                          <tr key={row.team}>
                            <td className="whitespace-nowrap py-1 pr-2 font-semibold text-primary">
                              {onTeamClick ? (
                                <button
                                  type="button"
                                  onClick={() => onTeamClick(row.team)}
                                  title={t("effectifs.staffingRate.teamClickHint")}
                                  className="underline-offset-2 hover:underline"
                                >
                                  {row.team}
                                </button>
                              ) : (
                                row.team
                              )}
                            </td>
                            <td className="px-1 py-1 text-right text-secondary">
                              {formatFte(row.available)}
                            </td>
                            {row.cells.map((cell) => (
                              <td key={cell.label} className="p-0">
                                <button
                                  type="button"
                                  title={cellTooltip(row.team, cell)}
                                  onClick={() => setOpenCell({ team: row.team, cell })}
                                  className={`block h-7 w-full min-w-[44px] rounded-sm px-1 text-center tabular-nums transition hover:outline hover:outline-2 hover:outline-black ${
                                    cell.mobilised === 0 && cell.available > 0
                                      ? LEVEL_CELL_CLASS.none
                                      : LEVEL_CELL_CLASS[cell.level]
                                  }`}
                                >
                                  {cell.ratePct === null
                                    ? cell.mobilised > 0
                                      ? "!"
                                      : "—"
                                    : cell.mobilised === 0
                                      ? "·"
                                      : `${cell.ratePct}%`}
                                </button>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-tertiary">
                    {(["over", "tense", "ok"] as const).map((level) => (
                      <span key={level} className="flex items-center gap-1">
                        <span
                          aria-hidden
                          className={`h-3 w-5 rounded-sm ${LEVEL_CELL_CLASS[level]}`}
                        />
                        {levelLabel(level)}
                      </span>
                    ))}
                    <span>{t("effectifs.staffingRate.legend")}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Modal
        open={openCell !== null}
        onOpenChange={(open) => {
          if (!open) setOpenCell(null);
        }}
        title={
          openCell
            ? t("effectifs.staffingRate.cellDetailTitle")
                .replace("{team}", openCell.team)
                .replace("{period}", formatMonthLong(openCell.cell.label, locale))
            : ""
        }
        maxWidth="560px"
      >
        {openCell && (
          <div>
            <p className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-secondary">
              <span>
                {t("effectifs.staffingRate.cellTooltip")
                  .replace("{mobilised}", formatFte(openCell.cell.mobilised))
                  .replace("{available}", formatFte(openCell.cell.available))}
              </span>
              <span className={`rounded px-2 py-0.5 ${LEVEL_CELL_CLASS[openCell.cell.level]}`}>
                {t("effectifs.staffingRate.rate")} {pctText(openCell.cell.ratePct)}
              </span>
            </p>
            {openCell.cell.contributions.length === 0 ? (
              <p className="py-4 text-center text-sm text-tertiary">
                {t("effectifs.staffingRate.cellDetailEmpty")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-left text-[12px]">
                  <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-secondary">
                    <tr>
                      <th className="px-3 py-2">{t("effectifs.staffingRate.projetCol")}</th>
                      <th className="px-3 py-2">{t("effectifs.staffingRate.chantierCol")}</th>
                      <th className="px-3 py-2 text-right">{t("effectifs.staffingRate.fteCol")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {openCell.cell.contributions.map((c) => (
                      <tr key={`${c.actionId ?? ""}|${c.chantierId}`} className="text-primary">
                        <td className="px-3 py-2 font-medium">
                          {c.actionId
                            ? (actionNamesById[c.actionId] ??
                              t("effectifs.staffingRate.unknownProjet"))
                            : t("effectifs.staffingRate.transverse")}
                        </td>
                        <td className="px-3 py-2 text-tertiary">
                          {chantierNamesById[c.chantierId] ?? t("effectifs.chantierUnknown")}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{formatFte(c.fte)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
