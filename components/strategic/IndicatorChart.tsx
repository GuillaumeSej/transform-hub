"use client";

import { useState, type ReactNode } from "react";
import { Maximize2 } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Modal } from "@/components/shared/Modal";
import { recentMeasurementWindow } from "@/lib/axisLogic";
import type { Indicator, IndicatorMeasurement } from "@/types";

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
};

function formatValue(value: number | string, unit?: string): string {
  return unit ? `${value} ${unit}` : `${value}`;
}

export function IndicatorChart({
  measurements,
  objectiveValue,
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
}: IndicatorChartProps) {
  // Hook appelé avant tout retour anticipé (repli qualitatif / absence de mesure).
  const [fullHistoryOpen, setFullHistoryOpen] = useState(false);

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
            unit={unit}
            qualitative={qualitative}
            height={360}
            windowMeasurements="all"
            frequency={frequency}
            labelValue={labelValue}
            labelObjective={labelObjective}
            emptyLabel={emptyLabel}
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

  const chart = (
    <ResponsiveContainer width="100%" height={resolvedHeight}>
      <LineChart
        data={data}
        margin={
          compact
            ? { top: 3, right: 3, left: 3, bottom: 3 }
            : { top: 4, right: 8, left: -16, bottom: 0 }
        }
      >
        {!compact && (
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
        )}
        {compact ? (
          <XAxis dataKey="period" hide />
        ) : (
          <XAxis dataKey="period" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
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
          <Tooltip formatter={(value) => [formatValue(value as number, unit), labelValue]} />
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
        <Line
          type="monotone"
          dataKey="value"
          name={labelValue}
          stroke="#FF3C47"
          strokeWidth={compact ? 2 : 2.5}
          // Sparkline sans points… sauf s'il n'y a QU'UNE mesure : un segment de longueur nulle ne
          // dessine rien, la carte paraîtrait vide alors qu'elle a une valeur.
          dot={compact ? (data.length === 1 ? { r: 2.5 } : false) : { r: 3 }}
          activeDot={compact ? false : { r: 5 }}
          isAnimationActive={!compact}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );

  if (compact) return chart;

  return <>{withZoom(chart)}</>;
}
