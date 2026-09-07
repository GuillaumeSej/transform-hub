import { describe, it, expect } from "vitest";
import { validateStaffingImportRows } from "@/lib/staffingExcelImport";
import type { Chantier, ChantierAction, ChantierStaffing } from "@/types";

const companyId = "C1";
const programId = "P1";

function baseChantier(overrides: Partial<Chantier> = {}): Chantier {
  return {
    id: "CH1",
    companyId,
    programId,
    axisId: "AX1",
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
      []
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => !r.isUpdate)).toBe(true);

    const rhRow = result.rows.find((r) => r.entry.function === "rh");
    expect(rhRow?.entry.chantierId).toBe("CH1");
    expect(rhRow?.entry.axisId).toBe("AX1");
    expect(rhRow?.entry.fte).toBe(1);
    expect(rhRow?.entry.startDate).toBe("2026-01-01");
    expect(rhRow?.entry.endDate).toBe("2026-06-30");
    expect(rhRow?.entry.actionId).toBeUndefined();

    const itRow = result.rows.find((r) => r.entry.function === "it");
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
      []
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
        axisId: "AX1",
        chantierId: "CH1",
        function: "rh",
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
      existing
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

  it("fusionne deux lignes du même fichier qui partagent la même clé métier plutôt que de dupliquer", () => {
    const chantiers = [baseChantier()];

    const result = validateStaffingImportRows(
      [baseRow({ ETP: 1 }), baseRow({ ETP: 3 })],
      companyId,
      programId,
      chantiers,
      [],
      []
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    // La 2e ligne "met à jour" l'entrée créée par la 1re — même id, dernière valeur d'ETP retenue.
    expect(result.rows[1].isUpdate).toBe(true);
    expect(result.rows[1].entry.id).toBe(result.rows[0].entry.id);
    expect(result.rows[1].entry.fte).toBe(3);
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
      []
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});
