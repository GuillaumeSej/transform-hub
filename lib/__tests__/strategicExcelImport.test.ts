import { describe, it, expect } from "vitest";
import {
  validateStrategicImportRows,
  type StrategicImportExistingData,
  type StrategicImportRawSheets,
} from "@/lib/strategicExcelImport";
import type { MaturityStageConfig } from "@/types";

const companyId = "C1";
const programId = "P1";

const stages: MaturityStageConfig[] = [
  { id: "planned", programId, companyId, order: 1, label: "Planifié" },
  { id: "in_progress", programId, companyId, order: 2, label: "En cours" },
  { id: "done", programId, companyId, order: 3, label: "Terminé", isTerminal: true },
];

function emptyExisting(): StrategicImportExistingData {
  return { axes: [], chantiers: [], actions: [], indicators: [] };
}

function emptySheets(): StrategicImportRawSheets {
  return { axes: [], chantiers: [], actions: [], livrables: [], indicateurs: [] };
}

function baseAxisRow(overrides: Record<string, unknown> = {}) {
  return {
    Code: "AX1",
    Nom: "Excellence opérationnelle",
    Description: "Test",
    Owner: "Marie Lefèvre",
    Couleur: "#320300",
    "Étape de maturité": "Planifié",
    ...overrides,
  };
}

function baseChantierRow(overrides: Record<string, unknown> = {}) {
  return {
    Code: "CH1",
    "Codes Axes (séparés par ;)": "AX1",
    Nom: "Refonte du parcours achats",
    Description: "Test",
    Pilote: "Marc Dubois",
    "Étape de maturité": "Planifié",
    "Budget alloué": 150000,
    "Budget consommé": 42000,
    "ETP consommés": 2.5,
    "Dépendances (Code:type, séparées par ;)": "",
    ...overrides,
  };
}

function baseActionRow(overrides: Record<string, unknown> = {}) {
  return {
    Code: "ACT1",
    "Code Chantier": "CH1",
    Nom: "Cartographier le processus actuel",
    Description: "Test",
    Owner: "Marc Dubois",
    Sponsor: "Isabelle Roy",
    "Date début": "2026-01-15",
    "Date fin": "2026-03-31",
    "Étape de maturité": "Planifié",
    Budget: 30000,
    "Budget consommé": 8000,
    "Poids dans le chantier (%)": 50,
    ...overrides,
  };
}

function baseIndicatorRow(overrides: Record<string, unknown> = {}) {
  return {
    "Code Axe": "AX1",
    "Code Chantier": "",
    Nom: "Taux d'automatisation",
    Type: "Quantitatif",
    Fréquence: "Trimestrielle",
    Objectif: "80% des demandes automatisées",
    "Valeur cible": 80,
    Sens: "Plus haut vaut mieux",
    Unité: "%",
    "Rôles responsables (séparés par ;)": "chantier_owner;strategic_lead",
    ...overrides,
  };
}

function baseLivrableRow(overrides: Record<string, unknown> = {}) {
  return {
    "Code Projet": "ACT1",
    Label: "Cartographie validée en comité",
    Début: "2026-02-01",
    Fin: "2026-03-31",
    ...overrides,
  };
}

