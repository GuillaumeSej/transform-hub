import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readXlsxWorkbook } from "@/lib/excelParse";
import {
  STRATEGIC_IMPORT_MESSAGES,
  buildStrategicImportTemplateWorkbook,
  buildStrategicPlanExportWorkbook,
  parseStrategicImportWorkbook,
  validateStrategicImportRows,
  type StrategicImportExistingData,
  type StrategicImportRawSheets,
} from "@/lib/strategicExcelImport";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";
import de from "@/lib/i18n/dictionaries/de";
import es from "@/lib/i18n/dictionaries/es";
import type {
  Chantier,
  ChantierAction,
  ChantierStaffing,
  MaturityStageConfig,
  StrategicAxis,
} from "@/types";

/**
 * Import du plan stratégique — lot 4 : feuille ETP alignée sur la règle commune de staffing
 * (lib/staffingLineValidation.ts), rapprochement par « ID ligne », poids au format % d'Excel,
 * vraies dates à l'export. À lancer aussi en Europe/Paris (PowerShell : `$env:TZ='Europe/Paris'`).
 */

const companyId = "C1";
const programId = "P1";
const stages: MaturityStageConfig[] = [
  { id: "defined", order: 1, label: "Défini", programId, companyId },
  { id: "validated", order: 2, label: "Validé", programId, companyId },
  { id: "planned", order: 3, label: "Planifié", programId, companyId },
  { id: "achieved", order: 4, label: "Réalisé", isTerminal: true, programId, companyId },
];
const NOW = new Date(2026, 0, 15);
const knownDepartments = ["Data & Analytics", "Ressources Humaines"];

const axisEntity: StrategicAxis = {
  id: "AX-1",
  companyId,
  programId,
  name: "Axe 1",
  stage: "defined",
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  importCode: "AX1",
} as StrategicAxis;
const chantierEntity: Chantier = {
  id: "CH-1",
  companyId,
  programId,
  axisIds: ["AX-1"],
  name: "Chantier 1",
  stage: "defined",
  dependencies: [],
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  importCode: "CH1",
} as Chantier;
const actionEntity: ChantierAction = {
  id: "CA-1",
  companyId,
  chantierId: "CH-1",
  name: "Projet 1",
  start: "2026-01-01",
  end: "2026-06-30",
  status: "defined",
  importCode: "P1",
} as ChantierAction;
const lineA: ChantierStaffing = {
  id: "ST-A",
  companyId,
  programId,
  chantierId: "CH-1",
  function: "Data & Analytics",
  fte: 2,
  note: "Squad data",
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  createdAt: "2025-12-01",
};
const lineB: ChantierStaffing = {
  ...lineA,
  id: "ST-B",
  fte: 1,
  note: undefined,
  startDate: "2026-04-01",
  endDate: "2026-06-30",
};

const existing = (): StrategicImportExistingData => ({
  axes: [axisEntity],
  chantiers: [chantierEntity],
  actions: [actionEntity],
  indicators: [],
  measurements: [],
  staffing: [lineA, { ...lineB }],
});

function sheets(partial: Partial<StrategicImportRawSheets>): StrategicImportRawSheets {
  return {
    axes: [],
    chantiers: [],
    actions: [],
    livrables: [],
    indicateurs: [],
    etp: [],
    ...partial,
  };
}

const etpRow = (o: Record<string, unknown> = {}) => ({
  "Code Chantier": "CH1",
  "Code Projet": "",
  "Fonction (équipe, base ETP)": "Data & Analytics",
  "Nombre d'ETP": 1,
  Précision: "",
  "Date début": "2026-07-01",
  "Date fin": "2026-12-31",
  "ID ligne": "",
  ...o,
});

const run = (s: StrategicImportRawSheets, data = existing(), departments = knownDepartments) =>
  validateStrategicImportRows(s, data, companyId, programId, stages, "admin", {
    now: NOW,
    knownDepartments: departments,
  });

/** Écrit le classeur en .xlsx puis le relit comme l'appli. */
function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readXlsxWorkbook(XLSX, bytes);
}

