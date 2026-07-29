import { describe, it, expect } from "vitest";
import { validateLeverImportRows, type LeverImportRawSheets } from "@/lib/leverExcelImport";
import type { BeTrackData, Lever } from "@/types";

type Ctx = Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">;

const workstreams: Ctx["workstreams"] = [
  {
    id: "WS-PROC",
    name: "Achats & Supply Chain",
    sponsor: "Isabelle Roy",
    color: "#000",
    target: 0,
  },
];

const pnlAccounts: Ctx["pnlAccounts"] = [
  { id: "GA", name: "General & Admin", baseline: -72, sign: -1 },
  { id: "REV", name: "Revenue", baseline: 892, sign: 1 },
];

function ctx(levers: Lever[] = []): Ctx {
  return { levers, workstreams, pnlAccounts };
}

const emptySheets: LeverImportRawSheets = { leviers: [], actions: [], impacts: [] };

function baseLeverRow(overrides: Record<string, unknown> = {}) {
  return {
    Code: "PROC-001",
    "Type de levier": "Sourcing & Achats",
    "Nom du levier": "Optimisation achats indirects",
    Workstream: "Achats & Supply Chain",
    Owner: "Marc Dubois",
    "Owner (initiales)": "MD",
    Sponsor: "Isabelle Roy",
    "Sponsor (initiales)": "IR",
    Géographie: "Europe",
    Pays: "France",
    Entité: "Acme France SAS",
    Fonction: "Procurement",
    "Centre de coût": "CC-PROC-001",
    "Compte P&L impacté": "GA",
    "Date de départ": "2026-01-15",
    "Date de fin estimée": "2026-12-31",
    Statut: "En cours d'exécution",
    "Progression (%)": 40,
    "Impact estimé brut (€M)": 2.5,
    "Impact estimé net (€M)": 2.1,
    "Impact estimé (ETP)": -1,
    "Population impactée": 120,
    "CAPEX (€M)": 0.3,
    "OPEX one-off (€M)": 0.4,
    "OPEX récurrent (€M/an)": 0.1,
    "Dépendances (ID:type, séparées par ;)": "",
    Description: "Test",
    ...overrides,
  };
}

function baseActionRow(overrides: Record<string, unknown> = {}) {
  return {
    "Code Levier": "PROC-001",
    "Nom de l'action": "Renégocier contrats classe A",
    Owner: "Marc Dubois",
    "Date début": "2026-01-15",
    "Date fin": "2026-04-30",
    Statut: "En cours",
    "Coût (€K)": 15,
    ...overrides,
  };
}

function baseImpactRow(overrides: Record<string, unknown> = {}) {
  return {
    "Code Levier": "PROC-001",
    "Nom de l'action": "Renégocier contrats classe A",
    Type: "Gain",
    Nature: "",
    "Montant (€M)": 1.2,
    ETP: "",
    "Type de gain": "Réduction de coût",
    "Date CAPEX": "",
    "Date gain": "01/07/2026",
    Reconnaissance: "",
    "Poste de coût": "",
    "Centre de coût": "",
    "Entité P&L": "",
    Commentaire: "",
    ...overrides,
  };
}

