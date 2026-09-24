import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  HR_EMPLOYEE_HEADERS,
  HR_EMPLOYEE_SHEET,
  HR_IMPORT_ISSUES,
  HR_MOVEMENT_HEADERS,
  HR_MOVEMENT_SHEET,
  buildHrImportPlan,
  employeeToExcelRow,
  movementToExcelRow,
} from "@/lib/hrExcel";
import { XLSX_READ_OPTIONS } from "@/lib/excelParse";
import { readSpreadsheet } from "@/lib/excelFileRead";
import fr from "@/lib/i18n/dictionaries/fr";
import type { BeTrackData, Employee, WorkforceMovement } from "@/types";

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

const mv: WorkforceMovement = {
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
  hrValidated: false,
  socialScheme: "RC",
  inPSE: false,
  salaryImpact: -80000,
  savings: 80000,
  cost: 20000,
  comment: "À confirmer",
  requiresRetraining: false,
  geographyLeafId: "GEO-FR",
  lockedPlan: { fte: 0.5, salaryImpact: -80000, savings: 80000, cost: 20000 },
} as WorkforceMovement;

function makeData(employees: Employee[] = [alice], movements: WorkforceMovement[] = [mv]) {
  return {
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
      employees,
      movements,
      departments: [{ name: "Finance" }, { name: "Achats Généraux" }],
    },
  } as unknown as BeTrackData;
}
const programs = [{ id: "p1", name: "Programme Performance" }];

/** Écrit un classeur 2 feuilles puis le relit comme le fait le bouton d'import. */
function roundTripWorkbook(
  empRows: Record<string, unknown>[],
  movRows: Record<string, unknown>[]
): { employeeRows: Record<string, unknown>[]; movementRows: Record<string, unknown>[] } {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(empRows, { header: [...HR_EMPLOYEE_HEADERS] }),
    HR_EMPLOYEE_SHEET
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(movRows, { header: [...HR_MOVEMENT_HEADERS] }),
    HR_MOVEMENT_SHEET
  );
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const read = XLSX.read(buf, XLSX_READ_OPTIONS);
  const rows = (name: string) =>
    XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets[name], { defval: "" });
  return { employeeRows: rows(HR_EMPLOYEE_SHEET), movementRows: rows(HR_MOVEMENT_SHEET) };
}

const errorsOf = (plan: ReturnType<typeof buildHrImportPlan>) =>
  plan.issues.filter((i) => i.severity === "error");

describe("buildHrImportPlan — aller-retour export/import", () => {
  it("ré-importer un export inchangé ne produit ni erreur ni écriture", () => {
    const data = makeData();
    const sheets = roundTripWorkbook(
      [employeeToExcelRow(alice)],
      [movementToExcelRow(mv, data, programs)]
    );
    const plan = buildHrImportPlan(sheets, data, programs);
    expect(errorsOf(plan)).toEqual([]);
    expect(plan.employees).toEqual([]);
    expect(plan.movements).toEqual([]);
    expect(plan.unchangedEmployees).toBe(1);
    expect(plan.unchangedMovements).toBe(1);
  });

  it("une modification partielle ne perd aucun champ (cellules vides = valeur conservée)", () => {
    const data = makeData();
    const empRow = { Matricule: "00042", Nom: "", ETP: "0,8" } as Record<string, unknown>;
    const movRow = {
      "ID mouvement": "MV001",
      "Employé / Poste": "",
      Statut: "Réalisé",
      "Date réalisée": "15/10/2026",
      "Validé RH": "oui",
    } as Record<string, unknown>;
    const plan = buildHrImportPlan({ employeeRows: [empRow], movementRows: [movRow] }, data);
    expect(errorsOf(plan)).toEqual([]);
    expect(plan.employees).toEqual([{ ...alice, fte: 0.8 }]);
    const updated = plan.movements[0];
    expect(updated).toEqual({
      ...mv,
      status: "Réalisé",
      actualDate: "2026-10-15",
      hrValidated: true,
    });
    // Champs non exportés conservés
    expect(updated.lockedPlan).toEqual(mv.lockedPlan);
    expect((updated as { geographyLeafId?: string }).geographyLeafId).toBe("GEO-FR");
  });

  it("lit la colonne Programme par nom ou par id", () => {
    const data = makeData([alice], [{ ...mv, programId: undefined, leverId: "" }]);
    const byName = buildHrImportPlan(
      {
        movementRows: [{ "ID mouvement": "MV001", Programme: "programme performance" }],
      },
      data,
      programs
    );
    expect(byName.movements[0].programId).toBe("p1");
    const unknown = buildHrImportPlan(
      { movementRows: [{ "ID mouvement": "MV001", Programme: "Inconnu" }] },
      data,
      programs
    );
    expect(unknown.movements).toEqual([]);
    expect(unknown.issues.map((i) => i.code)).toContain("unknownProgram");
  });
});