describe("feuille ETP — même règle que l'écran et l'import Effectifs", () => {
  it("refuse 7 ETP, une équipe hors base ETP, des dates manquantes ; « abc » = nombre illisible", () => {
    const result = run(
      sheets({
        etp: [
          etpRow({ "Nombre d'ETP": 7 }),
          etpRow({ "Fonction (équipe, base ETP)": "Astrologie" }),
          etpRow({ "Date fin": "" }),
          etpRow({ "Nombre d'ETP": "abc" }),
          etpRow({ "Nombre d'ETP": 0 }),
        ],
      })
    );
    // (Lecture des cellules puis règle commune : on trie par ligne pour comparer.)
    const errors = [...result.errors].sort((a, b) => a.rowNumber - b.rowNumber);
    expect(errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [2, "staffingFteTooHigh"],
      [3, "staffingUnknownTeam"],
      [4, "requiredDate"],
      [5, "notNumber"],
      [6, "notPositive"],
    ]);
    expect(errors.map((e) => e.reason)).toEqual([
      '"Nombre d\'ETP" (7) dépasse le plafond de 5 ETP par ligne — répartissez le besoin sur plusieurs lignes',
      'Équipe "Astrologie" absente de la base ETP (attendu : Data & Analytics, Ressources Humaines)',
      '"Date fin" est obligatoire (date JJ/MM/AAAA ou AAAA-MM-JJ)',
      '"Nombre d\'ETP" doit être un nombre (valeur lue : "abc")',
      '"Nombre d\'ETP" doit être un nombre strictement positif',
    ]);
    expect(result.toCreate.staffing).toEqual([]);
  });

  it("équipe : orthographe de la base ETP retenue ; aucune base ETP = toute équipe inconnue", () => {
    const ok = run(
      sheets({ etp: [etpRow({ "Fonction (équipe, base ETP)": "data &  analytics" })] })
    );
    expect(ok.errors).toEqual([]);
    expect(ok.toCreate.staffing[0].function).toBe("Data & Analytics");

    const none = run(sheets({ etp: [etpRow()] }), existing(), []);
    expect(none.errors.map((e) => e.reason)).toEqual([
      'Équipe "Data & Analytics" absente de la base ETP (attendu : aucune équipe dans la base ETP)',
    ]);
  });

  it("rapproche en tenant compte des dates (deux périodes de la même équipe)", () => {
    const result = run(
      sheets({
        etp: [
          etpRow({ "Nombre d'ETP": 3, "Date début": "2026-04-01", "Date fin": "2026-06-30" }),
          etpRow({ "Nombre d'ETP": 2, "Date début": "2026-01-01", "Date fin": "2026-03-31" }),
        ],
      })
    );
    expect(result.errors).toEqual([]);
    expect(result.toCreate.staffing).toEqual([]);
    // La 2e période (ST-B) passe à 3 ETP ; la 1re (ST-A) est inchangée (note conservée).
    expect(result.toUpdate.staffing.map((s) => [s.id, s.fte])).toEqual([["ST-B", 3]]);
    expect(result.unchanged.staffing).toBe(1);
  });

  it("Précision : vide = conservée, tiret = effacée", () => {
    const keep = run(
      sheets({
        etp: [etpRow({ "ID ligne": "ST-A", "Date début": "", "Date fin": "", "Nombre d'ETP": 2 })],
      })
    );
    expect(keep.errors).toEqual([]);
    expect(keep.unchanged.staffing).toBe(1);

    const clear = run(
      sheets({
        etp: [
          etpRow({
            "ID ligne": "ST-A",
            Précision: "-",
            "Date début": "",
            "Date fin": "",
            "Nombre d'ETP": 2,
          }),
        ],
      })
    );
    expect(clear.toUpdate.staffing).toHaveLength(1);
    expect(clear.toUpdate.staffing[0]).not.toHaveProperty("note");
    expect(clear.toUpdate.staffing[0]).toMatchObject({ id: "ST-A", startDate: "2026-01-01" });
  });

  it("ID ligne copié = erreur sur les deux lignes ; doublon de création = erreur", () => {
    const dup = run(
      sheets({ etp: [etpRow({ "ID ligne": "ST-A" }), etpRow({ "ID ligne": "ST-A" })] })
    );
    expect(dup.errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [2, "staffingDuplicateLineId"],
      [3, "staffingDuplicateLineId"],
    ]);
    const twice = run(sheets({ etp: [etpRow(), etpRow({ Précision: "bis" })] }));
    expect(twice.errors.map((e) => e.code).sort()).toEqual([
      "staffingDuplicateRow",
      "staffingDuplicateRow",
    ]);
    expect(twice.toCreate.staffing).toEqual([]);
  });

  it("chaque message ETP existe à l'identique en français et est traduit (en/de/es)", () => {
    for (const code of Object.keys(STRATEGIC_IMPORT_MESSAGES).filter((c) =>
      c.startsWith("staffing")
    )) {
      const key = `strategicImport.msg.${code}`;
      expect(fr[key], code).toBe(
        STRATEGIC_IMPORT_MESSAGES[code as keyof typeof STRATEGIC_IMPORT_MESSAGES]
      );
      for (const dict of [en, de, es]) expect(dict[key], code).toBeTruthy();
    }
  });
});

