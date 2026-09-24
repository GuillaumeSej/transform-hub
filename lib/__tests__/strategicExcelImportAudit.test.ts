import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { XLSX_READ_OPTIONS } from "@/lib/excelParse";
import {
  applyPeopleMapping,
  baselinePeriod,
  buildStrategicPlanExportWorkbook,
  combineStrategicImportWrites,
  countStrategicImportWrites,
  parseStrategicImportWorkbook,
  proposeAccountForName,
  validateStrategicImportRows,
  type StrategicImportExistingData,
  type StrategicImportPreview,
  type StrategicImportRawSheets,
} from "@/lib/strategicExcelImport";
import type { MaturityStageConfig } from "@/types";

/** Tests des correctifs de l'audit du 24/09/2026 sur l'import Excel du plan stratégique. */

const companyId = "C1";
const programId = "P1";
const stages: MaturityStageConfig[] = [
  { id: "defined", order: 1, label: "Défini", programId, companyId },
  { id: "validated", order: 2, label: "Validé", programId, companyId },
  { id: "planned", order: 3, label: "Planifié", programId, companyId },
  { id: "achieved", order: 4, label: "Réalisé", isTerminal: true, programId, companyId },
];
const NOW = new Date(2026, 0, 15); // 15 janvier 2026

const empty = (): StrategicImportExistingData => ({
  axes: [],
  chantiers: [],
  actions: [],
  indicators: [],
  measurements: [],
  staffing: [],
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

const axis = (o: Record<string, unknown> = {}) => ({ Code: "AX1", Nom: "Axe 1", ...o });
const chantier = (o: Record<string, unknown> = {}) => ({
  Code: "CH1",
  "Codes Axes (séparés par ;)": "AX1",
  Nom: "Chantier 1",
  ...o,
});
const projet = (o: Record<string, unknown> = {}) => ({
  Code: "P1",
  "Code Chantier": "CH1",
  Nom: "Projet 1",
  "Date début": "2026-01-01",
  "Date fin": "2026-06-30",
  ...o,
});
const kpi = (o: Record<string, unknown> = {}) => ({
  "Code Axe": "AX1",
  Nom: "KPI",
  Type: "Quantitatif",
  Fréquence: "Mensuelle",
  Objectif: "Atteindre 80",
  "Valeur cible": 80,
  "Rôles responsables (séparés par ;)": "strategic_lead",
  ...o,
});

const run = (
  s: StrategicImportRawSheets,
  existing = empty(),
  users?: { username: string; name: string }[]
) =>
  validateStrategicImportRows(s, existing, companyId, programId, stages, "admin", {
    users,
    now: NOW,
  });

/** Simule l'écriture : l'existant devient l'existant + créations + mises à jour. */
function applyToExisting(
  existing: StrategicImportExistingData,
  preview: StrategicImportPreview
): StrategicImportExistingData {
  const w = combineStrategicImportWrites(preview);
  const upsert = <T extends { id: string }>(list: T[], add: T[]) => {
    const byId = new Map(list.map((e) => [e.id, e]));
    for (const e of add) byId.set(e.id, e);
    return Array.from(byId.values());
  };
  return {
    axes: upsert(existing.axes, w.axes),
    chantiers: upsert(existing.chantiers, w.chantiers),
    actions: upsert(existing.actions, w.actions),
    indicators: upsert(existing.indicators, w.indicators),
    measurements: upsert(existing.measurements ?? [], w.measurements),
    staffing: upsert(existing.staffing ?? [], w.staffing),
  };
}

function loadFixture() {
  const buf = readFileSync(path.join(__dirname, "fixtures", "plan_strategique_pre-rempli.xlsx"));
  return XLSX.read(buf, XLSX_READ_OPTIONS);
}

describe("#1 personnes : Owner/Pilote/Sponsor stockés en username", () => {
  const users = [
    { username: "marc.dubois", name: "Marc Dubois" },
    { username: "iroy", name: "Isabelle Roy" },
    { username: "paul.martin", name: "P. Martin" },
    { username: "jdoe", name: "Jean Dupont" },
    { username: "jdoe2", name: "Jean Dupont" },
  ];

  it("rapproche par nom affiché (casse/accents), identifiant ou e-mail et réécrit en username", () => {
    const result = run(
      sheets({
        axes: [axis({ Owner: "MARC DUBOIS" })],
        chantiers: [chantier({ Pilote: "iroy" })],
        actions: [projet({ Owner: "iroy@acme.fr", Sponsor: "Isabelle Rôy" })],
      }),
      empty(),
      users
    );
    expect(result.errors).toEqual([]);
    expect(result.toCreate.axes[0].owner).toBe("marc.dubois");
    expect(result.toCreate.chantiers[0].pilote).toBe("iroy");
    expect(result.toCreate.actions[0].owner).toBe("iroy");
    expect(result.toCreate.actions[0].sponsor).toBe("iroy");
    expect(result.people).toEqual([]);
  });

  it("non rapproché : texte conservé + avertissement ; proposition de compte seulement pour « Prénom Nom »", () => {
    const result = run(
      sheets({
        axes: [axis({ Owner: "DG" }), axis({ Code: "AX2", Nom: "Axe 2", Owner: "Équipe Data" })],
        chantiers: [chantier({ Pilote: "Claire Fontaine" })],
        actions: [projet({ Owner: "Paul Martin", Sponsor: "Jean Dupont" })],
      }),
      empty(),
      users
    );
    expect(result.errors).toEqual([]);
    expect(result.toCreate.axes[0].owner).toBe("DG");
    const byName = new Map(result.people.map((p) => [p.name, p]));
    expect(byName.get("DG")?.kind).toBe("not_a_person");
    expect(byName.get("Équipe Data")?.kind).toBe("not_a_person");
    expect(byName.get("Claire Fontaine")).toMatchObject({
      kind: "proposable",
      username: "claire.fontaine",
    });
    // Collision : "paul.martin" existe déjà (autre personne) → suffixe signalé.
    expect(byName.get("Paul Martin")).toMatchObject({
      kind: "proposable",
      username: "paul.martin2",
      collisionWith: "paul.martin",
    });
    // Homonymes : jamais proposé ni rattaché.
    expect(byName.get("Jean Dupont")?.kind).toBe("ambiguous");
    expect(result.warnings.filter((w) => w.code === "personNotLinked")).toHaveLength(4);
    expect(result.warnings.filter((w) => w.code === "personAmbiguous")).toHaveLength(1);

    // Après création des comptes : réécriture en username avant l'écriture.
    const claire = byName.get("Claire Fontaine")!;
    const writes = applyPeopleMapping(
      combineStrategicImportWrites(result),
      new Map([[claire.key, claire.username!]])
    );
    expect(writes.chantiers[0].pilote).toBe("claire.fontaine");
    expect(writes.axes[0].owner).toBe("DG");
  });

  it("ne propose jamais de compte pour un seul mot, un sigle ou une équipe", () => {
    expect(proposeAccountForName("DG")).toBeUndefined();
    expect(proposeAccountForName("Direction Financière")).toBeUndefined();
    expect(proposeAccountForName("Squad data")).toBeUndefined();
    expect(proposeAccountForName("M. Dubois 2")).toBeUndefined();
    expect(proposeAccountForName("Élodie Marchand")).toEqual({
      firstName: "Élodie",
      lastName: "Marchand",
      username: "elodie.marchand",
    });
  });
});

describe("#3 ré-import idempotent (upsert) + export aller-retour", () => {
  it("réimporter le même fichier = 0 création, 0 mise à jour", () => {
    const first = run(parseStrategicImportWorkbook(loadFixture(), XLSX));
    expect(first.errors).toEqual([]);
    const existing = applyToExisting(empty(), first);

    const second = run(parseStrategicImportWorkbook(loadFixture(), XLSX), existing);
    expect(second.errors).toEqual([]);
    expect(countStrategicImportWrites(second.toCreate)).toBe(0);
    expect(countStrategicImportWrites(second.toUpdate)).toBe(0);
    expect(second.unchanged).toMatchObject({ axes: 4, chantiers: 14, actions: 43, indicators: 50 });
  });

  it("export puis réimport sans modification = 0 changement ; une modification = 1 mise à jour", () => {
    const first = run(parseStrategicImportWorkbook(loadFixture(), XLSX));
    const existing = applyToExisting(empty(), first);

    const exported = buildStrategicPlanExportWorkbook(existing, stages, XLSX);
    const reread = () =>
      XLSX.read(XLSX.write(exported, { type: "array", bookType: "xlsx" }), XLSX_READ_OPTIONS);

    const roundTrip = run(parseStrategicImportWorkbook(reread(), XLSX), existing);
    expect(roundTrip.errors).toEqual([]);
    expect(countStrategicImportWrites(roundTrip.toCreate)).toBe(0);
    expect(countStrategicImportWrites(roundTrip.toUpdate)).toBe(0);

    const wb = reread();
    const axesRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Axes"], {
      defval: "",
    });
    axesRows[0]["Nom"] = "Axe renommé";
    wb.Sheets["Axes"] = XLSX.utils.json_to_sheet(axesRows);
    const modified = run(parseStrategicImportWorkbook(wb, XLSX), existing);
    expect(countStrategicImportWrites(modified.toCreate)).toBe(0);
    expect(modified.toUpdate.axes).toHaveLength(1);
    expect(modified.toUpdate.axes[0].name).toBe("Axe renommé");
    expect(modified.toUpdate.axes[0].id).toBe(existing.axes[0].id);
  });

  it("rapproche par nom dans le même parent une entité sans Code (créée à la main)", () => {
    const existing = empty();
    existing.axes = [
      {
        id: "ax-manual",
        companyId,
        programId,
        name: "Axe 1",
        stage: "defined",
        createdAt: "2026-01-01",
        lastUpdate: "2026-01-01",
      },
    ];
    const result = run(sheets({ axes: [axis({ Description: "Nouvelle description" })] }), existing);
    expect(result.toCreate.axes).toHaveLength(0);
    expect(result.toUpdate.axes[0]).toMatchObject({
      id: "ax-manual",
      description: "Nouvelle description",
      importCode: "AX1",
    });
  });
});

