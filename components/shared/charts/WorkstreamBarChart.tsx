"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "@/lib/i18n/useTranslation";

export type WorkstreamBarPoint = {
  label: string;
  target: number;
  realized: number;
  reforecast?: number;
  /** Détail par levier de la contribution à la cible / au réalisé — alimente le tooltip détaillé
   *  (même esprit que le Mekko : lister les leviers derrière un segment agrégé). Optionnel : les
   *  vues issues du builder générique (pivot par dimension libre) ne le fournissent pas encore. */
  leverBreakdown?: {
    target: { name: string; value: number }[];
    realized: { name: string; value: number }[];
  };
};

type ChartDatum = WorkstreamBarPoint & { remaining: number };

/** Tick custom pour l'axe X : label tronqué avec <title> SVG natif pour le tooltip au hover. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function TruncatedTick(props: any) {
  const { x = 0, y = 0, payload } = props;
  const label = (payload?.value as string) ?? "";
  const maxLen = 12;
  const truncated = label.length > maxLen ? label.slice(0, maxLen) + "…" : label;
  return (
    <g>
      <title>{label}</title>
      <text x={x} y={y + 12} textAnchor="middle" fontSize={10} fill="#1A1A1A">
        {truncated}
      </text>
    </g>
  );
}

/** Détail par levier au format du tooltip custom (nom + montant formaté). */
function BreakdownList({
  items,
  fmt,
}: {
  items: { name: string; value: number }[];
  fmt: (v: number) => string;
}) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
      {sorted.map((item) => (
        <li key={item.name} className="flex items-center justify-between gap-3">
          <span className="truncate text-tertiary">{item.name}</span>
          <span className="shrink-0 font-medium text-primary">{fmt(item.value)}</span>
        </li>
      ))}
      {items.length > sorted.length && (
        <li className="text-[10px] text-tertiary">+ {items.length - sorted.length} autre(s)</li>
      )}
    </ul>
  );
}

/** Savings réalisés vs cible par dimension (workstream, pays, département).
 *
 *  Chaque barre = cible (hauteur totale) avec remplissage coral (réalisé) empilé en bas — la
 *  partie grise au-dessus (`remaining = max(0, target - realized)`) complète visuellement jusqu'à
 *  la cible ; en cas de sur-réalisation (`realized > target`), `remaining` est clampé à 0 donc la
 *  hauteur totale de la pile == `realized` (pas de somme cible+réalisé).
 *
 *  Valeurs affichées directement sur les barres (réalisé à l'intérieur du segment coral, cible
 *  au sommet de la pile). Tooltip détaillé au survol d'un segment : liste des leviers qui
 *  composent ce segment (même esprit que le détail par levier du Mekko). */
export function WorkstreamBarChart({
  data,
  labelTarget,
  labelRealized,
}: {
  data: WorkstreamBarPoint[];
  labelTarget?: string;
  labelRealized?: string;
}) {
  const { t } = useTranslation();
  const resolvedLabelTarget = labelTarget ?? t("chart.bar.target", "Cible");
  const resolvedLabelRealized = labelRealized ?? t("chart.bar.realized", "Réalisé");
  const fmt = (v: number) => `€${v}M`;

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-tertiary">
        {t("chart.emptyLevers", "Aucun levier à représenter.")}
      </p>
    );
  }

  // Calculer la partie "remaining" (cible - réalisé) pour l'empilement.
  const chartData: ChartDatum[] = data.map((d) => ({
    ...d,
    remaining: Math.max(0, Math.round((d.target - d.realized) * 10) / 10),
  }));

  const maxValue = Math.max(...data.map((d) => Math.max(d.target, d.realized)));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTargetLabel = (props: any) => {
    const { x = 0, y = 0, width = 0, index } = props;
    const d = chartData[index];
    if (!d) return null;
    return (
      <text
        x={x + width / 2}
        y={y - 6}
        textAnchor="middle"
        fontSize={10}
        fontWeight={600}
        fill="#1A1A1A"
      >
        {fmt(d.target)}
      </text>
    );
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload || payload.length === 0) return null;
    const entry = payload[0];
    const point = entry.payload as ChartDatum;
    const isTarget = entry.dataKey === "remaining";
    const total = isTarget ? point.target : point.realized;
    const breakdown = isTarget ? point.leverBreakdown?.target : point.leverBreakdown?.realized;
    return (
      <div className="max-w-[260px] rounded-md border border-border bg-white px-3 py-2 text-xs shadow-lg">
        <div className="font-semibold text-primary">{point.label}</div>
        <div className="flex items-center justify-between gap-3 text-secondary">
          <span>{isTarget ? resolvedLabelTarget : resolvedLabelRealized}</span>
          <span className="font-semibold text-primary">{fmt(total)}</span>
        </div>
        {breakdown && breakdown.length > 0 && <BreakdownList items={breakdown} fmt={fmt} />}
      </div>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 8, left: -16, bottom: 0 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={TruncatedTick} />
          <YAxis
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `€${v}M`}
            domain={[0, Math.ceil(maxValue * 1.15)]}
          />
          <Tooltip content={CustomTooltip} shared={false} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {/* Barre réalisé (bas de la pile) — coral */}
          <Bar
            dataKey="realized"
            name={resolvedLabelRealized}
            stackId="a"
            fill="#FF3C47"
            radius={[0, 0, 0, 0]}
          >
            <LabelList
              dataKey="realized"
              position="inside"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(v: any) => (typeof v === "number" && v > 0 ? `€${v}M` : "")}
              style={{ fontSize: 10, fontWeight: 600, fill: "#fff" }}
            />
          </Bar>
          {/* Barre remaining (haut de la pile) — gris transparent, complète jusqu'à la cible */}
          <Bar
            dataKey="remaining"
            name={resolvedLabelTarget}
            stackId="a"
            fill="rgba(168,154,147,0.3)"
            radius={[4, 4, 0, 0]}
          >
            <LabelList dataKey="remaining" content={renderTargetLabel} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
