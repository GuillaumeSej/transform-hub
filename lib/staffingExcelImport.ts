import type { WorkBook } from "xlsx";
import type { Chantier, ChantierAction, ChantierStaffing } from "@/types";
import {
  canonicalizeRowKeys,
  excelRowNumber,
  isBlankCell,
  normalizeHeaderKey,
  parseCellDate,
  parseCellNumber,
} from "@/lib/excelParse";
import { applyExcelDateColumns, readOptionalTextCell } from "@/lib/excelCells";
import { makeIssue, type ImportIssue } from "@/lib/importIssue";
import { availableForTeam } from "@/lib/staffingRate";
import {
  checkStaffingLine,
  formatStaffingFte,
  matchStaffingRows,
  staffingBusinessKey,
  type StaffingLineError,
  type StaffingMatchRow,
} from "@/lib/staffingLineValidation";

/**
 * Import/export Excel des lignes de staffing (`ChantierStaffing`) d'un programme — utilisé par
 * `StaffingImportButton` (même idiome `validate*Rows` -> aperçu + anomalies ligne par ligne, aucun
 * appel Firestore dans ce fichier — l'écriture reste à la charge de l'appelant).
 *
 * Format : UNE feuille de données "ETP", une ligne par entrée de staffing — colonnes Chantier /
 * Fonction / ETP / Date début / Date fin / Levier (optionnel) / Note (optionnel) / ID ligne
 * (technique, rempli par l'export). `Chantier`, `Fonction` et `Levier` sont résolus par NOM
 * (insensible à la casse, aux accents et aux espaces multiples). Les lignes dont la 1re cellule
 * commence par "#" sont des commentaires (ignorées) — c'est ainsi que le modèle présente ses
 * exemples. L'export (`buildStaffingExportWorkbook`) produit exactement ce format, dates en vraies
 * cellules date Excel : un fichier exporté puis ré-importé sans modification ne crée rien, ne met
 * rien à jour et ne produit aucune erreur.
 *
 * Feuille de RÉFÉRENCE "Équipes" (modèle ET export, décision PO) : équipes de la base ETP de
 * l'entreprise (nom exact à recopier dans "Fonction") avec leur effectif disponible — voir
 * `appendStaffingTeamsSheet`, partagé avec le classeur du plan stratégique. Elle est IGNORÉE à
 * l'import (`readStaffingImportSheet` ne lit que la feuille "ETP") : une équipe se crée uniquement
 * dans la base ETP.
 *
 * **Rapprochement d'une ligne du fichier avec une entrée existante** (audit lot 4 — auparavant par
 * clé métier seule, si bien que modifier une date dans l'export créait un doublon) :
 * 1. par « ID ligne » (colonne exportée) quand il est renseigné et connu ;
 * 2. sinon par clé métier exacte `chantier + fonction + début + fin + levier` ;
 * 3. sinon SANS les dates (`chantier + fonction + levier`) quand la correspondance est UNIQUE des
 *    deux côtés (une seule entrée existante libre, une seule ligne du fichier).
 * Entrée trouvée → mise à jour (si un champ change réellement, sinon « inchangée ») ; sinon
 * création avec un nouvel id. Deux lignes du MÊME fichier visant la même entrée (même ID ligne)
 * ou créant deux fois la même clé métier sont une ERREUR (on ne sait pas laquelle retenir).
 *
 * Contrôles : règle UNIQUE de `lib/staffingLineValidation.ts::checkStaffingLine` (la même que
 * l'écran et que la feuille ETP du plan stratégique) — équipe de la base ETP (une ligne existante
 * dont l'équipe a quitté la base reste modifiable, avec avertissement), ETP > 0 (avertissement non
 * bloquant au-delà de l'effectif disponible de l'équipe), dates de début et de fin obligatoires
 * (fin ≥ début), avertissement si les dates sortent de la période du levier. Dates lues via
 * `lib/excelParse.ts` (date illisible ou impossible = erreur). Mise à jour d'une ligne historique sans dates : cellules de date vides
 * acceptées (avertissement « dates à compléter »), comme le badge de l'écran.
 *
 * Cellule vide / tiret (règle commune aux imports, `lib/excelCells.ts`) : sur une mise à jour, une
 * cellule « Note » ou de date VIDE conserve la valeur existante ; un tiret « - » efface la note.
 */

