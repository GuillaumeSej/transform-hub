"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Cell, Pie, PieChart, Sector, Tooltip, type PieProps } from "recharts";
import { useLatestCallback, useStableValue } from "@/lib/hooks/useStableChartData";

/** Même palette que `GeoDonutChart` — catégorielle, tons de marque, déjà validée sur fond clair.
 *  Round 12 : pas de nouvelle couleur saturée introduite, réutilisation à l'identique. Round 13 :
 *  toujours la même palette (redesign visuel uniquement, aucune nouvelle couleur). */
const COLORS = ["#FF3C47", "#991D1F", "#FF797B", "#806659", "#A99E9A", "#320300"];

/** Round 16 : mêmes tokens couleur EXACTS que `BudgetVsActualBar` (`components/shared/BudgetVsActualBar.tsx`)
 *  pour l'anneau intérieur "consommé" — `--red`/`bg-rag-red` (dépassement), `--n-900`/`bg-neutral-900`
 *  (consommé, cas normal) et `--n-100`/`bg-neutral-100` (piste/restant), pas de nouvelle couleur inventée. */
const CONSUMED_OVER_COLOR = "#FF3C47";
const CONSUMED_COLOR = "#0A0A0A";
const REMAINING_COLOR = "#F0F0F0";

export type BudgetDonutSlice = { name: string; value: number; consumed?: number };

/** Rendu de la part active (survolée) — légèrement plus grande que les autres, même patron que les
 *  exemples recharts officiels d'`activeShape`. Reste sobre : pas d'ombre ni de couleur différente,
 *  juste un rayon extérieur agrandi de quelques pixels pour donner un retour visuel discret. */
function renderActiveShape(props: unknown): JSX.Element {
  const p = props as {
    cx: number;
    cy: number;
    innerRadius: number;
    outerRadius: number;
    startAngle: number;
    endAngle: number;
    fill: string;
  };
  return (
    <Sector
      cx={p.cx}
      cy={p.cy}
      innerRadius={p.innerRadius}
      // Agrandissement proportionnel au rayon (plutôt que +6px fixes) : le donut est désormais
      // dimensionné selon son conteneur, et l'écart avec l'arc "consommé" est lui aussi relatif.
      outerRadius={p.outerRadius + Math.max(3, (p.outerRadius / 0.86) * ACTIVE_GROW_RATIO * 0.9)}
      startAngle={p.startAngle}
      endAngle={p.endAngle}
      fill={p.fill}
    />
  );
}

/** Carte de tooltip custom (round 13) — même langage visuel que `Card`/`KPICard`
 *  (`rounded-lg border border-border bg-white shadow-sm`) plutôt que le tooltip recharts par
 *  défaut, pour rester cohérent avec le reste de l'UI. Affiche le nom de la part, sa valeur
 *  formatée (`formatValue`, fourni par l'appelant) et sa part en % du total. */
function renderTooltip(
  props: { active?: boolean; payload?: unknown } & {
    total: number;
    formatValue: (value: number) => string;
    consumedLabel?: string;
    clickHint?: string;
  }
): JSX.Element | null {
  const { active, total, formatValue, consumedLabel, clickHint } = props;
  // Round 16 : le datum d'origine (dont `consumed`, éventuel) est nesté par recharts sous
  // `payload[0].payload` — vérifié via les typings recharts (`Payload<...>.payload?: any`), PAS à
  // plat sur `payload[0]` (qui ne porte que `name`/`value`, les clés du `Pie`).
  const payload = props.payload as
    { name?: string; value?: number; payload?: { consumed?: number } }[] | undefined;
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const value = Number(entry.value ?? 0);
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const consumed = entry.payload?.consumed;
  const sliceOverBudget = consumed !== undefined && consumed > value;
  const consumedPct =
    consumed !== undefined && value > 0 ? Math.round((consumed / value) * 100) : 0;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-sm">
      <p className="text-[12px] font-semibold text-primary">{entry.name}</p>
      <p className="mt-0.5 text-[12px] text-secondary">
        {formatValue(value)} <span className="text-tertiary">· {pct}%</span>
      </p>
      {consumed !== undefined && (
        <p className={`mt-0.5 text-[12px] ${sliceOverBudget ? "text-rag-red" : "text-tertiary"}`}>
          {formatValue(consumed)} {consumedLabel ?? ""} <span>({consumedPct}%)</span>
        </p>
      )}
      {clickHint && <p className="mt-1 text-[10.5px] italic text-tertiary">{clickHint}</p>}
    </div>
  );
}

