import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import {
  parseStrategicImportWorkbook,
  validateStrategicImportRows,
} from "@/lib/strategicExcelImport";
import type { MaturityStageConfig } from "@/types";

/**
 * Fichier RÉEL pré-rempli (plan 2030 généré par IA à partir du modèle `modele_plan_strategique.xlsx`
 * téléchargé depuis l'app) — garde-fou de bout en bout : feuilles, en-têtes et conventions du
 * modèle doivent rester parsés intégralement par `validateStrategicImportRows`, avec le jeu
 * d'étapes de maturité par défaut d'un programme fraîchement créé (celui que reçoit l'import
 * proposé juste après la création d'une entreprise).
 */
const companyId = "C-NEW";
const programId = "P-NEW";

// Miroir de `DEFAULT_MATURITY_STAGES` (lib/firestore/maturityStageConfigs.ts) — dupliqué pour ne
// pas charger Firestore dans ce test purement fonctionnel.
const defaultStages: MaturityStageConfig[] = [
  { id: "defined", order: 1, label: "Défini", programId, companyId },
  { id: "validated", order: 2, label: "Validé", programId, companyId },
  { id: "planned", order: 3, label: "Planifié", programId, companyId },
  { id: "achieved", order: 4, label: "Réalisé", isTerminal: true, programId, companyId },
];

function loadFixture() {
  const buf = readFileSync(path.join(__dirname, "fixtures", "plan_strategique_pre-rempli.xlsx"));
  return XLSX.read(buf, { type: "buffer" });
}

describe("import Excel du plan stratégique — fichier pré-rempli réel", () => {
  it("parse toutes les feuilles sans erreur et cible l'entreprise/programme fournis", () => {
    const sheets = parseStrategicImportWorkbook(loadFixture());
    expect(sheets.axes.length).toBeGreaterThan(0);

    const { toCreate, errors } = validateStrategicImportRows(
      sheets,
      { axes: [], chantiers: [], actions: [], indicators: [] },
      companyId,
      programId,
      defaultStages,
      "admin"
    );

    expect(errors).toEqual([]);
    expect(toCreate.axes).toHaveLength(4);
    expect(toCreate.chantiers).toHaveLength(14);
    expect(toCreate.actions).toHaveLength(43);
    expect(toCreate.indicators).toHaveLength(50);
    expect(toCreate.measurements.length).toBeGreaterThan(0);
    // Feuille ETP laissée vide dans ce fichier.
    expect(toCreate.staffing).toHaveLength(0);

    // Chaque projet embarque son livrable (43 lignes Livrables pour 43 projets).
    const deliverables = toCreate.actions.flatMap((a) => a.deliverables ?? []);
    expect(deliverables).toHaveLength(43);

    for (const e of [...toCreate.axes, ...toCreate.chantiers, ...toCreate.indicators]) {
      expect(e.companyId).toBe(companyId);
      expect(e.programId).toBe(programId);
    }
    for (const a of toCreate.actions) expect(a.companyId).toBe(companyId);
  });

  it("accepte des dates Excel natives (sérielles) sur Livrables/ETP et les décimales à virgule", () => {
    const wb = XLSX.utils.book_new();
    const add = (name: string, rows: unknown[][]) =>
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
    add("Axes", [
      ["Code", "Nom", "Étape de maturité"],
      ["AX1", "Axe 1", "Planifié"],
    ]);
    add("Chantiers", [
      ["Code", "Codes Axes (séparés par ;)", "Nom", "Budget alloué"],
      ["CH1", "AX1", "Chantier 1", "1 500,5"],
    ]);
    add("Projets", [
      ["Code", "Code Chantier", "Nom", "Date début", "Date fin"],
      ["P1", "CH1", "Projet 1", 46023, 46387], // 2026-01-01 / 2026-12-31
    ]);
    add("Livrables", [
      ["Code Projet", "Label", "Début", "Fin"],
      ["P1", "Livrable", 46023, 46387],
    ]);
    add("Indicateurs", [
      [
        "Code Axe",
        "Nom",
        "Type",
        "Fréquence",
        "Objectif",
        "Valeur cible",
        "Rôles responsables (séparés par ;)",
      ],
      ["AX1", "KPI", "Quantitatif", "Annuelle", "Atteindre 99,5", "99,5", "strategic_lead"],
    ]);
    add("ETP", [
      ["Code Chantier", "Fonction (équipe, base ETP)", "Nombre d'ETP", "Date début"],
      ["CH1", "Finance", "1,5", 46023],
    ]);

    const { toCreate, errors } = validateStrategicImportRows(
      parseStrategicImportWorkbook(wb),
      { axes: [], chantiers: [], actions: [], indicators: [] },
      companyId,
      programId,
      defaultStages
    );
    expect(errors).toEqual([]);
    expect(toCreate.chantiers[0].allocatedBudget).toBe(1500.5);
    expect(toCreate.actions[0].start).toBe("2026-01-01");
    // Livrable = ÉCHÉANCE : ancien format "Début"/"Fin" → "Fin" devient l'échéance, "Début" ignoré.
    expect(toCreate.actions[0].deliverables?.[0]).toMatchObject({
      phases: [],
      dueDate: "2026-12-31",
    });
    expect(toCreate.indicators[0].objectiveValue).toBe(99.5);
    expect(toCreate.staffing[0]).toMatchObject({ fte: 1.5, startDate: "2026-01-01" });
  });
});
