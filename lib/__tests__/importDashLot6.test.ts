import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { EXCEL_NOT_CLEARABLE_MESSAGE } from "@/lib/excelCells";
import { convertExcelPercentCells, readXlsxWorkbook } from "@/lib/excelParse";
import { readSpreadsheet } from "@/lib/excelFileRead";
import {
  ACTION_IMPORT_HEADERS,
  LEVER_IMPORT_MESSAGES,
  leverImportHelpRows,
  validateLeverImportRows,
  type LeverImportRawSheets,
} from "@/lib/leverExcelImport";
import {
  IMPACT_EXPORT_HEADERS,
  leverActionsToExcelRows,
  leverImpactsToExcelRows,
  leverToExcelRow,
} from "@/lib/leverExcel";
import {
  STRATEGIC_IMPORT_GUIDE_ROWS,
  STRATEGIC_IMPORT_MESSAGES,
  buildStrategicPlanExportWorkbook,
  parseStrategicImportWorkbook,
  validateStrategicImportRows,
  type StrategicImportExistingData,
} from "@/lib/strategicExcelImport";
import {
  HR_EMPLOYEE_HEADERS,
  HR_EMPLOYEE_NOT_CLEARABLE,
  HR_EMPLOYEE_SHEET,
  HR_IMPORT_ISSUES,
  HR_MOVEMENT_HEADERS,
  HR_MOVEMENT_NOT_CLEARABLE,
  HR_MOVEMENT_SHEET,
  buildHrImportPlan,
  employeeToExcelRow,
  movementToExcelRow,
} from "@/lib/hrExcel";
import {
  STAFFING_IMPORT_ISSUES,
  STAFFING_IMPORT_SHEET_NAME,
  STAFFING_NOT_CLEARABLE,
  buildStaffingExportWorkbook,
  buildStaffingTemplateRows,
  readStaffingImportSheet,
  validateStaffingImportRows,
} from "@/lib/staffingExcelImport";
import {
  HIERARCHY_IMPORT_ISSUES,
  hierarchyToExcelRows,
  validateHierarchyImportRows,
} from "@/lib/hierarchyExcel";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";
import de from "@/lib/i18n/dictionaries/de";
import es from "@/lib/i18n/dictionaries/es";
import type {
  BeTrackData,
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Employee,
  HierarchyLevelDef,
  HierarchyNode,
  Indicator,
  Lever,
  MaturityStageConfig,
  StrategicAxis,
  WorkforceMovement,
} from "@/types";

/**
 * Lot 6 (contrôle du 03/10, décision PO) — règle du tiret dans TOUS les imports Excel :
 *  - cellule vide = valeur conservée ;
 *  - « - » (ou « – », « — ») dans une colonne FACULTATIVE = champ effacé ;
 *  - « - » dans une colonne OBLIGATOIRE ou un identifiant = ERREUR BLOQUANTE `notClearable`
 *    (message dédié commun, `EXCEL_NOT_CLEARABLE_MESSAGE`), contrôlée avant toute résolution :
 *    jamais un chantier « - » créé, un nom « - » enregistré, un « Axe introuvable : - », un
 *    « Type "-" inconnu », un nombre illisible ou un simple avertissement.
 * Allers-retours .xlsx réels (export → édition → relecture comme l'appli → import).
 */

const DASHES = ["-", "–", "—"];
/** Aucune valeur « tiret » n'est jamais écrite (créations / mises à jour). */
const noDashWritten = (writes: unknown) => expect(JSON.stringify(writes)).not.toMatch(/"[-–—]"/);

// ---------------------------------------------------------------------------------------------
// Leviers (3 feuilles)
// ---------------------------------------------------------------------------------------------

type LeverCtx = Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">;
const workstreams: LeverCtx["workstreams"] = [
  { id: "WS-PROC", name: "Achats & Supply Chain", sponsor: "IR", color: "#000", target: 0 },
];
const pnlAccounts: LeverCtx["pnlAccounts"] = [
  { id: "GA", name: "General & Admin", baseline: -72, sign: -1 },
];
const leverPrograms = [{ id: "p1", name: "Programme 1" }];

