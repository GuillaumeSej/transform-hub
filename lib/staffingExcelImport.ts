import type { Chantier, ChantierAction, ChantierStaffing } from "@/types";
import {
  canonicalizeRowKeys,
  excelRowNumber,
  isBlankCell,
  normalizeHeaderKey,
  parseCellDate,
  parseCellNumber,
} from "@/lib/excelParse";
import { makeIssue, type ImportIssue } from "@/lib/importIssue";

/**
 * Import/export Excel des lignes de staffing (`ChantierStaffing`) d'un programme — utilisé par
 * `StaffingImportButton` (même idiome `validate*Rows` -> aperçu + anomalies ligne par ligne, aucun
 * appel Firestore dans ce fichier — l'écriture reste à la charge de l'appelant).
 *
 * Format : UNE feuille, une ligne par entrée de staffing — colonnes Chantier / Fonction / ETP /
 * Date début / Date fin / Levier (optionnel) / Note (optionnel). `Chantier`, `Fonction` et `Levier`
 * sont résolus par NOM (insensible à la casse, aux accents et aux espaces multiples). Les lignes
 * dont la 1re cellule commence par "#" sont des commentaires (ignorées) — c'est ainsi que le
 * modèle présente ses exemples. L'export (`staffingToExcelRows`) produit exactement ce format :
 * un fichier exporté puis ré-importé sans modification ne crée rien et ne produit aucune erreur.
 *
 * **Upsert par clé métier** (`chantierId + fonction + dateDébut + dateFin + levier`) : une ligne
 * dont la clé correspond à une entrée DÉJÀ EN BASE réutilise son id (mise à jour) ; sinon un nouvel
 * id est alloué (création). Deux lignes du MÊME fichier avec la même clé sont une ERREUR (on ne
 * sait pas laquelle retenir) — audit du 24/09/2026, auparavant la dernière écrasait l'autre.
 *
 * Contrôles (audit du 24/09/2026) : dates lues via `lib/excelParse.ts` (date illisible ou
 * impossible = erreur, plus de repli silencieux sur ""), début > fin = erreur, 0 < ETP ≤ 5, équipe
 * absente de la base ETP = erreur à la création mais simple avertissement pour une ligne existante
 * (une équipe peut avoir quitté la base ETP depuis la saisie).
 */

// ---------- En-têtes / modèle ----------

export const STAFFING_IMPORT_SHEET_NAME = "ETP";

export const STAFFING_IMPORT_HEADERS = [
  "Chantier",
  "Fonction",
  "ETP",
  "Date début",
  "Date fin",
  "Levier",
  "Note",
] as const;

/** ETP maximal accepté pour une ligne de staffing (au-delà : faute de frappe probable). */
export const STAFFING_MAX_FTE = 5;

/** Modèles français des anomalies — recopiés dans fr.ts sous `staffingImport.issue.*`. */
export const STAFFING_IMPORT_ISSUES: Record<string, string> = {
  missingColumns: "Colonnes obligatoires absentes : {columns}",
  missingChantier: '"Chantier" est obligatoire',
  unknownChantier: 'Chantier "{value}" introuvable',
  unknownFunction: 'Fonction "{value}" inconnue (attendu : {expected})',
  functionLeftBase:
    'Équipe "{value}" absente de la base ETP — ligne existante mise à jour quand même',
  invalidFte: '"ETP" doit être un nombre strictement positif et au plus {max} (lu : "{value}")',
  invalidDate: '{column} "{value}" illisible ou impossible (attendu JJ/MM/AAAA ou AAAA-MM-JJ)',
  startAfterEnd: "Date début ({start}) postérieure à la date fin ({end})",
  unknownAction: 'Levier "{value}" introuvable sur le chantier "{chantier}"',
  duplicateRow: "Ligne en doublon (même chantier, fonction, dates et levier que la ligne {other})",
  noDepartments: "aucune équipe dans la base ETP",
};

/** Clé de comparaison des noms : casse, accents et espaces multiples ignorés. */
function nameKey(v: string): string {
  return normalizeHeaderKey(v);
}

/**
 * Lignes d'exemple du modèle — construites avec un chantier et une équipe RÉELS de l'entreprise,
 * mais COMMENTÉES ("# " devant le chantier) : elles sont ignorées à l'import tant que
 * l'utilisateur ne retire pas le "#". La 1re ligne explique la convention.
 */
