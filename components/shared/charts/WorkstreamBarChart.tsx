"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Customized,
  Legend,
  ResponsiveContainer,
  XAxis,
  YAxis,
  usePlotArea,
  useYAxisScale,
} from "recharts";
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
 *  dans le tooltip au survol d'une barre — la légende de
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
            <div className="relative h-3 w-full overflow-hidden rounded-full">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-[rgba(107,93,87,0.45)]"
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

const TAG_W = 48;
const TAG_H = 16;
/** Espace vertical entre deux tags empilés (ex. planifié initial / écart / réalisé / cible) — 3px
 *  seulement rendait les tags difficiles à distinguer les uns des autres à taille d'écran normale
 *  (retour testeur : "il n'y a pas de tag partout", alors qu'ils étaient bien tous présents mais
 *  visuellement fondus les uns dans les autres). */
const TAG_GAP = 6;
/** Largeur minimale d'un tag en fonction du texte affiché — évite que les montants à 3+ chiffres
 *  ou avec décimales (ex. "€123.4M") ne débordent du rectangle de fond. */
const tagWidthFor = (text: string) => Math.max(TAG_W, text.length * 6.4 + 12);
/** Marge de catégorie (part de la bande, de chaque côté) : largeur de barre = bande × (1 − 2×gap). */
const CATEGORY_GAP = 0.1;
const CHART_MARGIN_RIGHT = 128;

/** Centre de chaque catégorie déduit de la zone de tracé (fiable, contrairement à l'échelle X qui
 *  n'est pas décalée de l'origine de la zone avec un 2e axe X masqué). */
function useCategoryCenters(count: number): number[] | null {
  const plot = usePlotArea();
  if (!plot || !Number.isFinite(plot.x + plot.width) || count === 0) return null;
  const band = plot.width / count;
  return Array.from({ length: count }, (_, i) => plot.x + band * (i + 0.5));
}

/** Tags de totaux, centrés au-dessus de chaque barre en colonne alignée (jamais côte à côte, donc
 *  aucun chevauchement) : planifié initial (contour pointillé) au-dessus, cible réactualisée
 *  (gris) en dessous. Le réalisé est écrit DANS le segment coral quand il est assez haut, sinon il
 *  rejoint la colonne de tags. */