describe("buildHrImportPlan — CSV français (Windows-1252)", () => {
  const csv = [
    "Matricule;Nom;Département;ETP;Salaire brut annuel (€);Date d'entrée;Niveau",
    "E100;Hélène Dupré;Achats Généraux;0,5;45 000;01/03/2020;regional",
  ].join("\r\n");
  // Encodage Windows-1252 (Excel FR) : 1 octet par caractère Latin-1, "€" = 0x80.
  const cp1252 = Uint8Array.from(Array.from(csv), (ch) => (ch === "€" ? 0x80 : ch.charCodeAt(0)));
  const utf8 = new TextEncoder().encode(csv);

  it.each([
    ["Windows-1252", cp1252],
    ["UTF-8 sans BOM", utf8],
  ])("décode les accents (%s) et lit nombres/dates au format FR", (_label, bytes) => {
    const wb = readSpreadsheet(bytes.slice().buffer, "base.csv");
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
      defval: "",
    });
    const plan = buildHrImportPlan({ employeeRows: rows }, makeData([], []));
    expect(errorsOf(plan)).toEqual([]);
    expect(plan.issues.filter((i) => i.code === "unknownColumn")).toEqual([]);
    expect(plan.employees).toHaveLength(1);
    const e = plan.employees[0];
    expect(e.name).toBe("Hélène Dupré");
    expect(e.department).toBe("Achats Généraux");
    expect(e.fte).toBe(0.5);
    expect(e.salary).toBe(45000);
    expect(e.hireDate).toBe("2020-03-01");
    expect(e.level).toBe("Régional");
  });

  it("signale un nombre ou une date illisible au lieu d'un repli silencieux", () => {
    const plan = buildHrImportPlan(
      {
        employeeRows: [
          { Matricule: "00042", Nom: "Alice", ETP: "un demi", "Date d'entrée": "31/02/2020" },
        ],
      },
      makeData()
    );
    const codes = plan.issues.map((i) => i.code);
    expect(codes).toContain("invalidNumberKept");
    expect(codes).toContain("invalidDateKept");
    expect(plan.employees).toEqual([{ ...alice, name: "Alice" }]);
  });
});