export function buildStaffingTemplateRows(
  chantiers: Chantier[],
  chantierActions: ChantierAction[],
  knownDepartments: string[]
): (string | number)[][] {
  const chantier = chantiers[0];
  const team = knownDepartments[0];
  const action = chantier ? chantierActions.find((a) => a.chantierId === chantier.id) : undefined;
  const rows: (string | number)[][] = [
    [
      "# Les lignes commençant par # sont ignorées. Retirez le # d'un exemple pour l'importer.",
      "",
      "",
      "",
      "",
      "",
      "",
    ],
  ];
  if (chantier && team) {
    rows.push([`# ${chantier.name}`, team, 1, "01/01/2026", "30/06/2026", "", ""]);
    if (action) rows.push([`# ${chantier.name}`, team, 0.5, "01/01/2026", "", action.name, ""]);
  }
  return rows;
}

// ---------- Export ----------

/** Lignes d'export (même format que l'import) — dates au format JJ/MM/AAAA. */
export function staffingToExcelRows(
  staffing: ChantierStaffing[],
  chantiers: Chantier[],
  chantierActions: ChantierAction[]
): Record<string, string | number>[] {
  const frDate = (iso?: string) => {
    if (!iso) return "";
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
  };
  return staffing
    .map((s) => ({
      Chantier: chantiers.find((c) => c.id === s.chantierId)?.name ?? s.chantierId,
      Fonction: s.function,
      ETP: s.fte,
      "Date début": frDate(s.startDate),
      "Date fin": frDate(s.endDate),
      Levier: s.actionId ? (chantierActions.find((a) => a.id === s.actionId)?.name ?? "") : "",
      Note: s.note ?? "",
    }))
    .sort(
      (a, b) =>
        String(a.Chantier).localeCompare(String(b.Chantier)) ||
        String(a.Fonction).localeCompare(String(b.Fonction))
    );
}

// ---------- Parsing utilitaire ----------

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => isBlankCell(v));
}

function nowDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

let idSeq = 0;
/** Id alloué pour de vrai : c'est cet id qui sera écrit tel quel par `saveChantierStaffing`. Même
 *  préfixe "ST" que `newStaffingId()` de `ChantierStaffingEditor.tsx`. */
