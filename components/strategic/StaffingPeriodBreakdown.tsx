"use client";

import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import {
  STAFFING_FUNCTIONS,
  STAFFING_FUNCTION_COLORS,
  formatFte,
} from "@/components/strategic/ChantierStaffingEditor";
import { staffingPeriodBuckets } from "@/lib/axisLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierStaffing, Program, StaffingFunction } from "@/types";

/**
 * Répartition des ETP mobilisés PAR PÉRIODE (trimestre / semestre / année), pilotée par
 * `staffingPeriodBuckets` (lib/axisLogic.ts) — remplace la section historique « Au global, par
 * grande fonction » de `app/(app)/effectifs/EffectifsPageClient.tsx`, qui n'avait aucune dimension
 * temporelle. Seules les lignes de staffing DATÉES (`ChantierStaffing.startDate` défini)
 * apparaissent ici ; le nombre de lignes non datées est signalé en pied de carte plutôt que
 * silencieusement ignoré.
 *
 * `selectedFunction`/`onSelectFunction` sont OPTIONNELS mais, quand fournis par l'appelant,
 * permettent de cliquer une fonction (dans n'importe quelle période) pour piloter le filtre de la
 * section « Répartition par axe » restée plus bas sur `EffectifsPageClient.tsx` — c'est l'ancienne
 * section « Au global, par grande fonction » qui portait ce rôle de sélecteur ; cette carte en
 * hérite pour ne pas perdre l'interaction « cliquez une fonction pour comparer les axes ».
 */
export function StaffingPeriodBreakdown({
  staffing,
  activeProgram,
  selectedFunction = null,
  onSelectFunction,
}: {
  staffing: ChantierStaffing[];
  activeProgram: Program | null;
  selectedFunction?: StaffingFunction | null;
  onSelectFunction?: (fn: StaffingFunction | null) => void;
}) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<"quarterly" | "semiannual" | "annual">(
    "quarterly"
  );

  const buckets = useMemo(
    () => staffingPeriodBuckets(staffing, granularity),
    [staffing, granularity]
  );
  const maxTotal = useMemo(
    () => buckets.reduce((max, b) => Math.max(max, b.totalFte), 0),
    [buckets]
  );
  const undatedCount = useMemo(() => staffing.filter((e) => !e.startDate).length, [staffing]);

  return (
    <Card className="mb-0">
      <CardHeader
        title={t("staffingPeriod.title")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selectedFunction && onSelectFunction && (
              <Button variant="ghost" size="sm" onClick={() => onSelectFunction(null)}>
                {t("effectifs.allFunctions")}
              </Button>
            )}
            {/* Même look que `TimelineScaleToggle` (components/strategic/TimelineBars.tsx) — pas
                réutilisé tel quel : les granularités (trimestre/semestre/année) ne correspondent
                pas à `TimelineScale` (mois/trimestre/semestre), qui répond à un besoin différent
                (échelle d'un Gantt, pas une clé de bucket calendaire). */}
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["quarterly", "semiannual", "annual"] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  aria-pressed={granularity === g}
                  onClick={() => setGranularity(g)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition ${
                    granularity === g
                      ? "bg-black text-white"
                      : "bg-white text-secondary hover:text-primary"
                  }`}
                >
                  {t(`staffingPeriod.granularity.${g}`)}
                </button>
              ))}
            </div>
          </div>
        }
      />
      <CardBody>
        <p className="mb-3 text-xs text-tertiary">{t("staffingPeriod.subtitle")}</p>
        {buckets.length === 0 ? (
          <p className="text-sm text-text-secondary">{t("staffingPeriod.empty")}</p>
        ) : (
          <ul className="space-y-4">
            {buckets.map((bucket) => (
              <li key={bucket.period} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[13px] font-bold text-primary">{bucket.period}</span>
                  <span className="text-[12px] text-secondary">
                    <strong className="text-primary">{formatFte(bucket.totalFte)}</strong>{" "}
                    {t("staffing.fteUnit")}
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full rounded-full bg-bp-coral transition-all"
                    style={{
                      width: `${maxTotal > 0 ? (bucket.totalFte / maxTotal) * 100 : 0}%`,
                    }}
                  />
                </div>
                <ul className="mt-3 space-y-1.5">
                  {STAFFING_FUNCTIONS.filter((fn) => (bucket.byFunction[fn] ?? 0) > 0).map((fn) => {
                    const fte = bucket.byFunction[fn] ?? 0;
                    const budget = activeProgram?.staffingBudgets?.[fn];
                    const selected = selectedFunction === fn;
                    return (
                      <li key={fn}>
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => onSelectFunction?.(selected ? null : fn)}
                          className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[12px] transition ${
                            selected ? "bg-neutral-50 ring-1 ring-bp-coral" : "hover:bg-neutral-50"
                          }`}
                        >
                          <span className="flex items-center gap-1.5 text-primary">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${STAFFING_FUNCTION_COLORS[fn]}`}
                            />
                            {t(`staffing.function.${fn}`)}
                          </span>
                          <span className="text-secondary">
                            {formatFte(fte)} {t("staffing.fteUnit")}
                            {budget !== undefined && (
                              <span className="ml-1 text-tertiary">
                                / {formatFte(budget)} {t("staffing.fteUnit")} (
                                {Math.round((fte / (budget || 1)) * 100)}%)
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {undatedCount > 0 && (
          <p className="mt-3 text-[11px] text-tertiary">
            {t("staffingPeriod.undatedNote").replace("{n}", String(undatedCount))}
          </p>
        )}
      </CardBody>
    </Card>
  );
}