describe(`export / réimport .xlsx réel (fuseau ${process.env.TZ ?? "(système)"})`, () => {
  it("dates écrites en vraies cellules date JJ/MM/AAAA, ID ligne exporté", () => {
    const wb = buildStrategicPlanExportWorkbook(existing(), stages, XLSX);
    const projets = wb.Sheets["Projets"];
    const etp = wb.Sheets["ETP"];
    // Projets : F2 = Date début, G2 = Date fin.
    expect(projets["F2"]).toMatchObject({ t: "n", v: 46023, z: "dd/mm/yyyy" });
    expect(projets["G2"]).toMatchObject({ t: "n", v: 46203, z: "dd/mm/yyyy" });
    expect(etp["H1"].v).toBe("ID ligne");
    expect(etp["H2"].v).toBe("ST-A");
    expect(etp["F2"]).toMatchObject({ t: "n", v: 46023, z: "dd/mm/yyyy" });
  });

  it("aller-retour sans modification = 0 création, 0 mise à jour", () => {
    const read = roundTrip(buildStrategicPlanExportWorkbook(existing(), stages, XLSX));
    const result = run(parseStrategicImportWorkbook(read, XLSX));
    expect(result.errors).toEqual([]);
    expect(Object.values(result.toCreate).every((l) => l.length === 0)).toBe(true);
    expect(Object.values(result.toUpdate).every((l) => l.length === 0)).toBe(true);
    expect(result.unchanged.staffing).toBe(2);
  });

  it("date de fin d'une ligne ETP modifiée dans Excel = 1 mise à jour, 0 création", () => {
    const wb = buildStrategicPlanExportWorkbook(existing(), stages, XLSX);
    // ST-A : fin 31/03/2026 → 15/04/2026 (cellule date, comme une saisie Excel).
    wb.Sheets["ETP"]["G2"] = { t: "n", v: 46127, z: "dd/mm/yyyy" };
    const result = run(parseStrategicImportWorkbook(roundTrip(wb), XLSX));
    expect(result.errors).toEqual([]);
    expect(result.toCreate.staffing).toEqual([]);
    expect(result.toUpdate.staffing).toEqual([{ ...lineA, endDate: "2026-04-15" }]);
  });

  it("le modèle relu garde ses dates d'exemple au jour près", () => {
    const read = roundTrip(buildStrategicImportTemplateWorkbook(XLSX));
    const raw = parseStrategicImportWorkbook(read, XLSX);
    const result = validateStrategicImportRows(
      raw,
      { axes: [], chantiers: [], actions: [], indicators: [] },
      companyId,
      programId,
      stages,
      "admin",
      { now: NOW }
    );
    expect(result.errors.filter((e) => e.sheet === "ETP")).toEqual([]);
    expect(result.toCreate.staffing.map((s) => [s.startDate, s.endDate])).toEqual([
      ["2026-01-15", "2026-03-31"],
      ["2026-02-01", "2026-12-31"],
      ["2026-01-01", "2026-06-30"],
    ]);
  });
});

describe("Poids dans le chantier (%) — cellule au format pourcentage d'Excel", () => {
  function workbookWithWeight(cell: XLSX.CellObject | number | string): XLSX.WorkBook {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Code", "Code Chantier", "Nom", "Date début", "Date fin", "Poids dans le chantier (%)"],
        ["P1", "CH1", "Projet 1", "2026-01-01", "2026-06-30", cell],
      ]),
      "Projets"
    );
    return roundTrip(wb);
  }
  const weightOf = (cell: XLSX.CellObject | number | string) => {
    const result = run(parseStrategicImportWorkbook(workbookWithWeight(cell), XLSX));
    return { result, weight: result.toUpdate.actions[0]?.chantierWeightPct };
  };

  it("40 % saisi au format % (0,4 stocké) est lu 40, pas 0,4", () => {
    expect(weightOf({ t: "n", v: 0.4, z: "0%" }).weight).toBe(40);
    expect(weightOf({ t: "n", v: 0.075, z: "0.00%" }).weight).toBe(7.5);
  });

  it("nombre simple et texte « 40 % » inchangés", () => {
    expect(weightOf(40).weight).toBe(40);
    expect(weightOf("40 %").weight).toBe(40);
  });

  it("hors bornes (150 % au format %) = erreur explicite, jamais ramené à 100 en silence", () => {
    const { result, weight } = weightOf({ t: "n", v: 1.5, z: "0%" });
    expect(weight).toBeUndefined();
    // (Classeur réduit à la feuille Projets : les autres feuilles sont signalées absentes.)
    expect(result.errors.filter((e) => e.sheet === "Projets").map((e) => e.reason)).toEqual([
      '"Poids dans le chantier (%)" doit être compris entre 0 et 100 (valeur lue : 150)',
    ]);
  });
});
