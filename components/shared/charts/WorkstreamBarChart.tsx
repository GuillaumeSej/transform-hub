"use client";

import type { ReactNode } from "react";
import { useElementWidth } from "@/components/shared/charts/useElementWidth";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Customized,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useYAxisScale,
} from "recharts";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatMillions } from "@/lib/format";
import { leverGapContributors } from "@/lib/chartPreview";
import { ChartHoverArea, FloatingPreview, HIDDEN_TOOLTIP_WRAPPER } from "./HoverPreview";

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
  const { t } = useTranslation();
  const rows = mergeLeverBreakdown(point);
  const maxTarget = Math.max(1, ...rows.map((r) => Math.max(r.target, r.realized)));

  if (rows.length === 0) {
    return (
      <p className="text-sm text-tertiary">
        {t("chart.bar.noLeverDetail", "Aucun détail par levier disponible.")}
      </p>
    );
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
                className="absolute inset-y-0 left-0 rounded-full bg-bp-warm-brown/45"
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
 *  aucun chevauchement) : planifié initial (contour pointillé) au sommet, cible réactualisée (gris)
 *  au milieu, réalisé (corail) au plus près de la barre — toujours en tag externe, jamais écrit à
 *  l'intérieur du segment (voir commentaire plus bas sur les couches de rendu Recharts). */
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
    // pointerEvents="none" : les tags ne doivent jamais intercepter le clic sur une barre.
    <g pointerEvents="none">
      {data.map((d, di) => {
        const cx = centers[di];
        const stackTop = Math.max(d.target, d.realized);
        const top =
          hasPlanned && d.planned !== undefined ? Math.max(stackTop, d.planned) : stackTop;
        // Le "réalisé" est TOUJOURS un tag externe (jamais écrit à l'intérieur du segment coral) :
        // Recharts peint `<Customized>` sur une couche de z-index FIXE, systématiquement AVANT les
        // `<Bar>`, quel que soit leur ordre dans le JSX — un texte "à l'intérieur" de la barre se
        // retrouvait donc invisible, recouvert par le remplissage de la barre peinte après (retour
        // testeur : "les premiers bar charts, j'ai pas de tag" sur les leviers avec un réalisé assez
        // grand pour déclencher l'ancien mode "à l'intérieur").
        const tags: { key: string; v: number; fill: string; dashed?: boolean }[] = [
          { key: "t", v: d.target, fill: "#806659" },
          { key: "r", v: d.realized, fill: "#FF3C47" },
        ];
        if (hasPlanned && d.planned !== undefined)
          tags.push({ key: "p", v: d.planned, fill: "#fff", dashed: true });
        const baseY = yOf(top) - 4;
        return (
          <g key={d.label}>
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

/** Savings réalisés vs cible par dimension (workstream, pays, département).
 *
 *  Chaque barre = cible (hauteur totale) avec remplissage coral (réalisé) empilé en bas — la
 *  partie grise au-dessus (`remaining = max(0, target - realized)`) complète visuellement jusqu'à
 *  la cible ; en cas de sur-réalisation (`realized > target`), `remaining` est clampé à 0 donc la
 *  hauteur totale de la pile == `realized` (pas de somme cible+réalisé).
 *
 *  Valeurs affichées directement sur les barres (réalisé à l'intérieur du segment coral, écart à
 *  l'intérieur du segment gris quand il est assez haut pour rester lisible, cible au sommet de la
 *  pile). Au survol : aperçu flottant (`WorkstreamBarPreview`, portail toujours visible).
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
  // Mesure via callback ref : le conteneur n'existe pas pendant l'état vide (données en cours de
  // chargement) — avec un useRef + useEffect([]), la largeur restait à 0 et les barres tombaient à
  // leur minimum (graphique « tout fin » jusqu'au rafraîchissement).
  const [wrapRef, measuredW] = useElementWidth();
  const wrapW = measuredW ?? 0;
  const resolvedLabelTarget = labelTarget ?? t("chart.bar.target", "Cible réactualisée");
  const resolvedLabelRealized = labelRealized ?? t("chart.bar.realized", "Réalisé");
  const resolvedLabelPlanned = labelPlanned ?? t("chart.bar.planned", "Planifié initial");
  const fmt = (v: number) => formatMillions(v);
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
      <ChartHoverArea>
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
              tickFormatter={(v) => formatMillions(Number(v))}
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
                    <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-bp-warm-brown/35" />
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
            {/* Aperçu au survol (retour PO) : réalisé / réactualisé / planifié initial du groupe,
              taux de réalisation, écart au plan et principaux leviers ; le clic ouvre le détail. */}
            <Tooltip
              cursor={{ fill: "rgba(128,102,89,0.06)" }}
              wrapperStyle={HIDDEN_TOOLTIP_WRAPPER}
              content={({ active, payload }) => {
                const point = payload?.[0]?.payload as ChartDatum | undefined;
                if (!active || !point) return null;
                return (
                  <FloatingPreview>
                    <WorkstreamBarPreview
                      point={point}
                      clickable={!!onSegmentClick}
                      labels={{
                        realized: resolvedLabelRealized,
                        target: resolvedLabelTarget,
                        planned: resolvedLabelPlanned,
                      }}
                    />
                  </FloatingPreview>
                );
              }}
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
              fill="rgba(128,102,89,0.35)"
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
            {/* Tags de montant : leur position dans ce JSX n'a AUCUN effet sur l'ordre de peinture
              réel — Recharts range `<Customized>` sur une couche de z-index fixe
              (`recharts-customized-wrapper`), systématiquement rendue AVANT celle des `<Bar>`
              (`recharts-zIndex-layer_1xx` et au-delà), quel que soit l'ordre déclaré ici. C'est
              pour cette raison que le montant "réalisé" ne peut plus être écrit à l'intérieur du
              segment coral (voir `TotalTags`) : il serait invisible, recouvert par le remplissage
              de la barre peint après.
              (Round <n> : l'ancien `SideCallouts`, qui dupliquait sur la dernière barre uniquement
              les libellés déjà donnés par la `<Legend>` ci-dessus, a été retiré — sa position fixe
              en marge droite pouvait chevaucher le tag de montant de cette même dernière barre,
              donnant l'impression d'un montant "coupé"/sans détail au bout du graphe.) */}
            <Customized
              component={() => <TotalTags data={chartData} hasPlanned={hasPlanned} fmt={fmt} />}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartHoverArea>
    </div>
  );
}

const signedM = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatMillions(Math.abs(v))}`;

/** Aperçu au survol d'une barre (même carte que `SCurvePreview`) : réalisé / réactualisé /
 *  planifié initial, mini-comparaison, taux de réalisation, écart réalisé − planifié initial et
 *  principaux écarts par levier (réalisé − réactualisé, détail `leverBreakdown`). */
function WorkstreamBarPreview({
  point,
  clickable,
  labels,
}: {
  point: WorkstreamBarPoint;
  clickable: boolean;
  labels: { realized: string; target: string; planned: string };
}) {
  const { t } = useTranslation();
  const fmt = (v: number) => formatMillions(v);
  const { realized, target, planned } = point;
  const max = Math.max(Math.abs(realized), Math.abs(target), Math.abs(planned ?? 0), 1e-9);
  const width = (v: number) => `${Math.max(2, (Math.abs(v) / max) * 100)}%`;
  const rate = target > 0 ? Math.round((realized / target) * 100) : null;
  const gap = planned !== undefined ? Math.round((realized - planned) * 10) / 10 : null;
  const top = leverGapContributors(point.leverBreakdown).slice(0, 3);
  const row = (swatch: ReactNode, label: string, value: number) => (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-secondary">
        {swatch}
        {label}
      </span>
      <span className="font-semibold tabular-nums text-primary">{fmt(value)}</span>
    </div>
  );
  const square = (cls: string) => <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />;
  return (
    <div className="w-[260px] border border-border bg-white p-3 text-[11.5px] shadow-lg">
      <div className="mb-2 text-[12.5px] font-bold text-primary">{point.label}</div>
      <div className="space-y-1">
        {row(square("bg-bp-coral"), labels.realized, realized)}
        {target > 0 && row(square("bg-bp-warm-brown/35"), labels.target, target)}
        {planned !== undefined &&
          row(
            <span className="inline-block h-0 w-3 border-t-2 border-dashed border-[#320300]" />,
            labels.planned,
            planned
          )}
      </div>
      <div className="mt-2.5 space-y-1">
        {planned !== undefined && (
          <div className="h-1.5 bg-neutral-100">
            <div className="h-full bg-bp-deep-red/70" style={{ width: width(planned) }} />
          </div>
        )}
        {target > 0 && (
          <div className="h-1.5 bg-neutral-100">
            <div className="h-full bg-bp-warm-brown/60" style={{ width: width(target) }} />
          </div>
        )}
        <div className="h-1.5 bg-neutral-100">
          <div className="h-full bg-bp-coral" style={{ width: width(realized) }} />
        </div>
      </div>
      {(rate !== null || gap !== null) && (
        <div className="mt-2.5 space-y-0.5 border-t border-border pt-2">
          {rate !== null && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-secondary">
                {t("chart.barPreview.rate", "Taux de réalisation")}
              </span>
              <span className="font-semibold tabular-nums text-primary">{rate} %</span>
            </div>
          )}
          {gap !== null && (
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-primary">
                {t("chart.barPreview.gap", "Écart réalisé − planifié initial")}
              </span>
              <span
                className={
                  gap < 0
                    ? "font-bold tabular-nums text-bp-coral"
                    : "font-bold tabular-nums text-primary"
                }
              >
                {gap === 0 ? fmt(0) : signedM(gap)}
              </span>
            </div>
          )}
        </div>
      )}
      {top.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
            {t("chart.barPreview.topLevers", "Principaux écarts au réactualisé")}
          </div>
          <div className="space-y-0.5">
            {top.map((c) => (
              <div key={c.id} className="flex justify-between gap-3">
                <span className="truncate text-secondary">{c.name}</span>
                <span
                  className={
                    c.value < 0 ? "tabular-nums text-bp-coral" : "tabular-nums text-primary"
                  }
                >
                  {signedM(c.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {clickable && (
        <div className="mt-2 text-[10.5px] font-medium text-tertiary">
          {t("chart.scurvePreview.click", "Cliquer pour le détail →")}
        </div>
      )}
    </div>
  );
}