/** Géométrie du donut, calculée à partir de la taille RÉELLE de la zone de dessin (mesurée sur le
 *  conteneur, voir `useMeasuredWidth`) — tous les rayons sont des fractions de `R`, pour que
 *  l'anneau, l'éventuel anneau "consommé" et le trou central grandissent/rétrécissent ensemble.
 *
 *  Refonte (retour PO : texte central illisible, superposé à l'ancien anneau "consommé" noir qui
 *  était NESTÉ DANS le trou) : l'anneau consommé est désormais un arc FIN placé AUTOUR de l'anneau
 *  principal, jamais à l'intérieur — le trou central est entièrement réservé au texte. L'écart
 *  entre les deux anneaux (0.86R → 0.92R) absorbe l'agrandissement de la part survolée
 *  (`ACTIVE_GROW_RATIO`), qui ne vient donc jamais toucher l'arc consommé. */
const ACTIVE_GROW_RATIO = 0.05;
function donutGeometry(size: number, withConsumedRing: boolean) {
  const R = Math.max(0, size / 2 - 2);
  const outerRadius = withConsumedRing ? R * 0.86 : R * (1 - ACTIVE_GROW_RATIO);
  const innerRadius = withConsumedRing ? R * 0.66 : outerRadius * 0.64;
  return {
    outerRadius,
    innerRadius,
    consumedInnerRadius: R * 0.92,
    consumedOuterRadius: R * 0.98,
    // Carré inscrit dans le trou (côté r·√2 ≈ 1.41r) moins une marge : la boîte de texte centrale
    // ne peut PAS déborder sur l'anneau, quelle que soit la largeur de la carte.
    textBox: innerRadius * 1.34,
  };
}

/** Largeur mesurée d'un élément (ResizeObserver) — `null` tant que la première mesure n'a pas eu
 *  lieu, pour ne dessiner le donut qu'UNE fois à sa taille réelle (un premier rendu à une taille
 *  provisoire puis un second à la bonne taille relancerait l'animation d'entrée du `Pie`).
 *  Environnement sans mise en page (jsdom) : largeur 0 ⇒ repli sur `fallback`. */
function useMeasuredWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      setWidth(w > 0 ? w : fallback);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}

/** Zone de dessin Recharts du donut, MÉMOÏSÉE : ne se re-rend que si ses entrées changent
 *  réellement (jamais sur un simple survol — voir le commentaire au-dessus de `stableData` dans
 *  `BudgetDonutChart`), pour ne pas interrompre l'animation d'entrée du `Pie`. `size` ne change
 *  qu'au redimensionnement effectif du conteneur. */
const DonutPlot = memo(function DonutPlot({
  size,
  data,
  innerRingData,
  showConsumedRing,
  clickable,
  onSliceClick,
  onActiveIndexChange,
  tooltipContent,
}: {
  size: number;
  data: BudgetDonutSlice[];
  innerRingData: { name: string; value: number; fill: string }[];
  showConsumedRing: boolean;
  clickable: boolean;
  onSliceClick: (name: string) => void;
  onActiveIndexChange: (index: number | undefined) => void;
  tooltipContent: (props: { active?: boolean; payload?: unknown }) => JSX.Element | null;
}) {
  const g = donutGeometry(size, showConsumedRing);
  return (
    <PieChart width={size} height={size}>
      <Pie
        data={data}
        dataKey="value"
        nameKey="name"
        cx="50%"
        cy="50%"
        innerRadius={g.innerRadius}
        outerRadius={g.outerRadius}
        paddingAngle={1}
        activeShape={renderActiveShape as PieProps["activeShape"]}
        onMouseEnter={(_, index) => onActiveIndexChange(index)}
        onMouseLeave={() => onActiveIndexChange(undefined)}
        onClick={(d) => {
          const name = (d as { name?: string })?.name;
          if (name) onSliceClick(name);
        }}
        cursor={clickable ? "pointer" : undefined}
      >
        {data.map((entry, i) => (
          <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
        ))}
      </Pie>
      {/* Arc "consommé vs restant" : second `Pie` FIN, AUTOUR de l'anneau principal (voir
          `donutGeometry`) — plus jamais dans le trou central, réservé au texte. Pas d'animation
          (`isAnimationActive={false}`) ni de tooltip (`tooltipType="none"`, ses parts n'ont pas de
          nom lisible — le consommé est déjà détaillé au centre, en légende et dans le tooltip). */}
      {showConsumedRing && (
        <Pie
          data={innerRingData}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={g.consumedInnerRadius}
          outerRadius={g.consumedOuterRadius}
          isAnimationActive={false}
          tooltipType="none"
        >
          {innerRingData.map((entry) => (
            <Cell key={entry.name} fill={entry.fill} />
          ))}
        </Pie>
      )}
      <Tooltip content={tooltipContent} />
    </PieChart>
  );
});

