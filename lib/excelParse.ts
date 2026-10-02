/**
 * Lecture partagée des cellules Excel/CSV pour TOUS les imports (leviers, plan stratégique, RH,
 * effectifs, arborescence) — audit du 24/09/2026 : chaque import avait sa propre lecture des
 * nombres/dates, avec des pertes silencieuses ("0,5" lu 5 ou 1, "45 000" lu 0, date Excel lue
 * "46195.08…", "31/02/2026" accepté, décalage d'un jour en fuseau positif).
 *
 * Règles :
 * - Nombres : format français ou anglais toléré (espaces, espaces insécables U+00A0/U+202F,
 *   virgule décimale, "%" et "€" retirés, parenthèses comptables = négatif). Une valeur présente
 *   mais illisible renvoie `{ ok: false }` — jamais une valeur par défaut silencieuse.
 * - Dates : numéro de série Excel (nombre ou texte purement numérique), objet Date (cellule date
 *   convertie par `convertExcelDateCells` — jamais par `cellDates` de SheetJS, faux en Europe/Paris),
 *   ISO "AAAA-MM-JJ" (avec ou sans heure), "JJ/MM/AAAA" ou "JJ-MM-AAAA" ou "JJ.MM.AAAA".
 *   Toujours validées par aller-retour (pas de 31/02) et construites en composantes locales —
 *   jamais via `toISOString()` (décalage UTC).
 * - En-têtes : comparaison insensible à la casse, aux accents et aux espaces superflus.
 */

export type ParseResult<T> = { ok: true; value: T } | { ok: false; raw: string };

/** Cellule considérée vide (absente, null, chaîne vide ou espaces). */
export function isBlankCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/** Nombre au format FR/EN. `undefined` si la cellule est vide ; `{ok:false}` si illisible. */
export function parseCellNumber(v: unknown): ParseResult<number> | undefined {
  if (isBlankCell(v)) return undefined;
  if (typeof v === "number")
    return Number.isFinite(v) ? { ok: true, value: v } : { ok: false, raw: String(v) };
  if (typeof v === "boolean") return { ok: false, raw: String(v) };
  let s = String(v).trim();
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/[\s  ]/g, "")
    .replace(/[€%]/g, "")
    .replace(/^\+/, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (s === "") return { ok: false, raw: String(v) };
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // Le dernier séparateur rencontré est le décimal ("1.500,5" FR ou "1,500.5" EN).
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    const parts = s.split(",");
    // Plusieurs virgules = séparateurs de milliers EN ("1,500,000") ; une seule = décimale FR.
    s = parts.length > 2 ? parts.join("") : parts.join(".");
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(s)) return { ok: false, raw: String(v) };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, raw: String(v) };
  return { ok: true, value: negative ? -n : n };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "AAAA-MM-JJ" si (y, m, d) forment une date réelle, sinon `undefined`. */
