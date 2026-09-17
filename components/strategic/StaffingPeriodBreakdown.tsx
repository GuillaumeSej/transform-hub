"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
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
import { hexToRgb } from "@/components/strategic/TimelineBars";
import { hexForDepartment, periodLabelForDate, staffingPeriodBuckets } from "@/lib/axisLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { ChantierStaffing, StrategicAxis } from "@/types";

type Granularity = "quarterly" | "semiannual" | "annual";
type ViewMode = "period" | "axis";

/** Forme UNIFIÉE d'un bucket de période, quel que soit le mode — `byGroup` porte soit les
 *  équipes (mode "period", projection de `StaffingPeriodBucket.byFunction`), soit les axes (mode
 *  "axis", `axisPeriodBuckets` ci-dessous). Permet à TOUT le reste du composant (ligne de %, axe X
 *  du graphique, tooltip, panneau épinglé) de rester écrit une seule fois, sans brancher sur le
 *  mode à chaque endroit. */
type UnifiedBucket = { period: string; totalFte: number; byGroup: Record<string, number> };

/** Une série affichée (une barre empilée) — équipe (mode "period") ou axe (mode "axis"). `key` est
 *  l'identifiant STABLE utilisé comme `dataKey` Recharts / clé de `chartData` / clé de
 *  `chantierBreakdownByPeriod` (nom d'équipe ou `StrategicAxis.id`) ; `name` est le libellé AFFICHÉ
 *  (identique à `key` pour une équipe, résolu via `axes` pour un axe) — les deux divergent en mode
 *  "axis", jamais en mode "period". */
type SeriesDef = { key: string; name: string; color: string };

/** Couleur de repli quand l'axe n'a pas de `color` choisie (ou une valeur invalide) — même taupe
 *  BearingPoint que `ProgramRoadmap.tsx`/`ChantierGantt.tsx` (`FALLBACK_COLOR`), dupliquée ici pour
 *  la même raison qu'eux : pas de point de partage naturel pour une seule constante hex. */
const FALLBACK_AXIS_COLOR = "#a99e9a";

function findAxisName(axes: StrategicAxis[], t: (key: string) => string, axisId: string): string {
  return axes.find((a) => a.id === axisId)?.name ?? t("effectifs.axisUnknown");
}

function findAxisColor(axes: StrategicAxis[], axisId: string): string {
  const axis = axes.find((a) => a.id === axisId);
  return axis?.color && hexToRgb(axis.color) ? axis.color : FALLBACK_AXIS_COLOR;
}

/**
 * Pendant de `staffingPeriodBuckets` (lib/axisLogic.ts) pour le mode "axis" (round 22) — MÊME
 * boucle de répartition par période, mais la clé de regroupement est l'AXE (ou les axes, round 24)
 * du CHANTIER de la ligne plutôt que `entry.function`. Volontairement PAS généricisé dans
 * `staffingPeriodBuckets` lui-même (qui reste inchangé, toujours utilisé tel quel par le mode
 * "period" ci-dessous) : sa forme de sortie (`byFunction`) est nommée pour l'équipe, la renommer en
 * un nom neutre aurait cassé sa lisibilité pour son unique usage restant sans gagner grand-chose —
 * un peu de duplication ciblée plutôt que de génériciser une fonction partagée testée
 * (`lib/__tests__/axisLogic.test.ts`) pour un seul appelant interne à ce fichier.
 *
 * Round 24 : `ChantierStaffing.axisId` a été supprimé (dénormalisation retirée avec le passage de
 * `Chantier.axisId` à `Chantier.axisIds[]`) — la correspondance ligne de staffing → axe(s) se fait
 * désormais en rejoignant par `entry.chantierId` dans `axisIdsByChantier` (fourni par l'appelant,
 * voir `EffectifsPageClient.tsx`). Un chantier appartenant à PLUSIEURS axes voit sa ligne de
 * staffing comptée EN ENTIER sous CHAQUE axe (`bucket.byGroup[axisId]`, une fois par axe, même
 * principe de visibilité complète que le donut budgétaire) — mais `bucket.totalFte` n'est
 * incrémenté qu'UNE SEULE FOIS par ligne, hors de la boucle par axe, pour ne jamais gonfler le
 * total période. Une ligne dont le chantier est introuvable (référence orpheline) ou sans axe
 * connu n'alimente aucun `byGroup` mais compte tout de même dans `totalFte`. */
