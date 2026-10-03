import { isBlankCell, isoFromParts, normalizeHeaderKey } from "@/lib/excelParse";

/**
 * Règles de cellule partagées par les imports/exports Excel STAFFING (Effectifs), BASE ETP et
 * PLAN STRATÉGIQUE (lot 4 de l'audit) — complément de `lib/excelParse.ts` (lecture) :
 *
 * 1. Cellule vide / tiret. Sur une ligne qui MET À JOUR une entité existante, une cellule VIDE
 *    conserve la valeur en base (upsert non destructif) ; un tiret seul « - » (ou « – », « — »)
 *    l'EFFACE. Seuls les champs facultatifs peuvent être effacés ; le tiret dans une colonne
 *    OBLIGATOIRE (ou un code / identifiant de ligne) est une ERREUR BLOQUANTE dans TOUS les imports
 *    (décision PO du 03/10), avec le message dédié `EXCEL_NOT_CLEARABLE_MESSAGE` (code
 *    `notClearable`) — jamais un « nom inconnu », un « nombre illisible » ni un simple
 *    avertissement. Le contrôle passe AVANT toute résolution de la valeur (chantier, axe, type…).
 *
 * 2. Dates des exports. Les exports écrivent de VRAIES cellules date Excel (numéro de série +
 *    format « dd/mm/yyyy ») — et non plus du texte « JJ/MM/AAAA » ou « AAAA-MM-JJ » — pour que
 *    l'utilisateur puisse trier/filtrer/calculer dans Excel. Le numéro de série est calculé en UTC
 *    pur (jamais via `Date` locale : la conversion de SheetJS décale d'un jour en Europe/Paris) et
 *    relu exactement par `readXlsxWorkbook` / `localDateFromExcelSerial`.
 */

/** Marqueur « effacer la valeur » d'une cellule d'import. */
export const EXCEL_CLEAR_MARKER = "-";

/** true si la cellule contient le seul marqueur d'effacement (tiret simple, demi-cadratin ou
 *  cadratin — Excel remplace parfois « - » par « – » en correction automatique). */
export function isClearMarker(v: unknown): boolean {
  return typeof v === "string" && /^[-–—]$/.test(v.trim());
}

/** Modèle FRANÇAIS commun du refus « tiret sur une colonne obligatoire » (code `notClearable`
 *  des imports leviers, plan stratégique, base ETP, Effectifs et arborescence ; variable
 *  `{column}` — `{field}` côté leviers). Recopié à l'identique dans fr.ts (vérifié par test). */
export const EXCEL_NOT_CLEARABLE_MESSAGE =
  '"{column}" est une colonne obligatoire (ou un identifiant) : le tiret « - » ne peut pas l\'effacer — laissez la cellule vide pour conserver la valeur';

/** Lecture d'une cellule texte FACULTATIVE selon la règle vide/tiret :
 *  `{ kind: "keep" }` (vide), `{ kind: "clear" }` (tiret) ou `{ kind: "set", value }`. */
export type OptionalCell = { kind: "keep" } | { kind: "clear" } | { kind: "set"; value: string };

export function readOptionalTextCell(v: unknown): OptionalCell {
  if (isBlankCell(v)) return { kind: "keep" };
  if (isClearMarker(v)) return { kind: "clear" };
  return { kind: "set", value: String(v).trim() };
}

/** Format date des exports (affichage JJ/MM/AAAA dans Excel, quelle que soit sa langue). */
export const EXCEL_DATE_FORMAT = "dd/mm/yyyy";

/** "AAAA-MM-JJ" → numéro de série Excel (système 1900), calcul UTC pur. `undefined` si la chaîne
 *  n'est pas une date réelle. */
export function excelSerialFromIsoDate(iso: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!isoFromParts(y, mo, d)) return undefined;
  return (Date.UTC(y, mo - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
}

/** Cellule SheetJS « vraie date » pour une date ISO ; la chaîne d'origine si ce n'en est pas une
 *  (texte libre, vide…). */
export function excelDateCell(
  iso: string | null | undefined
): { t: "n"; v: number; z: string; w: string } | string {
  if (!iso) return "";
  const serial = excelSerialFromIsoDate(iso);
  if (serial === undefined) return iso;
  const [y, m, d] = iso.trim().split("-");
  return { t: "n", v: serial, z: EXCEL_DATE_FORMAT, w: `${d}/${m}/${y}` };
}

type XlsxUtilsLike = Pick<typeof import("xlsx"), "utils">;
type SheetLike = Record<string, unknown>;

/**
 * Convertit, dans une feuille construite par `json_to_sheet`/`aoa_to_sheet` (en-têtes en 1re
 * ligne), chaque cellule texte « AAAA-MM-JJ » des colonnes `dateHeaders` en vraie cellule date
 * (`excelDateCell`). Les autres valeurs (vide, texte libre) restent inchangées. Les en-têtes sont
 * comparés insensiblement à la casse/aux accents.
 */
export function applyExcelDateColumns(
  XLSX: XlsxUtilsLike,
  ws: SheetLike,
  dateHeaders: readonly string[]
): SheetLike {
  const ref = ws["!ref"];
  if (typeof ref !== "string") return ws;
  const range = XLSX.utils.decode_range(ref);
  const wanted = new Set(dateHeaders.map(normalizeHeaderKey));
  const cols: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const head = ws[XLSX.utils.encode_cell({ r: range.s.r, c })] as { v?: unknown } | undefined;
    if (head && typeof head.v === "string" && wanted.has(normalizeHeaderKey(head.v))) cols.push(c);
  }
  for (const c of cols) {
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as { t?: string; v?: unknown } | undefined;
      if (!cell || cell.t !== "s" || typeof cell.v !== "string") continue;
      const date = excelDateCell(cell.v);
      if (typeof date !== "string") ws[addr] = date;
    }
  }
  return ws;
}
