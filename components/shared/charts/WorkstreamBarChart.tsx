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
import { hexForChantier } from "@/lib/axisLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";

export type WorkstreamBarPoint = {
  label: string;
  /** Cible RÉACTUALISÉE (barre de fond). */
  target: number;
  realized: number;
  /** Planifié initial (plan figé) — dessiné en contour pointillé derrière/autour des barres. */
  planned?: number;
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

/** Découpe un label en (au plus) 2 lignes pour l'affichage sous l'axe X — sans troncature dure du
 *  nom complet dans le cas courant (contrairement à l'ancien `TruncatedTick` à `maxLen = 12`).
 *  Coupe sur l'espace le plus proche du milieu quand c'est possible (évite de couper un mot en
 *  deux), sinon retombe sur une coupe brute par nombre de caractères. Seule la 2e ligne peut encore
 *  être tronquée avec `…`, et seulement dans le cas (rare) où même 2 lignes ne suffisent pas. */
function wrapLabel(label: string): [string, string] {
  const maxLineLen = 14;
  if (label.length <= maxLineLen) return [label, ""];

  const mid = Math.ceil(label.length / 2);
  let splitIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < label.length; i += 1) {
    if (label[i] === " ") {
      const distance = Math.abs(i - mid);
      if (distance < bestDistance) {
        bestDistance = distance;
        splitIndex = i;
      }
    }
  }

  let line1: string;
  let line2: string;
  if (splitIndex > 0 && splitIndex < label.length - 1) {
    line1 = label.slice(0, splitIndex);
    line2 = label.slice(splitIndex + 1);
  } else {
    line1 = label.slice(0, maxLineLen);
    line2 = label.slice(maxLineLen);
  }

  if (line2.length > maxLineLen) {
    line2 = `${line2.slice(0, maxLineLen - 1)}…`;
  }
  return [line1, line2];
}

/** Tick custom pour l'axe X : label complet réparti sur 2 lignes (plus de troncature à 12
 *  caractères). Le code couleur par workstream (déterministe, `hexForChantier`) a été déplacé
 *  dans le tooltip au survol d'une barre (voir `BreakdownList` ci-dessous) — la légende de
 *  couleurs qui vivait ici (un carré + nom sous chaque barre) faisait doublon avec le libellé de
 *  l'axe X déjà affiché juste en dessous et n'apportait aucune information supplémentaire.
 *  Le `<title>` SVG natif reste en place pour le survol (utile si une 2e ligne est malgré tout
 *  tronquée). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CategoryTick(props: any) {
  const { x = 0, y = 0, payload } = props;
  const label = (payload?.value as string) ?? "";
  const [line1, line2] = wrapLabel(label);
  return (
    <g>
      <title>{label}</title>
      <text x={x} y={y + 14} textAnchor="middle" fontSize={10} fill="#1A1A1A">
        {line1}
      </text>
      {line2 && (
        <text x={x} y={y + 26} textAnchor="middle" fontSize={10} fill="#1A1A1A">
          {line2}
        </text>
      )}
    </g>
  );
}

/** Détail par levier au format du tooltip custom (nom + montant formaté), avec un carré de
 *  couleur devant chaque levier — reprend la couleur du workstream survolé (`hexForChantier`,
 *  même hash déterministe que l'ancienne légende sous le graphique, voir `CategoryTick`
 *  ci-dessus), répétée sur chaque ligne : c'est la seule couleur pertinente et déjà disponible
 *  ici (les leviers du breakdown n'exposent que `name`/`value`, aucun statut/maturité), et elle
 *  reste cohérente avec la barre survolée. */
function BreakdownList({
  items,
  fmt,
  color,
}: {
  items: { name: string; value: number }[];
  fmt: (v: number) => string;
  color: string;
}) {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto">
      {sorted.map((item) => (
        <li key={item.name} className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-tertiary">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-[1.5px]"
              style={{ backgroundColor: color }}
            />
            <span className="truncate">{item.name}</span>
          </span>
          <span className="shrink-0 font-medium text-primary">{fmt(item.value)}</span>
        </li>
      ))}
      {items.length > sorted.length && (
        <li className="text-[10px] text-tertiary">+ {items.length - sorted.length} autre(s)</li>
      )}
    </ul>
  );
}

