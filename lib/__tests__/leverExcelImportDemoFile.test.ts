import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import path from "path";
import { validateLeverImportRows, type LeverImportRawSheets } from "@/lib/leverExcelImport";
import type { BeTrackData } from "@/types";

/**
 * Preuve de bout en bout que `demo/leviers_demo.xlsx` (généré par
 * `scripts/generate-demo-excel.js`) s'importe sans AUCUNE erreur sur une entreprise flambant
 * neuve — même logique de lecture que `LeverImportButton.handleImportFile` (recherche de feuille
 * insensible à la casse, `defval: ""`), pour reproduire fidèlement ce qui se passe en conditions
 * réelles côté navigateur.
 */

const SHEET_NAMES = { leviers: "Leviers", actions: "Actions", impacts: "Impacts" } as const;

function findSheet(workbook: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase());
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
  });
}

// Comptes P&L de l'entreprise de démo — mêmes codes que FINANCIAL_ROWS dans
// scripts/generate-demo-excel.js (arborescence_financiere_demo.xlsx), référencés par la colonne
// "Compte P&L impacté" de leviers_demo.xlsx.
const pnlAccounts: Pick<BeTrackData, "pnlAccounts">["pnlAccounts"] = [
  { id: "REV", name: "Revenue", baseline: 0, sign: 1 },
  { id: "COGS", name: "Cost of Goods Sold", baseline: 0, sign: -1 },
  { id: "SGA", name: "Selling & Marketing", baseline: 0, sign: -1 },
  { id: "GA", name: "General & Admin", baseline: 0, sign: -1 },
];

describe("leverExcelImport — demo/leviers_demo.xlsx (généré par scripts/generate-demo-excel.js)", () => {
  it("imports the demo workbook end-to-end with zero errors on a brand-new company", () => {
    const filePath = path.resolve(__dirname, "..", "..", "demo", "leviers_demo.xlsx");
    const workbook = XLSX.readFile(filePath);

    const sheets: LeverImportRawSheets = {
      leviers: findSheet(workbook, SHEET_NAMES.leviers),
      actions: findSheet(workbook, SHEET_NAMES.actions),
      impacts: findSheet(workbook, SHEET_NAMES.impacts),
    };

    expect(sheets.leviers.length).toBeGreaterThan(0);

    // Entreprise flambant neuve : aucun workstream préexistant (auto-créés par l'import), aucun
    // levier existant, aucun programme (la colonne "Programme" du fichier de démo est vide).
    const preview = validateLeverImportRows(
      sheets,
      { levers: [], workstreams: [], pnlAccounts },
      "c-demo",
      []
    );

    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert.length).toBe(sheets.leviers.length);
    expect(preview.createCount).toBe(sheets.leviers.length);
    expect(preview.updateCount).toBe(0);

    // La colonne "Statut" du fichier de démo doit utiliser les libellés RÉELLEMENT affichés sur
    // la plateforme par défaut (cycle de vie court, voir DEFAULT_LIFECYCLE_STAGES dans
    // lib/status-config.ts) — pas les anciens libellés longs "Excel" — pour que le texte visible
    // à l'écran après import corresponde à celui du fichier montré pendant la démo. Une régression
    // qui régénère le fichier avec l'ancien vocabulaire long serait toujours acceptée à l'import
    // (rétrocompatibilité voulue), mais casserait la cohérence Excel <-> écran visée ici.
    const statusesInFile = new Set(sheets.leviers.map((r) => String(r["Statut"])));
    expect(statusesInFile).toEqual(
      new Set(["Identifié", "Validé", "Planifié", "Exécuté", "Réalisé"])
    );
  });
});
