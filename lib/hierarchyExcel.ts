import type { HierarchyDomain, HierarchyLevelDef, HierarchyNode } from "@/types";
import {
  canonicalizeRowKeys,
  excelRowNumber,
  isBlankCell,
  normalizeHeaderKey,
  parseCellNumber,
} from "@/lib/excelParse";
import { makeIssue, type ImportIssue } from "@/lib/importIssue";

/**
 * Import/export Excel de l'arborescence (financière ou géographique), utilisé par
 * `HierarchyEditor` pour construire/mettre à jour en masse un arbre profond sans passer par le
 * formulaire nœud-par-nœud.
 *
 * Format : une ligne par nœud, colonnes `Niveau` / `Code` / `Libellé` / `Code parent` (+ pour les
 * lignes P&L : `Baseline` / `Calculé` / `Sélectionnable`). Ce format ligne-par-ligne reste valide
 * quand un niveau est renommé/réordonné/ajouté après coup, tant que `Niveau` matche un
 * `HierarchyLevelDef` configuré (libellé OU clé, insensible à la casse et aux accents).
 *
 * Règles (audit du 24/09/2026) :
 * - En-têtes tolérants (casse/accents/espaces) ; colonnes obligatoires absentes = erreur fichier.
 * - ALLER-RETOUR : un code déjà existant pour ce niveau est une MISE À JOUR (libellé, parent,
 *   données financières modifiables depuis Excel) — ré-importer un export inchangé donne 0 erreur
 *   et 0 écriture.
 * - Cellules fusionnées = erreur explicite (elles vident toutes les cellules sauf la première).
 * - Validation COMPLÈTE avant écriture : l'appelant n'écrit rien si une erreur subsiste.
 * - `Code parent` : vide pour le niveau macro (order 0), sinon code d'un nœud (existant OU créé
 *   plus haut dans le même import) du niveau immédiatement parent. Les lignes sont traitées niveau
 *   par niveau, du plus macro au plus fin, quel que soit leur ordre dans le fichier.
 */

export const HIERARCHY_EXCEL_HEADERS = ["Niveau", "Code", "Libellé", "Code parent"] as const;
export const HIERARCHY_FINANCIAL_HEADERS = ["Baseline", "Calculé", "Sélectionnable"] as const;
const ALL_HEADERS = [...HIERARCHY_EXCEL_HEADERS, ...HIERARCHY_FINANCIAL_HEADERS] as const;

/** Modèles français des anomalies — recopiés dans fr.ts sous `adminHierarchy.issue.*`. */
export const HIERARCHY_IMPORT_ISSUES: Record<string, string> = {
  missingColumns: "Colonnes obligatoires absentes : {columns}",
  mergedCells:
    "Le fichier contient des cellules fusionnées ({ranges}) — défusionnez-les et répétez la valeur sur chaque ligne",
  unknownLevel: 'Niveau "{value}" non configuré pour cette entreprise',
  missingCodeOrLabel: '"Code" et "Libellé" sont obligatoires',
  duplicateCode: 'Code "{code}" en doublon pour le niveau "{level}" (déjà utilisé ligne {other})',
  missingParent: '"Code parent" obligatoire (le niveau "{level}" a pour parent "{parentLevel}")',
  unknownParent: '"Code parent" "{parent}" introuvable dans le niveau "{parentLevel}"',
  parentOnMacro: 'Le niveau macro "{level}" ne doit pas avoir de "Code parent"',
  invalidBaseline: 'Baseline "{value}" illisible',
  invalidBoolean: '{column} "{value}" non reconnu (attendu Oui/Non)',
  financialIgnored:
    'Données financières ignorées : le niveau "{level}" n\'est pas un niveau de lignes P&L',
};

export type HierarchyImportError = ImportIssue;

