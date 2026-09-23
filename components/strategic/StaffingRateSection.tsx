"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Users, X } from "lucide-react";
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
import { Dropdown, type DropdownOption } from "@/components/shared/Dropdown";
import { Modal } from "@/components/shared/Modal";
import { MultiSelect } from "@/components/shared/MultiSelect";
import { SegmentedControl } from "@/components/shared/SegmentedControl";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { StaffingThresholdsControl } from "@/components/strategic/StaffingThresholdsControl";
import { hexToRgb } from "@/components/strategic/TimelineBars";
import {
  periodBoundsForDate,
  todayIso,
  type NeedGranularity,
  type PeriodBounds,
} from "@/lib/staffingNeed";
import {
  availableForTeam,
  filterStaffingByAxes,
  filterStaffingByTeam,
  monthsOfYear,
  periodStaffingDetail,
  staffingRateSeries,
  staffingTeams,
  teamStaffingMatrix,
  totalStaffingRow,
  type StaffingRateLevel,
  type StaffingThresholds,
  type TeamPeriodCell,
} from "@/lib/staffingRate";
import { useStaffingThresholds } from "@/lib/hooks/useStaffingThresholds";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierStaffing, StrategicAxis } from "@/types";

/**
 * Section « Mobilisé vs disponible (base ETP) » de la page Budget & effectifs mobilisés.
 *  - filtres : granularité (contrôle segmenté carré), axes (multi-sélection, pastilles de couleur
 *    d'axe) et équipe (dropdown) — le filtre équipe restreint le mobilisé ET le disponible du
 *    graphique à cette équipe, et se pose aussi depuis la heatmap (ligne surlignée + tag ✕) ;
 *  - graphique par période : Disponible vs Mobilisé (barre mobilisé colorée par niveau, taux dans
 *    l'infobulle) ; clic sur une colonne → popup « Qui est mobilisé où » (équipe > projet > lignes) ;
 *  - heatmap équipe × mois (année navigable) avec ligne TOTAL « Toutes équipes » en tête ; clic sur
 *    une cellule = filtre équipe + popup détail de ce mois.
 * Toute la logique de calcul vit dans `lib/staffingRate.ts` (testée).
 */

type Granularity = Extract<NeedGranularity, "monthly" | "quarterly" | "semiannual" | "annual">;
const GRANULARITIES: Granularity[] = ["monthly", "quarterly", "semiannual", "annual"];

const FALLBACK_AXIS_COLOR = "#a99e9a";
const AVAILABLE_FILL = "#d4d0cd";
const MOBILISED_FILL = "#1a1a1a";

/** Couleurs de marque par niveau (app/globals.css) : coral = sur-staffé, coral-pink = tendu. */
const LEVEL_COLOR: Record<StaffingRateLevel, string> = {
  over: "#ff3c47",
  tense: "#ff797b",
  ok: MOBILISED_FILL,
  none: MOBILISED_FILL,
};

/** Courbe du taux de staffing (axe % de droite) : BearingPoint Red. Points colorés par niveau. */
const RATE_LINE_COLOR = "#ff3c47";
const RATE_DOT_FILL: Record<StaffingRateLevel, string> = {
  over: "#ff3c47",
  tense: "#ff797b",
  ok: "#ffffff",
  none: "#ffffff",
};
/** Lignes de référence des seuils (couleurs claires de la charte) + libellés plus soutenus. */
const TENSE_REF_STROKE = "#a99e9a";
const TENSE_REF_LABEL = "#806659";
const OVER_REF_STROKE = "#ffb1b5";
const OVER_REF_LABEL = "#991d1f";

/** Classes des cellules de heatmap — texte noir/blanc uniquement (charte). */
const LEVEL_CELL_CLASS: Record<StaffingRateLevel, string> = {
  over: "bg-bp-coral text-white font-bold",
  tense: "bg-bp-coral-pink text-black font-semibold",
  ok: "bg-neutral-100 text-black",
  none: "bg-white text-tertiary",
};

type DetailState = { period: PeriodBounds; granularity: Granularity; team: string | null };

