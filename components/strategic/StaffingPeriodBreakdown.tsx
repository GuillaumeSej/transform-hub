"use client";

import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { colorForDepartment, staffingPeriodBuckets } from "@/lib/axisLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierStaffing } from "@/types";

/**
 * Répartition des ETP mobilisés PAR PÉRIODE (trimestre / semestre / année), pilotée par
 * `staffingPeriodBuckets` (lib/axisLogic.ts) — remplace la section historique « Au global, par
 * grande fonction » de `app/(app)/effectifs/EffectifsPageClient.tsx`, qui n'avait aucune dimension
 * temporelle. Seules les lignes de staffing DATÉES (`ChantierStaffing.startDate` défini)
 * apparaissent ici ; le nombre de lignes non datées est signalé en pied de carte plutôt que
 * silencieusement ignoré.
 *
 * `selectedFunction`/`onSelectFunction` sont OPTIONNELS mais, quand fournis par l'appelant,
 * permettent de cliquer une équipe (dans n'importe quelle période) pour piloter le filtre de la
 * section « Répartition par axe » restée plus bas sur `EffectifsPageClient.tsx` — c'est l'ancienne
 * section « Au global, par grande fonction » qui portait ce rôle de sélecteur ; cette carte en
 * hérite pour ne pas perdre l'interaction « cliquez une équipe pour comparer les axes ».
 *
 * Round 13 : le « % utilisé » se lisait auparavant contre `Program.staffingBudgets` (un budget
 * saisi à la main, par fonction figée, scope PROGRAMME — retiré de `types/index.ts`). Il se lit
 * désormais contre `fteByDept` (round 13, disponible RÉEL de la base ETP entreprise, voir
 * `EffectifsPageClient.tsx`::useCompanyDepartments) — même dénominateur que la comparaison
 * besoin/disponible affichée plus bas sur la page, jamais deux sources de vérité différentes pour
 * le même pourcentage.
 */
export function StaffingPeriodBreakdown({
  staffing,
  fteByDept,
  selectedFunction = null,
  onSelectFunction,
}: {
  staffing: ChantierStaffing[];
  /** Disponible réel par équipe (base ETP entreprise, live) — voir doc-comment ci-dessus. */
  fteByDept: Record<string, number>;
  selectedFunction?: string | null;
  onSelectFunction?: (fn: string | null) => void;
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

  /** Disponible total tous équipes confondues (base ETP entreprise) — dénominateur du %
   *  d'utilisation global affiché par période. `0` quand la base ETP est vide : `pctUtilized`
   *  reste `null` plutôt que d'afficher un pourcentage trompeur ou une division par zéro. */
  const totalAvailable = useMemo(
    () => Object.values(fteByDept).reduce((sum, v) => sum + v, 0),
    [fteByDept]
  );

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
            {buckets.map((bucket) => {
              const pctUtilized =
                totalAvailable > 0 ? Math.round((bucket.totalFte / totalAvailable) * 100) : null;
              const functionsInBucket = Object.keys(bucket.byFunction)
                .filter((fn) => (bucket.byFunction[fn] ?? 0) > 0)
                .sort((a, b) => a.localeCompare(b));
              return (
                <li key={bucket.period} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-bold text-primary">{bucket.period}</span>
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[12px] text-secondary">
                        <strong className="text-primary">{formatFte(bucket.totalFte)}</strong>{" "}
                        {t("staffing.fteUnit")}
                      </span>
                      {pctUtilized !== null && (
                        <span className="text-[13px] font-bold text-primary">
                          {t("staffingPeriod.utilization").replace("{pct}", String(pctUtilized))}
                        </span>
                      )}
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
                    {functionsInBucket.map((fn) => {
                      const fte = bucket.byFunction[fn] ?? 0;
                      const available = fteByDept[fn];
                      const selected = selectedFunction === fn;
                      return (
                        <li key={fn}>
                          <button
                            type="button"
                            aria-pressed={selected}
                            onClick={() => onSelectFunction?.(selected ? null : fn)}
                            className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[12px] transition ${
                              selected
                                ? "bg-neutral-50 ring-1 ring-bp-coral"
                                : "hover:bg-neutral-50"
                            }`}
                          >
                            <span className="flex items-center gap-1.5 text-primary">
                              <span
                                className={`inline-block h-2 w-2 rounded-full ${colorForDepartment(fn)}`}
                              />
                              {fn}
                            </span>
                            <span className="text-secondary">
                              {formatFte(fte)} {t("staffing.fteUnit")}
                              {available !== undefined && (
                                <span className="ml-1 text-tertiary">
                                  / {formatFte(available)} {t("staffing.fteUnit")} (
                                  {Math.round((fte / (available || 1)) * 100)}%)
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
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
