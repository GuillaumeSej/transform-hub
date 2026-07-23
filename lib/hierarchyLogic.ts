import type { HierarchyLevelDef, HierarchyNode } from "@/types";

export type HierarchyPathEntry = {
  levelKey: string;
  label: string;
  code: string;
};

/**
 * Remonte la chaîne `parentId` d'un `HierarchyNode` (maille la plus fine, ex. Cost Center)
 * jusqu'à la racine (le niveau le plus macro), et retourne le chemin complet ordonné du plus
 * macro au plus fin — un élément par niveau réellement présent dans la chaîne.
 *
 * Retourne un tableau vide si `leafId` est introuvable dans `nodes` (id inconnu, ou nodes pas
 * encore chargés) — jamais d'exception, pour rester utilisable directement dans le rendu.
 *
 * `levels` sert à ordonner le résultat de façon fiable (par `HierarchyLevelDef.order`) plutôt que
 * de se fier uniquement à l'ordre de remontée des `parentId`, qui pourrait être corrompu par une
 * saisie manuelle erronée (ex. parentId pointant vers un nœud du même niveau).
 */
export function resolveHierarchyPath(
  leafId: string,
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): HierarchyPathEntry[] {
  if (!leafId) return [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const leaf = nodeById.get(leafId);
  if (!leaf) return [];

  const chain: HierarchyNode[] = [];
  const visited = new Set<string>();
  let current: HierarchyNode | undefined = leaf;
  while (current) {
    if (visited.has(current.id)) break; // garde-fou anti-cycle (parentId mal configuré)
    visited.add(current.id);
    chain.push(current);
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }

  const orderByKey = new Map(levels.map((l) => [l.key, l.order]));
  chain.sort((a, b) => (orderByKey.get(a.levelKey) ?? 0) - (orderByKey.get(b.levelKey) ?? 0));

  return chain.map((n) => ({ levelKey: n.levelKey, label: n.label, code: n.code }));
}