// ---------- En-têtes / modèle ----------

export const STAFFING_IMPORT_SHEET_NAME = "ETP";

/** Colonne technique d'identifiant de ligne (dernière colonne, remplie par l'export). */
export const STAFFING_LINE_ID_HEADER = "ID ligne";

export const STAFFING_IMPORT_HEADERS = [
  "Chantier",
  "Fonction",
  "ETP",
  "Date début",
  "Date fin",
  "Levier",
  "Note",
  STAFFING_LINE_ID_HEADER,
] as const;

const STAFFING_DATE_HEADERS = ["Date début", "Date fin"] as const;

/** Feuille de référence des équipes (modèle + export des deux classeurs de staffing), ignorée à
 *  l'import. */
export const STAFFING_TEAMS_SHEET_NAME = "Équipes";

export const STAFFING_TEAMS_HEADERS = ["Équipe", "Effectif disponible (ETP)"] as const;

/** Ligne unique de la feuille "Équipes" quand la base ETP est vide. */
export const STAFFING_TEAMS_EMPTY_TEXT = "Aucune équipe : importez d'abord la base ETP";

/** Règle rappelée dans le modèle Effectifs et le Lisez-moi du plan stratégique. */
export const STAFFING_TEAMS_RULE =
  "La colonne Fonction doit reprendre exactement un nom de l'onglet Équipes ; une équipe se crée uniquement dans la base ETP.";