/**
 * Donut GÉNÉRIQUE de répartition budgétaire (round 12, redesign visuel round 13) — patron recharts
 * minimal (`Pie`/`Cell`/`Tooltip`, taille mesurée sur le conteneur) mais délibérément PAS spécialisé : ni
 * unité, ni devise, ni domaine en dur — `formatValue` est fourni par l'appelant (ex. `"€2,3M"`,
 * `"120 j.h"`), contrairement à `GeoDonutChart` qui fige `€…M` dans son `Tooltip`. Plusieurs agents
 * réutilisent ce composant pour des ventilations budgétaires différentes (budget de chantier par
 * levier, budget de programme par axe, etc.) — garder ce composant minimal, ne pas lui ajouter de
 * logique métier propre à l'un de ces usages.
 *
 * Round 13 (demande PO : le round 12 était "trop simple pour du conseil en stratégie") — quatre
 * ajouts purement visuels, contrat de props inchangé pour les 3 appelants existants :
 *  - le TOTAL de `data[].value` s'affiche au centre de l'anneau (`centerLabel`, optionnel, pour un
 *    libellé secondaire sous le total — ex. "Total" — omis si non fourni) ;
 *  - légende maison (PAS le `<Legend>` recharts) avec valeur ET % par part. Rendue à côté du donut
 *    dans notre propre layout flex plutôt que via le composant `<Legend>` de recharts, dont la
 *    présence rétrécit la zone de dessin du `Pie` en interne (recharts recalcule alors le centre du
 *    donut en tenant compte de la largeur de la légende) — ce qui aurait désaligné le total
 *    superposé en absolu au centre avec le VRAI centre du donut. En sortant la légende du
 *    `PieChart`, le conteneur du graphique garde une zone de dessin stable et connue, sur laquelle
 *    l'overlay `absolute inset-0` du total reste toujours centré correctement ;
 *  - tooltip custom stylé (`renderTooltip`), même langage visuel que `Card`/`KPICard` ;
 *  - la part survolée grossit légèrement (`activeShape`/`renderActiveShape`), et la ligne de
 *    légende correspondante se met en surbrillance (même `activeIndex`, un seul état partagé).
 *
 * `onSliceClick`, si fourni, rend à la fois les parts du donut (`Cell`, via le `onClick`/`cursor`
 * du `Pie` — même patron que `HrDonutChart` dans `HrBreakdownCharts.tsx`) et les entrées de la
 * légende cliquables, les deux appelant `onSliceClick(name)` avec le NOM de la part cliquée (pas
 * son index ni sa valeur).
 *
 * Round 16 (PO : fusion de la carte "Budget financier alloué" d'`EffectifsPageClient` en un seul
 * graphique) — extension purement ADDITIVE : `data[].consumed`, `showConsumedRing` et
 * `consumedLabel`, tous optionnels, contrat inchangé pour les 3 appelants existants qui ne les
 * fournissent pas. Voir plus bas pour le détail (second anneau, overlay central à deux lignes,
 * légende et tooltip enrichis).
 *
 * Round 24 : `total`/`consumedTotal`, tous deux optionnels — par défaut (omis), le total affiché au
 * centre reste `data.reduce(...)` comme avant, donc les appelants existants (dont le donut de
 * drill-down par chantier) sont inchangés. À fournir UNIQUEMENT quand `data` est ventilé par axe et
 * qu'un chantier multi-axe apparaît dans PLUSIEURS parts (son budget est alors affiché en entier
 * sous chaque axe, par design — voir `EffectifsPageClient.tsx` — donc `data.reduce(...)` compterait
 * ce chantier plusieurs fois) : l'appelant calcule alors le vrai total dédupliqué une seule fois sur
 * la liste des chantiers à plat et le passe ici pour l'overlay central uniquement — les parts/légende
 * elles-mêmes continuent d'utiliser `data` tel quel (répartition par axe volontairement dupliquée).
 */
