import type { HierarchyDomain, HierarchyLevelDef, HierarchyNode, PnlAccount } from "@/types";

export type HierarchyPathEntry = {
  levelKey: string;
  label: string;
  code: string;
};

export type HierarchyTreeNode = HierarchyNode & { children: HierarchyTreeNode[] };

export type HierarchyNodeDraft = {
  code: string;
  label: string;
  parentId: string;
  baseline: string;
  sign: "1" | "-1";
  selectable: boolean;
};

export function buildHierarchyNodePayload({
  id,
  companyId,
  domain,
  level,
  draft,
}: {
  id: string;
  companyId: string;
  domain: HierarchyDomain;
  level: HierarchyLevelDef;
  draft: HierarchyNodeDraft;
}): HierarchyNode | null {
  const code = draft.code.trim();
  const label = draft.label.trim();
  const isRoot = level.order === 0;
  if (!code || !label || (!isRoot && !draft.parentId)) return null;

  const node: HierarchyNode = {
    id,
    companyId,
    domain,
    levelKey: level.key,
    code,
    label,
    parentId: isRoot ? null : draft.parentId,
  };
  if (level.semantic === "pnl") {
    const baseline = Number(draft.baseline || 0);
    if (!Number.isFinite(baseline)) return null;
    node.financial = {
      baseline,
      sign: draft.sign === "-1" ? -1 : 1,
      selectable: draft.selectable !== false,
    };
  }
  return node;
}

export function hierarchyDomain(node: HierarchyNode): HierarchyDomain {
  return node.domain ?? "financial";
}

export function nodesForDomain(nodes: HierarchyNode[], domain: HierarchyDomain): HierarchyNode[] {
  return nodes.filter((node) => hierarchyDomain(node) === domain);
}

/** Construit une forêt stable, utilisable aussi bien par l'aperçu UI que par les tests. */
export function buildHierarchyForest(
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): HierarchyTreeNode[] {
  const orderByLevel = new Map(levels.map((level) => [level.key, level.order]));
  const sorted = [...nodes].sort(
    (a, b) =>
      (orderByLevel.get(a.levelKey) ?? 999) - (orderByLevel.get(b.levelKey) ?? 999) ||
      a.label.localeCompare(b.label, "fr")
  );
  const byId = new Map<string, HierarchyTreeNode>();
  sorted.forEach((node) => byId.set(node.id, { ...node, children: [] }));
  const roots: HierarchyTreeNode[] = [];
  sorted.forEach((node) => {
    const treeNode = byId.get(node.id)!;
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent && parent.id !== treeNode.id) parent.children.push(treeNode);
    else roots.push(treeNode);
  });
  return roots;
}

export function derivePnlAccounts(
  levels: HierarchyLevelDef[],
  nodes: HierarchyNode[],
  fallback: PnlAccount[],
  referencedAccountIds: string[] = []
): PnlAccount[] {
  const pnlLevel = levels.find((level) => level.semantic === "pnl");
  if (!pnlLevel) return fallback;
  const accounts = nodes
    .filter((node) => node.levelKey === pnlLevel.key)
    .map((node) => ({
      id: node.code,
      name: node.label,
      baseline: node.financial?.baseline ?? 0,
      sign: node.financial?.sign ?? (1 as const),
      computed: node.financial?.computed ?? false,
      selectable: node.financial?.selectable ?? !node.financial?.computed,
    }));
  if (accounts.length === 0) return fallback;
  const configuredIds = new Set(accounts.map((account) => account.id));
  const referencedIds = new Set(referencedAccountIds.filter(Boolean));
  return [
    ...accounts,
    ...fallback.filter(
      (account) => referencedIds.has(account.id) && !configuredIds.has(account.id)
    ),
  ];
}

export function hierarchyPathValue(
  leafId: string | undefined,
  semantic: HierarchyLevelDef["semantic"],
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): string | undefined {
  if (!leafId || !semantic) return undefined;
  const level = levels.find((item) => item.semantic === semantic);
  return resolveHierarchyPath(leafId, nodes, levels).find((entry) => entry.levelKey === level?.key)
    ?.label;
}

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