/** Ligne de détail par levier fusionnée (cible + réalisé), pour la popup ouverte au clic sur une
 *  barre — voir `WorkstreamBarChart.onSegmentClick`. */
type LeverRow = { name: string; target: number; realized: number };

function mergeLeverBreakdown(point: WorkstreamBarPoint): LeverRow[] {
  const byName = new Map<string, LeverRow>();
  for (const item of point.leverBreakdown?.target ?? []) {
    byName.set(item.name, { name: item.name, target: item.value, realized: 0 });
  }
  for (const item of point.leverBreakdown?.realized ?? []) {
    const existing = byName.get(item.name);
    if (existing) {
      existing.realized = item.value;
    } else {
      byName.set(item.name, { name: item.name, target: 0, realized: item.value });
    }
  }
  return Array.from(byName.values()).sort((a, b) => b.target - a.target);
}

/** Popup de détail par levier ouverte au clic sur un segment de barre — une barre horizontale par
 *  levier (cible en fond, réalisé en overlay coral, même logique visuelle que le graphique
 *  principal) avec les montants et le taux de réalisation. */
export function WorkstreamBarDetail({
  point,
  fmt,
}: {
  point: WorkstreamBarPoint;
  fmt: (v: number) => string;
}) {
  const rows = mergeLeverBreakdown(point);
  const maxTarget = Math.max(1, ...rows.map((r) => Math.max(r.target, r.realized)));

  if (rows.length === 0) {
    return <p className="text-sm text-tertiary">Aucun détail par levier disponible.</p>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const pct = row.target > 0 ? Math.round((row.realized / row.target) * 100) : 0;
        const targetWidth = Math.max(2, (row.target / maxTarget) * 100);
        const realizedWidth = row.target > 0 ? Math.min(100, (row.realized / row.target) * 100) : 0;
        return (
          <li key={row.name}>
            <div className="mb-1 flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-primary">{row.name}</span>
              <span className="shrink-0 text-tertiary">
                {fmt(row.realized)} / {fmt(row.target)} · {pct}%
              </span>
            </div>
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-neutral-100">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[rgba(168,154,147,0.35)]"
                style={{ width: `${targetWidth}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-bp-coral"
                style={{ width: `${(realizedWidth * targetWidth) / 100}%` }}
              />
            </div>
          </li>
        );
      })}
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
 *  Valeurs affichées directement sur les barres (réalisé à l'intérieur du segment coral, écart à
 *  l'intérieur du segment gris quand il est assez haut pour rester lisible, cible au sommet de la
 *  pile). Tooltip détaillé au survol d'un segment : liste des leviers qui composent ce segment
 *  (même esprit que le détail par levier du Mekko). Clic sur un segment : callback `onSegmentClick`
 *  pour ouvrir un détail par levier (popup côté appelant). */
export function WorkstreamBarChart({
  data,
  labelTarget,
  labelRealized,
  labelPlanned,
  onSegmentClick,
}: {
  data: WorkstreamBarPoint[];
  labelTarget?: string;
  labelRealized?: string;
  labelPlanned?: string;
  onSegmentClick?: (point: WorkstreamBarPoint, segment: "target" | "realized") => void;
}) {
  const { t } = useTranslation();
  const resolvedLabelTarget = labelTarget ?? t("chart.bar.target", "Cible réactualisée");
  const resolvedLabelRealized = labelRealized ?? t("chart.bar.realized", "Réalisé");
  const resolvedLabelPlanned = labelPlanned ?? t("chart.bar.planned", "Planifié initial");
  const fmt = (v: number) => `€${v}M`;
  const hasPlanned = data.some((d) => d.planned !== undefined);

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

  const maxValue = Math.max(...data.map((d) => Math.max(d.target, d.realized, d.planned ?? 0)));

  // Label combiné du segment "remaining" : la cible totale au-dessus de la pile (comportement
  // existant) + l'écart (valeur propre au segment gris) centré à l'intérieur du segment, mais
  // seulement quand ce dernier est assez haut pour rester lisible (évite le fouillis visuel sur
  // les tout petits écarts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderRemainingLabels = (props: any) => {
    const { x = 0, y = 0, width = 0, height = 0, index } = props;
    const d = chartData[index];
    if (!d) return null;
    const showGap = height > 14 && d.remaining > 0;
    return (
      <g>
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
        {showGap && (
          <text
            x={x + width / 2}
            y={y + height / 2 + 3}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            fill="#6B5D57"
          >
            {fmt(d.remaining)}
          </text>
        )}
      </g>
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
        {point.planned !== undefined && (
          <div className="flex items-center justify-between gap-3 text-secondary">
            <span>{resolvedLabelPlanned}</span>
            <span className="font-semibold text-primary">{fmt(point.planned)}</span>
          </div>
        )}
        {breakdown && breakdown.length > 0 && (
          <BreakdownList items={breakdown} fmt={fmt} color={hexForChantier(point.label)} />
        )}
      </div>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={chartData}
          margin={{ top: 20, right: 8, left: -16, bottom: 4 }}
          barCategoryGap="20%"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            tick={CategoryTick}
            height={48}
            // `interval={0}` : force l'affichage de TOUS les ticks. Sans lui, Recharts estime
            // automatiquement quels libellés se chevauchent (sur la largeur du texte à 1 ligne,
            // pas sur le rendu réel à 2 lignes de `CategoryTick`) et en masque certains — ce calcul
            // dépend du nombre de barres, donc un ou plusieurs titres de colonne disparaissaient au
            // hasard selon le filtre actif.
            interval={0}
          />
          {/* Second axe X masqué (mêmes catégories) : la barre "Planifié initial" se superpose
              exactement aux barres empilées au lieu de s'y juxtaposer. */}
          <XAxis xAxisId="planned" dataKey="label" hide />
          <YAxis
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `€${v}M`}
            domain={[0, Math.ceil(maxValue * 1.15)]}
          />
          {/* `cursor={false}` : par défaut Recharts dessine, au survol/clic d'une barre, un
              rectangle de fond gris très léger sur toute la hauteur du plot pour la catégorie
              active (le halo de sélection standard de <Tooltip>) — c'est cette barre grise
              parasite "qui va jusqu'au bout" et ne représente rien métier qui était signalée.
              Le graphique ne doit garder que les deux barres empilées Cible/Réalisé. */}
          <Tooltip content={CustomTooltip} shared={false} cursor={false} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {/* Barre réalisé (bas de la pile) — coral */}
          <Bar
            dataKey="realized"
            name={resolvedLabelRealized}
            stackId="a"
            fill="#FF3C47"
            radius={[0, 0, 0, 0]}
            cursor={onSegmentClick ? "pointer" : undefined}
            onClick={
              onSegmentClick
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (entry: any) => {
                    const point = entry?.payload as WorkstreamBarPoint | undefined;
                    if (point) onSegmentClick(point, "realized");
                  }
                : undefined
            }
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
            cursor={onSegmentClick ? "pointer" : undefined}
            onClick={
              onSegmentClick
                ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (entry: any) => {
                    const point = entry?.payload as WorkstreamBarPoint | undefined;
                    if (point) onSegmentClick(point, "target");
                  }
                : undefined
            }
          >
            <LabelList dataKey="remaining" content={renderRemainingLabels} />
          </Bar>
          {/* Planifié initial : contour pointillé sans remplissage */}
          {hasPlanned && (
            <Bar
              dataKey="planned"
              name={resolvedLabelPlanned}
              xAxisId="planned"
              fill="none"
              stroke="#320300"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              isAnimationActive={false}
              legendType="plainline"
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