export function BudgetDonutChart({
  data,
  formatValue,
  onSliceClick,
  centerLabel,
  showConsumedRing,
  consumedLabel,
  total: totalOverride,
  consumedTotal: consumedTotalOverride,
  clickHint,
  size = "md",
  formatCenterValue,
  centerTotalLabel,
  centerConsumedPctLabel,
}: {
  data: BudgetDonutSlice[];
  formatValue: (value: number) => string;
  onSliceClick?: (name: string) => void;
  /** Libellé secondaire optionnel affiché sous le total, au centre de l'anneau (ex. "Total") —
   *  round 13. Omis par défaut : les 3 appelants existants n'ont pas besoin de le fournir. */
  centerLabel?: string;
  /** Round 16 : affiche un second anneau fin (autour de l'anneau principal depuis la refonte du
   *  texte central — voir `donutGeometry`),
   *  résumant `consommé` vs `restant` (ou `consommé` seul en rouge si dépassement) sur l'ensemble
   *  de `data`. Omis par défaut (`false`/`undefined`) : les 3 appelants existants n'ont pas à le
   *  fournir et gardent le rendu à anneau unique inchangé. */
  showConsumedRing?: boolean;
  /** Round 16 : mot "consommé"/"consumed" fourni par l'appelant (ce composant reste
   *  volontairement agnostique de la langue/du domaine) — utilisé dans la légende et le tooltip
   *  partout où ce mot serait sinon nécessaire. Sans effet si `showConsumedRing` n'est pas activé
   *  et qu'aucune part de `data` ne porte de `consumed`. */
  consumedLabel?: string;
  /** Round 24 : total affiché au centre de l'anneau, en override de `data.reduce((s, d) =>
   *  s + d.value, 0)` — voir le doc-comment de la fonction pour le cas d'usage (dédup d'un chantier
   *  multi-axe compté plusieurs fois dans une ventilation par axe). N'affecte QUE l'overlay central,
   *  jamais les parts du donut ni la légende (toujours dessinées depuis `data`). */
  total?: number;
  /** Round 24 : pendant de `total` ci-dessus pour le total "consommé" (anneau intérieur +
   *  overlay), en override de `data.reduce((s, d) => s + (d.consumed ?? 0), 0)`. */
  consumedTotal?: number;
  /** Consigne affichée en bas du tooltip quand une part est cliquable (ex. "Cliquez pour
   *  détailler") — optionnelle, purement additive, omise par défaut. */
  clickHint?: string;
  /** Taille MAXIMALE du donut : `"md"` (défaut, 220px — rendu historique des appelants existants)
   *  ou `"lg"` (300px, carte où le donut est le visuel principal). Dans les deux cas le donut se
   *  réduit à la largeur réelle de son conteneur si elle est plus petite (mesurée, pas un
   *  breakpoint), et toute la géométrie (anneaux, trou, texte) suit. */
  size?: "md" | "lg";
  /** Formatage COMPACT des montants affichés au centre (ex. `"7,7 M€"`) — `formatValue` sinon.
   *  La légende et le tooltip gardent toujours `formatValue` (montant complet). */
  formatCenterValue?: (value: number) => string;
  /** Mode `showConsumedRing` : ligne sous le montant consommé, construite à partir du total
   *  formaté (ex. "sur 23,6 M€ alloués"). Omis : `"/ <total>"` (rendu historique). */
  centerTotalLabel?: (formattedTotal: string) => string;
  /** Mode `showConsumedRing` : troisième ligne centrale à partir du ratio consommé/total
   *  (ex. "33 % consommé"). Omise si non fournie. */
  centerConsumedPctLabel?: (ratio: number) => string;
}): JSX.Element {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const maxSize = size === "lg" ? 300 : 220;
  const [plotRef, measuredWidth] = useMeasuredWidth(maxSize);
  const plotSize = measuredWidth === null ? null : Math.min(maxSize, measuredWidth);
  // Somme brute de `data` — dénominateur des % par part (tooltip + légende) et périmètre réel
  // dessiné par l'anneau EXTÉRIEUR (`Pie` principal, toujours rendu depuis `data` tel quel, jamais
  // depuis un total en override) : ces % doivent continuer à représenter "part de CE slice dans la
  // répartition affichée", qu'elle soit ou non dédupliquée en amont par l'appelant.
  const sliceTotal = data.reduce((sum, d) => sum + (d.value || 0), 0);
  const sliceConsumedTotal = data.reduce((sum, d) => sum + (d.consumed || 0), 0);
  // Round 24 : `total`/`consumedTotal` affichés au centre (et pilotant l'anneau INTÉRIEUR
  // "consommé/restant") — en override explicite quand fourni (cas d'un chantier multi-axe compté
  // plusieurs fois dans `data`, voir doc-comment de la fonction), sinon identiques à la somme brute
  // ci-dessus (comportement historique, tous les autres appelants).
  const total = totalOverride ?? sliceTotal;
  const consumedTotal = consumedTotalOverride ?? sliceConsumedTotal;

  // Round 16 : anneau intérieur "consommé vs restant" — même périmètre que `total` ci-dessus
  // (somme de `data[].consumed`, absent traité comme 0). Dépassement global : un seul segment
  // rouge plein (rien à montrer comme "restant"), sinon deux segments (consommé foncé / restant
  // clair, mêmes tokens que `BudgetVsActualBar`).
  const overBudget = consumedTotal > total;
  const remaining = Math.max(0, total - consumedTotal);
  const innerRingData = overBudget
    ? [{ name: "consumed", value: consumedTotal, fill: CONSUMED_OVER_COLOR }]
    : [
        { name: "consumed", value: consumedTotal, fill: CONSUMED_COLOR },
        { name: "remaining", value: remaining, fill: REMAINING_COLOR },
      ];

  // Survol ≠ ré-animation : `activeIndex` (survol d'une part/ligne de légende) re-rend ce composant,
  // or Recharts 3 relance l'animation d'un `Pie` dès que ses props changent de référence (voir
  // lib/hooks/useStableChartData.ts). Le dessin est donc isolé dans `DonutPlot` (mémoïsé) avec des
  // entrées stables — données stabilisées par contenu, handlers à identité fixe — pour qu'un survol
  // pendant l'animation d'entrée ne l'interrompe plus.
  const stableData = useStableValue(data);
  const stableInnerRingData = useStableValue(innerRingData);
  const clickable = !!onSliceClick;
  const handleSliceClick = useLatestCallback(onSliceClick);
  const latestFormatValue = useLatestCallback(formatValue);
  const tooltipContent = useCallback(
    (props: { active?: boolean; payload?: unknown }) =>
      renderTooltip({
        ...props,
        total: sliceTotal,
        formatValue: (v: number) => latestFormatValue(v) ?? "",
        consumedLabel,
        clickHint: clickable ? clickHint : undefined,
      }),
    [sliceTotal, latestFormatValue, consumedLabel, clickable, clickHint]
  );

  const formatCenter = formatCenterValue ?? formatValue;
  const geometry = plotSize === null ? null : donutGeometry(plotSize, !!showConsumedRing);
  // Typographie centrale proportionnelle au trou (bornée) : le montant principal reste lisible sur
  // un grand donut sans jamais déborder du carré inscrit (`textBox`) sur un petit.
  const hole = geometry?.innerRadius ?? 0;
  const valueFontSize = Math.round(Math.min(26, Math.max(14, hole * 0.26)));
  const subFontSize = Math.round(Math.min(12, Math.max(10, hole * 0.12)) * 10) / 10;

  return (
    <div
      className={`flex flex-col items-center gap-4 ${
        size === "lg" ? "md:flex-row md:items-center md:gap-6" : "sm:flex-row sm:items-center"
      }`}
    >
      {/* Zone de dessin du donut — carrée, largeur mesurée (`useMeasuredWidth`) : le donut occupe
          toute la largeur disponible jusqu'à `maxSize`. `relative` pour superposer le texte central
          en absolu, sans jamais laisser un composant recharts modifier sa géométrie interne. */}
      <div
        ref={plotRef}
        className={`relative w-full shrink-0 ${
          size === "lg" ? "max-w-[300px] md:w-[45%] md:min-w-[200px]" : "max-w-[220px] sm:w-[220px]"
        }`}
        style={{ height: plotSize ?? maxSize }}
      >
        {plotSize !== null && (
          <DonutPlot
            size={plotSize}
            data={stableData}
            innerRingData={stableInnerRingData}
            showConsumedRing={!!showConsumedRing}
            clickable={clickable}
            onSliceClick={handleSliceClick}
            onActiveIndexChange={setActiveIndex}
            tooltipContent={tooltipContent}
          />
        )}
        {/* Texte central — contenu dans le carré inscrit du trou (`geometry.textBox`, calculé
            depuis `innerRadius`) : il ne peut pas chevaucher un anneau, à aucune largeur de carte.
            `pointer-events-none` pour ne jamais intercepter les clics/hover destinés aux parts. */}
        {geometry && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className="flex flex-col items-center justify-center overflow-hidden text-center leading-tight"
              style={{ width: geometry.textBox, maxHeight: geometry.textBox }}
            >
              {showConsumedRing ? (
                <>
                  <span
                    className={`block break-words font-bold tabular-nums ${
                      overBudget ? "text-rag-red" : "text-primary"
                    }`}
                    style={{ fontSize: valueFontSize, lineHeight: 1.1 }}
                  >
                    {formatCenter(consumedTotal)}
                  </span>
                  <span
                    className="mt-1 block break-words text-secondary"
                    style={{ fontSize: subFontSize }}
                  >
                    {centerTotalLabel
                      ? centerTotalLabel(formatCenter(total))
                      : `/ ${formatCenter(total)}`}
                  </span>
                  {centerConsumedPctLabel && total > 0 && (
                    <span
                      className={`mt-0.5 block break-words font-semibold ${
                        overBudget ? "text-rag-red" : "text-tertiary"
                      }`}
                      style={{ fontSize: subFontSize }}
                    >
                      {centerConsumedPctLabel(consumedTotal / total)}
                    </span>
                  )}
                </>
              ) : (
                <span
                  className="block break-words font-bold tabular-nums text-primary"
                  style={{ fontSize: Math.min(valueFontSize, 18), lineHeight: 1.15 }}
                >
                  {formatCenter(total)}
                </span>
              )}
              {centerLabel && (
                <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                  {centerLabel}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Légende maison (round 13) — pastille de couleur, nom (tronqué si trop long), valeur
          formatée et % du total alignés à droite. Cliquable exactement comme avant si
          `onSliceClick` est fourni. */}
      <ul className="flex w-full min-w-0 flex-col gap-1.5 text-[11px]">
        {data.map((entry, i) => {
          const pct = sliceTotal > 0 ? Math.round((entry.value / sliceTotal) * 100) : 0;
          const active = activeIndex === i;
          return (
            <li
              key={entry.name}
              role={onSliceClick ? "button" : undefined}
              tabIndex={onSliceClick ? 0 : undefined}
              onClick={onSliceClick ? () => onSliceClick(entry.name) : undefined}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(undefined)}
              onKeyDown={
                onSliceClick
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") onSliceClick(entry.name);
                    }
                  : undefined
              }
              className={`flex items-center justify-between gap-3 rounded-sm px-1 py-0.5 transition ${
                onSliceClick ? "cursor-pointer" : ""
              } ${active ? "bg-neutral-50" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                />
                <span
                  className={`truncate ${active ? "text-primary" : "text-secondary"}`}
                  title={entry.name}
                >
                  {entry.name}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end text-right">
                <span className="font-semibold text-primary">
                  {formatValue(entry.value)} <span className="text-tertiary">({pct}%)</span>
                </span>
                {/* Round 16 : ligne "consommé" additionnelle, uniquement quand cette part la
                    fournit (`consumed !== undefined`) — rendu conditionnel, pas un espace vide
                    pour les entrées qui n'en ont pas, afin de ne pas casser l'alignement de la
                    légende pour les 3 appelants existants qui n'ont jamais `consumed`. */}
                {entry.consumed !== undefined && (
                  <span
                    className={`text-[10px] font-normal ${
                      entry.consumed > entry.value ? "text-rag-red" : "text-tertiary"
                    }`}
                  >
                    {formatValue(entry.consumed)} {consumedLabel ?? ""}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
