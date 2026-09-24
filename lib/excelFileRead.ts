import * as XLSX from "xlsx";
import { XLSX_READ_OPTIONS } from "@/lib/excelParse";

/**
 * Lecture d'un fichier importé (xlsx/xls/csv) en classeur SheetJS, avec un décodage CSV fiable.
 *
 * Pourquoi pas simplement `XLSX.read(buffer, XLSX_READ_OPTIONS)` pour un CSV : SheetJS lit alors
 * les octets en Latin-1 — un CSV UTF-8 SANS BOM (export Google Sheets, LibreOffice, scripts)
 * devient illisible ("HÃ©lÃ¨ne"), et le "€" d'un CSV Windows-1252 (Excel FR) est perdu (0x80
 * n'est pas un caractère Latin-1), ce qui casse par exemple l'en-tête "Salaire brut annuel (€)".
 * Ici : UTF-8 strict d'abord (BOM retiré), repli Windows-1252 si les octets ne sont pas de
 * l'UTF-8 valide, puis lecture texte avec `raw: true` (les "0,5" / "01/03/2026" restent du texte,
 * interprété ensuite au format français par `lib/excelParse.ts`).
 */
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    text = new TextDecoder("windows-1252").decode(view);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function readSpreadsheet(bytes: ArrayBuffer, fileName: string): XLSX.WorkBook {
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
export async function readSpreadsheetFile(file: File): Promise<XLSX.WorkBook> {
  return readSpreadsheet(await file.arrayBuffer(), file.name);
}