const baseLever: Lever = {
  id: "c1-L001",
  programId: "p1",
  code: "PROC-001",
  type: "Sourcing",
  name: "Optimisation achats",
  ws: "WS-PROC",
  owner: "Marc Dubois",
  ownerInit: "MD",
  sponsor: "Isabelle Roy",
  sponsorInit: "IR",
  geography: "Europe",
  country: "France",
  entity: "Acme",
  function: "Procurement",
  costCenter: "CC-1",
  pnlMap: "GA",
  start: "2026-01-15",
  end: "2026-12-31",
  status: "in_progress",
  progress: 0,
  risk: "low",
  grossSavings: 2.5,
  netSavings: 2.1,
  opexOneOff: 0.4,
  opexRec: 0.4,
  capex: 0.3,
  fteImpact: -1,
  companyId: "c1",
  dependencies: [],
  description: "Description",
  createdAt: "2025-01-01",
  lastUpdate: "2025-01-01",
  actions: [
    {
      id: "ACT-1",
      name: "Renégocier les contrats",
      owner: "Marc Dubois",
      start: "2026-01-15",
      end: "2026-04-30",
      status: "in_progress",
    },
  ],
  impacts: [
    {
      id: "IMP-C",
      label: "Outil e-sourcing",
      type: "cost",
      nature: "capex",
      amount: 0.3,
      capexDeploymentDate: "2026-03-01",
    },
    {
      id: "IMP-S",
      label: "Renégociation",
      type: "saving",
      nature: "opex_rec",
      amount: 1,
      gainDate: "2026-07-01",
      comments: [{ user: "Marc", ts: "2026-01-02", text: "Hypothèse prudente" }],
    },
  ],
};

const leverCtx = (): LeverCtx => ({
  levers: [structuredClone(baseLever)],
  workstreams,
  pnlAccounts,
});

function exportLevers(): LeverImportRawSheets {
  const levers = [baseLever];
  const data = { ...leverCtx(), program: {}, alerts: [] } as unknown as BeTrackData;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      levers.map((l) => leverToExcelRow(l, data, [], undefined, undefined, leverPrograms))
    ),
    "Leviers"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(levers.flatMap(leverActionsToExcelRows), {
      header: [...ACTION_IMPORT_HEADERS],
    }),
    "Actions"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      levers.flatMap((l) => leverImpactsToExcelRows(l)),
      { header: IMPACT_EXPORT_HEADERS }
    ),
    "Impacts"
  );
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const read = convertExcelPercentCells(readXlsxWorkbook(XLSX, buf));
  const sheet = (name: string) =>
    XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets[name], { defval: "" });
  return { leviers: sheet("Leviers"), actions: sheet("Actions"), impacts: sheet("Impacts") };
}

const importLevers = (sheets: LeverImportRawSheets) =>
  validateLeverImportRows(sheets, leverCtx(), "c1", leverPrograms, undefined, "p1", {
    importer: { name: "Paul Import", username: "pimport", profiles: [] },
  });

type LeverSheetKey = "leviers" | "actions" | "impacts";
const LEVER_SHEET_LABEL: Record<LeverSheetKey, string> = {
  leviers: "Leviers",
  actions: "Actions",
  impacts: "Impacts",
};
function setLeverCells(
  sheets: LeverImportRawSheets,
  key: LeverSheetKey,
  patch: Record<string, unknown>,
  only: (row: Record<string, unknown>) => boolean = () => true
): LeverImportRawSheets {
  return {
    ...sheets,
    [key]: sheets[key]!.map((r) => (only(r) ? { ...r, ...patch } : r)),
  };
}

/** Colonnes obligatoires (ou identifiants) des 3 feuilles leviers. */
const LEVER_MANDATORY: [LeverSheetKey, string][] = [
  ["leviers", "Code"],
  ["leviers", "Nom du levier"],
  ["leviers", "Chantier"],
  ["leviers", "Statut"],
  ["leviers", "Compte P&L impacté"],
  ["leviers", "Date de départ"],
  ["leviers", "Date de fin estimée"],
  ["leviers", "Programme"],
  ["actions", "Code Levier"],
  ["actions", "Nom de l'action"],
  ["actions", "Statut"],
  ["actions", "Date début"],
  ["actions", "Date fin"],
  ["actions", "ID action"],
  ["impacts", "Code Levier"],
  ["impacts", "Type"],
  ["impacts", "Montant (€M)"],
  ["impacts", "Nature"], // obligatoire pour un coût
];

