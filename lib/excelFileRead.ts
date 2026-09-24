import type { WorkBook } from "xlsx";
import { XLSX_READ_OPTIONS } from "@/lib/excelParse";

/**
 * Lecture d'un fichier importé (xlsx/xls/csv) en classeur SheetJS, avec un décodage CSV fiable.
 * Point d'entrée UNIQUE de tous les boutons d'import (leviers, plan stratégique, base ETP,
 * staffing, arborescences). SheetJS est chargé à la demande (`await import("xlsx")`) : la
 * bibliothèque (~400 kB) ne fait plus partie du JS initial des pages, seulement du clic.
 *
 * Pourquoi pas simplement `XLSX.read(buffer, XLSX_READ_OPTIONS)` pour un CSV : SheetJS lit alors
 * les octets en Latin-1 — un CSV UTF-8 SANS BOM (export Google Sheets, LibreOffice, scripts)
 * devient illisible ("HÃ©lÃ¨ne"), et le "€" d'un CSV Windows-1252 (Excel FR) est perdu (0x80
 * n'est pas un caractère Latin-1), ce qui casse par exemple l'en-tête "Salaire brut annuel (€)".
 * Ici : UTF-8 strict d'abord (BOM retiré), repli Windows-1252 si les octets ne sont pas de
 * l'UTF-8 valide, puis lecture texte avec `raw: true` (les "0,5" / "01/03/2026" restent du texte,
 * interprété ensuite au format français par `lib/excelParse.ts`).
 */
/** Caractères Windows-1252 des octets 0x80–0x9F (Latin-1 y met des caractères de contrôle). */
const CP1252_HIGH: Record<number, string> = {
  0x80: "€",
  0x82: "‚",
  0x83: "ƒ",
  0x84: "„",
  0x85: "…",
  0x86: "†",
  0x87: "‡",
  0x88: "ˆ",
  0x89: "‰",
  0x8a: "Š",
  0x8b: "‹",
  0x8c: "Œ",
  0x8e: "Ž",
  0x91: "‘",
  0x92: "’",
  0x93: "“",
  0x94: "”",
  0x95: "•",
  0x96: "–",
  0x97: "—",
  0x98: "˜",
  0x99: "™",
  0x9a: "š",
  0x9b: "›",
  0x9c: "œ",
  0x9e: "ž",
  0x9f: "Ÿ",
};

/** Décodage Windows-1252 explicite : `TextDecoder("windows-1252")` se comporte en Latin-1 dans
 *  certaines versions de Node (dont Node 20 de la CI) et perd le "€" (0x80). */
function decodeWindows1252(view: Uint8Array): string {
  let out = "";
  // Boucle indexée (pas de `for…of`) : `tsconfig.json` n'a pas de `target` explicite, et le
  // type-check de `next build` refuse alors d'itérer un `Uint8Array` (sans `downlevelIteration`).
  for (let i = 0; i < view.length; i++) {
    const b = view[i];
    out +=
      b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b] ?? String.fromCharCode(b)) : String.fromCharCode(b);
  }
  return out;
}

export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    text = decodeWindows1252(view);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function readSpreadsheet(bytes: ArrayBuffer, fileName: string): Promise<WorkBook> {
  const XLSX = await import("xlsx");
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return XLSX.read(decodeCsvBytes(bytes), {
      type: "string",
      raw: XLSX_READ_OPTIONS.raw,
      cellDates: XLSX_READ_OPTIONS.cellDates,
    });
  }
  return XLSX.read(bytes, XLSX_READ_OPTIONS);
}

/** Raccourci navigateur : `File` -> classeur. */
export async function readSpreadsheetFile(file: File): Promise<WorkBook> {
  return readSpreadsheet(await file.arrayBuffer(), file.name);
}