describe("#4 dates", () => {
  it("rejette une date impossible et une date de début postérieure à la fin", () => {
    const result = run(
      sheets({
        axes: [axis()],
        chantiers: [chantier()],
        actions: [
          projet({ "Date début": "31/02/2026" }),
          projet({ Code: "P2", "Date début": "2026-07-01", "Date fin": "2026-06-30" }),
          projet({ Code: "P3", "Date début": "01/03/2026", "Date fin": "2026-12-31" }),
        ],
      })
    );
    expect(result.errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [2, "invalidDate"],
      [3, "startAfterEnd"],
    ]);
    expect(result.toCreate.actions).toHaveLength(1);
    expect(result.toCreate.actions[0].start).toBe("2026-03-01");
  });
});

describe("#6 valeurs numériques des indicateurs", () => {
  it("Valeur cible illisible = erreur ; '80 %' accepté ; Valeur initiale illisible = avertissement", () => {
    const result = run(
      sheets({
        axes: [axis()],
        indicateurs: [
          kpi({ Nom: "Cible texte", "Valeur cible": "quatre-vingts" }),
          kpi({ Nom: "Cible %", "Valeur cible": "80 %" }),
          kpi({ Nom: "Initiale texte", "Valeur initiale": "n/a" }),
        ],
      })
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ rowNumber: 2, code: "notNumber" });
    expect(result.toCreate.indicators.map((i) => [i.name, i.objectiveValue])).toEqual([
      ["Cible %", 80],
      ["Initiale texte", 80],
    ]);
    expect(result.warnings.map((w) => w.code)).toContain("baselineNotNumber");
    expect(result.toCreate.measurements).toHaveLength(0);
  });
});