describe("validateStrategicImportRows", () => {
  it("importe un plan complet (axes + chantiers + actions + dépendance same-file + indicateurs)", () => {
    const sheets: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [
        baseChantierRow(),
        baseChantierRow({
          Code: "CH2",
          Nom: "Digitalisation des contrats",
          "Dépendances (Code:type, séparées par ;)": "CH1:FS",
        }),
      ],
      actions: [baseActionRow()],
      livrables: [baseLivrableRow()],
      indicateurs: [
        baseIndicatorRow(),
        baseIndicatorRow({
          "Code Axe": "",
          "Code Chantier": "CH1",
          Nom: "Avancement chantier",
        }),
      ],
    };

    const result = validateStrategicImportRows(
      sheets,
      emptyExisting(),
      companyId,
      programId,
      stages
    );

    expect(result.errors).toEqual([]);
    expect(result.toCreate.axes).toHaveLength(1);
    expect(result.toCreate.chantiers).toHaveLength(2);
    expect(result.toCreate.actions).toHaveLength(1);
    expect(result.toCreate.indicators).toHaveLength(2);

    const axis = result.toCreate.axes[0];
    expect(axis.name).toBe("Excellence opérationnelle");
    expect(axis.stage).toBe("planned");
    expect(axis.companyId).toBe(companyId);
    expect(axis.programId).toBe(programId);

    const ch1 = result.toCreate.chantiers.find((c) => c.name === "Refonte du parcours achats");
    const ch2 = result.toCreate.chantiers.find((c) => c.name === "Digitalisation des contrats");
    expect(ch1).toBeDefined();
    expect(ch2).toBeDefined();
    expect(ch1!.axisIds).toEqual([axis.id]);
    expect(ch1!.pilote).toBe("Marc Dubois");
    expect(ch1!.allocatedBudget).toBe(150000);
    expect(ch1!.consumedBudget).toBe(42000);
    expect(ch1!.consumedFte).toBe(2.5);
    // Résolution FK same-file : la dépendance de CH2 pointe vers le VRAI id alloué à CH1, pas
    // vers le Code littéral "CH1" du fichier.
    expect(ch2!.dependencies).toEqual([{ targetId: ch1!.id, type: "FS" }]);

    const action = result.toCreate.actions[0];
    expect(action.chantierId).toBe(ch1!.id);
    expect(action.budget).toBe(30000);
    expect(action.consumedBudget).toBe(8000);
    expect(action.chantierWeightPct).toBe(50);
    expect(action.deliverables).toHaveLength(1);
    expect(action.deliverables![0].label).toBe("Cartographie validée en comité");
    expect(action.deliverables![0].phases).toHaveLength(1);

    const axisIndicator = result.toCreate.indicators.find((ind) =>
      ind.name.includes("automatisation")
    );
    const chantierIndicator = result.toCreate.indicators.find(
      (ind) => ind.name === "Avancement chantier"
    );
    expect(axisIndicator?.axisId).toBe(axis.id);
    expect(axisIndicator?.chantierId).toBeUndefined();
    // Un indicateur rattaché par "Code Chantier" doit dériver son axisId du chantier résolu.
    expect(chantierIndicator?.chantierId).toBe(ch1!.id);
    expect(chantierIndicator?.axisId).toBe(axis.id);
  });

  it("signale une FK manquante/invalide comme erreur de ligne sans lever d'exception", () => {
    const sheets: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [baseChantierRow({ "Codes Axes (séparés par ;)": "AX-INCONNU" })],
      actions: [],
      livrables: [],
      indicateurs: [],
    };

    const result = validateStrategicImportRows(
      sheets,
      emptyExisting(),
      companyId,
      programId,
      stages
    );

    expect(result.toCreate.chantiers).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ sheet: "Chantiers", rowNumber: 2 });
    expect(result.errors[0].reason).toMatch(/introuvable/);
  });

  it("signale une ligne Indicateurs sans Code Axe ni Code Chantier comme erreur", () => {
    const sheets: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [],
      actions: [],
      livrables: [],
      indicateurs: [baseIndicatorRow({ "Code Axe": "", "Code Chantier": "" })],
    };

    const result = validateStrategicImportRows(
      sheets,
      emptyExisting(),
      companyId,
      programId,
      stages
    );

    expect(result.toCreate.indicators).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sheet).toBe("Indicateurs");
    expect(result.errors[0].reason).toMatch(/obligatoire/);
  });

  it("signale une dépendance de chantier référençant un Code introuvable, sans planter", () => {
    const sheets: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [
        baseChantierRow({
          Code: "CH2",
          Nom: "Digitalisation des contrats",
          "Dépendances (Code:type, séparées par ;)": "CH-FANTOME:FS",
        }),
      ],
      actions: [],
      livrables: [],
      indicateurs: [],
    };

    expect(() =>
      validateStrategicImportRows(sheets, emptyExisting(), companyId, programId, stages)
    ).not.toThrow();

    const result = validateStrategicImportRows(
      sheets,
      emptyExisting(),
      companyId,
      programId,
      stages
    );

    expect(result.toCreate.chantiers).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sheet).toBe("Chantiers");
    expect(result.errors[0].reason).toMatch(/CH-FANTOME/);
  });

  it("exclut du toCreate une ligne Livrables dont la FK Code Action est introuvable, sans invalider l'action", () => {
    const sheets: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [baseChantierRow()],
      actions: [baseActionRow()],
      livrables: [baseLivrableRow({ "Code Projet": "ACT-INCONNU" })],
      indicateurs: [],
    };

    const result = validateStrategicImportRows(
      sheets,
      emptyExisting(),
      companyId,
      programId,
      stages
    );

    expect(result.toCreate.actions).toHaveLength(1);
    expect(result.toCreate.actions[0].deliverables ?? []).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].sheet).toBe("Livrables");
  });

  it("rattache un chantier à PLUSIEURS axes via 'Codes Axes (séparés par ;)'", () => {
    const sheets: StrategicImportRawSheets = {
      axes: [baseAxisRow(), baseAxisRow({ Code: "AX2", Nom: "Transformation digitale" })],
      chantiers: [baseChantierRow({ "Codes Axes (séparés par ;)": "AX1;AX2" })],
      actions: [],
      livrables: [],
      indicateurs: [],
    };

    const result = validateStrategicImportRows(
      sheets,
      emptyExisting(),
      companyId,
      programId,
      stages
    );

    expect(result.errors).toEqual([]);
    const ax1 = result.toCreate.axes.find((a) => a.name === "Excellence opérationnelle")!;
    const ax2 = result.toCreate.axes.find((a) => a.name === "Transformation digitale")!;
    expect(result.toCreate.chantiers[0].axisIds).toEqual([ax1.id, ax2.id]);
  });

  it("signale un ou plusieurs codes d'axe introuvables dans une liste multi-axes, sans bloquer les codes valides isolément", () => {
    const sheets: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [baseChantierRow({ "Codes Axes (séparés par ;)": "AX1;AX-FANTOME" })],
      actions: [],
      livrables: [],
      indicateurs: [],
    };

    const result = validateStrategicImportRows(
      sheets,
      emptyExisting(),
      companyId,
      programId,
      stages
    );

    expect(result.toCreate.chantiers).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ sheet: "Chantiers" });
    expect(result.errors[0].reason).toMatch(/AX-FANTOME/);
  });

  it("signale une colonne budget/ETP facultative non numérique comme erreur (Chantiers et Projets), sans bloquer quand elle est vide", () => {
    const sheetsInvalidChantierBudget: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [baseChantierRow({ "Budget alloué": "pas un nombre" })],
      actions: [],
      livrables: [],
      indicateurs: [],
    };
    const resultChantier = validateStrategicImportRows(
      sheetsInvalidChantierBudget,
      emptyExisting(),
      companyId,
      programId,
      stages
    );
    expect(resultChantier.toCreate.chantiers).toHaveLength(0);
    expect(resultChantier.errors).toHaveLength(1);
    expect(resultChantier.errors[0]).toMatchObject({ sheet: "Chantiers" });
    expect(resultChantier.errors[0].reason).toMatch(/Budget alloué/);

    const sheetsInvalidActionBudget: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [baseChantierRow()],
      actions: [baseActionRow({ Budget: "N/A" })],
      livrables: [],
      indicateurs: [],
    };
    const resultAction = validateStrategicImportRows(
      sheetsInvalidActionBudget,
      emptyExisting(),
      companyId,
      programId,
      stages
    );
    expect(resultAction.toCreate.actions).toHaveLength(0);
    expect(resultAction.errors).toHaveLength(1);
    expect(resultAction.errors[0]).toMatchObject({ sheet: "Projets" });
    expect(resultAction.errors[0].reason).toMatch(/Budget/);

    // Champs budget/ETP tous vides : facultatifs, jamais une erreur.
    const sheetsAllEmptyBudgets: StrategicImportRawSheets = {
      axes: [baseAxisRow()],
      chantiers: [
        baseChantierRow({
          "Budget alloué": "",
          "Budget consommé": "",
          "ETP consommés": "",
          Pilote: "",
        }),
      ],
      actions: [
        baseActionRow({ Budget: "", "Budget consommé": "", "Poids dans le chantier (%)": "" }),
      ],
      livrables: [],
      indicateurs: [],
    };
    const resultEmpty = validateStrategicImportRows(
      sheetsAllEmptyBudgets,
      emptyExisting(),
      companyId,
      programId,
      stages
    );
    expect(resultEmpty.errors).toEqual([]);
    expect(resultEmpty.toCreate.chantiers[0].allocatedBudget).toBeUndefined();
    expect(resultEmpty.toCreate.chantiers[0].pilote).toBeUndefined();
    expect(resultEmpty.toCreate.actions[0].budget).toBeUndefined();
    expect(resultEmpty.toCreate.actions[0].chantierWeightPct).toBeUndefined();
  });

  it("ne plante jamais sur des feuilles vides", () => {
    const result = validateStrategicImportRows(
      emptySheets(),
      emptyExisting(),
      companyId,
      programId,
      stages
    );
    expect(result.errors).toEqual([]);
    expect(result.toCreate).toEqual({ axes: [], chantiers: [], actions: [], indicators: [] });
  });
});