function axisColor(axis: StrategicAxis): string {
  return axis.color && hexToRgb(axis.color) ? axis.color : FALLBACK_AXIS_COLOR;
}

function formatMonth(label: string, locale: string, month: "short" | "long"): string {
  const [y, m] = label.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale, {
    month,
    year: month === "short" ? "2-digit" : "numeric",
    timeZone: "UTC",
  });
}

function formatDate(iso: string, locale: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
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
  /** Détail des employés disponibles d'une équipe (bouton à côté du tag de filtre équipe), géré
   *  par la page. */
  onTeamClick?: (team: string) => void;
}) {
  const { t, locale } = useTranslation();
  const today = useMemo(() => todayIso(new Date()), []);
  const currentYear = Number(today.slice(0, 4));

  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [selectedAxisIds, setSelectedAxisIds] = useState<string[]>([]);
  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [heatmapYear, setHeatmapYear] = useState(currentYear);
  const [detail, setDetail] = useState<DetailState | null>(null);

  // Seuils tendu / sur-staffé : préférence utilisateur (profil), aperçu en direct pendant l'édition.
  const { thresholds: savedThresholds, save: saveThresholds, saving } = useStaffingThresholds();
  const [previewThresholds, setPreviewThresholds] = useState<StaffingThresholds | null>(null);
  const thresholds = previewThresholds ?? savedThresholds;
  const legendText = t("effectifs.staffingRate.legend")
    .replace("{tense}", String(thresholds.tense))
    .replace("{over}", String(thresholds.over));

  const levelLabel = (level: StaffingRateLevel) => t(`effectifs.staffingRate.level.${level}`);
  const pctText = (pct: number | null) => (pct === null ? "—" : `${pct} %`);
  const fteText = (v: number) => `${formatFte(v)} ${t("staffing.fteUnit")}`;

  const periodLabel = (p: PeriodBounds, g: Granularity, style: "short" | "long") => {
    if (g === "monthly") return formatMonth(p.label, locale, style);
    if (g === "annual") return p.label;
    const [year, part] = p.label.split("-");
    return t(
      g === "quarterly"
        ? "effectifs.staffingRate.quarterLabel"
        : "effectifs.staffingRate.semesterLabel"
    )
      .replace("{n}", part.slice(1))
      .replace("{year}", style === "short" ? year.slice(2) : year);
  };

  // ── Filtres ────────────────────────────────────────────────────────────────────────────────
  const filteredStaffing = useMemo(
    () => filterStaffingByAxes(staffing, axisIdsByChantier, selectedAxisIds),
    [staffing, axisIdsByChantier, selectedAxisIds]
  );
  const teams = useMemo(() => staffingTeams(staffing, fteByDept), [staffing, fteByDept]);

  const axisOptions: DropdownOption[] = useMemo(
    () => axes.map((a) => ({ value: a.id, label: a.name, color: axisColor(a) })),
    [axes]
  );
  const teamOptions: DropdownOption[] = useMemo(
    () => teams.map((team) => ({ value: team, label: team })),
    [teams]
  );

  const axisById = useMemo(() => new Map(axes.map((a) => [a.id, a])), [axes]);
  /** Couleur de l'axe d'un chantier — de préférence un axe sélectionné dans le filtre. */
  const chantierColor = (chantierId: string) => {
    const ids = axisIdsByChantier[chantierId] ?? [];
    const preferred = ids.find((id) => selectedAxisIds.includes(id) && axisById.has(id));
    const axis = axisById.get(preferred ?? ids.find((id) => axisById.has(id)) ?? "");
    return axis ? axisColor(axis) : FALLBACK_AXIS_COLOR;
  };

  // ── Graphique par période (filtré axe + équipe) ─────────────────────────────────────────────
  const chartStaffing = useMemo(
    () => filterStaffingByTeam(filteredStaffing, teamFilter),
    [filteredStaffing, teamFilter]
  );
  const chartAvailable = useMemo(
    () => availableForTeam(fteByDept, teamFilter),
    [fteByDept, teamFilter]
  );
  const series = useMemo(
    () => staffingRateSeries(chartStaffing, chartAvailable, granularity, today, 36, thresholds),
    [chartStaffing, chartAvailable, granularity, today, thresholds]
  );
  const chartData = series.map((p) => ({
    key: p.label,
    period: periodLabel(p, granularity, "short"),
    periodLong: periodLabel(p, granularity, "long"),
    available: Number(p.available.toFixed(2)),
    mobilised: Number(p.mobilised.toFixed(2)),
    ratePct: p.ratePct,
    level: p.level,
  }));
  /** Borne haute de l'axe % : au moins le seuil sur-staffé (+ marge) pour garder les deux lignes
   *  de référence visibles. */
  const rateAxisMax =
    Math.ceil((Math.max(thresholds.over, ...chartData.map((d) => d.ratePct ?? 0)) * 1.1) / 10) * 10;

  const openPeriodDetail = (index: number) => {
    const p = series[index];
    if (!p) return;
    setDetail({
      period: { label: p.label, start: p.start, end: p.end },
      granularity,
      team: teamFilter,
    });
  };

  // ── Heatmap équipe × mois ─────────────────────────────────────────────────────────────────
  const currentMonth = useMemo(() => periodBoundsForDate(today, "monthly"), [today]);
  const months = useMemo(() => monthsOfYear(heatmapYear), [heatmapYear]);
  const matrix = useMemo(
    () => teamStaffingMatrix(filteredStaffing, fteByDept, months, thresholds),
    [filteredStaffing, fteByDept, months, thresholds]
  );
  const totalRow = useMemo(
    () => totalStaffingRow(filteredStaffing, fteByDept, months, thresholds),
    [filteredStaffing, fteByDept, months, thresholds]
  );

  const contributionName = (c: { actionId?: string; chantierId: string }) =>
    c.actionId
      ? (actionNamesById[c.actionId] ?? t("effectifs.staffingRate.unknownProjet"))
      : `${chantierNamesById[c.chantierId] ?? t("effectifs.chantierUnknown")} ${t("effectifs.staffingRate.transverse")}`;

  const cellTooltip = (team: string, cell: TeamPeriodCell) => {
    const lines = [
      `${team} — ${formatMonth(cell.label, locale, "long")}`,
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
    lines.push(t("effectifs.staffingRate.cellClickHint"));
    return lines.join("\n");
  };

  const cellClass = (cell: TeamPeriodCell) =>
    cell.mobilised === 0 && cell.available > 0
      ? LEVEL_CELL_CLASS.none
      : LEVEL_CELL_CLASS[cell.level];
  const cellText = (cell: TeamPeriodCell) =>
    cell.ratePct === null
      ? cell.mobilised > 0
        ? "!"
        : "—"
      : cell.mobilised === 0
        ? "·"
        : `${cell.ratePct}%`;

  const openCellDetail = (team: string | null, cell: TeamPeriodCell) => {
    if (team !== null) setTeamFilter(team);
    setDetail({
      period: { label: cell.label, start: cell.start, end: cell.end },
      granularity: "monthly",
      team,
    });
  };

  // ── Popup « Qui est mobilisé où » ─────────────────────────────────────────────────────────
  const detailData = useMemo(
    () =>
      detail
        ? periodStaffingDetail(filteredStaffing, fteByDept, detail.period, detail.team, thresholds)
        : null,
    [detail, filteredStaffing, fteByDept, thresholds]
  );
  const detailTeamOptions: DropdownOption[] = useMemo(() => {
    if (!detail) return [];
    const names = periodStaffingDetail(filteredStaffing, fteByDept, detail.period).teams.map(
      (row) => row.team
    );
    if (detail.team !== null && !names.includes(detail.team)) names.push(detail.team);
    return names.sort((a, b) => a.localeCompare(b)).map((name) => ({ value: name, label: name }));
  }, [detail, filteredStaffing, fteByDept]);

  const rateBadge = (ratePct: number | null, level: StaffingRateLevel, available: number) =>
    available > 0 || level === "over" ? (
      <span className={`rounded-sm px-1.5 py-0.5 text-[11px] ${LEVEL_CELL_CLASS[level]}`}>
        {pctText(ratePct)}
        {level !== "none" && ` · ${levelLabel(level)}`}
      </span>
    ) : null;

  const hasData = series.length > 0 || matrix.length > 0;

  return (
    <>
      <Card className="mb-0">
        <CardHeader
          title={t("effectifs.staffingRate.title")}
          actions={
            <SegmentedControl
              label={t("effectifs.staffingRate.granularity", "Granularité")}
              showLabel={false}
              options={GRANULARITIES.map((g) => ({
                value: g,
                label: t(`staffingPeriod.granularity.${g}`),
              }))}
              value={granularity}
              onChange={setGranularity}
            />
          }
        />
        <CardBody>
          <p className="mb-3 text-[11px] text-tertiary">{t("effectifs.staffingRate.hint")}</p>

          {/* Filtres axes (multi) + équipe (unique) — même contrôles que la page KPI. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {axes.length > 0 && (
              <MultiSelect
                label={t("effectifs.staffingRate.axisFilter")}
                placeholder={t("effectifs.staffingRate.allAxes")}
                values={selectedAxisIds}
                onChange={setSelectedAxisIds}
                options={axisOptions}
              />
            )}
            {teams.length > 0 && (
              <Dropdown
                label={t("effectifs.staffingRate.teamCol")}
                placeholder={t("effectifs.staffingRate.allTeams")}
                value={teamFilter}
                onChange={setTeamFilter}
                options={teamOptions}
                allowClear
              />
            )}
          </div>
          {(teamFilter !== null || selectedAxisIds.length > 0) && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              {teamFilter !== null && (
                <span className="inline-flex items-center gap-1.5 rounded-sm border border-black bg-white py-0.5 pl-2 pr-0.5 text-[11px] font-semibold text-primary">
                  {t("effectifs.staffingRate.teamFilterTag").replace("{team}", teamFilter)}
                  <button
                    type="button"
                    onClick={() => setTeamFilter(null)}
                    aria-label={t("effectifs.staffingRate.removeTeamFilter")}
                    title={t("effectifs.staffingRate.removeTeamFilter")}
                    className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-secondary transition hover:bg-neutral-100 hover:text-bp-coral focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  >
                    <X size={12} />
                  </button>
                </span>
              )}
              {teamFilter !== null && onTeamClick && (
                <button
                  type="button"
                  onClick={() => onTeamClick(teamFilter)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-secondary underline-offset-2 hover:text-primary hover:underline"
                >
                  <Users size={12} />
                  {t("effectifs.staffingRate.teamClickHint")}
                </button>
              )}
              {selectedAxisIds.length > 0 && (
                <span className="text-[11px] text-tertiary">
                  {t("effectifs.staffingRate.axisFilterHint")}
                </span>
              )}
            </div>
          )}

          {!hasData ? (
            <p className="text-sm text-text-secondary">{t("effectifs.staffingRate.empty")}</p>
          ) : (
            <>
              <div className="mb-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[12px] font-semibold text-secondary">
                    {t("effectifs.staffingRate.seriesTitle")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-tertiary">{legendText}</span>
                    <StaffingThresholdsControl
                      value={savedThresholds}
                      onSave={saveThresholds}
                      onPreview={setPreviewThresholds}
                      saving={saving}
                    />
                  </div>
                </div>
                {series.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-tertiary">
                    {t("effectifs.staffingRate.chartEmpty")}
                  </p>
                ) : (
                  <>
                    <ResponsiveContainer width="100%" height={280}>
                      <ComposedChart
                        data={chartData}
                        margin={{ top: 8, right: 4, left: 4, bottom: 8 }}
                        style={{ cursor: "pointer" }}
                        onClick={(state) => {
                          const index = Number(state?.activeTooltipIndex);
                          if (Number.isInteger(index)) openPeriodDetail(index);
                        }}
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
                          yAxisId="rate"
                          orientation="right"
                          width={44}
                          domain={[0, rateAxisMax]}
                          tickFormatter={(v: number) => `${v} %`}
                          tick={{ fontSize: 11, fill: RATE_LINE_COLOR }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <ReferenceLine
                          yAxisId="rate"
                          y={thresholds.tense}
                          stroke={TENSE_REF_STROKE}
                          strokeDasharray="4 4"
                          label={{
                            value: `${levelLabel("tense")} ${thresholds.tense} %`,
                            position: "insideTopLeft",
                            fontSize: 10,
                            fill: TENSE_REF_LABEL,
                          }}
                        />
                        <ReferenceLine
                          yAxisId="rate"
                          y={thresholds.over}
                          stroke={OVER_REF_STROKE}
                          strokeDasharray="4 4"
                          label={{
                            value: `${levelLabel("over")} > ${thresholds.over} %`,
                            position: "insideTopLeft",
                            fontSize: 10,
                            fill: OVER_REF_LABEL,
                          }}
                        />
                        <RTooltip
                          cursor={{ fill: "rgba(0,0,0,0.04)" }}
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const row = payload[0]?.payload as
                              (typeof chartData)[number] | undefined;
                            if (!row) return null;
                            return (
                              <div className="rounded-md border border-border bg-white px-3 py-2 text-[12px] shadow-sm">
                                <p className="mb-1 font-bold text-primary">
                                  {row.periodLong}
                                  {teamFilter !== null && ` · ${teamFilter}`}
                                </p>
                                <p className="flex justify-between gap-3 text-secondary">
                                  <span>{t("effectifs.staffingRate.available")}</span>
                                  <span className="font-semibold text-primary">
                                    {fteText(row.available)}
                                  </span>
                                </p>
                                <p className="flex justify-between gap-3 text-secondary">
                                  <span>{t("effectifs.staffingRate.mobilised")}</span>
                                  <span className="font-semibold text-primary">
                                    {fteText(row.mobilised)}
                                  </span>
                                </p>
                                <p className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-1 text-secondary">
                                  <span>{t("effectifs.staffingRate.rate")}</span>
                                  {rateBadge(row.ratePct, row.level, row.available) ?? (
                                    <span>—</span>
                                  )}
                                </p>
                                <p className="mt-1 text-[11px] text-tertiary">
                                  {t("effectifs.staffingRate.columnClickHint")}
                                </p>
                              </div>
                            );
                          }}
                        />
                        <Legend
                          verticalAlign="top"
                          wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
                          formatter={(value) =>
                            value === "available"
                              ? t("effectifs.staffingRate.available")
                              : value === "ratePct"
                                ? `${t("effectifs.staffingRate.rate")} (%)`
                                : t("effectifs.staffingRate.mobilised")
                          }
                        />
                        <RBar
                          yAxisId="fte"
                          dataKey="available"
                          fill={AVAILABLE_FILL}
                          radius={[2, 2, 0, 0]}
                        />
                        <RBar
                          yAxisId="fte"
                          dataKey="mobilised"
                          fill={MOBILISED_FILL}
                          radius={[2, 2, 0, 0]}
                        >
                          {chartData.map((row) => (
                            <Cell key={row.key} fill={LEVEL_COLOR[row.level]} />
                          ))}
                        </RBar>
                        <Line
                          yAxisId="rate"
                          type="monotone"
                          dataKey="ratePct"
                          stroke={RATE_LINE_COLOR}
                          strokeWidth={2}
                          connectNulls={false}
                          isAnimationActive={false}
                          dot={(props: {
                            cx?: number;
                            cy?: number;
                            index?: number;
                            payload?: (typeof chartData)[number];
                          }) => {
                            const { cx, cy, index, payload } = props;
                            if (cx == null || cy == null || payload?.ratePct == null)
                              return <g key={`rate-dot-${index}`} />;
                            return (
                              <circle
                                key={`rate-dot-${index}`}
                                cx={cx}
                                cy={cy}
                                r={3.5}
                                stroke={RATE_LINE_COLOR}
                                strokeWidth={1.5}
                                fill={RATE_DOT_FILL[payload.level]}
                              />
                            );
                          }}
                          activeDot={{ r: 5, stroke: RATE_LINE_COLOR, fill: RATE_LINE_COLOR }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                    <p className="mt-1 text-[11px] text-tertiary">
                      {t("effectifs.staffingRate.chartHint")
                        .replace(/\{tense\}/g, String(thresholds.tense))
                        .replace(/\{over\}/g, String(thresholds.over))}
                    </p>
                  </>
                )}
              </div>

              {/* Heatmap équipe × mois, ligne TOTAL en tête */}
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
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-white text-secondary hover:border-black hover:text-primary"
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
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-white text-secondary hover:border-black hover:text-primary"
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
                        {/* Ligne TOTAL « Toutes équipes » */}
                        <tr>
                          <td
                            className={`whitespace-nowrap border-b-2 border-black py-1 pr-2 font-bold text-primary ${teamFilter === null ? "" : "opacity-60"}`}
                          >
                            <button
                              type="button"
                              onClick={() => setTeamFilter(null)}
                              title={t("effectifs.staffingRate.allTeams")}
                              className="underline-offset-2 hover:underline"
                            >
                              {t("effectifs.staffingRate.totalRow")}
                            </button>
                          </td>
                          <td className="border-b-2 border-black px-1 py-1 text-right font-bold text-primary">
                            {formatFte(totalRow.available)}
                          </td>
                          {totalRow.cells.map((cell) => (
                            <td key={cell.label} className="border-b-2 border-black p-0 pb-[2px]">
                              <button
                                type="button"
                                title={cellTooltip(t("effectifs.staffingRate.totalRow"), cell)}
                                onClick={() => openCellDetail(null, cell)}
                                className={`block h-7 w-full min-w-[44px] rounded-sm px-1 text-center font-bold tabular-nums transition hover:outline hover:outline-2 hover:outline-black ${cellClass(cell)}`}
                              >
                                {cellText(cell)}
                              </button>
                            </td>
                          ))}
                        </tr>
                        {matrix.map((row) => {
                          const selected = teamFilter === row.team;
                          const dimmed = teamFilter !== null && !selected;
                          return (
                            <tr key={row.team} className={dimmed ? "opacity-50" : ""}>
                              <td
                                className={`whitespace-nowrap py-1 pr-2 font-semibold text-primary ${selected ? "border-l-2 border-bp-coral bg-neutral-50 pl-1.5" : ""}`}
                              >
                                <button
                                  type="button"
                                  aria-pressed={selected}
                                  onClick={() => setTeamFilter(selected ? null : row.team)}
                                  title={t("effectifs.staffingRate.teamFilterHint")}
                                  className="underline-offset-2 hover:underline"
                                >
                                  {row.team}
                                </button>
                              </td>
                              <td
                                className={`px-1 py-1 text-right text-secondary ${selected ? "bg-neutral-50" : ""}`}
                              >
                                {formatFte(row.available)}
                              </td>
                              {row.cells.map((cell) => (
                                <td key={cell.label} className="p-0">
                                  <button
                                    type="button"
                                    title={cellTooltip(row.team, cell)}
                                    onClick={() => openCellDetail(row.team, cell)}
                                    className={`block h-7 w-full min-w-[44px] rounded-sm px-1 text-center tabular-nums transition hover:outline hover:outline-2 hover:outline-black ${cellClass(cell)} ${selected ? "outline outline-1 outline-black/30" : ""}`}
                                  >
                                    {cellText(cell)}
                                  </button>
                                </td>
                              ))}
                            </tr>
                          );
                        })}
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
                    <span>{legendText}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Modal
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        title={
          detail
            ? t("effectifs.staffingRate.detailTitle").replace(
                "{period}",
                periodLabel(detail.period, detail.granularity, "long")
              )
            : ""
        }
        maxWidth="760px"
      >
        {detail && detailData && (
          <div>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <Dropdown
                label={t("effectifs.staffingRate.teamCol")}
                placeholder={t("effectifs.staffingRate.allTeams")}
                value={detail.team}
                onChange={(team) => setDetail({ ...detail, team })}
                options={detailTeamOptions}
                allowClear
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-secondary">
                <span>
                  {t("effectifs.staffingRate.mobilised")}{" "}
                  <strong className="text-primary">{fteText(detailData.mobilised)}</strong>
                </span>
                <span>
                  {t("effectifs.staffingRate.available")}{" "}
                  <strong className="text-primary">{fteText(detailData.available)}</strong>
                </span>
                <span className="flex items-center gap-1.5">
                  {t("effectifs.staffingRate.rate")}
                  {rateBadge(detailData.ratePct, detailData.level, detailData.available) ?? "—"}
                </span>
              </div>
            </div>
            {selectedAxisIds.length > 0 && (
              <p className="mb-3 text-[11px] text-tertiary">
                {t("effectifs.staffingRate.axisFilterHint")}
              </p>
            )}

            {detailData.teams.length === 0 ? (
              <p className="py-4 text-center text-sm text-tertiary">
                {t("effectifs.staffingRate.cellDetailEmpty")}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[600px] text-left text-[12px]">
                  <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-secondary">
                    <tr>
                      <th className="px-3 py-2">{t("effectifs.staffingRate.projetChantierCol")}</th>
                      <th className="px-3 py-2">{t("effectifs.staffingRate.personCol")}</th>
                      <th className="px-3 py-2">{t("effectifs.staffingRate.datesCol")}</th>
                      <th className="px-3 py-2 text-right">{t("effectifs.staffingRate.fteCol")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailData.teams.map((team) => (
                      <Fragment key={team.team}>
                        <tr className="border-t-2 border-black bg-neutral-100">
                          <td colSpan={3} className="px-3 py-2 font-bold text-primary">
                            <span className="mr-2">{team.team}</span>
                            <span className="font-normal text-secondary">
                              {team.available > 0
                                ? t("effectifs.staffingRate.cellTooltip")
                                    .replace("{mobilised}", formatFte(team.mobilised))
                                    .replace("{available}", formatFte(team.available))
                                : t("effectifs.staffingRate.noAvailability")}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            {rateBadge(team.ratePct, team.level, team.available)}
                          </td>
                        </tr>
                        {team.groups.map((group) => (
                          <Fragment key={group.key}>
                            <tr className="border-t border-border">
                              <td colSpan={3} className="px-3 py-1.5 font-semibold text-primary">
                                <span className="flex items-center gap-2">
                                  <span
                                    aria-hidden
                                    className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                                    style={{ backgroundColor: chantierColor(group.chantierId) }}
                                  />
                                  <span>
                                    {group.actionId
                                      ? (actionNamesById[group.actionId] ??
                                        t("effectifs.staffingRate.unknownProjet"))
                                      : t("effectifs.staffingRate.transverse")}
                                    <span className="ml-1.5 font-normal text-tertiary">
                                      {chantierNamesById[group.chantierId] ??
                                        t("effectifs.chantierUnknown")}
                                    </span>
                                  </span>
                                </span>
                              </td>
                              <td className="px-3 py-1.5 text-right font-semibold text-primary">
                                {formatFte(group.fte)}
                              </td>
                            </tr>
                            {group.lines.map(({ entry, fte }) => (
                              <tr key={entry.id} className="text-secondary">
                                <td className="py-1 pl-8 pr-3" />
                                <td className="px-3 py-1 text-primary">{entry.note || "—"}</td>
                                <td className="whitespace-nowrap px-3 py-1">
                                  {entry.startDate ? formatDate(entry.startDate, locale) : "—"}
                                  {" → "}
                                  {entry.endDate
                                    ? formatDate(entry.endDate, locale)
                                    : t("effectifs.staffingRate.noEndDate")}
                                </td>
                                <td className="whitespace-nowrap px-3 py-1 text-right">
                                  {formatFte(fte)}
                                  {Math.abs(fte - entry.fte) > 0.005 && (
                                    <span className="ml-1 text-[11px] text-tertiary">
                                      (
                                      {t("effectifs.staffingRate.nominalFte").replace(
                                        "{fte}",
                                        formatFte(entry.fte)
                                      )}
                                      )
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </Fragment>
                        ))}
                      </Fragment>
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
