"use client";

import { useState } from "react";
import type { BridgeGranularity, DateRange, MovementBreakdownDimension } from "@/lib/hrEngine";
import { movementBreakdownByDimension } from "@/lib/hrEngine";
import { movementRhythmSeries } from "@/lib/hrTimeSeries";
import { GranularityToggle } from "@/components/shared/GranularityToggle";
import { DepartmentMovementsChart } from "@/components/shared/charts/HrBreakdownCharts";
import { MovementRhythmChart } from "@/components/shared/charts/HrGooduelleCharts";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { WorkforceMovement } from "@/types";

/**
 * Widget "vue combinée (proposition)" — round 4 clarté dashboard RH.
 *
 * Fusionne "Mouvements prévus par {dimension}" (`DepartmentMovementsChart`, widget
 * `department-breakdown`) et "Détail mensuel des mouvements et cumul net" (`MovementRhythmChart`,
 * widget `movement-rhythm`) derrière une simple bascule de mode : les deux graphiques tracent les
 * MÊMES cinq séries de mouvements (Recrutements/Attrition/Départs forcés/Transferts entrants et
 * sortants), juste sur deux axes différents (une dimension organisationnelle statique vs une série
 * temporelle ordonnée). Ce composant NE réimplémente AUCUNE agrégation — il appelle directement
 * `movementBreakdownByDimension()` (lib/hrEngine.ts) et `movementRhythmSeries()`
 * (lib/hrTimeSeries.ts), déjà correctes et déjà testées, et délègue le rendu aux DEUX composants
 * graphiques existants tels quels (`DepartmentMovementsChart`/`MovementRhythmChart`) plutôt que de
 * dupliquer leur JSX Recharts — ce qui garantit au passage que la courbe de cumul net (`cumulNet`,
 * seconde échelle Y) ne s'affiche QUE côté période : elle n'a de sens que sur un axe temporel
 * ordonné, et `DepartmentMovementsChart` ne l'a jamais eue, donc rien à masquer côté dimension.
 *
 * Widget ADDED (pas un remplacement) — voir `lib/hrDashboardWidgets.ts` (`"movements-merged"`,
 * dernier du registre) et `app/(app)/hr/page.tsx` (case `"movements-merged"`) : les deux widgets
 * d'origine restent inchangés au-dessus, celui-ci sert de comparaison avant décision utilisateur.
 */
export function MovementBreakdownMergedChart({
  movements,
  programLabels = {},
  dateRange,
  height = 300,
  onDrilldown,
}: {
  movements: WorkforceMovement[];
  /** Résolveur id programme → libellé affiché, mêmes conventions que `department-breakdown`. */
  programLabels?: Record<string, string>;
  /** Plage de dates pilotant les buckets temporels du mode "Par période" (mêmes bornes que
   *  `movement-rhythm` — range picker + presets FY de la page). */
  dateRange: DateRange;
  height?: number;
  /** Callback drill-down commun aux deux modes — même signature que `onBarClick` des deux
   *  graphiques source, déjà câblée par l'appelant vers `setDrilldownModal` (voir
   *  `MovementDrilldownModal`, app/(app)/hr/page.tsx). */
  onDrilldown?: (title: string, movements: WorkforceMovement[]) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"dimension" | "period">("dimension");
  const [dimension, setDimension] = useState<MovementBreakdownDimension>("department");
  const [granularity, setGranularity] = useState<BridgeGranularity>("quarter");

  const dimensionOptions: { value: MovementBreakdownDimension; label: string }[] = [
    { value: "department", label: t("hr.department", "Département") },
    { value: "country", label: t("dashboard.country", "Pays") },
    { value: "program", label: t("dashboard.program", "Programme") },
  ];
  const dimensionLabel = dimensionOptions.find((o) => o.value === dimension)?.label;

  const handleDimensionClick = (label: string, movs: WorkforceMovement[]) => {
    onDrilldown?.(
      t("hr.drilldown.dimensionTitle", "Mouvements — {label}").replace("{label}", label),
      movs
    );
  };

  const handlePeriodClick = (label: string, movs: WorkforceMovement[]) => {
    onDrilldown?.(
      t("hr.drilldown.periodTitle", "Mouvements — {label}").replace("{label}", label),
      movs
    );
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SegmentedToggle
          options={[
            {
              value: "dimension",
              label: t("hr.widget.movementsMerged.modeDimension", "Par dimension"),
            },
            { value: "period", label: t("hr.widget.movementsMerged.modePeriod", "Par période") },
          ]}
          value={mode}
          onChange={(next) => setMode(next as "dimension" | "period")}
        />
        {mode === "dimension" ? (
          <SegmentedToggle
            options={dimensionOptions}
            value={dimension}
            onChange={(next) => setDimension(next as MovementBreakdownDimension)}
          />
        ) : (
          <GranularityToggle value={granularity} onChange={setGranularity} />
        )}
      </div>
      {mode === "dimension" ? (
        <DepartmentMovementsChart
          data={movementBreakdownByDimension(movements, dimension, programLabels)}
          height={height}
          dimensionLabel={dimensionLabel}
          onBarClick={handleDimensionClick}
        />
      ) : (
        <MovementRhythmChart
          buckets={movementRhythmSeries(movements, granularity, dateRange)}
          height={height}
          onBarClick={handlePeriodClick}
        />
      )}
    </div>
  );
}

/** Bascule segmentée générique locale — reprend exactement le langage visuel de `ViewToggle`
 *  (app/(app)/hr/page.tsx, non exporté depuis ce fichier privé à la page) pour le mode
 *  dimension/période ET le sélecteur de dimension, plutôt que d'inventer un nouveau style de
 *  bascule pour ce widget. */
function SegmentedToggle<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <div className="flex rounded-md border border-border-strong p-0.5 text-[11px] font-semibold">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded px-2 py-1 transition ${
            value === o.value ? "bg-bp-coral text-white" : "text-secondary hover:text-primary"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
