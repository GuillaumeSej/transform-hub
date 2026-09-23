"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  MovementBreakdownRow,
  MovementBreakdownSeries,
  MovementRealizationRow,
} from "@/lib/hrEngine";
import {
  formatSignedFr,
  movementNetBalance,
  type MovementNetBalance,
} from "@/lib/hrMovementBalance";
import {
  MovementNetBalanceSummary,
  netBalanceColor,
} from "@/components/shared/MovementNetBalanceSummary";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { WorkforceMovement } from "@/types";

// Palette catégorielle validée (dataviz, tous checks PASS sur surface claire).
export const HR_CATEGORICAL = ["#FF3C47", "#421799", "#320300", "#FFB1B5", "#421799", "#A99E9A"];

const COLOR_DOWN = "#FF3C47"; // départs forcés + attrition (exits)
const COLOR_UP = "#421799"; // recrutements — bp-purple, aligné waterfall ETP
const COLOR_NEUTRAL = "#806659"; // transferts (entrants + sortants)

type NetLabelProps = { x?: number | string; y?: number | string; index?: number };

/**
 * Barres empilées +/− des cinq types de mouvements par département, pays ou programme.
 *
 * Lecture : au-dessus de 0 = entrées (recrutements, transferts entrants), en dessous = sorties
 * (attrition, départs forcés, transferts sortants). Le chiffre au-dessus de chaque groupe est le
 * bilan net ETP (`movementNetBalance`, lib/hrMovementBalance.ts — hors transferts), coloré
 * violet si positif / rouge corail si négatif, identique à l'infobulle et à la modale de
 * drill-down (`MovementDrilldownModal`). Juste en dessous, en taupe, le solde transferts du
 * groupe (« transf. ±N ») quand le groupe a des transferts — sens lu RELATIVEMENT AU GROUPE
 * (`MovementBreakdownRow.transferDirections`), comme les barres. L'ancien « rond blanc » (net
 * non légendé) a été retiré.
 */