function makeStaffingId(): string {
  idSeq += 1;
  return `ST-${Date.now().toString(36)}-${idSeq}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Clé métier d'upsert — voir doc-comment en tête de fichier. La fonction est comparée
 *  normalisée (casse/accents/espaces) pour qu'une variation de saisie ne duplique pas une ligne. */
function staffingMatchKey(
  chantierId: string,
  fn: string,
  startDate: string,
  endDate: string,
  actionId: string | undefined
): string {
  return [chantierId, nameKey(fn), startDate, endDate, actionId ?? ""].join("|");
}

// ---------- Types publics ----------

export type StaffingImportError = ImportIssue;

export type StaffingImportRow = {
  rowNumber: number;
  entry: ChantierStaffing;
  /** true = une entrée existante (même clé métier) a été trouvée, `entry.id` la réutilise. */
  isUpdate: boolean;
};

export type StaffingImportPreview = {
  rows: StaffingImportRow[];
  errors: StaffingImportError[];
  warnings: StaffingImportError[];
};

/**
 * Valide les lignes brutes de la feuille "ETP" et produit un aperçu (lignes prêtes à écrire,
 * classées création/mise à jour, + erreurs/avertissements ligne par ligne) sans rien écrire.
 */
export function validateStaffingImportRows(
  rawRows: Record<string, unknown>[],
  companyId: string | null | undefined,
  programId: string | null | undefined,
  chantiers: Chantier[],
  chantierActions: ChantierAction[],
  existingStaffing: ChantierStaffing[],
  /** Noms d'équipe réels de la base ETP entreprise — la colonne "Fonction" doit matcher l'un
   *  d'eux (ou, pour une ligne existante, l'équipe déjà enregistrée). */
  knownDepartments: string[]
): StaffingImportPreview {
  const errors: StaffingImportError[] = [];
  const warnings: StaffingImportError[] = [];
  const rows: StaffingImportRow[] = [];
  const resolvedCompanyId = companyId ?? "";
  const resolvedProgramId = programId ?? "";
  const error = (rowNumber: number, code: string, vars: Record<string, string | number> = {}) =>
    errors.push(makeIssue(STAFFING_IMPORT_ISSUES, "error", rowNumber, code, vars));
  const warning = (rowNumber: number, code: string, vars: Record<string, string | number> = {}) =>
    warnings.push(makeIssue(STAFFING_IMPORT_ISSUES, "warning", rowNumber, code, vars));

  const existingByKey = new Map<string, ChantierStaffing>();
  for (const entry of existingStaffing) {
    existingByKey.set(
      staffingMatchKey(
        entry.chantierId,
        entry.function,
        entry.startDate ?? "",
        entry.endDate ?? "",
        entry.actionId
      ),
      entry
    );
  }
  const seenInBatch = new Map<string, number>();

  const prepared = rawRows.map((raw, i) => ({
    row: canonicalizeRowKeys(raw, STAFFING_IMPORT_HEADERS).row,
    rowNumber: excelRowNumber(raw, i),
  }));
  if (prepared.length > 0) {
    const present = new Set(prepared.flatMap((p) => Object.keys(p.row)));
    const missing = ["Chantier", "Fonction", "ETP"].filter((c) => !present.has(c));
    if (missing.length > 0) {
      error(0, "missingColumns", { columns: missing.join(", ") });
      return { rows, errors, warnings };
    }
  }

  for (const { row, rowNumber } of prepared) {
    if (isRowEmpty(row)) continue;

    const chantierRaw = str(row["Chantier"]);
    if (chantierRaw.startsWith("#")) continue; // ligne de commentaire (exemples du modèle)
    if (!chantierRaw) {
      error(rowNumber, "missingChantier");
      continue;
    }
    const chantier = chantiers.find((c) => nameKey(c.name) === nameKey(chantierRaw));
    if (!chantier) {
      error(rowNumber, "unknownChantier", { value: chantierRaw });
      continue;
    }

    const fteRaw = row["ETP"];
    const fteParsed = parseCellNumber(fteRaw);
    const fte = fteParsed?.ok ? fteParsed.value : undefined;
    if (fte === undefined || !(fte > 0) || fte > STAFFING_MAX_FTE) {
      error(rowNumber, "invalidFte", { max: STAFFING_MAX_FTE, value: str(fteRaw) });
      continue;
    }

    let dateError = false;
    const readDate = (column: "Date début" | "Date fin"): string => {
      const r = parseCellDate(row[column]);
      if (!r) return "";
      if (r.ok) return r.value;
      error(rowNumber, "invalidDate", { column, value: r.raw });
      dateError = true;
      return "";
    };
    const startDate = readDate("Date début");
    const endDate = readDate("Date fin");
    if (dateError) continue;
    if (startDate && endDate && startDate > endDate) {
      error(rowNumber, "startAfterEnd", { start: startDate, end: endDate });
      continue;
    }

    const actionRaw = str(row["Levier"]);
    let actionId: string | undefined;
    if (actionRaw) {
      const action = chantierActions.find(
        (a) => a.chantierId === chantier.id && nameKey(a.name) === nameKey(actionRaw)
      );
      if (!action) {
        error(rowNumber, "unknownAction", { value: actionRaw, chantier: chantier.name });
        continue;
      }
      actionId = action.id;
    }

    const functionRaw = str(row["Fonction"]);
    const knownFn = functionRaw
      ? knownDepartments.find((d) => nameKey(d) === nameKey(functionRaw))
      : undefined;
    const key = staffingMatchKey(chantier.id, functionRaw, startDate, endDate, actionId);
    const matched = functionRaw ? existingByKey.get(key) : undefined;
    let fn: string;
    if (knownFn) fn = knownFn;
    else if (matched) {
      // Équipe sortie de la base ETP depuis la saisie : la ligne existante reste modifiable.
      fn = matched.function;
      warning(rowNumber, "functionLeftBase", { value: functionRaw });
    } else {
      error(rowNumber, "unknownFunction", {
        value: functionRaw,
        expected:
          knownDepartments.length > 0
            ? knownDepartments.join(", ")
            : STAFFING_IMPORT_ISSUES.noDepartments,
      });
      continue;
    }

    const firstRow = seenInBatch.get(key);
    if (firstRow !== undefined) {
      error(rowNumber, "duplicateRow", { other: firstRow });
      continue;
    }
    seenInBatch.set(key, rowNumber);

    const note = str(row["Note"]);
    const entry: ChantierStaffing = {
      id: matched?.id ?? makeStaffingId(),
      companyId: resolvedCompanyId,
      programId: resolvedProgramId,
      chantierId: chantier.id,
      function: fn,
      fte,
      ...(note !== "" ? { note } : matched?.note ? { note: matched.note } : {}),
      ...(startDate !== "" ? { startDate } : {}),
      ...(endDate !== "" ? { endDate } : {}),
      ...(actionId ? { actionId } : {}),
      createdAt: matched?.createdAt ?? nowDate(),
    };
    rows.push({ rowNumber, entry, isUpdate: matched !== undefined });
  }

  // Une ligne en doublon invalide aussi la 1re occurrence (on ne sait pas laquelle est juste).
  const duplicatedFirstRows = new Set(
    errors.filter((e) => e.code === "duplicateRow").map((e) => Number(e.vars.other))
  );
  const kept = rows.filter((r) => !duplicatedFirstRows.has(r.rowNumber));
  duplicatedFirstRows.forEach((n) => {
    const dupOf = errors.find((e) => e.code === "duplicateRow" && Number(e.vars.other) === n);
    error(n, "duplicateRow", { other: dupOf?.rowNumber ?? n });
  });
  errors.sort((a, b) => a.rowNumber - b.rowNumber);

  return { rows: kept, errors, warnings };
}
