"use client";

import { useId, useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Modal } from "@/components/shared/Modal";
import { IndicatorDeltaStat } from "@/components/strategic/IndicatorDeltaStat";
import { computeIndicatorDelta, recentMeasurementWindow } from "@/lib/axisLogic";
import type { Indicator, IndicatorMeasurement } from "@/types";

// Palette de la courbe (rendu NON-compact uniquement — la sparkline `compact` de
// `BusinessKpiCard`/`IndicatorStatusSummary.tsx` garde son coral fixe, hors périmètre de ce round) :
// sans cible chiffrée, coral de marque par défaut (comme avant) ; avec cible, EXACTEMENT les mêmes
// teintes que `IndicatorDonut`/`IndicatorDeltaStat` (rag-green = noir, la marque interdisant le vert
// littéral ; rag-amber = taupe) — la courbe devient ainsi un second lecteur du même signal de statut
// que le camembert d'en-tête de `IndicatorCard`, plutôt qu'une couleur arbitraire déconnectée.
const COLOR_DEFAULT = "#FF3C47";
const COLOR_FAVORABLE = "#000000";
const COLOR_UNFAVORABLE = "#806659";

/**
 * Graphique d'un indicateur : valeurs mesurées dans le temps + ligne d'objectif. Structure
 * recharts inspirée de `components/shared/charts/SCurveChart.tsx` (même conteneur responsive,
 * mêmes réglages d'axes), mais AUCUNE unité en dur : la S-Curve formate en `€xM`, alors qu'un
 * indicateur stratégique peut être en %, en jours, en NPS, en nombre de sites… d'où la prop
 * `unit`.
 *
 * Un indicateur QUALITATIF (pas de valeur numérique comparable, pas d'`objectiveValue`) n'a pas de
 * courbe qui ait du sens : le composant retombe alors sur une lecture chronologique simple des
 * notes saisies, plutôt que d'afficher un graphique vide.
 *
 * TROIS RENDUS, un seul composant (plutôt qu'un composant « sparkline » dupliqué à côté : mêmes
 * entrées, même sémantique de fenêtrage, même repli qualitatif — les faire diverger serait un
 * bug en puissance) :
 *  - `compact` : sparkline sans axes ni infobulle, pour une carte KPI (voir `BusinessKpiCards`) ;
 *  - normal fenêtré (`windowMeasurements: "recent"`, LE DÉFAUT) : seules les dernières périodes,
 *    avec un bouton « voir l'historique complet » dès qu'il existe des mesures antérieures ;
 *  - normal complet (`windowMeasurements: "all"`) : tout l'historique depuis le lancement du plan,
 *    c'est le rendu utilisé dans la modale d'agrandissement.
 */

