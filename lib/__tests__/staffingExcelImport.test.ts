import { describe, it, expect } from "vitest";
import {
  STAFFING_IMPORT_HEADERS,
  STAFFING_IMPORT_ISSUES,
  buildStaffingTemplateRows,
  staffingToExcelRows,
  validateStaffingImportRows,
} from "@/lib/staffingExcelImport";
import fr from "@/lib/i18n/dictionaries/fr";
import type { Chantier, ChantierAction, ChantierStaffing } from "@/types";

const companyId = "C1";
const programId = "P1";

// Round 13 : la colonne "Fonction" matche désormais une équipe RÉELLE de la base ETP entreprise
// (plus l'ancienne union fermée à 9 valeurs) — voir `validateStaffingImportRows`.
const knownDepartments = ["RH", "IT / SI"];

function baseChantier(overrides: Partial<Chantier> = {}): Chantier {
  return {
    id: "CH1",
    companyId,
    programId,
    axisIds: ["AX1"],
    name: "Refonte du parcours achats",
    stage: "planned",
    dependencies: [],
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

function baseAction(overrides: Partial<ChantierAction> = {}): ChantierAction {
  return {
    id: "CA1",
    companyId,
    chantierId: "CH1",
    name: "Cartographier le processus actuel",
    start: "2026-01-15",
    end: "2026-03-31",
    status: "planned",
    ...overrides,
  };
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    Chantier: "Refonte du parcours achats",
    Fonction: "RH",
    ETP: 1,
    "Date début": "2026-01-01",
    "Date fin": "2026-06-30",
    Levier: "",
    Note: "",
    ...overrides,
  };
}

describe("validateStaffingImportRows", () => {
  it("importe des lignes valides et les classe en création (aucune entrée existante ne matche)", () => {
    const chantiers = [baseChantier()];
    const chantierActions = [baseAction()];

    const result = validateStaffingImportRows(
      [
        baseRow(),
        baseRow({ Fonction: "IT / SI", ETP: 0.5, Levier: "Cartographier le processus actuel" }),
      ],
      companyId,
      programId,
      chantiers,
      chantierActions,
      [],
      knownDepartments
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => !r.isUpdate)).toBe(true);

    const rhRow = result.rows.find((r) => r.entry.function === "RH");
    expect(rhRow?.entry.chantierId).toBe("CH1");
    expect(rhRow?.entry.fte).toBe(1);
    expect(rhRow?.entry.startDate).toBe("2026-01-01");
    expect(rhRow?.entry.endDate).toBe("2026-06-30");
    expect(rhRow?.entry.actionId).toBeUndefined();

    const itRow = result.rows.find((r) => r.entry.function === "IT / SI");
    expect(itRow?.entry.actionId).toBe("CA1");
    expect(itRow?.entry.fte).toBe(0.5);
  });

  it("signale un chantier introuvable, une fonction inconnue et un levier introuvable comme erreurs de ligne", () => {
    const chantiers = [baseChantier()];
    const chantierActions = [baseAction()];

    const result = validateStaffingImportRows(
      [
        baseRow({ Chantier: "Chantier fantôme" }),
        baseRow({ Fonction: "Astrologie" }),
        baseRow({ Levier: "Levier inconnu" }),
      ],
      companyId,
      programId,
      chantiers,
      chantierActions,
      [],
      knownDepartments
    );

    expect(result.rows).toHaveLength(0);
    expect(result.errors).toHaveLength(3);
    expect(result.errors[0].reason).toMatch(/introuvable/);
    expect(result.errors[1].reason).toMatch(/inconnue/);
    expect(result.errors[2].reason).toMatch(/introuvable/);
  });

  it("réutilise l'id d'une entrée existante qui matche la clé métier (mise à jour), sinon crée une nouvelle entrée", () => {
    const chantiers = [
      baseChantier(),
      baseChantier({ id: "CH2", name: "Digitalisation des contrats" }),
    ];
    const chantierActions: ChantierAction[] = [];

    const existing: ChantierStaffing[] = [
      {
        id: "ST-existing-1",
        companyId,
        programId,
        chantierId: "CH1",
        function: "RH",
        fte: 1,
        startDate: "2026-01-01",
        endDate: "2026-06-30",
        createdAt: "2025-12-01",
      },
    ];

    const result = validateStaffingImportRows(
      [
        // Même clé (chantier + fonction + dates + pas de levier) que l'entrée existante : doit
        // mettre à jour, réutiliser l'id ET le createdAt d'origine, mais prendre le nouvel ETP.
        baseRow({ ETP: 2 }),
        // Chantier différent, même fonction/dates : clé différente, doit créer une nouvelle entrée.
        baseRow({ Chantier: "Digitalisation des contrats" }),
      ],
      companyId,
      programId,
      chantiers,
      chantierActions,
      existing,
      knownDepartments
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);

    const updated = result.rows.find((r) => r.entry.chantierId === "CH1");
    expect(updated?.isUpdate).toBe(true);
    expect(updated?.entry.id).toBe("ST-existing-1");
    expect(updated?.entry.createdAt).toBe("2025-12-01");
    expect(updated?.entry.fte).toBe(2);

    const created = result.rows.find((r) => r.entry.chantierId === "CH2");
    expect(created?.isUpdate).toBe(false);
    expect(created?.entry.id).not.toBe("ST-existing-1");
  });

  it("rejette deux lignes du même fichier qui partagent la même clé métier (doublon)", () => {
    const chantiers = [baseChantier()];

    const result = validateStaffingImportRows(
      // 2e ligne : mêmes noms mais casse/espaces différents -> même clé.
      [
        baseRow({ ETP: 1 }),
        baseRow({ ETP: 3, Chantier: "refonte  du parcours ACHATS", Fonction: "rh" }),
      ],
      companyId,
      programId,
      chantiers,
      [],
      [],
      knownDepartments
    );

    // Audit 24/09/2026 : on ne sait pas laquelle retenir -> les deux lignes sont en erreur.
    expect(result.rows).toEqual([]);
    expect(result.errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [2, "duplicateRow"],
      [3, "duplicateRow"],
    ]);
  });

  it("ne plante jamais sur des lignes vides", () => {
    const result = validateStaffingImportRows(
      [
        {
          Chantier: "",
          Fonction: "",
          ETP: "",
          "Date début": "",
          "Date fin": "",
          Levier: "",
          Note: "",
        },
      ],
      companyId,
      programId,
      [],
      [],
      [],
      knownDepartments
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});

describe("validateStaffingImportRows — contrôles de l'audit du 24/09/2026", () => {
  const run = (rows: Record<string, unknown>[], existing: ChantierStaffing[] = []) =>
    validateStaffingImportRows(
      rows,
      companyId,
      programId,
      [baseChantier()],
      [baseAction()],
      existing,
      knownDepartments
    );

  it("date illisible ou impossible = erreur (plus de repli silencieux sur une date vide)", () => {
    const result = run([
      baseRow({ "Date début": "31/02/2026" }),
      baseRow({ "Date fin": "bientôt", Fonction: "IT / SI" }),
    ]);
    expect(result.rows).toEqual([]);
    expect(result.errors.map((e) => e.code)).toEqual(["invalidDate", "invalidDate"]);
  });

  it("lit les dates FR, les séries Excel et refuse début > fin", () => {
    const ok = run([baseRow({ "Date début": "01/03/2026", "Date fin": 46203, ETP: "0,5" })]);
    expect(ok.errors).toEqual([]);
    expect(ok.rows[0].entry.startDate).toBe("2026-03-01");
    expect(ok.rows[0].entry.endDate).toBe("2026-06-30");
    expect(ok.rows[0].entry.fte).toBe(0.5);

    const ko = run([baseRow({ "Date début": "2026-07-01", "Date fin": "2026-06-30" })]);
    expect(ko.errors.map((e) => e.code)).toEqual(["startAfterEnd"]);
  });

  it("ETP borné : 0 < ETP ≤ 5", () => {
    const result = run([
      baseRow({ ETP: 0 }),
      baseRow({ ETP: "6", Fonction: "IT / SI" }),
      baseRow({ ETP: "abc", "Date fin": "" }),
      baseRow({ ETP: 5, "Date début": "" }),
    ]);
    expect(result.errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [2, "invalidFte"],
      [3, "invalidFte"],
      [4, "invalidFte"],
    ]);
    expect(result.rows).toHaveLength(1);
  });

  it("noms tolérants aux espaces multiples / accents / casse", () => {
    const result = run([
      baseRow({
        Chantier: "  Refonte   du parcours achats ",
        Fonction: "it /  si",
        Levier: "cartographier le  processus actuel",
      }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.rows[0].entry.function).toBe("IT / SI");
    expect(result.rows[0].entry.actionId).toBe("CA1");
  });

  it("équipe sortie de la base ETP : avertissement (pas erreur) pour une ligne existante", () => {
    const existing: ChantierStaffing = {
      id: "ST-old",
      companyId,
      programId,
      chantierId: "CH1",
      function: "Logistique",
      fte: 1,
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      note: "Paul",
      createdAt: "2025-12-01",
    };
    const result = run([baseRow({ Fonction: "Logistique", ETP: 2 })], [existing]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(["functionLeftBase"]);
    expect(result.rows[0].isUpdate).toBe(true);
    expect(result.rows[0].entry).toMatchObject({
      id: "ST-old",
      function: "Logistique",
      fte: 2,
      note: "Paul",
    });

    const creation = run([baseRow({ Fonction: "Logistique" })]);
    expect(creation.errors.map((e) => e.code)).toEqual(["unknownFunction"]);
  });

  it("les lignes commentées (#) du modèle sont ignorées", () => {
    const template = buildStaffingTemplateRows([baseChantier()], [baseAction()], knownDepartments);
    // Les exemples référencent un chantier et une équipe réels de l'entreprise…
    expect(template.some((r) => r[0] === "# Refonte du parcours achats" && r[1] === "RH")).toBe(
      true
    );
    const rows = template.map((r) =>
      Object.fromEntries(STAFFING_IMPORT_HEADERS.map((h, i) => [h, r[i] ?? ""]))
    );
    // …mais ne sont jamais importés tels quels.
    const result = run(rows);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("aller-retour : ré-importer l'export inchangé ne crée rien et ne produit aucune erreur", () => {
    const existing: ChantierStaffing[] = [
      {
        id: "ST-1",
        companyId,
        programId,
        chantierId: "CH1",
        function: "RH",
        fte: 0.5,
        startDate: "2026-01-01",
        endDate: "2026-06-30",
        actionId: "CA1",
        note: "Marie",
        createdAt: "2025-12-01",
      },
      {
        id: "ST-2",
        companyId,
        programId,
        chantierId: "CH1",
        function: "IT / SI",
        fte: 2,
        createdAt: "2025-12-01",
      },
    ];
    const exported = staffingToExcelRows(existing, [baseChantier()], [baseAction()]);
    const result = run(exported, existing);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.rows.map((r) => [r.entry.id, r.isUpdate])).toEqual([
      ["ST-2", true],
      ["ST-1", true],
    ]);
    for (const r of result.rows) {
      expect(r.entry).toEqual(existing.find((e) => e.id === r.entry.id));
    }
  });

  it("numéros de ligne Excel exacts malgré les lignes vides (__rowNum__)", () => {
    const row = baseRow({ Chantier: "Inconnu" });
    Object.defineProperty(row, "__rowNum__", { value: 6, enumerable: false });
    expect(run([row]).errors[0].rowNumber).toBe(7);
  });
});

describe("STAFFING_IMPORT_ISSUES ↔ dictionnaire français", () => {
  it("chaque modèle est présent à l'identique dans fr.ts", () => {
    for (const [code, template] of Object.entries(STAFFING_IMPORT_ISSUES)) {
      expect(fr[`staffingImport.issue.${code}`], code).toBe(template);
    }
  });
});