function axisPeriodBuckets(
  entries: ChantierStaffing[],
  granularity: Granularity,
  axisIdsByChantier: Record<string, string[]>
): UnifiedBucket[] {
  const byPeriod = new Map<string, UnifiedBucket>();
  for (const entry of entries) {
    if (!entry.startDate) continue;
    const period = periodLabelForDate(entry.startDate, granularity);
    let bucket = byPeriod.get(period);
    if (!bucket) {
      bucket = { period, totalFte: 0, byGroup: {} };
      byPeriod.set(period, bucket);
    }
    bucket.totalFte += entry.fte;
    const axisIds = axisIdsByChantier[entry.chantierId] ?? [];
    for (const axisId of axisIds) {
      bucket.byGroup[axisId] = (bucket.byGroup[axisId] ?? 0) + entry.fte;
    }
  }
  return Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Répartition des ETP mobilisés PAR PÉRIODE (trimestre / semestre / année), pilotée par
 * `staffingPeriodBuckets`/`axisPeriodBuckets` (lib/axisLogic.ts + helper local ci-dessus).
 *
 * Round 22 (PO : fusion des deux graphiques ETP de la page « Effectifs & budget », le second —
 * « Répartition par axe » — n'ayant aucune dimension temporelle et ne réagissant donc JAMAIS au
 * toggle trimestre/semestre/année tant qu'aucune période n'était épinglée) : cette carte absorbe
 * désormais CE QUI ÉTAIT la carte séparée « Répartition par axe » d'`EffectifsPageClient.tsx`,
 * retirée. Un toggle "Période" / "Axe" (`mode`, état local — pas besoin d'être piloté par le
 * parent, rien d'autre sur la page n'en dépend) choisit la clé d'empilement des barres, mais
 * **l'abscisse reste TOUJOURS la période, dans les deux modes** : c'est le correctif concret du bug
 * remonté par le PO, la vue "Axe" bouge désormais elle aussi quand on change la granularité.
 *
 * Toutes les interactions de cross-filtering qui vivaient sur `EffectifsPageClient.tsx` (équipe
 * sélectionnée, chantier sélectionné, période épinglée, granularité) sont désormais un état
 * PUREMENT LOCAL à ce composant — rien d'autre sur la page n'en a plus besoin une fois la carte
 * « Répartition par axe » retirée, plus la peine de les lever au parent.
 *
 * - Équipe/chantier sélectionnés PRÉ-FILTRENT les données du mode "axis" (voir
 *   `axisFilteredStaffing`) : sélectionner une équipe puis basculer en "Axe" montre la répartition
 *   de CETTE équipe entre les axes, dans le temps. Le mode "period" reste lui INCHANGÉ par ce
 *   filtre (toutes les équipes toujours affichées, simplement estompées — comportement historique).
 * - La rangée de chips "Chantiers :" (round 21, auparavant sur `EffectifsPageClient.tsx`) vit
 *   maintenant ici, visible dans les deux modes dès qu'une équipe est sélectionnée.
 * - Épingler une période (clic sur son libellé) fait apparaître un panneau de détail PERSISTANT
 *   sous le graphique (round 22, demande PO : le détail par chantier n'était visible qu'au survol)
 *   — additif, l'info-bulle au survol reste inchangée par ailleurs.
 * - Le sous-titre est désormais dynamique (round 22, PO : "ça représente quoi le nombre d'ETP dans
 *   la répartition par axe ?") : il précise explicitement le regroupement (équipe/axe) et le
 *   périmètre temporel (toute la période / une période épinglée).
 *
 * `chantierBreakdownByPeriod` généralise l'ancien `chantierBreakdownByPeriodFn` (clé = équipe) à
 * une clé de groupe quelconque (équipe OU id d'axe selon `mode`) — reconstruit depuis les lignes
 * `ChantierStaffing` brutes (jamais depuis les buckets, qui n'agrègent que par groupe, sans
 * granularité chantier), filtré par `axisFilteredStaffing` en mode "axis" pour rester cohérent avec
 * ce que le graphique affiche réellement dans ce mode.
 */
export function StaffingPeriodBreakdown({
  staffing,
  fteByDept,
  axes,
  chantierNamesById = {},
  axisIdsByChantier = {},
}: {
  staffing: ChantierStaffing[];
  /** Disponible réel par équipe (base ETP entreprise, live). */
  fteByDept: Record<string, number>;
  /** Axes du programme — mode "axis" : groupe les barres par axe (nom + `StrategicAxis.color`) au
   *  lieu d'équipe. */
  axes: StrategicAxis[];
  /** `Chantier.id` → nom, pour le détail par chantier du tooltip/panneau épinglé — construit par
   *  l'appelant. Optionnel : un chantier absent de la map retombe sur `effectifs.chantierUnknown`. */
  chantierNamesById?: Record<string, string>;
  /** `Chantier.id` → `Chantier.axisIds`, round 24 — remplace l'ancien `ChantierStaffing.axisId`
   *  dénormalisé (supprimé) pour le mode "axis" : construit par l'appelant, typiquement
   *  `Object.fromEntries(chantiers.map(c => [c.id, c.axisIds]))`. Optionnel : un chantier absent de
   *  la map (référence orpheline) n'alimente aucun groupe en mode "axis", même parti pris défensif
   *  que `chantierNamesById`. */
  axisIdsByChantier?: Record<string, string[]>;
}) {
  const { t } = useTranslation();

  const [mode, setMode] = useState<ViewMode>("period");
  const [granularity, setGranularity] = useState<Granularity>("quarterly");
  const [selectedFunction, setSelectedFunctionState] = useState<string | null>(null);
  const [selectedChantierId, setSelectedChantierId] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  /** Groupe actuellement survolé (segment de barre OU entrée de légende) — clé d'équipe ou d'axe
   *  selon `mode`. Distinct de `selectedFunction` (le clic, qui filtre le mode "axis") : le tooltip
   *  privilégie le survol, et ne retombe sur `selectedFunction` qu'en mode "period" (une équipe
   *  sélectionnée n'a pas de sens comme "groupe survolé" en mode "axis", dont les groupes sont des
   *  axes). */
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);

  /** Sélectionne (ou désélectionne) une équipe. Contrairement à l'ancien `selectFunction` de
   *  `EffectifsPageClient.tsx` (qui ne purgeait `selectedChantierId` que sur désélection complète),
   *  TOUT changement d'équipe purge le chantier sélectionné — un chantier reste scopé à UNE équipe
   *  (voir `chantiersForSelectedFunction`), il ne doit donc jamais survivre à un changement
   *  d'équipe, y compris vers une autre équipe non nulle. */
  const selectFunction = (fn: string | null) => {
    setSelectedFunctionState(fn);
    setSelectedChantierId(null);
  };

  const undatedCount = useMemo(() => staffing.filter((e) => !e.startDate).length, [staffing]);

  /** Disponible total tous équipes confondues (base ETP entreprise) — dénominateur du %
   *  d'utilisation, pertinent uniquement en mode "period" (voir plus bas : diviser le sous-total
   *  d'UNE équipe ou d'UN axe filtré par la capacité de TOUTE l'entreprise n'aurait pas de sens
   *  lisible, donc le % n'est affiché qu'en mode "period", jamais filtré). */
  const totalAvailable = useMemo(
    () => Object.values(fteByDept).reduce((sum, v) => sum + v, 0),
    [fteByDept]
  );
  const pctUtilizedFor = (total: number): number | null =>
    totalAvailable > 0 ? Math.round((total / totalAvailable) * 100) : null;

  // ── Mode "period" (équipe) — inchangé, `staffingPeriodBuckets` jamais filtré. ────────────────
  const teamBuckets = useMemo(
    () => staffingPeriodBuckets(staffing, granularity),
    [staffing, granularity]
  );
  const teamNames = useMemo(() => {
    const names = new Set<string>();
    for (const bucket of teamBuckets)
      for (const fn of Object.keys(bucket.byFunction)) names.add(fn);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [teamBuckets]);

  // ── Mode "axis" — pré-filtré par équipe/chantier sélectionnés (round 22, cross-filtering). ────
  const axisFilteredStaffing = useMemo(() => {
    let base = staffing;
    if (selectedFunction) base = base.filter((e) => e.function === selectedFunction);
    if (selectedChantierId) base = base.filter((e) => e.chantierId === selectedChantierId);
    return base;
  }, [staffing, selectedFunction, selectedChantierId]);

  const axisBuckets = useMemo(
    () => axisPeriodBuckets(axisFilteredStaffing, granularity, axisIdsByChantier),
    [axisFilteredStaffing, granularity, axisIdsByChantier]
  );

  /** Axes présents dans `axisBuckets`, dans l'ordre du programme (`axes`), plus les orphelins (id
   *  d'axe qui ne correspond plus à aucun axe existant) en fin de liste — même convention que
   *  l'ex-`byAxis` d'`EffectifsPageClient.tsx`. */
  const orderedAxisIds = useMemo(() => {
    const present = new Set<string>();
    for (const bucket of axisBuckets) for (const id of Object.keys(bucket.byGroup)) present.add(id);
    const known = axes.map((a) => a.id).filter((id) => present.has(id));
    const orphanIds = Array.from(present).filter((id) => !axes.some((a) => a.id === id));
    return [...known, ...orphanIds];
  }, [axes, axisBuckets]);

  // ── Vue unifiée : mêmes buckets/séries quel que soit `mode`, pour n'écrire qu'une fois le
  //    graphique/tooltip/panneau épinglé ci-dessous. ───────────────────────────────────────────
  const activeBuckets: UnifiedBucket[] = useMemo(() => {
    if (mode === "axis") return axisBuckets;
    return teamBuckets.map((b) => ({
      period: b.period,
      totalFte: b.totalFte,
      byGroup: b.byFunction,
    }));
  }, [mode, axisBuckets, teamBuckets]);

  const series: SeriesDef[] = useMemo(() => {
    if (mode === "axis") {
      return orderedAxisIds.map((id) => ({
        key: id,
        name: findAxisName(axes, t, id),
        color: findAxisColor(axes, id),
      }));
    }
    return teamNames.map((fn) => ({ key: fn, name: fn, color: hexForDepartment(fn) }));
  }, [mode, orderedAxisIds, teamNames, axes, t]);

  const chartData = useMemo(
    () =>
      activeBuckets.map((bucket) => {
        const row: Record<string, string | number> = { period: bucket.period };
        for (const s of series) row[s.key] = bucket.byGroup[s.key] ?? 0;
        return row;
      }),
    [activeBuckets, series]
  );

  /** Détail par chantier, par (période, groupe) — round 20 (mode "period") généralisé round 22 au
   *  mode "axis" (groupe = axe(s) du chantier). Filtré sur `axisFilteredStaffing` en mode "axis"
   *  pour rester cohérent avec les groupes/totaux réellement affichés dans ce mode.
   *
   *  Round 24 : en mode "axis", une ligne est désormais répartie sur CHAQUE axe de son chantier
   *  (`axisIdsByChantier`, voir `axisPeriodBuckets` ci-dessus) plutôt que sur un `entry.axisId`
   *  unique — même principe de visibilité complète par axe. */
  const chantierBreakdownByPeriod = useMemo(() => {
    const map = new Map<string, Map<string, Map<string, number>>>();
    const source = mode === "axis" ? axisFilteredStaffing : staffing;
    for (const entry of source) {
      if (!entry.startDate) continue;
      const period = periodLabelForDate(entry.startDate, granularity);
      const groupKeys =
        mode === "axis" ? (axisIdsByChantier[entry.chantierId] ?? []) : [entry.function];
      let byGroup = map.get(period);
      if (!byGroup) {
        byGroup = new Map();
        map.set(period, byGroup);
      }
      for (const groupKey of groupKeys) {
        let byChantier = byGroup.get(groupKey);
        if (!byChantier) {
          byChantier = new Map();
          byGroup.set(groupKey, byChantier);
        }
        byChantier.set(
          entry.chantierId,
          (byChantier.get(entry.chantierId) ?? 0) + (entry.fte || 0)
        );
      }
    }
    return map;
  }, [mode, staffing, axisFilteredStaffing, granularity, axisIdsByChantier]);

  /** Chantiers de l'équipe sélectionnée (round 21, déplacé ici round 22) — alimente la rangée de
   *  chips "Chantiers :", visible dans les deux modes. Volontairement basée sur `staffing` COMPLET
   *  (pas `axisFilteredStaffing` ni une période épinglée) : la liste proposée ne doit pas se réduire
   *  quand on épingle une période ou sélectionne déjà un chantier, seule l'équipe la borne. */
  const chantiersForSelectedFunction = useMemo(() => {
    if (!selectedFunction) return [];
    const totals = new Map<string, number>();
    for (const e of staffing) {
      if (e.function !== selectedFunction) continue;
      totals.set(e.chantierId, (totals.get(e.chantierId) ?? 0) + (e.fte || 0));
    }
    return Array.from(totals.entries())
      .map(([chantierId, fte]) => ({
        chantierId,
        name: chantierNamesById[chantierId] ?? t("effectifs.chantierUnknown"),
        fte,
      }))
      .sort((a, b) => b.fte - a.fte);
  }, [staffing, selectedFunction, chantierNamesById, t]);

  /** Lignes "une par série visible" (valeur > 0) — factorisé pour être identique entre l'info-bulle
   *  au survol et le panneau de détail épinglé (round 22), qui ne doivent jamais diverger. */
  function renderGroupRows(bucket: UnifiedBucket) {
    return series
      .filter((s) => (bucket.byGroup[s.key] ?? 0) > 0)
      .map((s) => (
        <p key={s.key} className="flex items-center justify-between gap-3 text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
          <span className="ml-2 font-semibold text-primary">
            {formatFte(bucket.byGroup[s.key] ?? 0)} {t("staffing.fteUnit")}
          </span>
        </p>
      ));
  }

  /** Détail par chantier pour (période, groupe actif) — même factorisation que `renderGroupRows`
   *  ci-dessus, réutilisée par l'info-bulle ET le panneau épinglé. */
  function renderChantierRows(period: string, activeGroup: string | null) {
    if (!activeGroup) return null;
    const entries = Array.from(chantierBreakdownByPeriod.get(period)?.get(activeGroup) ?? []).sort(
      (a, b) => b[1] - a[1]
    );
    if (entries.length === 0) return null;
    const groupLabel = mode === "axis" ? findAxisName(axes, t, activeGroup) : activeGroup;
    return (
      <div className="mt-1 border-t border-border pt-1">
        <p className="mb-0.5 font-semibold text-tertiary">
          {t("staffingPeriod.byChantier")} {groupLabel}
        </p>
        {entries.map(([chantierId, fte]) => (
          <p key={chantierId} className="flex items-center justify-between gap-3 text-tertiary">
            <span>{chantierNamesById[chantierId] ?? t("effectifs.chantierUnknown")}</span>
            <span className="ml-2 font-semibold text-secondary">
              {formatFte(fte)} {t("staffing.fteUnit")}
            </span>
          </p>
        ))}
      </div>
    );
  }

  return (
    <Card className="mb-0">
      <CardHeader
        title={t("staffingPeriod.title")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selectedFunction && (
              <Button variant="ghost" size="sm" onClick={() => selectFunction(null)}>
                {t("effectifs.allFunctions")}
              </Button>
            )}
            {/* Toggle "Période" / "Axe" (round 22) — même look que le toggle de granularité
                ci-dessous, groupés visuellement comme un seul système de sélection. */}
            <div className="flex overflow-hidden rounded-md border border-border">
              {(["period", "axis"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition ${
                    mode === m
                      ? "bg-black text-white"
                      : "bg-white text-secondary hover:text-primary"
                  }`}
                >
                  {t(`staffingPeriod.mode.${m}`)}
                </button>
              ))}
            </div>
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
        {/* Sous-titre dynamique (round 22, PO : "ça représente quoi le nombre d'ETP dans la
            répartition par axe ?") — précise le regroupement (équipe/axe) ET le périmètre temporel
            (toute la période / une période épinglée), reconstruit à chaque changement de `mode` ou
            `selectedPeriod`. */}
        <p className="mb-3 text-xs text-tertiary">
          {t("staffingPeriod.subtitle")
            .replace(
              "{mode}",
              mode === "axis"
                ? t("staffingPeriod.subtitle.modeAxis")
                : t("staffingPeriod.subtitle.modeTeam")
            )
            .replace(
              "{scope}",
              selectedPeriod
                ? t("staffingPeriod.subtitle.scopePeriod").replace("{period}", selectedPeriod)
                : t("staffingPeriod.subtitle.scopeAll")
            )}
        </p>

        {/* Chips "Filtré sur"/"Période" (round 20-21, déplacées ici round 22 — la carte "Répartition
            par axe" qu'elles reliaient visuellement a disparu, fusionnée dans cette même carte). */}
        {(selectedFunction || selectedPeriod) && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {selectedFunction && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-[12px] font-semibold text-primary">
                {t("effectifs.filteredOn").replace("{fn}", selectedFunction)}
                <button
                  type="button"
                  aria-label={t("effectifs.allFunctions")}
                  onClick={() => selectFunction(null)}
                  className="flex items-center justify-center rounded-full p-0.5 text-secondary transition hover:bg-neutral-200 hover:text-primary"
                >
                  <X size={12} />
                </button>
              </span>
            )}
            {selectedPeriod && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-[12px] font-semibold text-primary">
                {t("effectifs.filteredOnPeriod").replace("{period}", selectedPeriod)}
                <button
                  type="button"
                  aria-label={t("effectifs.filteredOnPeriod").replace("{period}", selectedPeriod)}
                  onClick={() => setSelectedPeriod(null)}
                  className="flex items-center justify-center rounded-full p-0.5 text-secondary transition hover:bg-neutral-200 hover:text-primary"
                >
                  <X size={12} />
                </button>
              </span>
            )}
          </div>
        )}

        {/* Chips "Chantiers :" (round 21, déplacées depuis `EffectifsPageClient.tsx` round 22) —
            visibles dans les deux modes dès qu'une équipe est sélectionnée. */}
        {selectedFunction && chantiersForSelectedFunction.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] font-semibold text-secondary">
              {t("effectifs.byChantierLabel")} :
            </span>
            {chantiersForSelectedFunction.map((row) => {
              const isSelected = selectedChantierId === row.chantierId;
              return (
                <button
                  key={row.chantierId}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => setSelectedChantierId(isSelected ? null : row.chantierId)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                    isSelected
                      ? "bg-black text-white"
                      : "bg-neutral-100 text-primary hover:bg-neutral-200"
                  }`}
                >
                  {row.name}
                  <span className={isSelected ? "text-white/70" : "text-tertiary"}>
                    {formatFte(row.fte)} {t("staffing.fteUnit")}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {activeBuckets.length === 0 ? (
          <p className="text-sm text-text-secondary">{t("staffingPeriod.empty")}</p>
        ) : (
          <>
            {/* % d'utilisation (mode "period" uniquement, voir doc-comment de `totalAvailable`) ou
                total ETP (mode "axis") au-dessus du graphique, par période — cliquable pour épingler
                (round 21). */}
            <div className="mb-2 flex flex-wrap gap-2">
              {activeBuckets.map((bucket) => {
                const pct = mode === "period" ? pctUtilizedFor(bucket.totalFte) : null;
                const isSelected = selectedPeriod === bucket.period;
                return (
                  <button
                    key={bucket.period}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedPeriod(isSelected ? null : bucket.period)}
                    className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                      isSelected
                        ? "bg-black text-white"
                        : "bg-neutral-100 text-secondary hover:text-primary"
                    }`}
                  >
                    {bucket.period}
                    {" · "}
                    {mode === "period"
                      ? pct !== null
                        ? t("staffingPeriod.utilization").replace("{pct}", String(pct))
                        : "—"
                      : `${formatFte(bucket.totalFte)} ${t("staffing.fteUnit")}`}
                  </button>
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
                    const period = String(label);
                    const bucket = activeBuckets.find((b) => b.period === period);
                    if (!bucket) return null;
                    const pctUtilized = mode === "period" ? pctUtilizedFor(bucket.totalFte) : null;
                    const activeGroup =
                      hoveredGroup ?? (mode === "period" ? selectedFunction : null);
                    return (
                      <div className="rounded-md border border-border bg-white px-3 py-2 text-[12px] shadow-sm">
                        <p className="mb-1 font-bold text-primary">{period}</p>
                        {renderGroupRows(bucket)}
                        <p className="mt-1 border-t border-border pt-1 font-bold text-primary">
                          {formatFte(bucket.totalFte)} {t("staffing.fteUnit")}
                          {pctUtilized !== null &&
                            ` · ${t("staffingPeriod.utilization").replace("{pct}", String(pctUtilized))}`}
                        </p>
                        {renderChantierRows(period, activeGroup)}
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
                    cursor: mode === "period" ? "pointer" : undefined,
                  }}
                  onClick={(entry) => {
                    if (mode !== "period") return;
                    const fn = typeof entry?.value === "string" ? entry.value : undefined;
                    if (!fn) return;
                    selectFunction(selectedFunction === fn ? null : fn);
                  }}
                  onMouseEnter={(entry) => {
                    const key = typeof entry?.value === "string" ? entry.value : undefined;
                    if (key) setHoveredGroup(key);
                  }}
                  onMouseLeave={() => setHoveredGroup(null)}
                  formatter={(value) => {
                    const key = String(value);
                    const displayName = mode === "axis" ? findAxisName(axes, t, key) : key;
                    return (
                      <span
                        style={{
                          fontWeight: mode === "period" && selectedFunction === key ? 700 : 400,
                        }}
                        className="text-primary"
                      >
                        {displayName}
                      </span>
                    );
                  }}
                />
                {series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.key}
                    stackId="etp"
                    fill={s.color}
                    fillOpacity={
                      mode === "period" && selectedFunction && selectedFunction !== s.key ? 0.35 : 1
                    }
                    cursor={mode === "period" ? "pointer" : undefined}
                    onClick={() => {
                      if (mode === "period")
                        selectFunction(selectedFunction === s.key ? null : s.key);
                    }}
                    onMouseEnter={() => setHoveredGroup(s.key)}
                    onMouseLeave={() => setHoveredGroup(null)}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>

            {/* Panneau de détail PERSISTANT pour la période épinglée (round 22, demande PO) —
                additif : l'info-bulle au survol ci-dessus reste inchangée. Bucket synthétique à 0
                si la période épinglée n'a plus de correspondance dans le mode/filtre courant (ex.
                période épinglée en mode "period" sans aucune donnée pour l'équipe sélectionnée en
                mode "axis") plutôt que de masquer silencieusement le panneau. */}
            {selectedPeriod &&
              (() => {
                const bucket: UnifiedBucket =
                  activeBuckets.find((b) => b.period === selectedPeriod) ??
                  ({ period: selectedPeriod, totalFte: 0, byGroup: {} } satisfies UnifiedBucket);
                const pct = mode === "period" ? pctUtilizedFor(bucket.totalFte) : null;
                const activeGroup = hoveredGroup ?? (mode === "period" ? selectedFunction : null);
                return (
                  <div className="mt-3 rounded-md border border-border bg-neutral-50 p-3 text-[12px]">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="font-bold text-primary">
                        {t("staffingPeriod.pinnedDetail.title").replace("{period}", selectedPeriod)}
                      </p>
                      <button
                        type="button"
                        aria-label={t("effectifs.filteredOnPeriod").replace(
                          "{period}",
                          selectedPeriod
                        )}
                        onClick={() => setSelectedPeriod(null)}
                        className="flex items-center justify-center rounded-full p-0.5 text-secondary transition hover:bg-neutral-200 hover:text-primary"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    {renderGroupRows(bucket)}
                    <p className="mt-1 border-t border-border pt-1 font-bold text-primary">
                      {formatFte(bucket.totalFte)} {t("staffing.fteUnit")}
                      {pct !== null &&
                        ` · ${t("staffingPeriod.utilization").replace("{pct}", String(pct))}`}
                    </p>
                    {renderChantierRows(selectedPeriod, activeGroup)}
                  </div>
                );
              })()}
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