/** Modèles français des anomalies — recopiés dans fr.ts sous `staffingImport.issue.*`. */
export const STAFFING_IMPORT_ISSUES: Record<string, string> = {
  missingColumns: "Colonnes obligatoires absentes : {columns}",
  missingChantier: '"Chantier" est obligatoire',
  unknownChantier: 'Chantier "{value}" introuvable',
  missingFunction: '"Fonction" est obligatoire (équipe de la base ETP)',
  unknownFunction: 'Fonction "{value}" inconnue (attendu : {expected})',
  functionLeftBase:
    'Équipe "{value}" absente de la base ETP — ligne existante mise à jour quand même',
  missingFte: '"ETP" est obligatoire',
  invalidFte: '"ETP" doit être un nombre, ex. 0,5 (lu : "{value}")',
  fteNotPositive: '"ETP" doit être strictement positif (lu : {value})',
  fteAboveTeam:
    "{fte} ETP sur cette ligne, au-delà de l'effectif de l'équipe {team} dans la base ETP ({dispo} ETP) — vérifiez la saisie",
  invalidDate: '{column} "{value}" illisible ou impossible (attendu JJ/MM/AAAA ou AAAA-MM-JJ)',
  missingDate: '"{column}" est obligatoire (date JJ/MM/AAAA)',
  datesMissing: "Ligne existante sans date de début ou de fin — dates à compléter",
  startAfterEnd: "Date début ({start}) postérieure à la date fin ({end})",
  outsideProject: 'Dates hors de la période du levier "{project}" ({start} → {end})',
  unknownAction: 'Levier "{value}" introuvable sur le chantier "{chantier}"',
  unknownLineId: 'ID ligne "{id}" inconnu dans ce programme — ligne rapprochée sans identifiant',
  duplicateLineId:
    'ID ligne "{id}" présent plusieurs fois dans le fichier (lignes {rows}) — videz la cellule "ID ligne" des lignes copiées',
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
 * l'utilisateur ne retire pas le "#". Les premières lignes expliquent les conventions.
 */
export function buildStaffingTemplateRows(
  chantiers: Chantier[],
  chantierActions: ChantierAction[],
  knownDepartments: string[]
): (string | number)[][] {
  const chantier = chantiers[0];
  const team = knownDepartments[0];
  const action = chantier ? chantierActions.find((a) => a.chantierId === chantier.id) : undefined;
  const comment = (text: string) => [text, "", "", "", "", "", "", ""];
  const rows: (string | number)[][] = [
    comment(
      "# Les lignes commençant par # sont ignorées. Retirez le # d'un exemple pour l'importer."
    ),
    comment(
      "# Règles : Fonction = équipe de la base ETP ; ETP > 0 (au-delà de l'effectif disponible de l'équipe, simple avertissement) ; Date début et Date fin obligatoires (fin ≥ début)."
    ),
    comment(`# ${STAFFING_TEAMS_RULE}`),
    comment(
      '# Mise à jour : "ID ligne" (rempli par l\'export) identifie la ligne — ne le modifiez pas, laissez-le vide pour une nouvelle ligne. Une cellule vide conserve la valeur existante ; un tiret "-" dans Note efface la note.'
    ),
  ];
  if (chantier && team) {
    rows.push([`# ${chantier.name}`, team, 1, "2026-01-01", "2026-06-30", "", "", ""]);
    if (action)
      rows.push([`# ${chantier.name}`, team, 0.5, "2026-01-01", "2026-12-31", action.name, "", ""]);
  }
  return rows;
}

type XlsxUtilsModule = Pick<typeof import("xlsx"), "utils">;
type StaffingWorkbook = ReturnType<XlsxUtilsModule["utils"]["book_new"]>;

/**
 * Lignes de la feuille "Équipes" : en-têtes puis une ligne par équipe de la base ETP (triées par
 * nom) avec son effectif DISPONIBLE (`availableForTeam`, même notion que le taux de staffing),
 * arrondi au centième. Base ETP vide = une ligne explicative.
 */
export function buildStaffingTeamsRows(
  knownDepartments: readonly string[],
  fteByTeam: Readonly<Record<string, number>>
): (string | number)[][] {
  const names = Array.from(new Set(knownDepartments.filter((n) => n.trim() !== ""))).sort((a, b) =>
    a.localeCompare(b)
  );
  const rows: (string | number)[][] =
    names.length > 0
      ? names.map((name) => [
          name,
          Math.round(availableForTeam(fteByTeam as Record<string, number>, name) * 100) / 100,
        ])
      : [[STAFFING_TEAMS_EMPTY_TEXT]];
  return [[...STAFFING_TEAMS_HEADERS], ...rows];
}

/** Ajoute la feuille de référence "Équipes" (ignorée à l'import) — modèle et export de la page
 *  Budget & effectifs, modèle et export du plan stratégique (`lib/strategicExcelImport.ts`). */
export function appendStaffingTeamsSheet(
  XLSX: XlsxUtilsModule,
  wb: StaffingWorkbook,
  knownDepartments: readonly string[],
  fteByTeam: Readonly<Record<string, number>>
): void {
  const sheet = XLSX.utils.aoa_to_sheet(buildStaffingTeamsRows(knownDepartments, fteByTeam));
  sheet["!cols"] = [{ wch: 44 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, sheet, STAFFING_TEAMS_SHEET_NAME);
}

const sheetKey = (name: string) => normalizeHeaderKey(name);

/** Lignes brutes de la feuille "ETP" (insensible à la casse/aux accents), avec repli sur la
 *  PREMIÈRE feuille de DONNÉES du classeur — cet import n'a qu'une feuille attendue : un CSV
 *  importé porte presque toujours un nom de feuille arbitraire ("Sheet1"). La feuille de
 *  référence "Équipes" n'est JAMAIS lue (ni comme feuille ETP, ni en repli). */
export function readStaffingImportSheet(
  XLSX: XlsxUtilsModule,
  workbook: WorkBook
): Record<string, unknown>[] {
  const wanted = workbook.SheetNames.find(
    (n) => sheetKey(n) === sheetKey(STAFFING_IMPORT_SHEET_NAME)
  );
  const sheetName =
    wanted ?? workbook.SheetNames.find((n) => sheetKey(n) !== sheetKey(STAFFING_TEAMS_SHEET_NAME));
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
  });
}

function staffingSheetColumns() {
  return STAFFING_IMPORT_HEADERS.map((h) => ({
    wch: h === STAFFING_LINE_ID_HEADER ? 12 : h === "Chantier" || h === "Levier" ? 36 : 14,
  }));
}

/** Modèle (en-têtes + exemples commentés, puis feuille de référence "Équipes"), dates en vraies
 *  cellules date. */
