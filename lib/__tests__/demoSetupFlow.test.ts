import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import path from "path";
import { validateHierarchyImportRows } from "@/lib/hierarchyExcel";
import { derivePnlAccounts } from "@/lib/hierarchyLogic";
import { validateLeverImportRows, type LeverImportRawSheets } from "@/lib/leverExcelImport";
import { parseEmployeeRow, parseMovementRow } from "@/lib/hrExcel";
import type { BeTrackData, Employee, HierarchyLevelDef, Lever } from "@/types";

/**
 * Preuve de bout en bout du parcours de setup "from scratch" décrit dans `doc/demo-script.md`
 * §3 : les 4 fichiers de `demo/` importés DANS L'ORDRE sur une entreprise vierge, chaque étape
 * consommant réellement le résultat de la précédente (les comptes P&L des leviers viennent de
 * l'arborescence importée à l'étape d'avant, les mouvements RH référencent les leviers importés).
 *
 * Complète `leverExcelImportDemoFile.test.ts`, qui valide le seul fichier des leviers avec des
 * comptes P&L codés en dur : ici c'est le CHAÎNAGE qui est verrouillé, pour qu'une régénération
 * d'un seul fichier (ou un changement de format d'import) ne puisse plus les laisser diverger
 * silencieusement entre eux.
 */

const DEMO_DIR = path.resolve(__dirname, "..", "..", "demo");

function readSheet(fileName: string, sheetName: string): Record<string, unknown>[] {
  const workbook = XLSX.readFile(path.join(DEMO_DIR, fileName));
  const found = workbook.SheetNames.find((n) => n.toLowerCase() === sheetName.toLowerCase());
  if (!found) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[found], { defval: "" });
}

const COMPANY_ID = "c-demo-setup";

// Étape 2 du script de démo : niveaux créés À LA MAIN dans la fiche entreprise avant tout import.
// Les libellés doivent matcher la colonne "Niveau" des fichiers d'arborescence, et le niveau macro
// financier doit porter `semantic: "pnl"` — sans quoi `derivePnlAccounts` retombe sur le fallback
// et TOUTES les lignes de leviers échouent sur "Compte P&L introuvable".
const FINANCIAL_LEVELS: HierarchyLevelDef[] = [
  { key: "pnl_account", label: "P&L", order: 0, semantic: "pnl" },
  { key: "cost_center", label: "Centre de coût", order: 1 },
];
const GEOGRAPHIC_LEVELS: HierarchyLevelDef[] = [
  { key: "continent", label: "Continent", order: 0, semantic: "continent" },
  { key: "country", label: "Pays", order: 1, semantic: "country" },
];

describe("parcours de setup complet avec les 4 fichiers demo/ (doc/demo-script.md §3)", () => {
  it("enchaîne arborescences → leviers → base ETP sans une seule ligne en erreur", () => {
    // ── Étape 2a : arborescence financière ────────────────────────────────────────────────
    const financial = validateHierarchyImportRows(
      readSheet("arborescence_financiere_demo.xlsx", "Arborescence"),
      FINANCIAL_LEVELS,
      [],
      COMPANY_ID,
      "financial"
    );
    expect(financial.errors).toEqual([]);
    expect(financial.toCreate.length).toBe(10);

    // ── Étape 2b : arborescence géographique ──────────────────────────────────────────────
    const geographic = validateHierarchyImportRows(
      readSheet("arborescence_geographique_demo.xlsx", "Arborescence"),
      GEOGRAPHIC_LEVELS,
      [],
      COMPANY_ID,
      "geographic"
    );
    expect(geographic.errors).toEqual([]);
    expect(geographic.toCreate.length).toBe(6);

    // ── Chaînage : les comptes P&L viennent de l'arborescence qu'on vient d'importer ──────
    // (mêmes appels que `useStorage`, fallback vide = aucune donnée mock pour cette entreprise).
    const pnlAccounts = derivePnlAccounts(FINANCIAL_LEVELS, financial.toCreate, []);
    expect(pnlAccounts.map((a) => a.id).sort()).toEqual(["COGS", "GA", "REV", "SGA"]);

    // ── Étape 4a : leviers + actions + impacts ────────────────────────────────────────────
    const sheets: LeverImportRawSheets = {
      leviers: readSheet("leviers_demo.xlsx", "Leviers"),
      actions: readSheet("leviers_demo.xlsx", "Actions"),
      impacts: readSheet("leviers_demo.xlsx", "Impacts"),
    };
    const leverPreview = validateLeverImportRows(
      sheets,
      { levers: [], workstreams: [], pnlAccounts },
      COMPANY_ID,
      [] // aucun programme : la colonne "Programme" du fichier de démo est vide
    );
    expect(leverPreview.errors).toEqual([]);
    expect(leverPreview.toUpsert.length).toBe(sheets.leviers.length);

    // ── Étape 4b : base ETP + mouvements, sur les leviers qu'on vient d'importer ──────────
    const importedLevers = leverPreview.toUpsert as Lever[];
    const employees: Employee[] = [];
    const warnings: string[] = [];
    let ignored = 0;

    const data = {
      levers: importedLevers,
      workforce: { employees, departments: [], movements: [] },
    } as unknown as BeTrackData;

    readSheet("base_etp_demo.xlsx", "Base ETP").forEach((row, i) => {
      const parsed = parseEmployeeRow(row, data, i + 2);
      warnings.push(...parsed.warnings);
      if (parsed.values) employees.push(parsed.values);
      else ignored += 1;
    });
    expect(employees.length).toBe(100);

    readSheet("base_etp_demo.xlsx", "Mouvements").forEach((row, i) => {
      const parsed = parseMovementRow(row, data, i + 2);
      warnings.push(...parsed.warnings);
      if (!parsed.values) ignored += 1;
    });

    // Aucune ligne ignorée : un mouvement dont le code levier ou le matricule ne serait pas
    // résolu remonterait ici (c'est précisément le chaînage testé).
    expect(ignored).toBe(0);

    // AUCUN avertissement de conversion : ceux-ci signalent un fichier de démo resté sur un
    // vocabulaire périmé (ancienne typologie 4-types, statut "En cours"...). Le fichier doit
    // toujours être généré avec la typologie courante — voir MOVEMENT_TYPES_POOL /
    // MOVEMENT_STATUS_POOL dans scripts/generate-demo-excel.js.
    expect(warnings.filter((w) => /converti/i.test(w))).toEqual([]);

    // Les seuls avertissements tolérés sont les départements "inconnus" : sur une entreprise
    // flambant neuve AUCUN département n'est encore configuré, la valeur du fichier est donc
    // reprise telle quelle (comportement voulu, la ligne est bien importée). Toute autre famille
    // d'avertissement est une régression.
    const unexpected = warnings.filter(
      (w) => !/département .* inconnu \(accepté tel quel\)/i.test(w)
    );
    expect(unexpected).toEqual([]);
  });
});
