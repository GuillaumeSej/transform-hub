import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readXlsxWorkbook } from "@/lib/excelParse";
import {
  STRATEGIC_IMPORT_GUIDE_ROWS,
  STRATEGIC_IMPORT_MESSAGES,
  buildStrategicImportTemplateWorkbook,
  buildStrategicPlanExportWorkbook,
  parseStrategicImportWorkbook,
  validateStrategicImportRows,
  type StrategicImportExistingData,
  type StrategicImportRawSheets,
} from "@/lib/strategicExcelImport";
import {
  STAFFING_TEAMS_EMPTY_TEXT,
  STAFFING_TEAMS_RULE,
  STAFFING_TEAMS_SHEET_NAME,
} from "@/lib/staffingExcelImport";
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
/** Effectif disponible par équipe (base ETP) : feuille "Équipes" et avertissement ETP > effectif. */
const fteByTeam: Record<string, number> = { "Data & Analytics": 14, "Ressources Humaines": 2.5 };
const teams = { knownDepartments, fteByTeam };

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
    teamAvailableFte: fteByTeam,
  });

/** Écrit le classeur en .xlsx puis le relit comme l'appli. */
function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readXlsxWorkbook(XLSX, bytes);
}

describe("feuille ETP — même règle que l'écran et l'import Effectifs", () => {
  it("accepte 7 ETP (plus de plafond) ; refuse une équipe hors base ETP, des dates manquantes, « abc », 0 et -1", () => {
    const result = run(
      sheets({
        etp: [
          etpRow({ "Nombre d'ETP": 7 }),
          etpRow({ "Fonction (équipe, base ETP)": "Astrologie" }),
          etpRow({ "Date fin": "" }),
          etpRow({ "Nombre d'ETP": "abc" }),
          etpRow({ "Nombre d'ETP": 0 }),
          etpRow({ "Nombre d'ETP": -1 }),
        ],
      })
    );
    // (Lecture des cellules puis règle commune : on trie par ligne pour comparer.)
    const errors = [...result.errors].sort((a, b) => a.rowNumber - b.rowNumber);
    expect(errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [3, "staffingUnknownTeam"],
      [4, "requiredDate"],
      [5, "notNumber"],
      [6, "notPositive"],
      [7, "notPositive"],
    ]);
    expect(errors.map((e) => e.reason)).toEqual([
      'Équipe "Astrologie" absente de la base ETP (attendu : Data & Analytics, Ressources Humaines)',
      '"Date fin" est obligatoire (date JJ/MM/AAAA ou AAAA-MM-JJ)',
      '"Nombre d\'ETP" doit être un nombre (valeur lue : "abc")',
      '"Nombre d\'ETP" doit être un nombre strictement positif',
      '"Nombre d\'ETP" doit être un nombre strictement positif',
    ]);
    // 7 ETP pour une équipe de 14 : créé, sans avertissement.
    expect(result.toCreate.staffing.map((s) => s.fte)).toEqual([7]);
    expect(result.warnings.filter((w) => w.sheet === "ETP")).toEqual([]);
  });

  it("au-delà de l'effectif de l'équipe dans la base ETP : avertissement, ligne importée", () => {
    const result = run(
      sheets({
        etp: [
          etpRow({ "Nombre d'ETP": 50 }),
          etpRow({
            "Fonction (équipe, base ETP)": "Ressources Humaines",
            "Nombre d'ETP": "2,5",
          }),
          etpRow({
            "Fonction (équipe, base ETP)": "Ressources Humaines",
            "Nombre d'ETP": 3,
            "Date début": "2026-08-01",
          }),
        ],
      })
    );
    expect(result.errors).toEqual([]);
    expect(result.toCreate.staffing.map((s) => [s.function, s.fte])).toEqual([
      ["Data & Analytics", 50],
      ["Ressources Humaines", 2.5],
      ["Ressources Humaines", 3],
    ]);
    const etpWarnings = result.warnings.filter((w) => w.sheet === "ETP");
    expect(etpWarnings.map((w) => [w.rowNumber, w.code])).toEqual([
      [2, "staffingFteAboveTeam"],
      [4, "staffingFteAboveTeam"],
    ]);
    expect(etpWarnings[0].reason).toBe(
      "50 ETP sur cette ligne, au-delà de l'effectif de l'équipe Data & Analytics dans la base ETP (14 ETP) — vérifiez la saisie"
    );
    // Effectif inconnu (base non chargée) : aucun avertissement.
    const unknown = validateStrategicImportRows(
      sheets({ etp: [etpRow({ "Nombre d'ETP": 50 })] }),
      existing(),
      companyId,
      programId,
      stages,
      "admin",
      { now: NOW, knownDepartments }
    );
    expect(unknown.errors).toEqual([]);
    expect(unknown.warnings.filter((w) => w.sheet === "ETP")).toEqual([]);
    expect(unknown.toCreate.staffing).toHaveLength(1);
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
    const wb = buildStrategicPlanExportWorkbook(existing(), stages, XLSX, teams);
    const projets = wb.Sheets["Projets"];
    const etp = wb.Sheets["ETP"];
    // Projets : F2 = Date début, G2 = Date fin.
    expect(projets["F2"]).toMatchObject({ t: "n", v: 46023, z: "dd/mm/yyyy" });
    expect(projets["G2"]).toMatchObject({ t: "n", v: 46203, z: "dd/mm/yyyy" });
    expect(etp["H1"].v).toBe("ID ligne");
    expect(etp["H2"].v).toBe("ST-A");
    expect(etp["F2"]).toMatchObject({ t: "n", v: 46023, z: "dd/mm/yyyy" });
  });

  it("aller-retour sans modification = 0 création, 0 mise à jour ; onglet Équipes présent et ignoré", () => {
    const read = roundTrip(buildStrategicPlanExportWorkbook(existing(), stages, XLSX, teams));
    // Onglet Équipes à côté de la feuille ETP : équipes de la base ETP + effectif disponible.
    expect(read.SheetNames.slice(-2)).toEqual(["ETP", STAFFING_TEAMS_SHEET_NAME]);
    expect(
      XLSX.utils.sheet_to_json<unknown[]>(read.Sheets[STAFFING_TEAMS_SHEET_NAME], { header: 1 })
    ).toEqual([
      ["Équipe", "Effectif disponible (ETP)"],
      ["Data & Analytics", 14],
      ["Ressources Humaines", 2.5],
    ]);
    const raw = parseStrategicImportWorkbook(read, XLSX);
    expect(raw.missingSheets).toEqual([]);
    expect(Object.keys(raw)).not.toContain(STAFFING_TEAMS_SHEET_NAME);
    const result = run(raw);
    expect(result.errors).toEqual([]);
    expect(result.warnings.filter((w) => w.sheet === "ETP")).toEqual([]);
    expect(Object.values(result.toCreate).every((l) => l.length === 0)).toBe(true);
    expect(Object.values(result.toUpdate).every((l) => l.length === 0)).toBe(true);
    expect(result.unchanged.staffing).toBe(2);
  });

  it("date de fin d'une ligne ETP modifiée dans Excel = 1 mise à jour, 0 création", () => {
    const wb = buildStrategicPlanExportWorkbook(existing(), stages, XLSX, teams);
    // ST-A : fin 31/03/2026 → 15/04/2026 (cellule date, comme une saisie Excel).
    wb.Sheets["ETP"]["G2"] = { t: "n", v: 46127, z: "dd/mm/yyyy" };
    const result = run(parseStrategicImportWorkbook(roundTrip(wb), XLSX));
    expect(result.errors).toEqual([]);
    expect(result.toCreate.staffing).toEqual([]);
    expect(result.toUpdate.staffing).toEqual([{ ...lineA, endDate: "2026-04-15" }]);
  });

  it("le modèle : onglet Équipes (ligne explicative si la base ETP est vide), règle dans le Lisez-moi", () => {
    const read = roundTrip(buildStrategicImportTemplateWorkbook(XLSX, teams));
    expect(read.SheetNames).toContain(STAFFING_TEAMS_SHEET_NAME);
    expect(
      XLSX.utils.sheet_to_json<unknown[]>(read.Sheets[STAFFING_TEAMS_SHEET_NAME], { header: 1 })
    ).toHaveLength(3);
    const empty = roundTrip(
      buildStrategicImportTemplateWorkbook(XLSX, { knownDepartments: [], fteByTeam: {} })
    );
    expect(
      XLSX.utils.sheet_to_json<unknown[]>(empty.Sheets[STAFFING_TEAMS_SHEET_NAME], { header: 1 })
    ).toEqual([["Équipe", "Effectif disponible (ETP)"], [STAFFING_TEAMS_EMPTY_TEXT]]);
    const guide = STRATEGIC_IMPORT_GUIDE_ROWS.flat().join("\n");
    expect(guide).toContain(STAFFING_TEAMS_RULE);
    expect(guide).not.toMatch(/au plus \d/);
  });

  it("lot 5 — modèle : exemples ETP commentés, avec les VRAIES équipes de la base ETP ; décommentés, ils s'importent sans erreur et gardent leurs dates", () => {
    const read = roundTrip(buildStrategicImportTemplateWorkbook(XLSX, teams));
    const raw = parseStrategicImportWorkbook(read, XLSX);
    const empty = { axes: [], chantiers: [], actions: [], indicators: [] };
    const validate = (s: StrategicImportRawSheets) =>
      validateStrategicImportRows(s, empty, companyId, programId, stages, "admin", {
        now: NOW,
        knownDepartments,
        teamAvailableFte: fteByTeam,
      });
    // Tel quel : lignes ETP commentées = ignorées (avant : équipes fictives → erreurs).
    const asIs = validate(raw);
    expect(asIs.errors).toEqual([]);
    expect(asIs.toCreate.staffing).toEqual([]);
    const examples = raw.etp.filter((r) => /^# CH\d$/.test(String(r["Code Chantier"])));
    expect(examples.map((r) => r["Fonction (équipe, base ETP)"])).toEqual([
      "Data & Analytics",
      "Ressources Humaines",
      "Data & Analytics",
    ]);
    // « # » retiré : importés, dates au jour près.
    const uncommented = validate({
      ...raw,
      etp: raw.etp.map((r) =>
        /^# CH\d$/.test(String(r["Code Chantier"]))
          ? { ...r, "Code Chantier": String(r["Code Chantier"]).slice(2) }
          : r
      ),
    });
    expect(uncommented.errors).toEqual([]);
    expect(uncommented.toCreate.staffing.map((s) => [s.function, s.startDate, s.endDate])).toEqual([
      ["Data & Analytics", "2026-01-15", "2026-03-31"],
      ["Ressources Humaines", "2026-02-01", "2026-12-31"],
      ["Data & Analytics", "2026-01-01", "2026-06-30"],
    ]);
    // Base ETP vide : une ligne explicative commentée, aucune équipe inventée.
    const none = parseStrategicImportWorkbook(
      roundTrip(
        buildStrategicImportTemplateWorkbook(XLSX, { knownDepartments: [], fteByTeam: {} })
      ),
      XLSX
    );
    expect(none.etp.every((r) => String(r["Code Chantier"]).startsWith("#"))).toBe(true);
    expect(validate(none).errors).toEqual([]);
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