export type IndicatorChartProps = {
  measurements: IndicatorMeasurement[];
  /** Valeur cible — matérialisée par une `ReferenceLine` horizontale. Absente = pas de ligne. */
  objectiveValue?: number;
  /** Sens d'amélioration de l'indicateur — nécessaire pour calculer l'écart signé affiché à côté
   *  de la `ReferenceLine` (voir `computeIndicatorDelta`). Absente = traité comme "up" (plus haut
   *  vaut mieux), même convention par défaut que `lib/axisLogic.ts`. */
  direction?: Indicator["direction"];
  /** Suffixe d'unité affiché sur l'axe et dans l'infobulle (ex. "%", "j", "NPS"). */
  unit?: string;
  /** true = indicateur qualitatif : rendu en liste de notes datées, pas en courbe. */
  qualitative?: boolean;
  /** Défaut : 200 px en rendu normal, 48 px en `compact`. */
  height?: number;
  /**
   * Étendue temporelle affichée. `"recent"` (défaut) = seulement les dernières périodes, calibrées
   * par `frequency` (voir `axisLogic.recentMeasurementWindow`) ; `"all"` = tout l'historique.
   * Le défaut est volontairement `"recent"` : sur un plan pluriannuel, une courbe qui empile
   * 3 ans de points écrase la tendance des derniers mois, qui est ce qu'on vient lire.
   */
  windowMeasurements?: "recent" | "all";
  /** Fréquence de reporting — calibre la largeur de la fenêtre `"recent"`. Absente = 12 points. */
  frequency?: Indicator["frequency"];
  /** Sparkline : ni axes, ni grille, ni infobulle, ni points — juste la tendance. Toujours
   *  fenêtrée (`"recent"`) et sans bouton d'agrandissement : c'est la carte qui porte le clic. */
  compact?: boolean;
  /** Libellés (traduits par l'appelant) — repli français. */
  labelValue?: string;
  labelObjective?: string;
  emptyLabel?: string;
  /** Bouton d'agrandissement + titre de la modale d'historique complet. */
  labelViewFull?: string;
  fullHistoryTitle?: string;
  /** Sous-libellé de la barre de progression-vers-la-cible affichée à côté de l'écart signé
   *  (voir `IndicatorDeltaStat`) — repli français. */
  labelProgress?: string;
  /** Round 7, point 3 : masque le `IndicatorDeltaStat` superposé en interne (visible seulement en
   *  rendu non-`compact`, voir `deltaStat` plus bas) — pour un appelant qui affiche déjà ce même
   *  signal ailleurs sur la carte (ex. `IndicatorDonut` en en-tête de `KpiPageClient.tsx`) et ne
   *  veut pas le tripler. Défaut `false` : comportement historique inchangé pour tous les autres
   *  appelants (modales d'historique complet comprises). */
  hideDeltaStat?: boolean;
};

function formatValue(value: number | string, unit?: string): string {
  return unit ? `${value} ${unit}` : `${value}`;
}

/**
 * Infobulle personnalisée du graphique — même habillage carte (bordure + ombre légère) que
 * `InvestVsSavingsTooltip` (`components/finance/FinanceCostCharts.tsx`), seul autre point de
 * l'appli à définir une infobulle recharts sur mesure : la boîte grise par défaut de recharts ne
 * porte ni la typographie ni les coins carrés de la marque BearingPoint.
 */
