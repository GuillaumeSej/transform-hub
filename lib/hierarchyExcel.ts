import type { HierarchyLevelDef, HierarchyNode } from "@/types";

/**
 * Import/export Excel de l'arborescence financière (P&L -> maille la plus fine), utilisé par
 * `HierarchyEditor` pour construire en masse un arbre profond (3+ niveaux, nombreux nœuds par
 * niveau) sans passer par le formulaire nœud-par-nœud.
 *
 * Format retenu : une ligne par nœud, colonnes explicites `Niveau` / `Code` / `Libellé` /
 * `Code parent` — plutôt qu'une colonne par niveau configuré. Ce choix est délibéré : une colonne
 * par niveau casserait silencieusement dès qu'un niveau est renommé/réordonné/ajouté après coup
 * (l'en-tête ne correspondrait plus), alors que le format ligne-par-ligne reste valide tant que
 * `Niveau` matche un des `HierarchyLevelDef` configurés — et il permet de valider/rapporter les
 * erreurs ligne par ligne, comme `lib/hrExcel.ts` le fait déjà pour la base ETP.
 *
 * `Niveau` peut contenir soit le libellé (`level.label`, ex. "Business Unit"), soit la clé stable
 * (`level.key`, ex. "business_unit") — comparaison insensible à la casse.
 * `Code parent` doit être vide pour le niveau macro (order 0), et doit référencer un `code`
 * existant (déjà en base OU créé plus haut dans le même import) du niveau immédiatement parent
 * pour tout autre niveau. Les lignes sont traitées niveau par niveau, du plus macro au plus fin,
 * indépendamment de leur ordre dans le fichier — un utilisateur qui remplit les onglets/lignes
 * dans le désordre n'est donc pas pénalisé.
 */

export const HIERARCHY_EXCEL_HEADERS = ["Niveau", "Code", "Libellé", "Code parent"] as const;

export type HierarchyImportError = { rowNumber: number; reason: string };

export type HierarchyImportPreview = {
  toCreate: HierarchyNode[];
  errors: HierarchyImportError[];
};

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/** Génère un id de nœud unique au sein d'un même import (compteur `seq` fourni par l'appelant). */
function makeNodeId(seq: number): string {
  return `HN-${Date.now()}-${seq}`;
}

export function hierarchyNodeToExcelRow(
  node: HierarchyNode,
  levels: HierarchyLevelDef[],
  nodesById: Map<string, HierarchyNode>
): Record<string, string> {
  const level = levels.find((l) => l.key === node.levelKey);
  const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
  return {
    Niveau: level?.label ?? node.levelKey,
    Code: node.code,
    Libellé: node.label,
    "Code parent": parent?.code ?? "",
  };
}

/**
 * Valide un lot de lignes brutes (issues de `XLSX.utils.sheet_to_json`) contre les niveaux
 * configurés et les nœuds déjà existants, et produit un aperçu (nœuds prêts à créer + erreurs
 * ligne par ligne) sans rien écrire — mêmes conventions que `parseEmployeeRow`/`parseMovementRow`
 * dans `lib/hrExcel.ts` (aperçu avant confirmation).
 */