export type HierarchyImportPreview = {
  toCreate: HierarchyNode[];
  /** Nœuds existants modifiés (même id, libellé/parent/données financières mis à jour). */
  toUpdate: HierarchyNode[];
  /** Lignes identiques à l'existant (aucune écriture). */
  unchanged: number;
  errors: HierarchyImportError[];
  warnings: HierarchyImportError[];
};

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

/** Génère un id de nœud unique au sein d'un même import (compteur `seq` fourni par l'appelant). */
function makeNodeId(seq: number): string {
  return `HN-${Date.now()}-${seq}`;
}

const BOOL: Record<string, boolean> = {
  oui: true,
  yes: true,
  true: true,
  vrai: true,
  "1": true,
  x: true,
  non: false,
  no: false,
  false: false,
  faux: false,
  "0": false,
};

/** Forme comparable des données financières (défauts explicites : non calculé, sélectionnable). */
function normalizedFinancial(f: HierarchyNode["financial"]) {
  return f
    ? { baseline: f.baseline, computed: !!f.computed, selectable: f.selectable !== false }
    : null;
}

export function hierarchyNodeToExcelRow(
  node: HierarchyNode,
  levels: HierarchyLevelDef[],
  nodesById: Map<string, HierarchyNode>
): Record<string, string | number> {
  const level = levels.find((l) => l.key === node.levelKey);
  const parent = node.parentId ? nodesById.get(node.parentId) : undefined;
  const row: Record<string, string | number> = {
    Niveau: level?.label ?? node.levelKey,
    Code: node.code,
    Libellé: node.label,
    "Code parent": parent?.code ?? "",
  };
  if (node.financial) {
    row.Baseline = node.financial.baseline;
    row["Calculé"] = node.financial.computed ? "Oui" : "Non";
    row["Sélectionnable"] = node.financial.selectable === false ? "Non" : "Oui";
  }
  return row;
}

/**
 * Lignes d'export de l'arbre : uniquement les nœuds dont le niveau est configuré (les nœuds
 * orphelins — niveau supprimé — ne sont pas ré-importables et sont comptés à part), triés du
 * niveau macro au plus fin puis par code, avec les colonnes financières quand l'arbre en porte.
 */
export function hierarchyToExcelRows(
  nodes: HierarchyNode[],
  levels: HierarchyLevelDef[]
): { rows: Record<string, string | number>[]; headers: string[]; orphans: number } {
  const sorted = [...levels].sort((a, b) => a.order - b.order);
  const order = new Map(sorted.map((l, i) => [l.key, i]));
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const valid = nodes
    .filter((n) => order.has(n.levelKey))
    .sort(
      (a, b) => order.get(a.levelKey)! - order.get(b.levelKey)! || a.code.localeCompare(b.code)
    );
  const withFinancial = sorted.some((l) => l.semantic === "pnl") || valid.some((n) => n.financial);
  return {
    rows: valid.map((n) => hierarchyNodeToExcelRow(n, sorted, nodesById)),
    headers: withFinancial
      ? [...HIERARCHY_EXCEL_HEADERS, ...HIERARCHY_FINANCIAL_HEADERS]
      : [...HIERARCHY_EXCEL_HEADERS],
    orphans: nodes.length - valid.length,
  };
}

/** Nom de fichier d'export sûr : type d'arbre + entreprise (caractères non sûrs retirés) + date. */
export function hierarchyExportFileName(
  companyName: string,
  domain: HierarchyDomain,
  date: Date = new Date()
): string {
  const safe =
    companyName
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60) || "entreprise";
  const stamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const kind = domain === "geographic" ? "geographique" : "financiere";
  return `arborescence_${kind}_${safe}_${stamp}.xlsx`;
}

/**
 * Valide un lot de lignes brutes (issues de `XLSX.utils.sheet_to_json`) contre les niveaux
 * configurés et les nœuds déjà existants, et produit un aperçu (nœuds à créer / à mettre à jour +
 * anomalies ligne par ligne) sans rien écrire.
 * `options.mergedRanges` : plages fusionnées de la feuille (`sheet["!merges"]`, format "A1:B2").
 */