export function DepartmentMovementsChart({
  data,
  height = 260,
  dimensionLabel,
  onBarClick,
}: {
  data: MovementBreakdownRow[];
  height?: number;
  /** Titre de l'axe horizontal ("Département", "Pays", "Programme"). */
  dimensionLabel?: string;
  /** Clic sur une barre (n'importe lequel des 5 types) — ouvre le détail des mouvements de cette
   *  ligne (voir `MovementDrilldownModal`, câblé dans `app/(app)/hr/page.tsx`). */
  onBarClick?: (
    label: string,
    movements: WorkforceMovement[],
    /** Bilan du groupe (transferts lus relativement au groupe) — à repasser à la modale. */
    balance: MovementNetBalance
  ) => void;
}) {
  const { t } = useTranslation();
  const etp = t("etp.column.fte", "ETP");

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.noDataToDisplay", "Aucune donnée à afficher.")}
      </p>
    );
  }

  const series: {
    key: MovementBreakdownSeries;
    label: string;
    color: string;
  }[] = [
    {
      key: "recrutements",
      label: t("chart.movementType.recruitments", "Recrutements"),
      color: COLOR_UP,
    },
    {
      key: "transfertEntrants",
      label: t("chart.movementType.transfersIn", "Transferts entrants"),
      color: "#A99E9A",
    },
    {
      key: "attritions",
      label: t("chart.movementType.attrition", "Attrition"),
      color: "#FFB1B5",
    },
    {
      key: "forcedDepartures",
      label: t("chart.movementType.forcedDepartures", "Départs forcés"),
      color: COLOR_DOWN,
    },
    {
      key: "transfertSortants",
      label: t("chart.movementType.transfersOut", "Transferts sortants"),
      color: COLOR_NEUTRAL,
    },
  ];

  const chartData = data.map((d) => ({
    dimension: d.label,
    recrutements: d.recrutements,
    transfertEntrants: d.transfertEntrants,
    attritions: -d.attritions,
    forcedDepartures: -d.forcedDepartures,
    transfertSortants: -d.transfertSortants,
    /** Sommet de la pile positive — ancre (invisible) de l'étiquette de bilan net. */
    positiveTop: d.recrutements + d.transfertEntrants,
    counts: d.counts,
    balance: movementNetBalance(d.movements, {
      transferDirection: (m) => d.transferDirections[m.id],
    }),
    movements: d.movements,
  }));
  type Row = (typeof chartData)[number];

  const handleBarClick = (payload: unknown) => {
    const row = payload as Partial<Row> | undefined;
    if (row?.dimension && row.balance && onBarClick)
      onBarClick(row.dimension, row.movements ?? [], row.balance);
  };

  const rotateTicks = data.length > 4;
  // Deux lignes d'étiquette (net + transferts) au-dessus des piles dès qu'un groupe a des transferts.
  const hasTransferLabels = chartData.some(
    (r) => r.balance.transfersIn.count + r.balance.transfersOut.count > 0
  );

  return (
    <div>
      <div className="px-1 text-[10px] font-medium text-tertiary">
        ↑ {t("shared.hrBreakdownCharts.axisFtePerType", "ETP par type de mouvement")} (
        {t("shared.hrBreakdownCharts.axisSides", "entrées au-dessus de 0, sorties en dessous")})
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart
          data={chartData}
          stackOffset="sign"
          margin={{ top: hasTransferLabels ? 30 : 18, right: 8, left: -8, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis
            dataKey="dimension"
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={rotateTicks ? -25 : 0}
            textAnchor={rotateTicks ? "end" : "middle"}
            height={(rotateTicks ? 44 : 24) + (dimensionLabel ? 14 : 0)}
            label={
              dimensionLabel
                ? {
                    value: dimensionLabel,
                    position: "insideBottom",
                    offset: 0,
                    fontSize: 10,
                    fill: "#806659",
                  }
                : undefined
            }
          />
          <YAxis
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v.toLocaleString("fr-FR")}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]?.payload as Row | undefined;
              if (!row) return null;
              return (
                <div className="max-w-[320px] rounded-md border border-border bg-white px-3 py-2 text-xs shadow-sm">
                  <div className="mb-1 font-semibold text-primary">{row.dimension}</div>
                  <div className="space-y-0.5">
                    {series
                      .filter((s) => row.counts[s.key] > 0)
                      .map((s) => (
                        <div key={s.key} className="flex items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-1.5 text-secondary">
                            <span
                              aria-hidden
                              className="inline-block h-2 w-2 rounded-[2px]"
                              style={{ backgroundColor: s.color }}
                            />
                            {s.label}
                          </span>
                          <span className="tabular-nums text-secondary">
                            {t("shared.hrBreakdownCharts.countAndFte", "{n} pers. · {v} {etp}")
                              .replace("{n}", String(row.counts[s.key]))
                              .replace("{v}", formatSignedFr(row[s.key]))
                              .replace("{etp}", etp)}
                          </span>
                        </div>
                      ))}
                  </div>
                  <div className="mt-1.5 border-t border-border pt-1.5">
                    <MovementNetBalanceSummary balance={row.balance} compact />
                  </div>
                  {onBarClick && row.movements.length > 0 && (
                    <div className="mt-1 text-[10.5px] italic text-tertiary">
                      {t(
                        "shared.hrBreakdownCharts.clickForDetail",
                        "Cliquez sur la barre pour voir la liste des mouvements."
                      )}
                    </div>
                  )}
                </div>
              );
            }}
          />
          <ReferenceLine y={0} stroke="rgba(0,0,0,0.35)" />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="mouv"
              fill={s.color}
              onClick={handleBarClick}
              cursor={onBarClick ? "pointer" : undefined}
            />
          ))}
          {/* Ancre invisible (hors légende) de l'étiquette « net ±N » au sommet de chaque groupe :
           *  aucun trait, aucun point, seule la valeur signée colorée est dessinée. */}
          <Line
            dataKey="positiveTop"
            legendType="none"
            stroke="none"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
            label={(props: NetLabelProps) => {
              const row = chartData[props.index ?? -1];
              if (!row || row.movements.length === 0) return <g />;
              const net = row.balance.netFte;
              const x = Number(props.x);
              const y = Number(props.y);
              const hasTransfers =
                row.balance.transfersIn.count + row.balance.transfersOut.count > 0;
              return (
                <g>
                  <text
                    x={x}
                    y={hasTransfers ? y - 17 : y - 6}
                    textAnchor="middle"
                    fontSize={10.5}
                    fontWeight={700}
                    fill={netBalanceColor(net) ?? "#806659"}
                  >
                    {t("shared.hrBreakdownCharts.netLabel", "net {v}").replace(
                      "{v}",
                      formatSignedFr(net)
                    )}
                  </text>
                  {hasTransfers && (
                    <text
                      x={x}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize={9.5}
                      fontWeight={600}
                      fill={COLOR_NEUTRAL}
                    >
                      {t("shared.hrBreakdownCharts.transferLabel", "transf. {v}").replace(
                        "{v}",
                        formatSignedFr(row.balance.transferNetFte)
                      )}
                    </text>
                  )}
                </g>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {/* Légende HTML en bas, centrée, carrés uniformes — même style que
          `MovementProgressByDimensionChart` ; hors du SVG, elle ne chevauche ni les barres ni les
          libellés d'axe inclinés et se replie proprement en lignes centrées. */}
      <ul className="mt-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-secondary">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5"
              style={{ backgroundColor: s.color }}
            />
            {s.label}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-tertiary">
        {t(
          "shared.hrBreakdownCharts.caption",
          "Barres : ETP par type de mouvement (au-dessus de 0 = entrées, en dessous = sorties). « net ±N » : bilan net ETP du groupe (recrutements − attrition − départs forcés, hors transferts). « transf. ±N » : bilan transferts du groupe (entrants − sortants), suivi à part. Survolez une barre pour le détail, cliquez pour la liste des mouvements."
        )}
      </p>
    </div>
  );
}

/** Réalisé + reste à faire = cible, par fonction ou pays. */
export function MovementRealizationChart({
  data,
  height = 260,
}: {
  data: MovementRealizationRow[];
  height?: number;
}) {
  const { t } = useTranslation();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(value, name) => [
            `${Number(value).toLocaleString("fr-FR")} ${t("etp.column.fte", "ETP")}`,
            String(name),
          ]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar
          dataKey="realized"
          name={t("chart.bar.realized", "Réalisé")}
          stackId="total"
          fill="#421799"
        />
        <Bar
          dataKey="remaining"
          name={t("shared.movementRealizationChart.remaining", "Reste à faire")}
          stackId="total"
          fill="#CCC1BD"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Formateur ETP par défaut (module scope, pas d'accès direct à `t`) — reçoit `t` en paramètre et
 * renvoie le formateur, appelé depuis le corps des composants ci-dessous. */
const defaultFteFormat = (t: (key: string, fallback?: string) => string) => (v: number) =>
  `${v.toLocaleString("fr-FR")} ${t("etp.column.fte", "ETP")}`;

/** Donut générique (mouvements par pays par défaut) — palette catégorielle validée, ordre fixe.
 * `formatValue` permet de réutiliser ce composant pour n'importe quelle métrique du builder
 * générique RH (voir `lib/hrDashboardPivot.ts`) — défaut = suffixe "ETP" inchangé pour l'usage
 * historique (ventilation par pays). */
export function HrDonutChart({
  data,
  height = 240,
  onSliceClick,
  formatValue,
}: {
  data: { name: string; value: number }[];
  height?: number;
  onSliceClick?: (name: string) => void;
  formatValue?: (value: number) => string;
}) {
  const { t } = useTranslation();
  const resolvedFormatValue = formatValue ?? defaultFteFormat(t);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={52}
          outerRadius={86}
          paddingAngle={2}
          onClick={(d) => {
            const name = (d as { name?: string })?.name;
            if (name) onSliceClick?.(name);
          }}
          cursor={onSliceClick ? "pointer" : undefined}
        >
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={HR_CATEGORICAL[i % HR_CATEGORICAL.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => resolvedFormatValue(Number(value))} />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          layout="vertical"
          verticalAlign="middle"
          align="right"
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Barre simple générique (une seule série) pour les vues construites par l'utilisateur via le
 * builder générique RH — une métrique croisée avec une dimension (voir `lib/hrDashboardPivot.ts`),
 * contrairement à `DepartmentMovementsChart` qui est câblé en dur sur 3 séries fixes. */
export function HrPivotBarChart({
  data,
  height = 260,
  formatValue,
  onBarClick,
}: {
  data: { label: string; value: number }[];
  height?: number;
  formatValue?: (value: number) => string;
  onBarClick?: (label: string) => void;
}) {
  const { t } = useTranslation();
  const resolvedFormatValue = formatValue ?? defaultFteFormat(t);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(value) => resolvedFormatValue(Number(value))} />
        <Bar
          dataKey="value"
          fill={HR_CATEGORICAL[0]}
          radius={[3, 3, 0, 0]}
          onClick={(d) => {
            const label = (d as { label?: string })?.label;
            if (label) onBarClick?.(label);
          }}
          cursor={onBarClick ? "pointer" : undefined}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