describe("#8/#9 statut et période de la mesure de référence", () => {
  it("calcule le statut à partir de la baseline et la date une période AVANT la période courante", () => {
    const result = run(
      sheets({
        axes: [axis()],
        indicateurs: [
          kpi({ Nom: "Sous la cible", "Valeur initiale": 40 }),
          kpi({ Nom: "Au-dessus", "Valeur initiale": 90, Fréquence: "Trimestriel" }),
          kpi({ Nom: "Baisse", "Valeur initiale": 90, Sens: "Baisse", Fréquence: "Annuel" }),
          kpi({ Nom: "Sans baseline" }),
        ],
      })
    );
    expect(result.errors).toEqual([]);
    const status = Object.fromEntries(result.toCreate.indicators.map((i) => [i.name, i.status]));
    expect(status).toEqual({
      "Sous la cible": "at_risk",
      "Au-dessus": "on_track",
      Baisse: "at_risk",
      "Sans baseline": "on_track",
    });
    const baisse = result.toCreate.indicators.find((i) => i.name === "Baisse")!;
    expect(baisse.direction).toBe("down");
    expect(baisse.frequency).toBe("annual");
    expect(result.toCreate.measurements.map((m) => m.period)).toEqual([
      "2025-12",
      "2025-Q4",
      "2025",
    ]);
    expect(baselinePeriod("semiannual", NOW)).toBe("2025-S2");
  });
});