export function validateHierarchyImportRows(
  rawRows: Record<string, unknown>[],
  levels: HierarchyLevelDef[],
  existingNodes: HierarchyNode[],
  companyId: string,
  domain: HierarchyDomain = "financial",
  options: { mergedRanges?: string[] } = {}
): HierarchyImportPreview {
  const errors: HierarchyImportError[] = [];
  const warnings: HierarchyImportError[] = [];
  const error = (rowNumber: number, code: string, vars: Record<string, string | number> = {}) =>
    errors.push(makeIssue(HIERARCHY_IMPORT_ISSUES, "error", rowNumber, code, vars));
  const warning = (rowNumber: number, code: string, vars: Record<string, string | number> = {}) =>
    warnings.push(makeIssue(HIERARCHY_IMPORT_ISSUES, "warning", rowNumber, code, vars));
  const empty = (): HierarchyImportPreview => ({
    toCreate: [],
    toUpdate: [],
    unchanged: 0,
    errors,
    warnings,
  });

  if (options.mergedRanges && options.mergedRanges.length > 0) {
    error(0, "mergedCells", { ranges: options.mergedRanges.slice(0, 5).join(", ") });
    return empty();
  }

  const sortedLevels = [...levels].sort((a, b) => a.order - b.order);
  const levelByLabelOrKey = new Map<string, HierarchyLevelDef>();
  for (const l of sortedLevels) {
    levelByLabelOrKey.set(normalizeHeaderKey(l.key), l);
    levelByLabelOrKey.set(normalizeHeaderKey(l.label), l);
  }

  const prepared = rawRows.map((raw, i) => ({
    row: canonicalizeRowKeys(raw, ALL_HEADERS).row,
    rowNumber: excelRowNumber(raw, i),
  }));
  if (prepared.length > 0) {
    const present = new Set(prepared.flatMap((p) => Object.keys(p.row)));
    const required: string[] = ["Niveau", "Code", "Libellé"];
    if (sortedLevels.length > 1) required.push("Code parent");
    const missing = required.filter((c) => !present.has(c));
    if (missing.length > 0) {
      error(0, "missingColumns", { columns: missing.join(", ") });
      return empty();
    }
  }

  type ParsedRow = {
    rowNumber: number;
    level: HierarchyLevelDef;
    code: string;
    label: string;
    parentCode: string;
    financial?: Partial<NonNullable<HierarchyNode["financial"]>>;
  };
  const parsed: ParsedRow[] = [];

  for (const { row, rowNumber } of prepared) {
    const levelRaw = str(row["Niveau"]);
    const code = str(row["Code"]);
    const label = str(row["Libellé"]);
    const parentCode = str(row["Code parent"]);

    if (!levelRaw && !code && !label && !parentCode) continue; // ligne vide, ignorée

    const level = levelByLabelOrKey.get(normalizeHeaderKey(levelRaw));
    if (!level) {
      error(rowNumber, "unknownLevel", { value: levelRaw });
      continue;
    }
    if (!code || !label) {
      error(rowNumber, "missingCodeOrLabel");
      continue;
    }

    // Données financières facultatives (niveau "pnl" uniquement).
    let financial: ParsedRow["financial"];
    const hasFinancial = HIERARCHY_FINANCIAL_HEADERS.some((h) => h in row && !isBlankCell(row[h]));
    if (hasFinancial) {
      if (level.semantic !== "pnl") {
        warning(rowNumber, "financialIgnored", { level: level.label });
      } else {
        financial = {};
        let bad = false;
        const b = parseCellNumber(row["Baseline"]);
        if (b && !b.ok) {
          error(rowNumber, "invalidBaseline", { value: b.raw });
          bad = true;
        } else if (b) financial.baseline = b.value;
        for (const [col, key] of [
          ["Calculé", "computed"],
          ["Sélectionnable", "selectable"],
        ] as const) {
          if (!(col in row) || isBlankCell(row[col])) continue;
          const v = BOOL[normalizeHeaderKey(str(row[col]))];
          if (v === undefined) {
            error(rowNumber, "invalidBoolean", { column: col, value: str(row[col]) });
            bad = true;
          } else financial[key] = v;
        }
        if (bad) continue;
      }
    }
    parsed.push({ rowNumber, level, code, label, parentCode, financial });
  }

  // code(minuscule) -> nœud, par niveau : préchargé avec l'existant, complété au fil du traitement
  // (macro d'abord) pour que les niveaux plus fins puissent référencer un parent du même import.
  const nodesByLevelAndCode = new Map<string, Map<string, HierarchyNode>>();
  for (const l of sortedLevels) nodesByLevelAndCode.set(l.key, new Map());
  for (const n of existingNodes) {
    nodesByLevelAndCode.get(n.levelKey)?.set(n.code.toLowerCase(), n);
  }
  const firstRowSeenByLevelAndCode = new Map<string, Map<string, number>>();
  for (const l of sortedLevels) firstRowSeenByLevelAndCode.set(l.key, new Map());

  const toCreate: HierarchyNode[] = [];
  const toUpdate: HierarchyNode[] = [];
  let unchanged = 0;
  let seq = 0;

  for (const l of sortedLevels) {
    const parentLevel = sortedLevels.find((pl) => pl.order === l.order - 1);
    const codeMap = nodesByLevelAndCode.get(l.key)!;
    const seenMap = firstRowSeenByLevelAndCode.get(l.key)!;

    for (const p of parsed.filter((row) => row.level.key === l.key)) {
      const lowerCode = p.code.toLowerCase();
      if (seenMap.has(lowerCode)) {
        error(p.rowNumber, "duplicateCode", {
          code: p.code,
          level: l.label,
          other: seenMap.get(lowerCode)!,
        });
        continue;
      }
      seenMap.set(lowerCode, p.rowNumber);

      let parentId: string | null = null;
      if (parentLevel) {
        if (!p.parentCode) {
          error(p.rowNumber, "missingParent", { level: l.label, parentLevel: parentLevel.label });
          continue;
        }
        const parentNode = nodesByLevelAndCode
          .get(parentLevel.key)
          ?.get(p.parentCode.toLowerCase());
        if (!parentNode) {
          error(p.rowNumber, "unknownParent", {
            parent: p.parentCode,
            parentLevel: parentLevel.label,
          });
          continue;
        }
        parentId = parentNode.id;
      } else if (p.parentCode) {
        error(p.rowNumber, "parentOnMacro", { level: l.label });
        continue;
      }

      const existing = codeMap.get(lowerCode);
      let financial = existing?.financial;
      if (p.financial) {
        // Cellule vide = valeur existante conservée (jamais écrasée par undefined).
        const computed = p.financial.computed ?? existing?.financial?.computed;
        const selectable = p.financial.selectable ?? existing?.financial?.selectable;
        financial = {
          baseline: p.financial.baseline ?? existing?.financial?.baseline ?? 0,
          ...(computed !== undefined ? { computed } : {}),
          ...(selectable !== undefined ? { selectable } : {}),
        };
      }

      if (existing) {
        const updated: HierarchyNode = {
          ...existing,
          label: p.label,
          parentId,
          ...(financial ? { financial } : {}),
        };
        const same =
          existing.label === updated.label &&
          existing.parentId === updated.parentId &&
          JSON.stringify(normalizedFinancial(existing.financial)) ===
            JSON.stringify(normalizedFinancial(updated.financial));
        if (same) unchanged += 1;
        else toUpdate.push(updated);
        codeMap.set(lowerCode, updated);
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
        domain,
        ...(financial ? { financial } : {}),
      };
      toCreate.push(node);
      codeMap.set(lowerCode, node);
    }
  }

  errors.sort((a, b) => a.rowNumber - b.rowNumber);
  return { toCreate, toUpdate, unchanged, errors, warnings };
}