function IndicatorTooltip({
  active,
  payload,
  label,
  unit,
  labelValue,
}: {
  active?: boolean;
  payload?: { value?: number | string | null }[];
  label?: string;
  unit?: string;
  labelValue: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const raw = payload[0]?.value;
  if (raw === undefined || raw === null) return null;
  return (
    <div className="rounded-lg border border-border bg-white px-3 py-2 shadow-sm">
      <p className="text-[11px] font-semibold text-primary">{label}</p>
      <p className="mt-0.5 text-[12px] text-secondary">
        {labelValue} :{" "}
        <span className="font-semibold text-text-primary">{formatValue(raw, unit)}</span>
      </p>
    </div>
  );
}

export function IndicatorChart({
  measurements,
  objectiveValue,
  direction,
  unit,
  qualitative = false,
  height,
  windowMeasurements = "recent",
  frequency,
  compact = false,
  labelValue = "Valeur",
  labelObjective = "Objectif",
  emptyLabel = "Aucune mesure enregistrée.",
  labelViewFull = "Voir l'historique complet",
  fullHistoryTitle = "Historique complet",
  labelProgress,
  hideDeltaStat = false,
}: IndicatorChartProps) {
  // Hooks appelés avant tout retour anticipé (repli qualitatif / absence de mesure). `useId`
  // fournit un identifiant STABLE et unique par instance pour le `<linearGradient>` du remplissage
  // de la courbe (voir `chart` plus bas) : sans lui, deux `IndicatorChart` montés côte à côte sur
  // la page KPI (une carte par indicateur) partageraient le même `id` de gradient SVG, et le second
  // silencieusement écraserait/référencerait celui du premier (les `id` sont globaux au document).
  const [fullHistoryOpen, setFullHistoryOpen] = useState(false);
  const gradientId = `indicator-gradient-${useId().replace(/:/g, "")}`;

  const resolvedHeight = height ?? (compact ? 48 : 200);

  // Tri chronologique + fenêtrage : les mesures arrivent dans l'ordre arbitraire de Firestore.
  // Une sparkline est toujours fenêtrée — elle n'a pas la place d'afficher 3 ans de points.
  const { all, visible, hidden } = recentMeasurementWindow(measurements, frequency);
  const sorted = windowMeasurements === "all" && !compact ? all : visible;

  /** Repli visuel sans texte (sparkline vide ou non chiffrée) : un simple filet pointillé garde la
   *  hauteur de carte constante sans introduire de chaîne à traduire dans un composant dont les
   *  libellés viennent de l'appelant. */
  const compactPlaceholder = (
    <div className="flex items-center" style={{ height: resolvedHeight }} aria-hidden>
      <div className="w-full border-t border-dashed border-border" />
    </div>
  );

  // Bouton d'agrandissement : seulement en vue fenêtrée ET s'il existe réellement des mesures
  // antérieures à la fenêtre — sinon la modale montrerait exactement le même contenu.
  const canZoom = !compact && windowMeasurements === "recent" && hidden > 0;

  /** Habille un rendu (courbe OU liste qualitative) du bouton « historique complet » + sa modale,
   *  qui rejoue LE MÊME composant en mode `"all"` : une seule définition de ce à quoi ressemble un
   *  historique d'indicateur, quel que soit son type. */
  const withZoom = (body: ReactNode): ReactNode => {
    if (!canZoom) return body;
    return (
      <div className="space-y-1">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setFullHistoryOpen(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-bg-surface hover:text-bp-coral"
          >
            <Maximize2 size={11} /> {labelViewFull}
          </button>
        </div>
        {body}
        <Modal
          open={fullHistoryOpen}
          onOpenChange={setFullHistoryOpen}
          title={fullHistoryTitle}
          maxWidth="820px"
        >
          <IndicatorChart
            measurements={measurements}
            objectiveValue={objectiveValue}
            direction={direction}
            unit={unit}
            qualitative={qualitative}
            height={360}
            windowMeasurements="all"
            frequency={frequency}
            labelValue={labelValue}
            labelObjective={labelObjective}
            emptyLabel={emptyLabel}
            labelProgress={labelProgress}
          />
        </Modal>
      </div>
    );
  };

  if (sorted.length === 0) {
    if (compact) return compactPlaceholder;
    return <div className="py-6 text-center text-xs text-tertiary">{emptyLabel}</div>;
  }

  // Repli qualitatif — également utilisé quand un indicateur quantitatif n'a que des mesures sans
  // valeur numérique (saisies uniquement commentées) : tracer une courbe vide induirait en erreur.
  // Ce repli est FENÊTRÉ comme la courbe, et hérite donc du même bouton d'agrandissement plus bas :
  // sans lui, les notes antérieures à la fenêtre seraient définitivement invisibles.
  const hasNumericValue = sorted.some((m) => m.value !== undefined);
  if (qualitative || !hasNumericValue) {
    if (compact) return compactPlaceholder;
    return (
      <>
        {withZoom(
          <ul className="divide-y divide-border text-sm">
            {sorted.map((m) => (
              <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                <span className="shrink-0 font-mono text-xs text-secondary">{m.period}</span>
                <span className="text-right text-text-primary">
                  {m.note ?? (m.value !== undefined ? formatValue(m.value, unit) : "—")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  const data = sorted.map((m) => ({ period: m.period, value: m.value ?? null }));

  // Dernière mesure de TOUT l'historique (`all`, pas `sorted`/fenêtré) — sert à la fois à l'écart
  // signé ci-dessous ET au nouveau rappel de valeur courante (voir `chartWithDelta` plus bas) :
  // aucun des deux ne doit changer selon que la fenêtre "récente" masque ou non la mesure la plus
  // récente.
  const latestOverall = all[all.length - 1];

  // Statut vs la cible (round 4, point 1 ; réutilisé round 27 pour la couleur de la courbe) —
  // calculé INDÉPENDAMMENT de `hideDeltaStat` : ce flag ne masque que le badge `IndicatorDeltaStat`
  // rendu par CE composant (round 7, point 3 — l'appelant affiche déjà le même signal ailleurs),
  // il ne doit pas priver la courbe elle-même de sa couleur de statut. `undefined` (pas d'objectif
  // chiffré, ou dernière mesure sans valeur numérique) : ni badge ni couleur de statut, la courbe
  // retombe sur le coral de marque par défaut.
  const statusDelta =
    !compact && objectiveValue !== undefined
      ? computeIndicatorDelta({ objectiveValue, direction }, latestOverall)
      : undefined;
  const deltaStat = hideDeltaStat ? undefined : statusDelta;
  const lineColor = !statusDelta
    ? COLOR_DEFAULT
    : statusDelta.favorable
      ? COLOR_FAVORABLE
      : COLOR_UNFAVORABLE;

  // Sparkline : pas d'axe visible, donc pas de domaine par défaut lisible — on le calcule pour que
  // la courbe occupe toute la hauteur disponible ET que la ligne d'objectif reste dans le cadre
  // (recharts écarte une `ReferenceLine` hors domaine).
  let compactDomain: [number, number] | undefined;
  if (compact) {
    const values = data.map((d) => d.value).filter((v): v is number => v !== null);
    const lo = Math.min(...values, ...(objectiveValue !== undefined ? [objectiveValue] : []));
    const hi = Math.max(...values, ...(objectiveValue !== undefined ? [objectiveValue] : []));
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1;
    compactDomain = [lo - pad, hi + pad];
  }

  // `ComposedChart` (plutôt que `LineChart`) : seul conteneur recharts capable d'accueillir à la
  // fois la `Line` d'origine (rendu `compact`, INCHANGÉ pixel pour pixel — c'est la sparkline de
  // `BusinessKpiCard`/`IndicatorStatusSummary.tsx`, explicitement hors périmètre de ce round) et la
  // nouvelle `Area` à remplissage dégradé du rendu normal ci-dessous, sans dupliquer toute la
  // structure grille/axes/`ReferenceLine` commune aux deux rendus.
  const chart = (
    <ResponsiveContainer width="100%" height={resolvedHeight}>
      <ComposedChart
        data={data}
        margin={
          compact
            ? { top: 3, right: 3, left: 3, bottom: 3 }
            : { top: 4, right: 8, left: -16, bottom: 0 }
        }
      >
        {/* Dégradé de la zone sous la courbe (rendu normal uniquement) : de la couleur de statut de
            la courbe (`lineColor`, voir plus haut) à transparent — même esprit que les graphiques
            Finance (`components/finance/FinanceCostCharts.tsx`), qui utilisent déjà des remplissages
            pleins pour donner du poids visuel à une courbe/barre plutôt qu'un simple filet. */}
        {!compact && (
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={lineColor} stopOpacity={0.25} />
              <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
            </linearGradient>
          </defs>
        )}
        {!compact && (
          // Round 27 : grille très légèrement plus marquée (6% de noir contre 4% avant) — le
          // rendu précédent était au bord de l'invisible sur un écran standard, ce qui participait
          // au ressenti "pas fini" signalé par le PO ; on reste loin d'un quadrillage chargé.
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        )}
        {compact ? (
          <XAxis dataKey="period" hide />
        ) : (
          <XAxis
            dataKey="period"
            tick={{ fontSize: 11 }}
            // Ligne d'axe très discrète plutôt qu'entièrement masquée (`axisLine={false}` avant) :
            // ancre visuellement la courbe à une base, sans réintroduire un cadre complet.
            axisLine={{ stroke: "rgba(0,0,0,0.1)" }}
            tickLine={false}
          />
        )}
        {compact ? (
          <YAxis hide domain={compactDomain} />
        ) : (
          <YAxis
            tick={{ fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => formatValue(v as number, unit)}
          />
        )}
        {!compact && (
          <Tooltip
            content={<IndicatorTooltip unit={unit} labelValue={labelValue} />}
            cursor={{ stroke: lineColor, strokeWidth: 1, strokeDasharray: "4 4" }}
          />
        )}
        {objectiveValue !== undefined && (
          <ReferenceLine
            y={objectiveValue}
            stroke="#806659"
            strokeDasharray={compact ? "3 3" : "6 4"}
            strokeWidth={compact ? 1 : undefined}
            strokeOpacity={compact ? 0.6 : undefined}
            label={
              compact
                ? undefined
                : {
                    value: `${labelObjective} : ${formatValue(objectiveValue, unit)}`,
                    position: "insideTopRight",
                    fontSize: 11,
                    fill: "#806659",
                  }
            }
          />
        )}
        {compact ? (
          <Line
            type="monotone"
            dataKey="value"
            name={labelValue}
            stroke="#FF3C47"
            strokeWidth={2}
            // Sparkline sans points… sauf s'il n'y a QU'UNE mesure : un segment de longueur nulle
            // ne dessine rien, la carte paraîtrait vide alors qu'elle a une valeur.
            dot={data.length === 1 ? { r: 2.5 } : false}
            activeDot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
        ) : (
          <Area
            type="monotone"
            dataKey="value"
            name={labelValue}
            stroke={lineColor}
            strokeWidth={2.5}
            fill={`url(#${gradientId})`}
            dot={{ r: 3, fill: "#fff", stroke: lineColor, strokeWidth: 2 }}
            activeDot={{ r: 6, fill: lineColor, stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive
            connectNulls={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );

  if (compact) return chart;

  // Rappel de la dernière valeur (nouveau, round 27) : un chiffre en gros caractères gras, même
  // poids visuel que `BusinessKpiCard` (`text-xl font-bold`), coloré comme la courbe (`lineColor`)
  // — pour que le graphique ne soit plus le SEUL signal visuel de la carte. Aligné à gauche pour
  // laisser l'écart signé (`IndicatorDeltaStat`, quand affiché) au même coin droit qu'avant.
  // Volontairement ADDITIF : ne remplace ni ne masque rien de ce qui existait (le graphique reste
  // visible en permanence, la valeur détaillée sous le graphique dans `IndicatorCard` n'est pas
  // retirée).
  const latestValueNode =
    latestOverall?.value !== undefined ? (
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-xl font-bold leading-none tracking-tight"
          style={{ color: lineColor }}
        >
          {formatValue(latestOverall.value, unit)}
        </span>
        <span className="font-mono text-[11px] text-tertiary">{latestOverall.period}</span>
      </div>
    ) : null;

  const header =
    latestValueNode || deltaStat ? (
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>{latestValueNode}</div>
        {deltaStat && (
          <IndicatorDeltaStat
            delta={deltaStat}
            unit={unit}
            compact
            labels={{ progress: labelProgress }}
          />
        )}
      </div>
    ) : null;

  // Cadre léger (même habillage que le bloc "Objectif" voisin dans `IndicatorCard.tsx` — bordure +
  // fond `bg-bg-surface/60`, round 27) autour du rappel de valeur + de la courbe : donne au
  // graphique sa propre identité visuelle plutôt que de flotter nu dans la carte, sans ajouter de
  // second `Card` imbriqué (l'appelant garde la main sur son propre habillage extérieur).
  const chartPanel = (
    <div className="rounded-lg border border-border bg-bg-surface/40 px-3 pb-1 pt-3">
      {header && <div className="mb-2">{header}</div>}
      {chart}
    </div>
  );

  return <>{withZoom(chartPanel)}</>;
}