describe("points mineurs", () => {
  it("dépendances : type insensible à la casse, type inconnu / auto-dépendance / cycle = erreur", () => {
    const result = run(
      sheets({
        axes: [axis()],
        chantiers: [
          chantier(),
          chantier({ Code: "CH2", Nom: "C2", "Dépendances (Code:type, séparées par ;)": "ch1:ss" }),
          chantier({ Code: "CH3", Nom: "C3", "Dépendances (Code:type, séparées par ;)": "CH1:XX" }),
          chantier({ Code: "CH4", Nom: "C4", "Dépendances (Code:type, séparées par ;)": "CH4" }),
          chantier({ Code: "CH5", Nom: "C5", "Dépendances (Code:type, séparées par ;)": "CH6:FS" }),
          chantier({ Code: "CH6", Nom: "C6", "Dépendances (Code:type, séparées par ;)": "CH5:FS" }),
        ],
      })
    );
    expect(result.errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [4, "depBadType"],
      [5, "depSelf"],
      [6, "depCycle"],
      [7, "depCycle"],
    ]);
    const ch1 = result.toCreate.chantiers.find((c) => c.name === "Chantier 1")!;
    const ch2 = result.toCreate.chantiers.find((c) => c.name === "C2")!;
    expect(ch2.dependencies).toEqual([{ targetId: ch1.id, type: "SS" }]);
  });

  it("poids 0–100 et budgets >= 0, longueurs maximales", () => {
    const result = run(
      sheets({
        axes: [axis({ Nom: "x".repeat(201) }), axis({ Code: "AX2", Nom: "Axe 2" })],
        chantiers: [chantier({ "Codes Axes (séparés par ;)": "AX2", "Budget alloué": -5 })],
        actions: [projet({ "Code Chantier": "CH1", "Poids dans le chantier (%)": 150 })],
      })
    );
    expect(result.errors.map((e) => [e.sheet, e.code])).toEqual([
      ["Axes", "tooLong"],
      ["Chantiers", "negative"],
      ["Projets", "chantierNotFound"],
    ]);
    const weight = run(
      sheets({
        axes: [axis()],
        chantiers: [chantier()],
        actions: [projet({ "Poids dans le chantier (%)": 150 })],
      })
    );
    expect(weight.errors.map((e) => e.code)).toEqual(["outOfRange"]);
  });

  it("en-têtes : variantes de casse/accents, ancien 'Code Axe', colonne inconnue, colonnes manquantes signalées une fois", () => {
    const result = run(
      sheets({
        axes: [{ code: "AX1", NOM: "Axe 1", "etape de maturite": "validé", Commentaire: "x" }],
        chantiers: [{ Code: "CH1", "Code Axe": "AX1", Nom: "Chantier 1" }],
        actions: [
          { Code: "P1", "Code Chantier": "CH1", Nom: "P" },
          { Code: "P2", "Code Chantier": "CH1", Nom: "Q" },
        ],
      })
    );
    expect(result.toCreate.axes[0]).toMatchObject({ name: "Axe 1", stage: "validated" });
    expect(result.toCreate.chantiers).toHaveLength(1);
    expect(result.warnings.find((w) => w.code === "unknownColumns")?.vars).toEqual({
      columns: "Commentaire",
    });
    const missing = result.errors.filter((e) => e.code === "missingColumns");
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ sheet: "Projets", rowNumber: 1 });
    expect(missing[0].reason).toMatch(/Date début, Date fin/);
  });

  it("feuille obligatoire absente = erreur explicite ; ancienne feuille 'Actions' acceptée", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Code", "Nom"],
        ["AX1", "Axe 1"],
      ]),
      "Axes"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Code", "Codes Axes (séparés par ;)", "Nom"],
        ["CH1", "AX1", "C1"],
        ["", "", ""],
        ["CH2", "AX9", "C2"],
      ]),
      "Chantiers"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Code", "Code Chantier", "Nom", "Date début", "Date fin"],
        ["P1", "CH1", "P", "2026-01-01", "2026-02-01"],
      ]),
      "Actions"
    );
    const result = run(
      parseStrategicImportWorkbook(
        XLSX.read(XLSX.write(wb, { type: "array" }), XLSX_READ_OPTIONS),
        XLSX
      )
    );
    expect(result.toCreate.actions).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain("sheetAlias");
    expect(result.errors.map((e) => [e.sheet, e.code])).toEqual([
      ["Indicateurs", "sheetMissing"],
      // Ligne vide sautée : le numéro reste celui du fichier (ligne 4).
      ["Chantiers", "axesNotFound"],
    ]);
    expect(result.errors[1].rowNumber).toBe(4);
  });
});