describe("lot 6 — import leviers : tiret dans une colonne obligatoire", () => {
  it("aller-retour sans modification : 0 changement, aucune anomalie", () => {
    const p = importLevers(exportLevers());
    expect(p.errors).toEqual([]);
    expect(p.warnings).toEqual([]);
    expect(p.updateCount).toBe(0);
    expect(p.unchangedCount).toBe(1);
    expect(p.toUpsert).toEqual([]);
  });

  for (const [key, column] of LEVER_MANDATORY) {
    it(`« - » dans « ${column} » (${LEVER_SHEET_LABEL[key]}) = erreur bloquante notClearable`, () => {
      const only =
        column === "Nature" ? (r: Record<string, unknown>) => r["Type"] === "Coût" : undefined;
      const p = importLevers(setLeverCells(exportLevers(), key, { [column]: "-" }, only));
      expect(p.errors.length).toBeGreaterThan(0);
      expect(p.errors[0]).toMatchObject({
        sheet: LEVER_SHEET_LABEL[key],
        code: "notClearable",
        vars: { field: column },
      });
      expect(p.errors[0].reason).toBe(EXCEL_NOT_CLEARABLE_MESSAGE.replace("{column}", column));
      // Jamais de message générique (chantier/statut/compte/type inconnu, nombre ou date
      // illisible) — seule conséquence : les lignes Actions/Impacts du levier refusé.
      for (const e of p.errors) expect(["notClearable", "leverRowRejected"]).toContain(e.code);
      expect(p.toCreateWorkstreams).toEqual([]);
      if (key === "leviers") expect(p.toUpsert).toEqual([]);
      noDashWritten(p.toUpsert);
    });
  }

  it("MAJEUR — « - » dans Chantier : aucun chantier « - » créé, levier non rattaché", () => {
    for (const dash of DASHES) {
      const p = importLevers(setLeverCells(exportLevers(), "leviers", { Chantier: dash }));
      expect(p.toCreateWorkstreams).toEqual([]);
      expect(p.toUpsert).toEqual([]);
      expect(p.errors.map((e) => [e.sheet, e.code, e.vars?.field])).toEqual([
        ["Leviers", "notClearable", "Chantier"],
        // Lignes du levier refusé (1 action, 2 impacts) : ignorées, rien n'est écrit.
        ["Actions", "leverRowRejected", undefined],
        ["Impacts", "leverRowRejected", undefined],
        ["Impacts", "leverRowRejected", undefined],
      ]);
    }
  });

  it("« - » dans un nouveau levier (Code) : rien n'est créé", () => {
    const p = importLevers(setLeverCells(exportLevers(), "leviers", { Code: "–" }));
    expect(p.createCount).toBe(0);
    expect(p.toUpsert).toEqual([]);
  });
});