describe("leverExcelImport — validateLeverImportRows", () => {
  it("imports a single lever with 2 actions and 3 impacts, no errors", () => {
    const sheets: LeverImportRawSheets = {
      leviers: [baseLeverRow()],
      actions: [
        baseActionRow(),
        baseActionRow({ "Nom de l'action": "Digitaliser le processus achats", "Coût (€K)": 30 }),
      ],
      impacts: [
        baseImpactRow(),
        baseImpactRow({
          Type: "Coût",
          Nature: "OPEX récurrent",
          "Montant (€M)": 0.2,
          "Type de gain": "",
          "Date gain": "",
        }),
        baseImpactRow({
          "Nom de l'action": "Digitaliser le processus achats",
          Type: "Coût",
          Nature: "CAPEX",
          "Montant (€M)": 0.5,
          "Type de gain": "",
          "Date gain": "",
          "Date CAPEX": "15/03/2026",
        }),
      ],
    };

    const preview = validateLeverImportRows(sheets, ctx(), "c1");

    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.createCount).toBe(1);
    expect(preview.updateCount).toBe(0);

    const lever = preview.toUpsert[0];
    expect(lever.code).toBe("PROC-001");
    expect(lever.ws).toBe("WS-PROC");
    expect(lever.pnlMap).toBe("GA");
    expect(lever.status).toBe("in_progress");
    expect(lever.companyId).toBe("c1");
    expect(lever.actions).toHaveLength(2);

    const allImpacts = (lever.actions ?? []).flatMap((a) => a.impacts ?? []);
    expect(allImpacts).toHaveLength(3);

    const capexImpact = allImpacts.find((i) => i.nature === "capex")!;
    expect(capexImpact.capexDeploymentDate).toBe("2026-03-15");

    const gainImpact = allImpacts.find((i) => i.type === "saving")!;
    expect(gainImpact.savingType).toBe("cost_reduction");
    expect(gainImpact.gainDate).toBe("2026-07-01");
  });

  it("updates a lever whose Code already exists in the database", () => {
    const existing: Lever = {
      id: "L001",
      code: "PROC-001",
      type: "Sourcing & Achats",
      name: "Ancien nom",
      ws: "WS-PROC",
      owner: "Marc Dubois",
      ownerInit: "MD",
      sponsor: "Isabelle Roy",
      sponsorInit: "IR",
      geography: "Europe",
      country: "France",
      entity: "Acme France SAS",
      function: "Procurement",
      costCenter: "CC-PROC-001",
      pnlMap: "GA",
      start: "2026-01-01",
      end: "2026-06-30",
      status: "idea",
      progress: 0,
      risk: "medium",
      grossSavings: 1,
      netSavings: 1,
      opexOneOff: 0,
      opexRec: 0,
      capex: 0,
      fteImpact: 0,
      popImpacted: 0,
      companyId: "c1",
      dependencies: [],
      description: "",
      createdAt: "2025-01-01",
      lastUpdate: "2025-01-01",
      actions: [],
    };

    const sheets: LeverImportRawSheets = {
      leviers: [baseLeverRow({ "Nom du levier": "Nouveau nom" })],
      actions: [],
      impacts: [],
    };

    const preview = validateLeverImportRows(sheets, ctx([existing]), "c1");

    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.createCount).toBe(0);
    expect(preview.updateCount).toBe(1);
    expect(preview.toUpsert[0].name).toBe("Nouveau nom");
    // Le fichier ne redéclare aucune action pour ce levier -> le plan existant (vide) est conservé.
    expect(preview.toUpsert[0].actions).toEqual([]);
    // Le risque stocké n'est pas réinitialisé par l'import (recalculé de toute façon à l'affichage).
    expect(preview.toUpsert[0].risk).toBe("medium");
  });

  it("reports a line error when an Action row references an unknown lever code", () => {
    const sheets: LeverImportRawSheets = {
      leviers: [baseLeverRow()],
      actions: [baseActionRow({ "Code Levier": "GHOST-999" })],
      impacts: [],
    };

    const preview = validateLeverImportRows(sheets, ctx(), "c1");

    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].sheet).toBe("Actions");
    expect(preview.errors[0].rowNumber).toBe(2);
    expect(preview.errors[0].reason).toMatch(/introuvable/);
  });

  it("reports a line error when an Impact row references an unknown action name", () => {
    const sheets: LeverImportRawSheets = {
      leviers: [baseLeverRow()],
      actions: [baseActionRow()],
      impacts: [baseImpactRow({ "Nom de l'action": "Action fantôme" })],
    };

    const preview = validateLeverImportRows(sheets, ctx(), "c1");

    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].sheet).toBe("Impacts");
    expect(preview.errors[0].reason).toMatch(/introuvable/);
    // Le levier reste importable (aucune erreur autre que la ligne d'impact orpheline) même si
    // l'impact fantôme est écarté silencieusement de l'action correspondante.
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.toUpsert[0].actions?.[0].impacts).toEqual([]);
  });

  it("handles empty optional fields correctly across all 3 sheets", () => {
    const sheets: LeverImportRawSheets = {
      leviers: [
        baseLeverRow({
          Owner: "",
          Sponsor: "",
          "Progression (%)": "",
          "Dépendances (ID:type, séparées par ;)": "",
          Description: "",
        }),
      ],
      actions: [baseActionRow({ Owner: "" })],
      impacts: [
        baseImpactRow({
          "Type de gain": "",
          "Poste de coût": "",
          "Centre de coût": "",
          "Entité P&L": "",
          Commentaire: "",
          ETP: "",
        }),
      ],
    };

    const preview = validateLeverImportRows(sheets, ctx(), "c1");

    expect(preview.errors).toEqual([]);
    const lever = preview.toUpsert[0];
    expect(lever.owner).toBe("");
    expect(lever.sponsor).toBe("");
    expect(lever.progress).toBe(0);
    expect(lever.dependencies).toEqual([]);
    expect(lever.description).toBe("");

    const action = (lever.actions ?? [])[0];
    expect(action.owner).toBeUndefined();

    const impact = (action.impacts ?? [])[0];
    expect(impact.savingType).toBeUndefined();
    expect(impact.pnlMap).toBeUndefined();
    expect(impact.costCenter).toBeUndefined();
    expect(impact.entity).toBeUndefined();
    expect(impact.comments).toBeUndefined();
    expect(impact.fteCount).toBeUndefined();
  });

  it("rejects a row with an unknown Workstream, PnL account, or Statut", () => {
    const preview1 = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ Workstream: "Inconnu" })] },
      ctx(),
      "c1"
    );
    expect(preview1.errors[0].reason).toMatch(/Workstream/);

    const preview2 = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ "Compte P&L impacté": "ZZZ" })] },
      ctx(),
      "c1"
    );
    expect(preview2.errors[0].reason).toMatch(/Compte P&L/);

    const preview3 = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ Statut: "Statut bidon" })] },
      ctx(),
      "c1"
    );
    expect(preview3.errors[0].reason).toMatch(/Statut/);
  });

  it("rejects a duplicate Code within the same import file", () => {
    const preview = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow(), baseLeverRow({ "Nom du levier": "Doublon" })] },
      ctx(),
      "c1"
    );
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].reason).toMatch(/doublon/);
  });

  it("silently skips fully empty rows in all 3 sheets", () => {
    const emptyRow = Object.fromEntries(Object.keys(baseLeverRow()).map((k) => [k, ""]));
    const preview = validateLeverImportRows(
      { leviers: [emptyRow], actions: [], impacts: [] },
      ctx(),
      "c1"
    );
    expect(preview.toUpsert).toEqual([]);
    expect(preview.errors).toEqual([]);
  });
});