describe("buildHrImportPlan — contrôles", () => {
  it("rejette toutes les lignes d'un matricule en doublon", () => {
    const plan = buildHrImportPlan(
      {
        employeeRows: [
          { Matricule: "E1", Nom: "A" },
          { Matricule: "E1", Nom: "B" },
          { Matricule: "E2", Nom: "C" },
        ],
      },
      makeData([], [])
    );
    expect(plan.employees.map((e) => e.id)).toEqual(["E2"]);
    expect(errorsOf(plan).filter((i) => i.code === "duplicateEmployeeId")).toHaveLength(2);
    expect(plan.rejectedRows).toBe(2);
  });

  it("rejette les ID mouvement en doublon", () => {
    const row = {
      "ID mouvement": "MV009",
      "Employé / Poste": "X",
      Type: "Attrition",
      "Date planifiée": "2026-01-01",
    };
    const plan = buildHrImportPlan({ movementRows: [row, row] }, makeData());
    expect(plan.movements).toEqual([]);
    expect(errorsOf(plan).map((i) => i.code)).toEqual([
      "duplicateMovementId",
      "duplicateMovementId",
    ]);
  });

  it("un ID mouvement inconnu est créé avec cet ID (ré-import idempotent)", () => {
    const row = {
      "ID mouvement": "MV777",
      "Employé / Poste": "Poste data",
      Type: "Recrutement",
      "Date planifiée": "01/02/2027",
      Statut: "a faire",
    };
    const first = buildHrImportPlan({ movementRows: [row] }, makeData());
    expect(first.movements.map((m) => m.id)).toEqual(["MV777"]);
    expect(first.movements[0].status).toBe("À faire");
    expect(first.issues.map((i) => i.code)).toContain("unknownMovementIdCreated");
    const second = buildHrImportPlan(
      { movementRows: [row] },
      makeData([alice], [mv, first.movements[0]])
    );
    expect(second.createdMovements).toBe(0);
    expect(second.movements).toEqual([]);
  });

  it("Type vide ou inconnu = erreur de ligne (plus de repli sur Transfert entrant)", () => {
    const plan = buildHrImportPlan(
      {
        movementRows: [
          { "Employé / Poste": "A", Type: "", "Date planifiée": "2026-01-01" },
          { "Employé / Poste": "B", Type: "Mutation", "Date planifiée": "2026-01-01" },
          {
            "Employé / Poste": "C",
            Type: "depart FORCE",
            "Date planifiée": "2026-01-01",
            Matricule: "00042",
          },
        ],
      },
      makeData()
    );
    expect(errorsOf(plan).map((i) => i.code)).toEqual(["missingType", "unknownType"]);
    expect(plan.movements).toHaveLength(1);
    expect(plan.movements[0].type).toBe("Départ forcé");
    expect(plan.movements[0].id).toBe("MV002");
  });

  it("avertit sur les incohérences statut / validation / date réelle", () => {
    const plan = buildHrImportPlan(
      {
        movementRows: [
          {
            "ID mouvement": "MV001",
            Statut: "Planifié",
            "Validé RH": "Oui",
            "Date réalisée": "2026-10-01",
          },
        ],
      },
      makeData()
    );
    const codes = plan.issues.map((i) => i.code);
    expect(codes).toContain("hrValidatedNotRealised");
    expect(codes).toContain("actualDateNotRealised");
  });

  it("un matricule lu comme nombre est rattaché au matricule zéro-paddé existant", () => {
    const plan = buildHrImportPlan(
      { employeeRows: [{ Matricule: 42, Nom: "Alice Martin", ETP: 1 }] },
      makeData()
    );
    expect(plan.createdEmployees).toBe(0);
    expect(plan.employees[0].id).toBe("00042");
    expect(plan.issues.map((i) => i.code)).toContain("matriculeZeroPadded");
  });

  it("valeur d'énumération inconnue sur une mise à jour : avertissement, valeur conservée", () => {
    const plan = buildHrImportPlan(
      { employeeRows: [{ Matricule: "00042", Niveau: "Continental", Région: "", Pays: "" }] },
      makeData()
    );
    expect(plan.employees).toEqual([]);
    expect(plan.issues.map((i) => i.code)).toEqual(["unknownEnumKept"]);
  });

  it("colonnes obligatoires absentes = erreur fichier", () => {
    const plan = buildHrImportPlan({ employeeRows: [{ Name: "A" }] }, makeData());
    expect(errorsOf(plan).map((i) => i.code)).toEqual(["missingColumns"]);
  });

  it("numéros de ligne Excel exacts malgré les lignes vides", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["Matricule", "Nom"], ["E1", "A"], [], [], ["", "Sans matricule"]]),
      HR_EMPLOYEE_SHEET
    );
    const read = XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), XLSX_READ_OPTIONS);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets[HR_EMPLOYEE_SHEET], {
      defval: "",
    });
    const plan = buildHrImportPlan({ employeeRows: rows }, makeData([], []));
    expect(errorsOf(plan)[0].rowNumber).toBe(5);
  });
});

describe("HR_IMPORT_ISSUES ↔ dictionnaire français", () => {
  it("chaque modèle est présent à l'identique dans fr.ts", () => {
    for (const [code, template] of Object.entries(HR_IMPORT_ISSUES)) {
      expect(fr[`hrImport.issue.${code}`], code).toBe(template);
    }
  });
});
