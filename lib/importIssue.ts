/**
 * Anomalies d'import Excel traduisibles (audit du 24/09/2026) : chaque import (base ETP,
 * effectifs, arborescence) produit des anomalies sous forme de CODE + variables, et non plus de
 * phrases françaises figées. L'UI les rend via `t("<préfixe>.<code>", modèleFR)` ; `reason` garde
 * le rendu français (repli, journaux, tests).
 *
 * Les modèles français de chaque import vivent dans son module (`HR_IMPORT_ISSUES`,
 * `STAFFING_IMPORT_ISSUES`, `HIERARCHY_IMPORT_ISSUES`) et DOIVENT être recopiés à l'identique dans
 * `lib/i18n/dictionaries/fr.ts` (vérifié par test).
 */

export type ImportIssueSeverity = "error" | "warning";

export type ImportIssue = {
  /** Numéro de ligne Excel (1-based) ; 0 = anomalie portant sur le fichier entier. */
  rowNumber: number;
  /** Feuille concernée (imports multi-feuilles), facultatif. */
  sheet?: string;
  severity: ImportIssueSeverity;
  code: string;
  vars: Record<string, string | number>;
  /** Rendu français (repli si la clé de traduction manque). */
  reason: string;
};

/** Remplace les `{var}` d'un modèle. */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m
  );
}

export function makeIssue(
  templates: Record<string, string>,
  severity: ImportIssueSeverity,
  rowNumber: number,
  code: string,
  vars: Record<string, string | number> = {},
  sheet?: string
): ImportIssue {
  return {
    rowNumber,
    ...(sheet ? { sheet } : {}),
    severity,
    code,
    vars,
    reason: fillTemplate(templates[code] ?? code, vars),
  };
}

/** Rendu traduit d'une anomalie (sans le préfixe "Ligne n"). */
export function formatImportIssue(
  t: (key: string, fallback?: string) => string,
  keyPrefix: string,
  templates: Record<string, string>,
  issue: ImportIssue
): string {
  return fillTemplate(
    t(`${keyPrefix}.${issue.code}`, templates[issue.code] ?? issue.reason),
    issue.vars
  );
}