export function buildStaffingTemplateWorkbook(
  XLSX: XlsxUtilsModule,
  chantiers: Chantier[],
  chantierActions: ChantierAction[],
  knownDepartments: string[],
  /** Effectif disponible par équipe (base ETP) — colonne de la feuille "Équipes". */
  fteByTeam: Readonly<Record<string, number>>
): StaffingWorkbook {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    [...STAFFING_IMPORT_HEADERS],
    ...buildStaffingTemplateRows(chantiers, chantierActions, knownDepartments),
  ]);
  applyExcelDateColumns(XLSX, sheet, STAFFING_DATE_HEADERS);
  sheet["!cols"] = staffingSheetColumns();
  XLSX.utils.book_append_sheet(wb, sheet, STAFFING_IMPORT_SHEET_NAME);
  appendStaffingTeamsSheet(XLSX, wb, knownDepartments, fteByTeam);
  return wb;
}

// ---------- Export ----------

/** Lignes d'export (même format que l'import) — dates ISO "AAAA-MM-JJ", converties en vraies
 *  cellules date par `buildStaffingExportWorkbook`. */
export function staffingToExcelRows(
  staffing: ChantierStaffing[],
  chantiers: Chantier[],
  chantierActions: ChantierAction[]
): Record<string, string | number>[] {
  return staffing
    .map((s) => ({
      Chantier: chantiers.find((c) => c.id === s.chantierId)?.name ?? s.chantierId,
      Fonction: s.function,
      ETP: s.fte,
      "Date début": s.startDate ?? "",
      "Date fin": s.endDate ?? "",
      Levier: s.actionId ? (chantierActions.find((a) => a.id === s.actionId)?.name ?? "") : "",
      Note: s.note ?? "",
      [STAFFING_LINE_ID_HEADER]: s.id,
    }))
    .sort(
      (a, b) =>
        String(a.Chantier).localeCompare(String(b.Chantier)) ||
        String(a.Fonction).localeCompare(String(b.Fonction))
    );
}

/** Classeur d'export (feuille "ETP" + feuille de référence "Équipes") : dates en vraies cellules
 *  date Excel (JJ/MM/AAAA). */
export function buildStaffingExportWorkbook(
  XLSX: XlsxUtilsModule,
  staffing: ChantierStaffing[],
  chantiers: Chantier[],
  chantierActions: ChantierAction[],
  /** Équipes de la base ETP et leur effectif disponible — feuille "Équipes". */
  knownDepartments: string[],
  fteByTeam: Readonly<Record<string, number>>
): StaffingWorkbook {
  const rows = staffingToExcelRows(staffing, chantiers, chantierActions);
  const wb = XLSX.utils.book_new();
  const sheet =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows, { header: [...STAFFING_IMPORT_HEADERS] })
      : XLSX.utils.aoa_to_sheet([[...STAFFING_IMPORT_HEADERS]]);
  applyExcelDateColumns(XLSX, sheet, STAFFING_DATE_HEADERS);
  sheet["!cols"] = staffingSheetColumns();
  XLSX.utils.book_append_sheet(wb, sheet, STAFFING_IMPORT_SHEET_NAME);
  appendStaffingTeamsSheet(XLSX, wb, knownDepartments, fteByTeam);
  return wb;
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

/** Égalité de deux entrées, indépendante de l'ordre des clés (champs `undefined` ignorés). */
function sameEntry(a: ChantierStaffing, b: ChantierStaffing): boolean {
  const canon = (e: ChantierStaffing) => {
    const rec = e as Record<string, unknown>;
    return JSON.stringify(
      Object.keys(rec)
        .filter((k) => rec[k] !== undefined)
        .sort()
        .map((k) => [k, rec[k]])
    );
  };
  return canon(a) === canon(b);
}

// ---------- Types publics ----------

export type StaffingImportError = ImportIssue;

export type StaffingImportRow = {
  rowNumber: number;
  entry: ChantierStaffing;
  /** true = une entrée existante a été rapprochée, `entry.id` la réutilise. */
  isUpdate: boolean;
};

export type StaffingImportPreview = {
  /** Lignes à écrire (créations + mises à jour qui changent réellement quelque chose). */
  rows: StaffingImportRow[];
  /** Lignes rapprochées d'une entrée existante sans aucun changement (rien à écrire). */
  unchanged: number;
  errors: StaffingImportError[];
  warnings: StaffingImportError[];
};

