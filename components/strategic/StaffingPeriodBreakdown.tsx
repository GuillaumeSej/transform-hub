"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { hexForDepartment, staffingPeriodBuckets } from "@/lib/axisLogic";
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
 *
 * Round 19 (PO : « une vraie courbe/graphique, pas une liste de barres ») : la vue passe d'un
 * `<ul>` de cartes-période (une barre CSS plate par période + une liste imbriquée sans barre par
 * équipe) à un vrai graphique Recharts avec le TEMPS en abscisse — barres empilées, une série par
 * équipe (`Bar dataKey={team} stackId="etp"`). Chaque `StaffingPeriodBucket.byFunction` (objet
 * imbriqué) est reformaté en ligne PLATE `{ period, [team]: fte, ... }` (`chartData`), Recharts ne
 * consommant que des lignes plates ; `teamNames` (union de toutes les équipes tous buckets
 * confondus) garantit que chaque série est définie pour CHAQUE période, avec `0` par défaut plutôt
 * qu'une valeur manquante (sans quoi une équipe absente d'une période casserait l'empilement des
 * barres suivantes). Couleurs alignées EXACTEMENT sur les barres CSS historiques de cette page
 * (`hexForDepartment`, équivalent hex de `colorForDepartment` — même hash, même palette, même
 * index).
 *
 * L'interaction « cliquer une équipe pour filtrer » ne disparaît pas avec la liste : elle se pilote
 * désormais depuis la légende (clic sur un nom d'équipe) ET directement depuis un segment de barre
 * (clic sur un segment de la même équipe, dans n'importe quelle période) — les deux appellent le
 * même `onSelectFunction`, avec le même comportement toggle qu'avant.
 */
/** Réplique volontaire de `periodLabelForDate` (`lib/axisLogic.ts`, non exportée — ce fichier n'a
 *  pas la main sur `axisLogic.ts` pour ce chantier, round 20 : périmètre agent figé). Nécessaire
 *  pour retrouver, à partir d'une ligne `ChantierStaffing` brute, la même étiquette de période que
 *  celle produite par `staffingPeriodBuckets` pour `buckets` — sans quoi le détail par chantier du
 *  tooltip (round 20, point 3) pourrait diverger de l'agrégat affiché. */
function periodLabelForDateLocal(
  isoDate: string,
  granularity: "quarterly" | "semiannual" | "annual"
): string {
  const year = isoDate.slice(0, 4);
  const month = Number(isoDate.slice(5, 7)); // 1-12
  switch (granularity) {
    case "quarterly":
      return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
    case "semiannual":
      return `${year}-S${month <= 6 ? 1 : 2}`;
    case "annual":
      return year;
  }
}

export function StaffingPeriodBreakdown({
  staffing,
  fteByDept,
  chantierNamesById = {},
  selectedFunction = null,
  onSelectFunction,
}: {
  staffing: ChantierStaffing[];
  /** Disponible réel par équipe (base ETP entreprise, live) — voir doc-comment ci-dessus. */
  fteByDept: Record<string, number>;
  /** `Chantier.id` → nom, pour le détail par chantier du tooltip (round 20, point 3) — construit
   *  par l'appelant (`EffectifsPageClient.tsx` a déjà tous les chantiers du programme chargés).
   *  Optionnel : un chantier absent de la map retombe sur `effectifs.chantierUnknown`. */
  chantierNamesById?: Record<string, string>;
  selectedFunction?: string | null;
  onSelectFunction?: (fn: string | null) => void;
}) {
  const { t } = useTranslation();
  const [granularity, setGranularity] = useState<"quarterly" | "semiannual" | "annual">(
    "quarterly"
  );
  /** Équipe actuellement survolée (segment de barre OU entrée de légende) — round 20, point 3 :
   *  distinct de `selectedFunction` (le clic, qui pilote le filtre de la section "Répartition par
   *  axe" plus bas sur la page). Le tooltip privilégie le survol quand il existe, et retombe sur
   *  `selectedFunction` sinon, pour montrer le détail par chantier de l'équipe la plus pertinente
   *  dans chaque contexte. */
  const [hoveredFunction, setHoveredFunction] = useState<string | null>(null);

  const buckets = useMemo(
    () => staffingPeriodBuckets(staffing, granularity),
    [staffing, granularity]
  );
  const undatedCount = useMemo(() => staffing.filter((e) => !e.startDate).length, [staffing]);

  /** Disponible total tous équipes confondues (base ETP entreprise) — dénominateur du %
   *  d'utilisation global affiché par période, désormais dans l'info-bulle du graphique plutôt que
   *  sur un en-tête de carte-période disparu avec la liste. `0` quand la base ETP est vide :
   *  `pctUtilized` reste `null` plutôt que d'afficher un pourcentage trompeur ou une division par
   *  zéro. */
  const totalAvailable = useMemo(
    () => Object.values(fteByDept).reduce((sum, v) => sum + v, 0),
    [fteByDept]
  );

  /** % d'utilisation pour un total d'ETP mobilisés donné — factorisé (round 20, point 2) pour que
   *  le libellé visible au-dessus du graphique ET le tooltip au survol utilisent EXACTEMENT le même
   *  calcul, jamais deux chemins de calcul différents pour le même pourcentage. */
  const pctUtilizedFor = (total: number): number | null =>
    totalAvailable > 0 ? Math.round((total / totalAvailable) * 100) : null;

  /** Détail par chantier, par (période, équipe) — round 20, point 3 : reconstruit depuis les
   *  lignes `ChantierStaffing` brutes (jamais depuis `buckets`, qui n'agrège que par équipe, sans
   *  granularité chantier) en réutilisant EXACTEMENT le même découpage de période que
   *  `staffingPeriodBuckets` (voir `periodLabelForDateLocal` ci-dessus). Structure :
   *  période → équipe → chantierId → ETP. */
  const chantierBreakdownByPeriodFn = useMemo(() => {
    const map = new Map<string, Map<string, Map<string, number>>>();
    for (const entry of staffing) {
      if (!entry.startDate) continue;
      const period = periodLabelForDateLocal(entry.startDate, granularity);
      let byFn = map.get(period);
      if (!byFn) {
        byFn = new Map();
        map.set(period, byFn);
      }
      let byChantier = byFn.get(entry.function);
      if (!byChantier) {
        byChantier = new Map();
        byFn.set(entry.function, byChantier);
      }
      byChantier.set(entry.chantierId, (byChantier.get(entry.chantierId) ?? 0) + (entry.fte || 0));
    }
    return map;
  }, [staffing, granularity]);

  /** Union de toutes les équipes tous buckets confondus — voir doc-comment du composant. Triée
   *  alphabétiquement pour un ordre de légende/empilement stable indépendant de l'ordre d'arrivée
   *  des lignes de staffing. */
  const teamNames = useMemo(() => {
    const names = new Set<string>();
    for (const bucket of buckets) {
      for (const fn of Object.keys(bucket.byFunction)) names.add(fn);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [buckets]);

  /** Reformatage plat `{ period, [team]: fte }` — voir doc-comment du composant. */
  const chartData = useMemo(
    () =>
      buckets.map((bucket) => {
        const row: Record<string, string | number> = { period: bucket.period };
        for (const fn of teamNames) row[fn] = bucket.byFunction[fn] ?? 0;
        return row;
      }),
    [buckets, teamNames]
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
          <>
            {/* % d'utilisation visible sans survol (round 20, point 2) — une ligne de libellés au-
                dessus du graphique, une entrée par période, dans le même ordre que l'abscisse.
                Réutilise `pctUtilizedFor`, exactement le même calcul que celui du tooltip
                ci-dessous, pour que les deux ne puissent jamais diverger. */}
            <div className="mb-2 flex flex-wrap gap-2">
              {buckets.map((bucket) => {
                const pct = pctUtilizedFor(bucket.totalFte);
                return (
                  <span
                    key={bucket.period}
                    className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-semibold text-secondary"
                  >
                    {bucket.period}
                    {" · "}
                    {pct !== null
                      ? t("staffingPeriod.utilization").replace("{pct}", String(pct))
                      : "—"}
                  </span>
                );
              })}
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  tickFormatter={(v) => String(Math.round(Number(v)))}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const total = payload.reduce(
                      (sum, p) => sum + (typeof p.value === "number" ? p.value : 0),
                      0
                    );
                    const pctUtilized = pctUtilizedFor(total);
                    // Détail par chantier (round 20, point 3) : pour l'équipe survolée (priorité)
                    // ou, à défaut, l'équipe actuellement sélectionnée — voir doc-comment de
                    // `hoveredFunction` plus haut.
                    const activeFn = hoveredFunction ?? selectedFunction ?? null;
                    const chantierEntries = activeFn
                      ? Array.from(
                          chantierBreakdownByPeriodFn.get(String(label))?.get(activeFn) ?? []
                        ).sort((a, b) => b[1] - a[1])
                      : [];
                    return (
                      <div className="rounded-md border border-border bg-white px-3 py-2 text-[12px] shadow-sm">
                        <p className="mb-1 font-bold text-primary">{label}</p>
                        {payload
                          .filter((p) => (typeof p.value === "number" ? p.value : 0) > 0)
                          .map((p) => (
                            <p
                              key={String(p.dataKey)}
                              className="flex items-center justify-between gap-3 text-secondary"
                            >
                              <span className="flex items-center gap-1.5">
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ background: p.color }}
                                />
                                {p.name}
                              </span>
                              <span className="ml-2 font-semibold text-primary">
                                {formatFte(Number(p.value))} {t("staffing.fteUnit")}
                              </span>
                            </p>
                          ))}
                        <p className="mt-1 border-t border-border pt-1 font-bold text-primary">
                          {formatFte(total)} {t("staffing.fteUnit")}
                          {pctUtilized !== null &&
                            ` · ${t("staffingPeriod.utilization").replace("{pct}", String(pctUtilized))}`}
                        </p>
                        {chantierEntries.length > 0 && (
                          <div className="mt-1 border-t border-border pt-1">
                            <p className="mb-0.5 font-semibold text-tertiary">
                              {t("staffingPeriod.byChantier")} {activeFn}
                            </p>
                            {chantierEntries.map(([chantierId, fte]) => (
                              <p
                                key={chantierId}
                                className="flex items-center justify-between gap-3 text-tertiary"
                              >
                                <span>
                                  {chantierNamesById[chantierId] ?? t("effectifs.chantierUnknown")}
                                </span>
                                <span className="ml-2 font-semibold text-secondary">
                                  {formatFte(fte)} {t("staffing.fteUnit")}
                                </span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                <Legend
                  verticalAlign="top"
                  align="right"
                  wrapperStyle={{
                    fontSize: 11,
                    paddingBottom: 8,
                    cursor: onSelectFunction ? "pointer" : undefined,
                  }}
                  onClick={(entry) => {
                    const fn = typeof entry?.value === "string" ? entry.value : undefined;
                    if (!fn) return;
                    onSelectFunction?.(selectedFunction === fn ? null : fn);
                  }}
                  onMouseEnter={(entry) => {
                    const fn = typeof entry?.value === "string" ? entry.value : undefined;
                    if (fn) setHoveredFunction(fn);
                  }}
                  onMouseLeave={() => setHoveredFunction(null)}
                  formatter={(value) => (
                    <span
                      style={{ fontWeight: selectedFunction === value ? 700 : 400 }}
                      className="text-primary"
                    >
                      {value}
                    </span>
                  )}
                />
                {teamNames.map((fn) => (
                  <Bar
                    key={fn}
                    dataKey={fn}
                    name={fn}
                    stackId="etp"
                    fill={hexForDepartment(fn)}
                    fillOpacity={selectedFunction && selectedFunction !== fn ? 0.35 : 1}
                    cursor={onSelectFunction ? "pointer" : undefined}
                    onClick={() => onSelectFunction?.(selectedFunction === fn ? null : fn)}
                    onMouseEnter={() => setHoveredFunction(fn)}
                    onMouseLeave={() => setHoveredFunction(null)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </>
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
