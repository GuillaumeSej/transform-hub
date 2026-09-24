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
 * - Dates : numéro de série Excel (nombre ou texte purement numérique), objet Date (cellDates),
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
    // SheetJS (cellDates) crée des dates à minuit LOCAL : composantes locales.
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

/** Options `XLSX.read` pour un classeur BINAIRE (.xlsx/.xls) lu depuis un ArrayBuffer : dates en
 *  objets Date (`cellDates`) et texte brut (`raw: true`). Un CSV ne doit JAMAIS être lu avec ces
 *  options directement — SheetJS décoderait les octets en Latin-1 (accents et "€" perdus) : tout
 *  fichier importé passe par `lib/excelFileRead.ts::readSpreadsheetFile`, seul point d'entrée,
 *  qui décode le CSV (UTF-8 / Windows-1252) avant de le lire en mode texte avec ces mêmes
 *  `raw`/`cellDates` pour que "0,5" et "01/03/2026" ne soient pas réinterprétés à l'américaine. */
export const XLSX_READ_OPTIONS = { type: "array" as const, raw: true, cellDates: true };
