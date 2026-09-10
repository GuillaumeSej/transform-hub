"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, type PieProps } from "recharts";

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
      outerRadius={p.outerRadius + 6}
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
  }
): JSX.Element | null {
  const { active, total, formatValue, consumedLabel } = props;
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
    </div>
  );
}

/**
 * Donut GÉNÉRIQUE de répartition budgétaire (round 12, redesign visuel round 13) — patron recharts
 * minimal (`Pie`/`Cell`/`Tooltip`/`ResponsiveContainer`) mais délibérément PAS spécialisé : ni
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
 */
export function BudgetDonutChart({
  data,
  formatValue,
  onSliceClick,
  centerLabel,
  showConsumedRing,
  consumedLabel,
}: {
  data: BudgetDonutSlice[];
  formatValue: (value: number) => string;
  onSliceClick?: (name: string) => void;
  /** Libellé secondaire optionnel affiché sous le total, au centre de l'anneau (ex. "Total") —
   *  round 13. Omis par défaut : les 3 appelants existants n'ont pas besoin de le fournir. */
  centerLabel?: string;
  /** Round 16 : affiche un second anneau, plus petit, à l'intérieur du trou de l'anneau existant,
   *  résumant `consommé` vs `restant` (ou `consommé` seul en rouge si dépassement) sur l'ensemble
   *  de `data`. Omis par défaut (`false`/`undefined`) : les 3 appelants existants n'ont pas à le
   *  fournir et gardent le rendu à anneau unique inchangé. */
  showConsumedRing?: boolean;
  /** Round 16 : mot "consommé"/"consumed" fourni par l'appelant (ce composant reste
   *  volontairement agnostique de la langue/du domaine) — utilisé dans la légende et le tooltip
   *  partout où ce mot serait sinon nécessaire. Sans effet si `showConsumedRing` n'est pas activé
   *  et qu'aucune part de `data` ne porte de `consumed`. */
  consumedLabel?: string;
}): JSX.Element {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const total = data.reduce((sum, d) => sum + (d.value || 0), 0);

  // Round 16 : anneau intérieur "consommé vs restant" — même périmètre que `total` ci-dessus
  // (somme de `data[].consumed`, absent traité comme 0). Dépassement global : un seul segment
  // rouge plein (rien à montrer comme "restant"), sinon deux segments (consommé foncé / restant
  // clair, mêmes tokens que `BudgetVsActualBar`).
  const consumedTotal = data.reduce((sum, d) => sum + (d.consumed || 0), 0);
  const overBudget = consumedTotal > total;
  const remaining = Math.max(0, total - consumedTotal);
  const innerRingData = overBudget
    ? [{ name: "consumed", value: consumedTotal, fill: CONSUMED_OVER_COLOR }]
    : [
        { name: "consumed", value: consumedTotal, fill: CONSUMED_COLOR },
        { name: "remaining", value: remaining, fill: REMAINING_COLOR },
      ];

  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center">
      {/* Zone de dessin du donut — `relative` pour superposer le total en absolu par-dessus, sans
          jamais laisser un composant recharts (légende, notamment) modifier sa géométrie interne. */}
      <div className="relative w-full shrink-0 sm:w-[220px]">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={55}
              outerRadius={90}
              paddingAngle={1}
              activeShape={renderActiveShape as PieProps["activeShape"]}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(undefined)}
              onClick={(d) => {
                const name = (d as { name?: string })?.name;
                if (name) onSliceClick?.(name);
              }}
              cursor={onSliceClick ? "pointer" : undefined}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            {/* Round 16 : second `Pie` NESTÉ dans le MÊME `PieChart`/`ResponsiveContainer` que
                l'anneau existant, à un rayon plus petit qui tient DANS le trou de celui-ci
                (`innerRadius=55` ci-dessus ⇒ un rayon extérieur de 46 laisse un espace visible
                entre les deux anneaux). Pas d'animation (`isAnimationActive={false}`) pour éviter
                une ré-animation disgracieuse à chaque re-render du parent. */}
            {showConsumedRing && (
              <Pie
                data={innerRingData}
                dataKey="value"
                nameKey="name"
                innerRadius={28}
                outerRadius={46}
                isAnimationActive={false}
              >
                {innerRingData.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
            )}
            <Tooltip
              content={(props) => renderTooltip({ ...props, total, formatValue, consumedLabel })}
            />
          </PieChart>
        </ResponsiveContainer>
        {/* Total au centre de l'anneau (round 13) — dans la zone vide laissée par `innerRadius`.
            `pointer-events-none` pour ne jamais intercepter les clics/hover destinés aux parts du
            donut en dessous.
            Round 14 (PO) : rien ne contraignait jusqu'ici la largeur de ce total — un `formatValue`
            long (ex. "17 350 000 EUR") pouvait dépasser visuellement du cercle intérieur, surtout si
            l'anneau grossit un jour. `innerRadius={55}` ci-dessus ⇒ diamètre intérieur 110px ; le
            conteneur ci-dessous est plafonné à 90px (110px moins une marge de sécurité pour ne
            jamais toucher l'anneau) et `text-base` (au lieu de `text-lg`) réduit encore le risque de
            dépassement à cette taille pour une valeur longue — l'emballe/tronque proprement
            (`break-words`) plutôt que de déborder si elle est malgré tout trop longue. À ajuster de
            concert si `innerRadius` change. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="max-w-[90px] px-1 text-center leading-tight">
            {/* Round 16 : quand `showConsumedRing` est actif, la ligne unique ci-dessous cède la
                place à un affichage compact à deux lignes (consommé en gras, puis "/ total" en
                plus petit et atténué) — `text-sm` (au lieu de `text-base`) pour que les DEUX
                lignes tiennent confortablement dans la même largeur `max-w-[90px]`. Sans
                `showConsumedRing`, comportement à ligne unique strictement inchangé (round 13/14). */}
            {showConsumedRing ? (
              <>
                <span
                  className={`block break-words text-sm font-bold ${
                    overBudget ? "text-rag-red" : "text-primary"
                  }`}
                >
                  {formatValue(consumedTotal)}
                </span>
                <span className="block break-words text-[10px] text-tertiary">
                  / {formatValue(total)}
                </span>
              </>
            ) : (
              <span className="break-words text-base font-bold text-primary">
                {formatValue(total)}
              </span>
            )}
            {centerLabel && (
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide text-tertiary">
                {centerLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Légende maison (round 13) — pastille de couleur, nom (tronqué si trop long), valeur
          formatée et % du total alignés à droite. Cliquable exactement comme avant si
          `onSliceClick` est fourni. */}
      <ul className="flex w-full min-w-0 flex-col gap-1.5 text-[11px]">
        {data.map((entry, i) => {
          const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0;
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
