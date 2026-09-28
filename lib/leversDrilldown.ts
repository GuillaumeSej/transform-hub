/**
 * Drill-down du dashboard Performance vers `/levers` : traduit une dimension du builder de
 * graphiques (`lib/dashboardPivot.ts`) en paramètre de filtre `f_xxx` RÉELLEMENT présent dans la
 * barre de filtres de `LeversPagePerformance.tsx` — qui dépend des arborescences configurées :
 *   - arborescence géographique configurée → `f_geo_<niveau>` REMPLACE `f_geography`/`f_country`/
 *     `f_entity` (qui n'existent alors plus sur /levers) ;
 *   - arborescence financière configurée → `f_hierarchy_<niveau>` REMPLACE `f_pnl`.
 * Une dimension sans équivalent renvoie `undefined` : l'appelant navigue alors sans filtre
 * additionnel plutôt que de poser un paramètre ignoré (ou filtrant tout) à l'arrivée.
 */
const DIRECT: Record<string, string> = {
  function: "f_function",
  ws: "f_ws",
  owner: "f_owner",
  sponsor: "f_sponsor",
  risk: "f_risk",
  type: "f_type",
  status: "f_status",
};

const LEGACY_GEOGRAPHY: Record<string, string> = {
  geography: "f_geography",
  country: "f_country",
  entity: "f_entity",
};

/** Libellés de repli du pivot (valeur vide côté levier) : aucun levier n'a cette valeur sur
 *  /levers, filtrer dessus afficherait une liste vide. */
const PIVOT_FALLBACK_VALUES = new Set(["Non renseigné", "Global", "Non assigné"]);

export function leversFilterParamForDimension(
  dimensionKey: string,
  hierarchies: { financial: boolean; geographic: boolean }
): string | undefined {
  if (DIRECT[dimensionKey]) return DIRECT[dimensionKey];
  if (LEGACY_GEOGRAPHY[dimensionKey])
    return hierarchies.geographic ? undefined : LEGACY_GEOGRAPHY[dimensionKey];
  if (dimensionKey === "pnlAccount" || dimensionKey === "pnl")
    return hierarchies.financial ? undefined : "f_pnl";
  if (dimensionKey.startsWith("hierarchy:"))
    return hierarchies.financial
      ? `f_hierarchy_${dimensionKey.slice("hierarchy:".length)}`
      : undefined;
  return undefined;
}

/** Paramètres `/levers` pour un clic sur la valeur `value` de la dimension `dimensionKey`. */
export function leversDrilldownParams(
  dimensionKey: string,
  value: string,
  hierarchies: { financial: boolean; geographic: boolean }
): Record<string, string> {
  const param = leversFilterParamForDimension(dimensionKey, hierarchies);
  if (!param || !value || PIVOT_FALLBACK_VALUES.has(value)) return {};
  return { [param]: value };
}
