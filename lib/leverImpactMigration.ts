import type { Lever, LeverImpact } from "@/types";

/** Migration pure "impacts d'action → impacts de levier" : remonte chaque ligne de
 *  `action.impacts` dans `lever.impacts` (dédoublonnage par id, tous les champs conservés :
 *  hierarchyLeafId, pnlMap, dates...), puis vide `action.impacts`. Idempotente : un levier déjà
 *  migré (aucune action ne porte d'impact) est retourné TEL QUEL (même référence).
 *
 *  Levier qui porte DÉJÀ ses propres impacts : ce sont eux qui font foi (modèle actuel), les
 *  impacts restés sur les actions sont d'anciens doublons (ex. ACME COM-001, DIG-001, SC-002,
 *  ORG-003, SC-003 : business case « SEED » réparti sur les actions + détail « ENR » sur le levier,
 *  pour les mêmes gains) — ils sont ÉCARTÉS au lieu d'être additionnés, sinon le net du levier
 *  doublait (audit 2026-09-24, C3), et la prochaine sauvegarde du levier persiste l'état propre. */
export function migrateLeverImpacts(lever: Lever): Lever {
  const actions = lever.actions ?? [];
  if (!actions.some((a) => (a.impacts?.length ?? 0) > 0)) return lever;

  const leverHasOwnImpacts = (lever.impacts?.length ?? 0) > 0;
  const impacts: LeverImpact[] = [...(lever.impacts ?? [])];
  const seen = new Set(impacts.map((i) => i.id));
  for (const action of leverHasOwnImpacts ? [] : actions) {
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