function TotalTags({
  data,
  hasPlanned,
  fmt,
}: {
  data: ChartDatum[];
  hasPlanned: boolean;
  fmt: (v: number) => string;
}) {
  const centers = useCategoryCenters(data.length);
  const yScale = useYAxisScale();
  if (!centers || !yScale) return null;
  const yOf = (v: number) => (yScale(v) as number) ?? 0;
  return (
    // pointerEvents="none" : rendu APRÈS les <Bar> (pour rester visible par-dessus), donc sans ça
    // le texte "réalisé" à l'intérieur d'une barre intercepterait son clic à la place de la barre.
    <g pointerEvents="none">
      {data.map((d, di) => {
        const cx = centers[di];
        const stackTop = Math.max(d.target, d.realized);
        const top =
          hasPlanned && d.planned !== undefined ? Math.max(stackTop, d.planned) : stackTop;
        const realizedH = yOf(0) - yOf(d.realized);
        const realizedInside = realizedH >= 18;
        // De bas en haut, à partir du sommet de la barre la plus haute.
        const tags: { key: string; v: number; fill: string; dashed?: boolean }[] = [
          { key: "t", v: d.target, fill: "#6B5D57" },
        ];
        if (!realizedInside) tags.push({ key: "r", v: d.realized, fill: "#FF3C47" });
        if (hasPlanned && d.planned !== undefined)
          tags.push({ key: "p", v: d.planned, fill: "#fff", dashed: true });
        const baseY = yOf(top) - 4;
        return (
          <g key={d.label}>
            {realizedInside && (
              <text
                x={cx}
                y={yOf(d.realized / 2) + 4}
                textAnchor="middle"
                fontSize={11}
                fontWeight={800}
                fill="#fff"
              >
                {fmt(d.realized)}
              </text>
            )}
            {tags.map((it, i) => {
              const y = baseY - (i + 1) * (TAG_H + TAG_GAP) + 2;
              const label = fmt(it.v);
              const w = tagWidthFor(label);
              return (
                <g key={it.key}>
                  {/* Fond systématiquement opaque (blanc pour le tag "planifié", couleur pleine
                      sinon) pour rester lisible quelle que soit la couleur derrière. */}
                  <rect
                    x={cx - w / 2}
                    y={y}
                    width={w}
                    height={TAG_H}
                    rx={3}
                    fill={it.dashed ? "#ffffff" : it.fill}
                    stroke={it.dashed ? "#320300" : "rgba(0,0,0,0.15)"}
                    strokeWidth={it.dashed ? 1.25 : 0.75}
                    strokeDasharray={it.dashed ? "3 2" : undefined}
                  />
                  <text
                    x={cx}
                    y={y + TAG_H / 2 + 3.6}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={800}
                    fill={it.dashed ? "#320300" : "#fff"}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/** Légendes sur le côté : pour la dernière barre, une pastille de la couleur du segment reliée
 *  par un petit trait au segment (gris = cible réactualisée, rouge = réalisé, pointillé = planifié
 *  initial). Positions verticales espacées d'au moins 16 px pour éviter tout chevauchement. */
function SideCallouts({
  data,
  hasPlanned,
  labels,
  barW,
}: {
  data: ChartDatum[];
  hasPlanned: boolean;
  labels: [string, string, string];
  barW: number;
}) {
  const centers = useCategoryCenters(data.length);
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  const last = data[data.length - 1];
  if (!centers || !yScale || !plot || !last || !Number.isFinite(plot.x + plot.width)) return null;
  const cx = centers[data.length - 1];
  const barRight = cx + barW / 2 + 4;
  const yTop = (v: number) => (yScale(v) as number) ?? 0;
  const stackTop = Math.max(last.target, last.realized);
  const items = [
    {
      key: "t",
      label: labels[0],
      y: (yTop(last.realized) + yTop(stackTop)) / 2,
      color: "rgba(107,93,87,0.6)",
      dashed: false,
      show: last.target > last.realized,
    },
    {
      key: "r",
      label: labels[1],
      y: (yTop(0) + yTop(last.realized)) / 2,
      color: "#FF3C47",
      dashed: false,
      show: true,
    },
    {
      key: "p",
      label: labels[2],
      y: yTop(last.planned ?? 0),
      color: "#320300",
      dashed: true,
      show: hasPlanned && last.planned !== undefined,
    },
  ]
    .filter((i) => i.show)
    .sort((a, b) => a.y - b.y);
  const labelY: number[] = [];
  items.forEach((it, i) => {
    labelY.push(i === 0 ? it.y : Math.max(it.y, labelY[i - 1] + 16));
  });
  const xText = plot.x + plot.width + 18;
  return (
    <g>
      {items.map((it, i) => (
        <g key={it.key}>
          <polyline
            points={`${barRight},${it.y} ${plot.x + plot.width + 4},${labelY[i]} ${xText - 8},${labelY[i]}`}
            fill="none"
            stroke="#6B5D57"
            strokeWidth={0.75}
            strokeDasharray={it.dashed ? "3 2" : undefined}
          />
          <circle
            cx={xText - 4}
            cy={labelY[i]}
            r={4}
            fill={it.dashed ? "#fff" : it.color}
            stroke={it.dashed ? "#320300" : "none"}
            strokeDasharray={it.dashed ? "2 1.5" : undefined}
          />
          <text x={xText + 6} y={labelY[i] + 3.5} fontSize={11} fontWeight={600} fill="#1A1A1A">
            {it.label}
          </text>
        </g>
      ))}
    </g>
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
 *  pile). Pas de tooltip au survol : les totaux sont des tags à droite de chaque barre.
 * Clic sur un segment : callback `onSegmentClick`
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
  // Largeur de barre en px (Recharts 3 ignore barSize en % avec 2 axes X) : ~80 % de la bande.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
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

  const band = Math.max(0, wrapW - CHART_MARGIN_RIGHT - 44) / Math.max(1, data.length);
  const barW = Math.round(Math.min(120, Math.max(14, band * (1 - 2 * CATEGORY_GAP))));

  return (
    <div className="relative" ref={wrapRef}>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart
          data={chartData}
          // top: assez pour empiler jusqu'à 3 tags (planifié initial / écart-retard / cible
          // réactualisée) avec TAG_GAP entre chacun sans les rogner en haut du graphique.
          margin={{ top: 76, right: CHART_MARGIN_RIGHT, left: -16, bottom: 4 }}
          barCategoryGap={`${CATEGORY_GAP * 100}%`}
          barSize={barW}
          // Les tags de totaux (planifié / cible / réalisé) sont dessinés au-dessus de la zone de
          // tracé via `<Customized>` : sans `overflow: visible` sur le <svg> racine, ils pouvaient
          // être rognés par le viewport SVG quand une barre est proche du haut du graphique.
          style={{ overflow: "visible" }}
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
            domain={[0, Math.ceil(maxValue * 1.05)]}
          />
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            content={() => (
              <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-[11px] font-medium text-primary">
                <li className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[#FF3C47]" />
                  {resolvedLabelRealized}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-[rgba(107,93,87,0.35)]" />
                  {resolvedLabelTarget}
                </li>
                {hasPlanned && (
                  <li className="flex items-center gap-1.5">
                    <svg width="18" height="6" aria-hidden="true">
                      <line
                        x1="0"
                        y1="3"
                        x2="18"
                        y2="3"
                        stroke="#320300"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                      />
                    </svg>
                    {resolvedLabelPlanned}
                  </li>
                )}
              </ul>
            )}
          />
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
          ></Bar>
          {/* Barre remaining (haut de la pile) — gris transparent, complète jusqu'à la cible */}
          <Bar
            dataKey="remaining"
            name={resolvedLabelTarget}
            stackId="a"
            fill="rgba(107,93,87,0.35)"
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
          ></Bar>
          {/* Planifié initial : contour pointillé sans remplissage */}
          {hasPlanned && (
            <Bar
              dataKey="planned"
              name={resolvedLabelPlanned}
              xAxisId="planned"
              fill="none"
              stroke="#320300"
              strokeWidth={2}
              strokeDasharray="4 3"
              isAnimationActive={false}
              legendType="plainline"
            />
          )}
          {/* Tags/callouts déclarés APRÈS les <Bar> : Recharts peint les enfants dans l'ordre du
              JSX, donc les placer avant les barres (comme précédemment) faisait peindre les barres
              PAR-DESSUS — masquant en particulier le montant "réalisé" écrit en blanc À L'INTÉRIEUR
              du segment coral quand il est assez haut (`realizedInside`), invisible sous le
              remplissage de la barre peinte ensuite. Retour testeur : "les premiers bar charts,
              j'ai pas de tag" — le tag existait, il était juste caché. */}
          <Customized
            component={() => <TotalTags data={chartData} hasPlanned={hasPlanned} fmt={fmt} />}
          />
          <Customized
            component={() => (
              <SideCallouts
                data={chartData}
                hasPlanned={hasPlanned}
                labels={[resolvedLabelTarget, resolvedLabelRealized, resolvedLabelPlanned]}
                barW={barW}
              />
            )}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