export function isoFromParts(y: number, m: number, d: number): string | undefined {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return undefined;
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return undefined;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Numéro de série Excel (système 1900) → "AAAA-MM-JJ" (partie horaire ignorée). */
export function isoFromExcelSerial(serial: number): string | undefined {
  if (!Number.isFinite(serial) || serial < 1 || serial > 120000) return undefined;
  // 25569 = 1970-01-01 ; calcul en UTC pur pour éviter tout décalage de fuseau.
  const ms = Math.round((Math.floor(serial) - 25569) * 86400000);
  const dt = new Date(ms);
  return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** Date au format "AAAA-MM-JJ". `undefined` si vide ; `{ok:false}` si illisible ou impossible. */
export function parseCellDate(v: unknown): ParseResult<string> | undefined {
  if (isBlankCell(v)) return undefined;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return { ok: false, raw: String(v) };
    // `convertExcelDateCells` crée des dates à minuit LOCAL exact : composantes locales.
    const iso = isoFromParts(v.getFullYear(), v.getMonth() + 1, v.getDate());
    return iso ? { ok: true, value: iso } : { ok: false, raw: String(v) };
  }
  if (typeof v === "number") {
    const iso = isoFromExcelSerial(v);
    return iso ? { ok: true, value: iso } : { ok: false, raw: String(v) };
  }
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) {
    const iso = isoFromExcelSerial(Number(s));
    return iso ? { ok: true, value: iso } : { ok: false, raw: s };
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (m) {
    const iso = isoFromParts(Number(m[1]), Number(m[2]), Number(m[3]));
    return iso ? { ok: true, value: iso } : { ok: false, raw: s };
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/);
  if (m) {
    const iso = isoFromParts(Number(m[3]), Number(m[2]), Number(m[1]));
    return iso ? { ok: true, value: iso } : { ok: false, raw: s };
  }
  return { ok: false, raw: s };
}

/** Clé d'en-tête normalisée : minuscules, sans accents, espaces simples, sans espace de bord. */
export function normalizeHeaderKey(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\s  ]+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Réécrit les clés d'une ligne `sheet_to_json` vers les en-têtes canoniques attendus, en
 * tolérant casse/accents/espaces. Les colonnes inconnues sont conservées telles quelles (et
 * listées dans `unknown` pour pouvoir avertir l'utilisateur).
 */
export function canonicalizeRowKeys(
  row: Record<string, unknown>,
  expectedHeaders: readonly string[]
): { row: Record<string, unknown>; unknown: string[] } {
  const byNorm = new Map(expectedHeaders.map((h) => [normalizeHeaderKey(h), h]));
  const out: Record<string, unknown> = {};
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (k === "__rowNum__") continue;
    const canonical = byNorm.get(normalizeHeaderKey(k));
    if (canonical) out[canonical] = v;
    else {
      out[k] = v;
      if (!k.startsWith("__EMPTY")) unknown.push(k);
    }
  }
  return { row: out, unknown };
}

/** Numéro de ligne Excel (1-based) d'une ligne `sheet_to_json`, robuste aux lignes vides. */
export function excelRowNumber(row: Record<string, unknown>, fallbackIndex: number): number {
  const n = (row as { __rowNum__?: number }).__rowNum__;
  return typeof n === "number" ? n + 1 : fallbackIndex + 2;
}

/** Options `XLSX.read` pour un classeur BINAIRE (.xlsx/.xls) lu depuis un ArrayBuffer : texte brut
 *  (`raw: true`), formats numériques conservés (`cellNF`) et SURTOUT pas de `cellDates` — la
 *  conversion de date de SheetJS 0.18.5 est fausse dans les fuseaux dont l'heure de 1899 n'était
 *  pas un nombre entier de minutes (Europe/Paris : LMT +0:09:21) : une date saisie 31/03/2026
 *  revenait à 30/03/2026 23:59:39, donc importée la veille. Les cellules date sont converties par
 *  `convertExcelDateCells` (numéro de série → Date locale exacte) : passer par `readXlsxWorkbook`.
 *  Un CSV ne doit JAMAIS être lu avec ces options directement — SheetJS décoderait les octets en
 *  Latin-1 (accents et "€" perdus) : tout fichier importé passe par
 *  `lib/excelFileRead.ts::readSpreadsheetFile`, seul point d'entrée, qui décode le CSV (UTF-8 /
 *  Windows-1252) avant de le lire en mode texte avec ce même `raw` pour que "0,5" et "01/03/2026"
 *  ne soient pas réinterprétés à l'américaine. */
export const XLSX_READ_OPTIONS = {
  type: "array" as const,
  raw: true,
  cellDates: false,
  cellNF: true,
};

/**
 * Numéro de série Excel → `Date` aux composantes LOCALES exactes (minuit local pour une date pure,
 * heure conservée à la seconde près). Calcul en UTC pur puis recomposition locale : aucun fuseau,
 * aucune heure d'été ni décalage historique (LMT) ne peut faire glisser le jour.
 * `date1904` : classeurs Mac historiques (série 0 = 01/01/1904).
 */
export function localDateFromExcelSerial(serial: number, date1904 = false): Date | undefined {
  if (!Number.isFinite(serial)) return undefined;
  let days = Math.floor(serial);
  let secs = Math.round((serial - days) * 86400);
  if (secs >= 86400) {
    days += 1;
    secs -= 86400;
  }
  if (date1904) days += 1462;
  // Série 60 = 29/02/1900 fictif (bogue Lotus repris par Excel) : avant le 01/03/1900, un jour
  // de décalage. Sans effet pour les dates métier (≥ 1900 validées par `isoFromParts`).
  const base = days < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const utc = new Date(base + days * 86400000);
  return new Date(
    utc.getUTCFullYear(),
    utc.getUTCMonth(),
    utc.getUTCDate(),
    Math.floor(secs / 3600),
    Math.floor(secs / 60) % 60,
    secs % 60
  );
}

/** Cellule SheetJS minimale (évite d'importer le module `xlsx`, chargé à la demande). */
type SheetCell = { t?: string; v?: unknown; z?: unknown };
type WorkbookLike = {
  Sheets: Record<string, Record<string, unknown>>;
  Workbook?: { WBProps?: { date1904?: boolean } };
};

/**
 * Remplace, dans un classeur lu avec `XLSX_READ_OPTIONS` (sans `cellDates`), chaque cellule
 * numérique au format date (`isDateFormat`, en pratique `XLSX.SSF.is_date`) par un objet `Date`
 * construit par `localDateFromExcelSerial` — même forme qu'avec `cellDates` (type "d", `Date` en
 * valeur), mais sans l'erreur de fuseau de SheetJS. Le texte formaté (`w`) est conservé.
 */
export function convertExcelDateCells<W extends WorkbookLike>(
  wb: W,
  isDateFormat: (fmt: string) => boolean
): W {
  const date1904 = Boolean(wb.Workbook?.WBProps?.date1904);
  for (const ws of Object.values(wb.Sheets)) {
    for (const [addr, raw] of Object.entries(ws)) {
      if (addr.startsWith("!")) continue;
      const cell = raw as SheetCell;
      if (!cell || cell.t !== "n" || typeof cell.v !== "number") continue;
      if (typeof cell.z !== "string" || !isDateFormat(cell.z)) continue;
      const d = localDateFromExcelSerial(cell.v, date1904);
      if (!d) continue;
      cell.t = "d";
      cell.v = d;
    }
  }
  return wb;
}

/** Module `xlsx` réduit à ce qu'utilise `readXlsxWorkbook` (le module est chargé à la demande). */
type XlsxModuleLike<W> = {
  read: (data: ArrayBuffer | Uint8Array, opts: typeof XLSX_READ_OPTIONS) => W;
  SSF: { is_date: (fmt: string) => boolean };
};

/** Lecture d'un classeur BINAIRE comme l'appli (options + conversion exacte des dates). */
export function readXlsxWorkbook<W extends WorkbookLike>(
  XLSX: XlsxModuleLike<W>,
  data: ArrayBuffer | Uint8Array
): W {
  return convertExcelDateCells(XLSX.read(data, XLSX_READ_OPTIONS), (z) => XLSX.SSF.is_date(z));
}