describe("lot 6 — import leviers : tiret dans une colonne facultative = effacé", () => {
  it("Owner, Description, Dépendances du levier ; Owner de l'action", () => {
    let sheets = setLeverCells(exportLevers(), "leviers", {
      Owner: "-",
      Description: "-",
      "Dépendances (ID:type, séparées par ;)": "-",
    });
    sheets = setLeverCells(sheets, "actions", { Owner: "—" });
    const p = importLevers(sheets);
    expect(p.errors).toEqual([]);
    const [l] = p.toUpsert;
    expect(l).toMatchObject({ code: "PROC-001", owner: "", description: "", dependencies: [] });
    expect(l.actions?.[0]).toMatchObject({ id: "ACT-1", name: "Renégocier les contrats" });
    expect(l.actions?.[0]).not.toHaveProperty("owner");
    noDashWritten(p.toUpsert);
  });

  it("« Libellé » d'impact « - » = retour au libellé calculé (impact conservé, même id)", () => {
    const p = importLevers(
      setLeverCells(exportLevers(), "impacts", { Libellé: "-" }, (r) => r["Type"] === "Gain")
    );
    expect(p.errors).toEqual([]);
    const impacts = p.toUpsert[0].impacts ?? [];
    const saving = impacts.find((i) => i.type === "saving")!;
    expect(saving.id).toBe("IMP-S");
    expect(saving.label).not.toBe("-");
    expect(saving.label).toMatch(/^Gain \(/);
    expect(saving.comments).toHaveLength(1);
    expect(impacts.find((i) => i.type === "cost")).toMatchObject({
      id: "IMP-C",
      label: "Outil e-sourcing",
    });
    expect(p.impactsRemoved).toEqual([]);
  });

  it("« Nom de l'action », « Commentaire » et « Nature » (hors coût) d'un impact : « - » sans erreur", () => {
    const p = importLevers(
      setLeverCells(
        exportLevers(),
        "impacts",
        { "Nom de l'action": "-", Commentaire: "-", Nature: "-" },
        (r) => r["Type"] === "Gain"
      )
    );
    expect(p.errors).toEqual([]);
    // Rien à effacer réellement (libellé explicite conservé, commentaire jamais ajouté).
    expect(p.toUpsert).toEqual([]);
    expect(p.unchangedCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Plan stratégique
// ---------------------------------------------------------------------------------------------

const companyId = "C1";
const programId = "P1";
const stages: MaturityStageConfig[] = [
  { id: "defined", order: 1, label: "Défini", programId, companyId },
  { id: "validated", order: 2, label: "Validé", programId, companyId },
];
const NOW = new Date(2026, 0, 15);
const knownDepartments = ["Data & Analytics", "Ressources Humaines"];
const fteByTeam: Record<string, number> = { "Data & Analytics": 14, "Ressources Humaines": 2.5 };
const users = [{ username: "jdupont", name: "Jean Dupont" }];

const axis = {
  id: "AX-1",
  companyId,
  programId,
  name: "Axe 1",
  description: "Axe décrit",
  owner: "jdupont",
  color: "#123456",
  stage: "defined",
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  importCode: "AX1",
} as StrategicAxis;
const chantier = {
  id: "CH-1",
  companyId,
  programId,
  axisIds: ["AX-1"],
  name: "Chantier 1",
  pilote: "jdupont",
  stage: "defined",
  dependencies: [],
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  importCode: "CH1",
} as Chantier;
const action = {
  id: "CA-1",
  companyId,
  chantierId: "CH-1",
  name: "Projet 1",
  owner: "jdupont",
  start: "2026-01-01",
  end: "2026-06-30",
  status: "defined",
  deliverables: [
    { id: "DL-1", label: "Livrable 1", phases: [], status: "todo", dueDate: "2026-03-31" },
  ],
  importCode: "P1",
} as ChantierAction;
const indicator = {
  id: "IND-1",
  companyId,
  programId,
  axisId: "AX-1",
  chantierId: "CH-1",
  name: "Taux de couverture",
  kind: "quantitative",
  frequency: "monthly",
  objective: "Atteindre 80 %",
  objectiveValue: 80,
  direction: "up",
  unit: "%",
  responsibleRoles: [],
  additionalAuthorizedUserIds: ["jdupont"],
  status: "on_track",
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  importCode: "KPI1",
} as unknown as Indicator;
const line: ChantierStaffing = {
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

const planData = (): StrategicImportExistingData => ({
  axes: [{ ...axis }],
  chantiers: [{ ...chantier }],
  actions: [structuredClone(action)],
  indicators: [structuredClone(indicator)],
  measurements: [],
  staffing: [{ ...line }],
});

function editSheet(
  wb: XLSX.WorkBook,
  name: string,
  edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[]
): XLSX.WorkBook {
  const ws = wb.Sheets[name];
  const header = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? []) as string[];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  wb.Sheets[name] = XLSX.utils.json_to_sheet(edit(rows), { header });
  return wb;
}
const setCells =
  (patch: Record<string, unknown>) =>
  (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
    rows.map((r) => ({ ...r, ...patch }));

const exportPlan = () =>
  buildStrategicPlanExportWorkbook(planData(), stages, XLSX, { knownDepartments, fteByTeam });
const reimportPlan = (wb: XLSX.WorkBook) => {
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return validateStrategicImportRows(
    parseStrategicImportWorkbook(readXlsxWorkbook(XLSX, bytes), XLSX),
    planData(),
    companyId,
    programId,
    stages,
    "admin",
    { now: NOW, knownDepartments, teamAvailableFte: fteByTeam, users }
  );
};
type PlanResult = ReturnType<typeof reimportPlan>;
const planWrites = (r: PlanResult) => [
  ...Object.values(r.toCreate).flat(),
  ...Object.values(r.toUpdate).flat(),
];

/** Colonnes obligatoires (ou identifiants) des feuilles du plan stratégique. */
const PLAN_MANDATORY: [string, string][] = [
  ["Axes", "Code"],
  ["Axes", "Nom"],
  ["Chantiers", "Code"],
  ["Chantiers", "Codes Axes (séparés par ;)"],
  ["Chantiers", "Nom"],
  ["Chantiers", "Étape de maturité"],
  ["Projets", "Code"],
  ["Projets", "Code Chantier"],
  ["Projets", "Nom"],
  ["Projets", "Date début"],
  ["Projets", "Date fin"],
  ["Livrables", "Code Projet"],
  ["Livrables", "Label"],
  ["Indicateurs", "Code"],
  ["Indicateurs", "Code Axe"],
  ["Indicateurs", "Code Chantier"],
  ["Indicateurs", "Nom"],
  ["Indicateurs", "Type"],
  ["Indicateurs", "Fréquence"],
  ["Indicateurs", "Objectif"],
  ["ETP", "Code Chantier"],
  ["ETP", "Fonction (équipe, base ETP)"],
  ["ETP", "Nombre d'ETP"],
  ["ETP", "Date début"],
  ["ETP", "Date fin"],
  ["ETP", "ID ligne"],
];

describe(`lot 6 — plan stratégique : tiret dans une colonne obligatoire (fuseau ${process.env.TZ ?? "(système)"})`, () => {
  it("aller-retour sans modification (avec indicateur) : 0 changement, aucune anomalie", () => {
    const r = reimportPlan(exportPlan());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(planWrites(r)).toEqual([]);
  });

  for (const [sheet, column] of PLAN_MANDATORY) {
    it(`« - » dans « ${column} » (${sheet}) = erreur notClearable, message dédié`, () => {
      const r = reimportPlan(editSheet(exportPlan(), sheet, setCells({ [column]: "-" })));
      const own = r.errors.filter((e) => e.sheet === sheet);
      expect(own.map((e) => [e.code, e.vars?.column])).toEqual([["notClearable", column]]);
      expect(own[0].reason).toBe(EXCEL_NOT_CLEARABLE_MESSAGE.replace("{column}", column));
      // Plus de message générique ni de simple avertissement.
      const generic = ["axesNotFound", "axisNotFound", "unknownValue", "notNumber", "required"];
      expect(r.errors.filter((e) => generic.includes(e.code))).toEqual([]);
      expect(r.warnings.filter((w) => w.code === "staffingUnknownLineId")).toEqual([]);
      noDashWritten(planWrites(r));
    });
  }

  it("« – » / « — » dans « Codes Axes » ou une liste d'axes : même refus (pas « Axe(s) introuvable(s) »)", () => {
    for (const value of ["–", "—", "AX1;-"]) {
      const r = reimportPlan(
        editSheet(exportPlan(), "Chantiers", setCells({ "Codes Axes (séparés par ;)": value }))
      );
      expect(r.errors.filter((e) => e.sheet === "Chantiers").map((e) => e.code)).toEqual([
        "notClearable",
      ]);
    }
  });

  it('« - » dans « ID ligne » : erreur claire (avant : avertissement « ID ligne "-" inconnu »)', () => {
    const r = reimportPlan(editSheet(exportPlan(), "ETP", setCells({ "ID ligne": "-" })));
    expect(r.errors.map((e) => [e.sheet, e.code, e.vars?.column])).toEqual([
      ["ETP", "notClearable", "ID ligne"],
    ]);
    expect(r.warnings).toEqual([]);
    expect(planWrites(r)).toEqual([]);
  });

  it("le tiret qui retire le dernier responsable d'un indicateur est refusé (message dédié)", () => {
    const r = reimportPlan(
      editSheet(
        exportPlan(),
        "Indicateurs",
        setCells({
          "Responsables saisie (séparés par ;)": "-",
          "Rôles responsables (séparés par ;)": "-",
        })
      )
    );
    expect(r.errors.map((e) => [e.code, e.vars?.column])).toEqual([
      ["notClearable", "Responsables saisie (séparés par ;) / Rôles responsables (séparés par ;)"],
    ]);
  });

  it("colonnes facultatives d'un indicateur : « - » efface (Valeur cible, Sens, Unité)", () => {
    const r = reimportPlan(
      editSheet(
        exportPlan(),
        "Indicateurs",
        setCells({ "Valeur cible": "-", Sens: "-", Unité: "-" })
      )
    );
    expect(r.errors).toEqual([]);
    const [ind] = r.toUpdate.indicators;
    for (const k of ["objectiveValue", "direction", "unit"]) expect(ind).not.toHaveProperty(k);
    expect(ind).toMatchObject({ id: "IND-1", name: "Taux de couverture", kind: "quantitative" });
    noDashWritten(planWrites(r));
  });

  it("le Lisez-moi documente le refus du tiret sur les colonnes obligatoires", () => {
    const guide = STRATEGIC_IMPORT_GUIDE_ROWS.flat().join("\n");
    expect(guide).toContain("Refusé (erreur bloquante, rien n'est importé)");
    expect(guide).toContain('"ID ligne"');
  });
});

// ---------------------------------------------------------------------------------------------
// Base ETP (employés + mouvements)
// ---------------------------------------------------------------------------------------------

const alice: Employee = {
  id: "00042",
  name: "Alice Martin",
  region: "Europe",
  country: "France",
  department: "Finance",
  direction: "Direction Financière",
  hrOwner: "Nadia",
  func: "Contrôle de gestion",
  team: "CDG",
  bu: "BU1",
  entity: "SA",
  level: "Régional",
  fte: 0.5,
  salary: 45000,
  hireDate: "2020-03-01",
  retirement: "2041",
};
const mv = {
  id: "MV001",
  empId: "00042",
  label: "Alice Martin",
  leverId: "L001",
  workstream: "WS-FIN",
  function: "Finance",
  programId: "p1",
  type: "Départ forcé",
  fte: 0.5,
  department: "Finance",
  toDepartment: "Achats",
  country: "France",
  hrOwner: "Nadia",
  plannedDate: "2026-09-30",
  actualDate: null,
  status: "Planifié",
  hrValidated: true,
  socialScheme: "RC",
  inPSE: false,
  salaryImpact: -80000,
  savings: 80000,
  cost: 20000,
  comment: "À confirmer",
} as WorkforceMovement;
const hrPrograms = [{ id: "p1", name: "Programme Performance" }];
const hrData = () =>
  ({
    levers: [
      {
        id: "L001",
        code: "FIN-001",
        owner: "Marc",
        ws: "WS-FIN",
        function: "Finance",
        programId: "p1",
      },
    ],
    workforce: {
      employees: [{ ...alice }],
      movements: [{ ...mv }],
      departments: [{ name: "Finance" }, { name: "Achats" }],
    },
  }) as unknown as BeTrackData;

function hrRoundTrip(
  emp: Record<string, unknown>[],
  mov: Record<string, unknown>[]
): { employeeRows: Record<string, unknown>[]; movementRows: Record<string, unknown>[] } {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(emp, { header: [...HR_EMPLOYEE_HEADERS] }),
    HR_EMPLOYEE_SHEET
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(mov, { header: [...HR_MOVEMENT_HEADERS] }),
    HR_MOVEMENT_SHEET
  );
  const read = readXlsxWorkbook(XLSX, XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  const rows = (name: string) =>
    XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets[name], { defval: "" });
  return { employeeRows: rows(HR_EMPLOYEE_SHEET), movementRows: rows(HR_MOVEMENT_SHEET) };
}
const empRow = () => employeeToExcelRow(alice) as Record<string, unknown>;
const movRow = () => movementToExcelRow(mv, hrData(), hrPrograms) as Record<string, unknown>;
const hrPlan = (emp: Record<string, unknown>[], mov: Record<string, unknown>[]) =>
  buildHrImportPlan(hrRoundTrip(emp, mov), hrData(), hrPrograms);
const hrErrors = (p: ReturnType<typeof hrPlan>) => p.issues.filter((i) => i.severity === "error");

describe("lot 6 — base ETP : tiret dans une colonne obligatoire", () => {
  it("aller-retour sans modification : 0 changement, aucune erreur", () => {
    const p = hrPlan([empRow()], [movRow()]);
    expect(hrErrors(p)).toEqual([]);
    expect(p.employees).toEqual([]);
    expect(p.movements).toEqual([]);
  });

  for (const column of HR_EMPLOYEE_NOT_CLEARABLE) {
    it(`Base ETP, « - » dans « ${column} » = erreur bloquante, ligne rejetée`, () => {
      const p = hrPlan([{ ...empRow(), [column]: "-" }], [movRow()]);
      expect(hrErrors(p).map((i) => [i.sheet, i.code, i.vars.column])).toEqual([
        [HR_EMPLOYEE_SHEET, "notClearable", column],
      ]);
      expect(p.employees).toEqual([]);
      expect(p.rejectedRows).toBe(1);
      // Plus d'avertissement « valeur conservée » / « illisible ».
      expect(
        p.issues.filter((i) => i.severity === "warning" && i.sheet === HR_EMPLOYEE_SHEET)
      ).toEqual([]);
    });
  }

  for (const column of HR_MOVEMENT_NOT_CLEARABLE) {
    it(`Mouvements, « - » dans « ${column} » = erreur bloquante, ligne rejetée`, () => {
      const p = hrPlan([empRow()], [{ ...movRow(), [column]: "—" }]);
      expect(hrErrors(p).map((i) => [i.sheet, i.code, i.vars.column])).toEqual([
        [HR_MOVEMENT_SHEET, "notClearable", column],
      ]);
      expect(p.movements).toEqual([]);
      expect(p.rejectedRows).toBe(1);
    });
  }

  it("colonnes facultatives : « - » efface (employé)", () => {
    const p = hrPlan(
      [
        {
          ...empRow(),
          Direction: "-",
          "RH local": "-",
          Région: "-",
          Pays: "-",
          Fonction: "-",
          Équipe: "-",
          BU: "-",
          Entité: "-",
          "Salaire brut annuel (€)": "-",
          "Date d'entrée": "-",
          "Départ retraite": "-",
        },
      ],
      []
    );
    expect(hrErrors(p)).toEqual([]);
    expect(p.employees).toEqual([
      {
        ...alice,
        direction: "",
        hrOwner: "",
        region: "",
        country: "",
        func: "",
        team: "",
        bu: "",
        entity: "",
        salary: 0,
        hireDate: "",
        retirement: "",
      },
    ]);
  });

  it("colonnes facultatives : « - » efface (mouvement)", () => {
    const p = hrPlan(
      [],
      [
        {
          ...movRow(),
          Matricule: "-",
          "Département d'arrivée": "-",
          Pays: "-",
          "RH local": "-",
          "Levier (code)": "-",
          Programme: "-",
          "Validé RH": "-",
          "Dispositif social": "-",
          "Impact masse salariale (€/an)": "-",
          "Économies (€)": "-",
          "Coût one-off (€)": "-",
          Commentaire: "-",
        },
      ]
    );
    expect(hrErrors(p)).toEqual([]);
    const [m] = p.movements;
    expect(m).toMatchObject({
      id: "MV001",
      empId: null,
      leverId: "",
      country: "",
      hrOwner: "",
      hrValidated: false,
      salaryImpact: 0,
      savings: 0,
      cost: 0,
    });
    for (const k of ["toDepartment", "programId", "socialScheme", "comment"])
      expect(m[k as keyof WorkforceMovement]).toBeUndefined();
    noDashWritten(p.movements);
  });
});

// ---------------------------------------------------------------------------------------------
// Effectifs (staffing)
// ---------------------------------------------------------------------------------------------

const stChantiers = [
  {
    id: "CH1",
    companyId,
    programId,
    axisIds: ["AX1"],
    name: "Refonte achats",
    stage: "planned",
    dependencies: [],
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
  },
] as Chantier[];
const stActions = [
  {
    id: "CA1",
    companyId,
    chantierId: "CH1",
    name: "Cartographie",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "planned",
  },
] as ChantierAction[];
const stExisting: ChantierStaffing[] = [
  {
    id: "ST-A",
    companyId,
    programId,
    chantierId: "CH1",
    function: "RH",
    fte: 1,
    note: "Renfort",
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    actionId: "CA1",
    createdAt: "2025-12-01",
  },
];
const stTeams = ["RH", "IT / SI"];
const stFte = { RH: 14, "IT / SI": 3 };

async function staffingRows(patch: Record<string, unknown> = {}) {
  const wb = buildStaffingExportWorkbook(XLSX, stExisting, stChantiers, stActions, stTeams, stFte);
  const ws = wb.Sheets[STAFFING_IMPORT_SHEET_NAME];
  const header = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 })[0];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  wb.Sheets[STAFFING_IMPORT_SHEET_NAME] = XLSX.utils.json_to_sheet(
    rows.map((r) => ({ ...r, ...patch })),
    { header }
  );
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readStaffingImportSheet(XLSX, await readSpreadsheet(bytes, "effectifs.xlsx"));
}
const runStaffing = (rows: Record<string, unknown>[]) =>
  validateStaffingImportRows(
    rows,
    companyId,
    programId,
    stChantiers,
    stActions,
    stExisting,
    stTeams,
    stFte
  );

describe("lot 6 — Effectifs : tiret dans une colonne obligatoire", () => {
  it("aller-retour sans modification : 0 changement", async () => {
    const r = runStaffing(await staffingRows());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.unchanged).toBe(1);
  });

  for (const column of STAFFING_NOT_CLEARABLE) {
    it(`« - » dans « ${column} » = erreur bloquante notClearable, 0 écriture`, async () => {
      const r = runStaffing(await staffingRows({ [column]: "-" }));
      expect(r.errors.map((e) => [e.code, e.vars.column])).toEqual([["notClearable", column]]);
      expect(r.warnings).toEqual([]);
      expect(r.rows).toEqual([]);
    });
  }

  it("colonnes facultatives : « - » efface la Note et retire le Levier", async () => {
    const r = runStaffing(await staffingRows({ Note: "-", Levier: "–" }));
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].entry.id).toBe("ST-A");
    expect(r.rows[0].entry).not.toHaveProperty("note");
    expect(r.rows[0].entry).not.toHaveProperty("actionId");
  });

  it("le modèle rappelle le refus du tiret", () => {
    const rows = buildStaffingTemplateRows(stChantiers, stActions, stTeams).map((r) => r[0]);
    expect(rows.some((t) => String(t).startsWith("# Tiret refusé"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// Arborescence
// ---------------------------------------------------------------------------------------------

const hLevels: HierarchyLevelDef[] = [
  { key: "bu", label: "Business Unit", order: 0 },
  { key: "line", label: "Ligne P&L", order: 1, semantic: "pnl" },
];
const hNodes: HierarchyNode[] = [
  { id: "bu1", companyId: "c1", levelKey: "bu", code: "BU-1", label: "BU 1", parentId: null },
  {
    id: "ln1",
    companyId: "c1",
    levelKey: "line",
    code: "L-1",
    label: "Ligne 1",
    parentId: "bu1",
    financial: { baseline: 12, computed: true, selectable: false },
  },
];
function hierarchyRows(
  patchFor: (row: Record<string, unknown>) => Record<string, unknown> = () => ({})
) {
  const { rows, headers } = hierarchyToExcelRows(hNodes, hLevels);
  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) => ({ ...r, ...patchFor(r) })),
    { header: headers }
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Arborescence");
  const read = readXlsxWorkbook(XLSX, XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets["Arborescence"], {
    defval: "",
  });
}
const runHierarchy = (rows: Record<string, unknown>[]) =>
  validateHierarchyImportRows(rows, hLevels, hNodes, "c1");
const onLine = (patch: Record<string, unknown>) => (r: Record<string, unknown>) =>
  r.Code === "L-1" ? patch : {};

describe("lot 6 — arborescence : tiret dans une colonne obligatoire", () => {
  it("aller-retour sans modification : 0 changement", () => {
    const p = runHierarchy(hierarchyRows());
    expect(p.errors).toEqual([]);
    expect(p.toCreate).toEqual([]);
    expect(p.toUpdate).toEqual([]);
    expect(p.unchanged).toBe(2);
  });

  for (const column of ["Niveau", "Code", "Libellé", "Code parent"]) {
    it(`« - » dans « ${column} » = erreur bloquante notClearable, 0 écriture`, () => {
      const p = runHierarchy(hierarchyRows(onLine({ [column]: "-" })));
      expect(p.errors.map((e) => [e.code, e.vars.column])).toEqual([["notClearable", column]]);
      expect(p.toCreate).toEqual([]);
      expect(p.toUpdate).toEqual([]);
    });
  }

  it("niveau macro : « - » dans « Code parent » = aucun parent (facultatif), sans erreur", () => {
    const p = runHierarchy(hierarchyRows((r) => (r.Code === "BU-1" ? { "Code parent": "-" } : {})));
    expect(p.errors).toEqual([]);
    expect(p.toUpdate).toEqual([]);
  });

  it("données financières facultatives : « - » remet les valeurs par défaut", () => {
    const p = runHierarchy(
      hierarchyRows(onLine({ Baseline: "-", Calculé: "-", Sélectionnable: "-" }))
    );
    expect(p.errors).toEqual([]);
    expect(p.toUpdate).toHaveLength(1);
    expect(p.toUpdate[0].financial).toEqual({ baseline: 0, computed: false, selectable: true });
  });
});

// ---------------------------------------------------------------------------------------------
// Messages : un seul modèle, présent à l'identique dans fr.ts
// ---------------------------------------------------------------------------------------------

describe("lot 6 — messages d'import", () => {
  it("LEVER_IMPORT_MESSAGES : chaque message FR du dictionnaire = modèle du code (et traduit)", () => {
    for (const [code, template] of Object.entries(LEVER_IMPORT_MESSAGES)) {
      const key = `shared.leverImport.msg.${code}`;
      expect(fr[key], code).toBe(template);
      for (const dict of [en, de, es]) expect(dict[key], `${code}`).toBeTruthy();
    }
  });

  it("les messages de statut parlent de « statut », plus de « maturité »", () => {
    for (const code of ["statusNewLever", "statusGated", "statusBackward"] as const) {
      const key = `shared.leverImport.msg.${code}`;
      expect(fr[key]).toContain("statut");
      expect(fr[key]).not.toMatch(/maturit/i);
      expect(en[key]).not.toMatch(/maturity/i);
      expect(de[key]).not.toMatch(/Reife/);
      expect(es[key]).not.toMatch(/madurez/i);
    }
  });

  it("notClearable : même modèle dans les 5 imports, présent à l'identique dans fr.ts", () => {
    expect(EXCEL_NOT_CLEARABLE_MESSAGE).toContain("colonne obligatoire");
    expect(LEVER_IMPORT_MESSAGES.notClearable).toBe(
      EXCEL_NOT_CLEARABLE_MESSAGE.replace("{column}", "{field}")
    );
    const pairs: [string, string][] = [
      ["strategicImport.msg.notClearable", STRATEGIC_IMPORT_MESSAGES.notClearable],
      ["hrImport.issue.notClearable", HR_IMPORT_ISSUES.notClearable],
      ["staffingImport.issue.notClearable", STAFFING_IMPORT_ISSUES.notClearable],
      ["adminHierarchy.issue.notClearable", HIERARCHY_IMPORT_ISSUES.notClearable],
    ];
    for (const [key, template] of pairs) {
      expect(template, key).toBe(EXCEL_NOT_CLEARABLE_MESSAGE);
      expect(fr[key], key).toBe(template);
      for (const dict of [en, de, es]) expect(dict[key], key).toContain("{column}");
    }
    expect(HR_IMPORT_ISSUES).not.toHaveProperty("clearNotAllowed");
  });

  it("l'onglet Aide du modèle leviers documente le refus du tiret", () => {
    const help = leverImportHelpRows();
    const row = help.find((r) => r[0] === "Tiret refusé");
    expect(row?.[1]).toContain("erreur bloquante");
  });
});