/** Ligne du fichier lue et résolue (avant rapprochement). */
type ParsedRow = StaffingMatchRow & {
  chantier: Chantier;
  action?: ChantierAction;
  fteRaw: unknown;
  fte: number | null | undefined;
  note: ReturnType<typeof readOptionalTextCell>;
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
  knownDepartments: string[],
  /** Effectif disponible par équipe (base ETP) : au-delà, avertissement `fteAboveTeam` (la ligne
   *  est importée). Absent = pas de contrôle. */
  fteByTeam?: Readonly<Record<string, number>>
): StaffingImportPreview {
  const errors: StaffingImportError[] = [];
  const warnings: StaffingImportError[] = [];
  const rows: StaffingImportRow[] = [];
  let unchanged = 0;
  const resolvedCompanyId = companyId ?? "";
  const resolvedProgramId = programId ?? "";
  const error = (rowNumber: number, code: string, vars: Record<string, string | number> = {}) =>
    errors.push(makeIssue(STAFFING_IMPORT_ISSUES, "error", rowNumber, code, vars));
  const warning = (rowNumber: number, code: string, vars: Record<string, string | number> = {}) =>
    warnings.push(makeIssue(STAFFING_IMPORT_ISSUES, "warning", rowNumber, code, vars));

  const prepared = rawRows.map((raw, i) => ({
    row: canonicalizeRowKeys(raw, STAFFING_IMPORT_HEADERS).row,
    rowNumber: excelRowNumber(raw, i),
  }));
  if (prepared.length > 0) {
    const present = new Set(prepared.flatMap((p) => Object.keys(p.row)));
    const missing = ["Chantier", "Fonction", "ETP"].filter((c) => !present.has(c));
    if (missing.length > 0) {
      error(0, "missingColumns", { columns: missing.join(", ") });
      return { rows, unchanged, errors, warnings };
    }
  }

  // ---- 1. Lecture des cellules (chantier, levier, date illisible = erreur immédiate) ----
  const parsed: ParsedRow[] = [];
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

    let dateError = false;
    const readDate = (column: "Date début" | "Date fin"): string | undefined => {
      const r = parseCellDate(row[column]);
      if (!r) return undefined;
      if (r.ok) return r.value;
      error(rowNumber, "invalidDate", { column, value: r.raw });
      dateError = true;
      return undefined;
    };
    const startDate = readDate("Date début");
    const endDate = readDate("Date fin");
    if (dateError) continue;

    const actionRaw = str(row["Levier"]);
    let action: ChantierAction | undefined;
    if (actionRaw) {
      action = chantierActions.find(
        (a) => a.chantierId === chantier.id && nameKey(a.name) === nameKey(actionRaw)
      );
      if (!action) {
        error(rowNumber, "unknownAction", { value: actionRaw, chantier: chantier.name });
        continue;
      }
    }

    const fteParsed = parseCellNumber(row["ETP"]);
    parsed.push({
      rowNumber,
      chantier,
      chantierId: chantier.id,
      action,
      actionId: action?.id,
      fn: str(row["Fonction"]),
      fteRaw: row["ETP"],
      fte: fteParsed === undefined ? undefined : fteParsed.ok ? fteParsed.value : null,
      startDate,
      endDate,
      note: readOptionalTextCell(row["Note"]),
      lineId: str(row[STAFFING_LINE_ID_HEADER]),
    });
  }

  // ---- 2. Rapprochement : ID ligne, puis clé exacte, puis clé sans dates si unique ----
  const { duplicateIds, unknownIds } = matchStaffingRows(parsed, existingStaffing);
  const rejected = new Set<number>();
  duplicateIds.forEach((rowNumbers, id) => {
    for (const n of rowNumbers) {
      rejected.add(n);
      error(n, "duplicateLineId", { id, rows: rowNumbers.join(", ") });
    }
  });
  for (const u of unknownIds) warning(u.rowNumber, "unknownLineId", { id: u.id });
  const candidates = parsed.filter((p) => !rejected.has(p.rowNumber));

  // ---- 3. Règle commune (écran = imports), puis fusion ----
  const firstRowByKey = new Map<string, number>();
  const duplicatedFirstRows = new Map<number, number>();
  for (const p of candidates) {
    const { rowNumber, matched } = p;
    // Cellule de date vide sur une mise à jour = date existante conservée.
    const startDate = p.startDate ?? matched?.startDate;
    const endDate = p.endDate ?? matched?.endDate;
    // Date encore absente après fusion = absente du fichier ET de la ligne existante (historique).
    const legacyUndated = matched !== undefined && (!startDate || !endDate);
    const check = checkStaffingLine(
      { team: p.fn, fte: p.fte, startDate, endDate },
      {
        knownTeams: knownDepartments,
        currentTeam: matched?.function,
        projectRange: p.action ? { start: p.action.start, end: p.action.end } : null,
        teamAvailableFte: fteByTeam,
      }
    );
    let rowFailed = false;
    for (const code of Object.values(check.errors) as StaffingLineError[]) {
      // Ligne historique sans aucune date : mise à jour acceptée, dates à compléter.
      if ((code === "startRequired" || code === "endRequired") && legacyUndated) continue;
      rowFailed = true;
      switch (code) {
        case "teamRequired":
          error(rowNumber, "missingFunction");
          break;
        case "teamUnknown":
          error(rowNumber, "unknownFunction", {
            value: p.fn,
            expected:
              knownDepartments.length > 0
                ? knownDepartments.join(", ")
                : STAFFING_IMPORT_ISSUES.noDepartments,
          });
          break;
        case "fteRequired":
          error(rowNumber, "missingFte");
          break;
        case "fteInvalid":
          error(rowNumber, "invalidFte", { value: str(p.fteRaw) });
          break;
        case "fteNotPositive":
          error(rowNumber, "fteNotPositive", { value: str(p.fteRaw) });
          break;
        case "startRequired":
        case "endRequired":
          error(rowNumber, "missingDate", {
            column: code === "startRequired" ? "Date début" : "Date fin",
          });
          break;
        case "endBeforeStart":
          error(rowNumber, "startAfterEnd", { start: startDate ?? "", end: endDate ?? "" });
          break;
        default:
          // startInvalid / endInvalid : impossibles ici (dates déjà lues par `parseCellDate`).
          error(rowNumber, "invalidDate", {
            column: code === "startInvalid" ? "Date début" : "Date fin",
            value: (code === "startInvalid" ? startDate : endDate) ?? "",
          });
      }
    }
    if (rowFailed) continue;
    if (legacyUndated) warning(rowNumber, "datesMissing");
    if (check.warnings.includes("teamLeftBase"))
      warning(rowNumber, "functionLeftBase", { value: p.fn });
    if (check.warnings.includes("fteAboveTeam") && check.fte !== null)
      warning(rowNumber, "fteAboveTeam", {
        fte: formatStaffingFte(check.fte),
        team: check.team,
        dispo: formatStaffingFte(check.teamAvailableFte ?? 0),
      });
    if (check.warnings.includes("outsideProject") && p.action)
      warning(rowNumber, "outsideProject", {
        project: p.action.name,
        start: p.action.start ?? "",
        end: p.action.end ?? "",
      });

    if (!matched) {
      const key = staffingBusinessKey(p.chantierId, check.team, startDate, endDate, p.actionId);
      const first = firstRowByKey.get(key);
      if (first !== undefined) {
        error(rowNumber, "duplicateRow", { other: first });
        duplicatedFirstRows.set(first, rowNumber);
        continue;
      }
      firstRowByKey.set(key, rowNumber);
    }

    // Note : vide = conservée, "-" = effacée.
    const note =
      p.note.kind === "set" ? p.note.value : p.note.kind === "keep" ? matched?.note : undefined;
    const entry: ChantierStaffing = {
      id: matched?.id ?? makeStaffingId(),
      companyId: matched?.companyId || resolvedCompanyId,
      programId: matched?.programId || resolvedProgramId,
      chantierId: p.chantier.id,
      function: check.team,
      fte: check.fte as number,
      ...(note ? { note } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(p.action ? { actionId: p.action.id } : {}),
      createdAt: matched?.createdAt ?? nowDate(),
    };
    if (matched && sameEntry(entry, matched)) {
      unchanged += 1;
      continue;
    }
    rows.push({ rowNumber, entry, isUpdate: matched !== undefined });
  }

  // Une ligne en doublon invalide aussi la 1re occurrence (on ne sait pas laquelle est juste).
  const kept = rows.filter((r) => !duplicatedFirstRows.has(r.rowNumber));
  duplicatedFirstRows.forEach((dupRow, first) => error(first, "duplicateRow", { other: dupRow }));
  errors.sort((a, b) => a.rowNumber - b.rowNumber);
  warnings.sort((a, b) => a.rowNumber - b.rowNumber);

  return { rows: kept, unchanged, errors, warnings };
}