export function validateHierarchyImportRows(
  rawRows: Record<string, unknown>[],
  levels: HierarchyLevelDef[],
  existingNodes: HierarchyNode[],
  companyId: string
): HierarchyImportPreview {
  const errors: HierarchyImportError[] = [];
  const sortedLevels = [...levels].sort((a, b) => a.order - b.order);

  const levelByLabelOrKey = new Map<string, HierarchyLevelDef>();
  for (const l of sortedLevels) {
    levelByLabelOrKey.set(l.key.toLowerCase(), l);
    levelByLabelOrKey.set(l.label.toLowerCase(), l);
  }

  type ParsedRow = {
    rowNumber: number;
    level: HierarchyLevelDef;
    code: string;
    label: string;
    parentCode: string;
  };
  const parsed: ParsedRow[] = [];

  rawRows.forEach((row, i) => {
    const rowNumber = i + 2; // ligne 1 = en-têtes
    const levelRaw = str(row["Niveau"]);
    const code = str(row["Code"]);
    const label = str(row["Libellé"]);
    const parentCode = str(row["Code parent"]);

    if (!levelRaw && !code && !label && !parentCode) return; // ligne vide, ignorée silencieusement

    const level = levelByLabelOrKey.get(levelRaw.toLowerCase());
    if (!level) {
      errors.push({
        rowNumber,
        reason: `Niveau "${levelRaw}" non configuré pour cette entreprise`,
      });
      return;
    }
    if (!code || !label) {
      errors.push({ rowNumber, reason: `"Code" et "Libellé" sont obligatoires` });
      return;
    }
    parsed.push({ rowNumber, level, code, label, parentCode });
  });

  // code(minuscule) -> nœud, par niveau : préchargé avec l'existant, complété au fil du traitement
  // (macro d'abord) pour que les niveaux plus fins puissent référencer un parent créé dans le même
  // import.
  const nodesByLevelAndCode = new Map<string, Map<string, HierarchyNode>>();
  for (const l of sortedLevels) nodesByLevelAndCode.set(l.key, new Map());
  for (const n of existingNodes) {
    nodesByLevelAndCode.get(n.levelKey)?.set(n.code.toLowerCase(), n);
  }

  // Pour détecter les doublons de code introduits PAR l'import lui-même, en distinguant du cas où
  // le code existe déjà en base (autre message d'erreur, plus explicite).
  const firstRowSeenByLevelAndCode = new Map<string, Map<string, number>>();
  for (const l of sortedLevels) firstRowSeenByLevelAndCode.set(l.key, new Map());

  const toCreate: HierarchyNode[] = [];
  let seq = 0;

  for (const l of sortedLevels) {
    const parentLevel = sortedLevels.find((pl) => pl.order === l.order - 1);
    const rowsForLevel = parsed.filter((p) => p.level.key === l.key);
    const codeMap = nodesByLevelAndCode.get(l.key)!;
    const seenMap = firstRowSeenByLevelAndCode.get(l.key)!;

    for (const p of rowsForLevel) {
      const lowerCode = p.code.toLowerCase();

      if (codeMap.has(lowerCode) && !seenMap.has(lowerCode)) {
        errors.push({
          rowNumber: p.rowNumber,
          reason: `Code "${p.code}" déjà existant pour le niveau "${l.label}"`,
        });
        continue;
      }
      if (seenMap.has(lowerCode)) {
        errors.push({
          rowNumber: p.rowNumber,
          reason: `Code "${p.code}" en doublon pour le niveau "${l.label}" (déjà utilisé ligne ${seenMap.get(lowerCode)})`,
        });
        continue;
      }

      let parentId: string | null = null;
      if (parentLevel) {
        if (!p.parentCode) {
          errors.push({
            rowNumber: p.rowNumber,
            reason: `"Code parent" obligatoire (le niveau "${l.label}" a pour parent "${parentLevel.label}")`,
          });
          continue;
        }
        const parentNode = nodesByLevelAndCode
          .get(parentLevel.key)
          ?.get(p.parentCode.toLowerCase());
        if (!parentNode) {
          errors.push({
            rowNumber: p.rowNumber,
            reason: `"Code parent" "${p.parentCode}" introuvable dans le niveau "${parentLevel.label}"`,
          });
          continue;
        }
        parentId = parentNode.id;
      } else if (p.parentCode) {
        errors.push({
          rowNumber: p.rowNumber,
          reason: `Le niveau macro "${l.label}" ne doit pas avoir de "Code parent"`,
        });
        continue;
      }

      seq += 1;
      const node: HierarchyNode = {
        id: makeNodeId(seq),
        companyId,
        levelKey: l.key,
        code: p.code,
        label: p.label,
        parentId,
      };
      toCreate.push(node);
      codeMap.set(lowerCode, node);
      seenMap.set(lowerCode, p.rowNumber);
    }
  }

  return { toCreate, errors };
}
