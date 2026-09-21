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
      selectable: draft.selectable !== false,
    };
  }
  return node;
}

/** Dérive le signe d'un compte P&L à partir du signe de sa `baseline` : négatif = coût, positif
 *  (ou nul) = revenu. Remplace l'ancien champ `financial.sign`, redondant avec le signe de
 *  `baseline` et source d'incohérence (ex. `baseline: 500, sign: -1`). */
export function pnlAccountSign(baseline: number): 1 | -1 {
  return baseline < 0 ? -1 : 1;
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
    .map((node) => {
      const baseline = node.financial?.baseline ?? 0;
      return {
        id: node.code,
        name: node.label,
        baseline,
        sign: pnlAccountSign(baseline),
        computed: node.financial?.computed ?? false,
        selectable: node.financial?.selectable ?? !node.financial?.computed,
      };
    });
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
/** Même remontée que `resolveHierarchyPath`, mais retourne les `HierarchyNode` complets (pas
 *  seulement levelKey/label/code) — nécessaire pour piloter des sélecteurs en cascade par niveau
 *  (voir `LeverForm.tsx`, section géographie), qui ont besoin de l'id de chaque nœud du chemin
 *  pour présélectionner/filtrer les niveaux suivants. */
export function resolveHierarchyNodeChain(
  leafId: string,
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): HierarchyNode[] {
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
  return chain;
}

export function resolveHierarchyPath(
  leafId: string,
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): HierarchyPathEntry[] {
  return resolveHierarchyNodeChain(leafId, nodes, levels).map((n) => ({
    levelKey: n.levelKey,
    label: n.label,
    code: n.code,
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Niveau optionnel (`HierarchyLevelDef.optional`) — au plus un par arborescence, en général le plus
 * fin (ex. Centre de coût). `optional` absent = comportement historique (tous obligatoires).
 * ---------------------------------------------------------------------------------------------- */

function sortLevels(levels: HierarchyLevelDef[]): HierarchyLevelDef[] {
  return [...levels].sort((a, b) => a.order - b.order);
}

/** Le niveau marqué optionnel (le premier s'il y en avait plusieurs par erreur), ou undefined. */
export function optionalLevel(levels: HierarchyLevelDef[]): HierarchyLevelDef | undefined {
  return sortLevels(levels).find((l) => l.optional);
}

/** Maille "effective" : le niveau non-optionnel le plus fin — celle à utiliser pour filtrer,
 *  afficher et grouper. Sans niveau optionnel = le niveau le plus fin. Repli sur le plus fin si
 *  tous les niveaux sont (à tort) optionnels. */
export function effectiveLeafLevel(levels: HierarchyLevelDef[]): HierarchyLevelDef | undefined {
  const sorted = sortLevels(levels);
  const required = sorted.filter((l) => !l.optional);
  return required[required.length - 1] ?? sorted[sorted.length - 1];
}

/** Niveaux sélectionnables dans un sélecteur de feuille : la maille effective plus, si elle est
 *  plus fine, le niveau optionnel (ordonnés du plus fin au plus macro). */
export function leafLevels(levels: HierarchyLevelDef[]): HierarchyLevelDef[] {
  const effective = effectiveLeafLevel(levels);
  if (!effective) return [];
  const optional = optionalLevel(levels);
  return optional && optional.order > effective.order ? [optional, effective] : [effective];
}

/** Ne garde qu'un seul niveau optionnel : marque/démarque `key` et retire le flag des autres. */
export function setOptionalLevel(
  levels: HierarchyLevelDef[],
  key: string,
  optional: boolean
): HierarchyLevelDef[] {
  return levels.map((l) => {
    const next = { ...l };
    if (l.key === key && optional) next.optional = true;
    else delete next.optional;
    return next;
  });
}

/** Erreur de validation de la structure (plus d'un niveau optionnel), sinon null. */
export function validateOptionalLevels(levels: HierarchyLevelDef[]): string | null {
  return levels.filter((l) => l.optional).length > 1 ? "Un seul niveau peut être optionnel." : null;
}

/** Nœud de la maille effective correspondant à `nodeId` : l'ancêtre du niveau effectif si le nœud
 *  est plus fin (niveau optionnel), le nœud lui-même s'il est déjà au niveau effectif ou au-dessus.
 *  Un impact rattaché au niveau obligatoire seul reste donc valide. */
export function effectiveLeafNode(
  nodeId: string | undefined,
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): HierarchyNode | undefined {
  if (!nodeId) return undefined;
  const chain = resolveHierarchyNodeChain(nodeId, nodes, levels);
  if (chain.length === 0) return undefined;
  const effective = effectiveLeafLevel(levels);
  if (!effective) return chain[chain.length - 1];
  return chain.find((n) => n.levelKey === effective.key) ?? chain[chain.length - 1];
}

/** Nœuds proposés par un sélecteur de feuille (niveau optionnel + niveau effectif). */
export function selectableLeafNodes(
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): HierarchyNode[] {
  const keys = new Set(leafLevels(levels).map((l) => l.key));
  return nodes.filter((n) => keys.has(n.levelKey));
}
