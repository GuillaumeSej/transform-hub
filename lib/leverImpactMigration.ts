import type { Lever, LeverImpact } from "@/types";

/** Migration pure "impacts d'action → impacts de levier" : remonte chaque ligne de
 *  `action.impacts` dans `lever.impacts` (dédoublonnage par id, tous les champs conservés :
 *  hierarchyLeafId, pnlMap, dates...), puis vide `action.impacts`. Idempotente : un levier déjà
 *  migré (aucune action ne porte d'impact) est retourné TEL QUEL (même référence). Ne supprime
 *  jamais de donnée — un impact déjà présent au niveau levier avec le même id est conservé. */
export function migrateLeverImpacts(lever: Lever): Lever {
  const actions = lever.actions ?? [];
  if (!actions.some((a) => (a.impacts?.length ?? 0) > 0)) return lever;

  const impacts: LeverImpact[] = [...(lever.impacts ?? [])];
  const seen = new Set(impacts.map((i) => i.id));
  for (const action of actions) {
    for (const imp of action.impacts ?? []) {
      if (seen.has(imp.id)) continue;
      seen.add(imp.id);
      impacts.push(imp);
    }
  }
  return {
    ...lever,
    impacts,
    actions: actions.map((a) => {
      if (!a.impacts) return a;
      const { impacts: _dropped, ...rest } = a;
      void _dropped;
      return rest;
    }),
  };
}

export function migrateLeversImpacts(levers: Lever[]): Lever[] {
  let changed = false;
  const out = levers.map((l) => {
    const m = migrateLeverImpacts(l);
    if (m !== l) changed = true;
    return m;
  });
  return changed ? out : levers;
}
