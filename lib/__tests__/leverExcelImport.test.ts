import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  ACTION_IMPORT_HEADERS,
  IMPACT_IMPORT_HEADERS,
  LEVER_IMPORT_HEADERS,
  importStatusTransitionError,
  leverImportTemplateRows,
  validateLeverImportRows,
  type LeverImportRawSheets,
} from "@/lib/leverExcelImport";
import { leverActionsToExcelRows } from "@/lib/leverExcel";
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

/** Levier déjà en base, au statut donné, avec le même Code que `baseLeverRow` : un import qui
 *  garde ce statut est permis (voir `importStatusTransitionError`), alors qu'un NOUVEAU levier ne
 *  peut être importé qu'au stade « Identifié ». */
function existingLeverAt(status: Lever["status"]): Lever {
  return {
    id: "L001",
    programId: "prog1",
    code: "PROC-001",
    type: "Sourcing & Achats",
    name: "Optimisation achats indirects",
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
    start: "2026-01-15",
    end: "2026-12-31",
    status,
    progress: 0,
    risk: "medium",
    grossSavings: 2.5,
    netSavings: 2.1,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    popImpacted: "",
    companyId: "c1",
    dependencies: [],
    description: "",
    createdAt: "2025-01-01",
    lastUpdate: "2025-01-01",
    actions: [],
  };
}

const emptySheets: LeverImportRawSheets = { leviers: [], actions: [], impacts: [] };

/** Programme unique par défaut pour la plupart des tests : la colonne "Programme" du fichier peut
 *  alors rester vide (rattachement sans ambiguïté) — voir `validateLeverImportRows` /
 *  `Lever.programId` (désormais obligatoire). Les tests qui portent spécifiquement sur la
 *  résolution de la colonne "Programme" passent leur propre tableau `programs`. */
const singleProgram = [{ id: "prog1", name: "Programme Test" }];

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
    Statut: "Identifié",
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

    const preview = validateLeverImportRows(sheets, ctx(), "c1", singleProgram);

    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.createCount).toBe(1);
    expect(preview.updateCount).toBe(0);

    const lever = preview.toUpsert[0];
    expect(lever.code).toBe("PROC-001");
    expect(lever.ws).toBe("WS-PROC");
    expect(lever.pnlMap).toBe("GA");
    expect(lever.status).toBe("idea");
    expect(lever.companyId).toBe("c1");
    expect(lever.actions).toHaveLength(2);

    // Impacts portés par le LEVIER (modèle actuel), plus par les actions.
    const allImpacts = lever.impacts ?? [];
    expect(allImpacts).toHaveLength(3);
    expect(allImpacts.map((i) => i.label)).toContain(
      "Digitaliser le processus achats — Coût (CAPEX)"
    );

    const capexImpact = allImpacts.find((i) => i.nature === "capex")!;
    expect(capexImpact.capexDeploymentDate).toBe("2026-03-15");

    const gainImpact = allImpacts.find((i) => i.type === "saving")!;
    expect(gainImpact.savingType).toBe("cost_reduction");
    expect(gainImpact.gainDate).toBe("2026-07-01");
  });

  it("updates a lever whose Code already exists in the database", () => {
    const existing: Lever = {
      id: "L001",
      programId: "p1",
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
      popImpacted: "",
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

    const preview = validateLeverImportRows(sheets, ctx([existing]), "c1", singleProgram);

    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.createCount).toBe(0);
    expect(preview.updateCount).toBe(1);
    expect(preview.toUpsert[0].name).toBe("Nouveau nom");
    // Le fichier ne redéclare aucune action pour ce levier -> le plan (déjà vide) reste vide.
    expect(preview.toUpsert[0].actions).toEqual([]);
    // Le risque stocké n'est pas réinitialisé par l'import (recalculé de toute façon à l'affichage).
    expect(preview.toUpsert[0].risk).toBe("medium");
  });

  it("wipes a lever's pre-existing actions when the file declares none for its Code", () => {
    const existing: Lever = {
      id: "L001",
      programId: "p1",
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
      popImpacted: "",
      companyId: "c1",
      dependencies: [],
      description: "",
      createdAt: "2025-01-01",
      lastUpdate: "2025-01-01",
      actions: [
        {
          id: "A001",
          name: "Ancienne action",
          start: "2026-01-01",
          end: "2026-02-01",
          status: "todo",
          impacts: [],
        },
      ],
    };

    const sheets: LeverImportRawSheets = {
      leviers: [baseLeverRow({ "Nom du levier": "Nouveau nom" })],
      actions: [],
      impacts: [],
    };

    const preview = validateLeverImportRows(sheets, ctx([existing]), "c1", singleProgram);

    expect(preview.errors).toEqual([]);
    expect(preview.updateCount).toBe(1);
    // Le fichier importé fait foi : aucune ligne Action pour ce Code -> le plan d'action existant
    // (qui contenait "Ancienne action") est intégralement vidé, pas conservé.
    expect(preview.toUpsert[0].actions).toEqual([]);
    // Les autres champs préservés (ex. risk) ne sont pas affectés par ce changement.
    expect(preview.toUpsert[0].risk).toBe("medium");
  });

  it("reports a line error when an Action row references an unknown lever code", () => {
    const sheets: LeverImportRawSheets = {
      leviers: [baseLeverRow()],
      actions: [baseActionRow({ "Code Levier": "GHOST-999" })],
      impacts: [],
    };

    const preview = validateLeverImportRows(sheets, ctx(), "c1", singleProgram);

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

    const preview = validateLeverImportRows(sheets, ctx(), "c1", singleProgram);

    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].sheet).toBe("Impacts");
    expect(preview.errors[0].reason).toMatch(/introuvable/);
    // Le levier reste importable (aucune erreur autre que la ligne d'impact orpheline) même si
    // l'impact fantôme est écarté silencieusement de l'action correspondante.
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.toUpsert[0].impacts ?? []).toEqual([]);
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

    const preview = validateLeverImportRows(sheets, ctx(), "c1", singleProgram);

    expect(preview.errors).toEqual([]);
    const lever = preview.toUpsert[0];
    expect(lever.owner).toBe("");
    expect(lever.sponsor).toBe("");
    expect(lever.progress).toBe(0);
    expect(lever.dependencies).toEqual([]);
    expect(lever.description).toBe("");

    const action = (lever.actions ?? [])[0];
    expect(action.owner).toBeUndefined();

    const impact = (lever.impacts ?? [])[0];
    expect(impact.savingType).toBeUndefined();
    expect(impact.pnlMap).toBeUndefined();
    expect(impact.costCenter).toBeUndefined();
    expect(impact.entity).toBeUndefined();
    expect(impact.comments).toBeUndefined();
    expect(impact.fteCount).toBeUndefined();
  });

  it("auto-creates an unknown Workstream instead of rejecting the row (no admin UI exists to pre-create one)", () => {
    const preview1 = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ Workstream: "Excellence Nordique" })] },
      ctx(),
      "c1",
      singleProgram
    );
    expect(preview1.errors).toEqual([]);
    expect(preview1.toCreateWorkstreams).toHaveLength(1);
    expect(preview1.toCreateWorkstreams[0].name).toBe("Excellence Nordique");
    expect(preview1.toUpsert[0].ws).toBe(preview1.toCreateWorkstreams[0].id);
  });

  it("resolves the Programme column by name, auto-resolves a blank column when exactly one program exists, and errors on an unknown Programme (no auto-create, unlike Workstream) or an unresolvable blank column (0 or 2+ programs)", () => {
    const programs = [{ id: "p1", name: "NordicRetail Excellence 2026" }];

    // Colonne vide + un SEUL programme pour l'entreprise -> rattachement sans ambiguïté.
    const blankSingleProgram = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow()] },
      ctx(),
      "c1",
      programs
    );
    expect(blankSingleProgram.errors).toEqual([]);
    expect(blankSingleProgram.toUpsert[0].programId).toBe("p1");

    // Colonne renseignée -> résolue par nom.
    const withProgram = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ Programme: "NordicRetail Excellence 2026" })] },
      ctx(),
      "c1",
      programs
    );
    expect(withProgram.errors).toEqual([]);
    expect(withProgram.toUpsert[0].programId).toBe("p1");

    // Nom de programme inconnu -> erreur de ligne (pas d'auto-création, contrairement au Workstream).
    const unknownProgram = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ Programme: "Programme fantôme" })] },
      ctx(),
      "c1",
      programs
    );
    expect(unknownProgram.errors[0].reason).toMatch(/Programme/);

    // Colonne vide + AUCUN programme pour l'entreprise -> `programId` obligatoire ne peut pas être
    // résolu, la ligne est rejetée (au lieu d'être acceptée avec un levier "non rattaché").
    const blankNoProgram = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow()] },
      ctx(),
      "c1",
      []
    );
    expect(blankNoProgram.errors).toHaveLength(1);
    expect(blankNoProgram.errors[0].reason).toMatch(/Programme/);
    expect(blankNoProgram.toUpsert).toEqual([]);

    // Colonne vide + PLUSIEURS programmes pour l'entreprise -> ambiguïté, la ligne est rejetée.
    const blankMultiplePrograms = validateLeverImportRows(
      {
        ...emptySheets,
        leviers: [baseLeverRow()],
      },
      ctx(),
      "c1",
      [...programs, { id: "p2", name: "Autre programme" }]
    );
    expect(blankMultiplePrograms.errors).toHaveLength(1);
    expect(blankMultiplePrograms.errors[0].reason).toMatch(/Programme/);
    expect(blankMultiplePrograms.toUpsert).toEqual([]);
  });

  it("rejects a row with an unknown PnL account or Statut", () => {
    const preview2 = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ "Compte P&L impacté": "ZZZ" })] },
      ctx(),
      "c1",
      singleProgram
    );
    expect(preview2.errors[0].reason).toMatch(/Compte P&L/);

    const preview3 = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ Statut: "Statut bidon" })] },
      ctx(),
      "c1",
      singleProgram
    );
    expect(preview3.errors[0].reason).toMatch(/Statut/);
  });

  it("rejects a duplicate Code within the same import file", () => {
    const preview = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow(), baseLeverRow({ "Nom du levier": "Doublon" })] },
      ctx(),
      "c1",
      singleProgram
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
      "c1",
      singleProgram
    );
    expect(preview.toUpsert).toEqual([]);
    expect(preview.errors).toEqual([]);
  });

  describe("Statut — cohérence avec le référentiel de cycle de vie réellement affiché (voir lib/status-config.ts)", () => {
    // Le cycle de vie par défaut affiché sur la plateforme (Kanban, dropdown de statut, stepper du
    // détail levier) utilise DEFAULT_LIFECYCLE_STAGES (libellés courts), pas le STATUS_LABEL
    // historique (libellés longs) — voir lib/hooks/useLifecycleLabels.ts. Un import doit accepter
    // les deux, sinon un utilisateur qui tape ce qu'il voit à l'écran est bloqué.
    it("accepts the short default label actually displayed on the platform (DEFAULT_LIFECYCLE_STAGES)", () => {
      const preview = validateLeverImportRows(
        { ...emptySheets, leviers: [baseLeverRow({ Statut: "Exécuté" })] },
        ctx([existingLeverAt("in_progress")]),
        "c1",
        singleProgram
      );
      expect(preview.errors).toEqual([]);
      expect(preview.toUpsert[0].status).toBe("in_progress");
    });

    it("still accepts the legacy long-form label (STATUS_LABEL) for backward compatibility with old files/templates", () => {
      const preview = validateLeverImportRows(
        { ...emptySheets, leviers: [baseLeverRow({ Statut: "En cours d'exécution" })] },
        ctx([existingLeverAt("in_progress")]),
        "c1",
        singleProgram
      );
      expect(preview.errors).toEqual([]);
      expect(preview.toUpsert[0].status).toBe("in_progress");
    });

    it("accepts a genuine per-company custom lifecycle label when the caller passes it", () => {
      const customStages = [
        { key: "idea" as const, label: "Piste identifiée", validationRequired: false },
        { key: "qualified" as const, label: "Cas d'usage validé", validationRequired: false },
        { key: "validated" as const, label: "Lancement décidé", validationRequired: true },
        { key: "in_progress" as const, label: "Déploiement", validationRequired: false },
        { key: "delivered" as const, label: "Bénéfices constatés", validationRequired: false },
      ];

      const rejected = validateLeverImportRows(
        { ...emptySheets, leviers: [baseLeverRow({ Statut: "Déploiement" })] },
        ctx([existingLeverAt("in_progress")]),
        "c1",
        singleProgram
        // pas de lifecycleStages custom passé -> le libellé personnalisé n'est pas (encore) connu
      );
      expect(rejected.errors[0].reason).toMatch(/Statut/);

      const accepted = validateLeverImportRows(
        { ...emptySheets, leviers: [baseLeverRow({ Statut: "Déploiement" })] },
        ctx([existingLeverAt("in_progress")]),
        "c1",
        singleProgram,
        customStages
      );
      expect(accepted.errors).toEqual([]);
      expect(accepted.toUpsert[0].status).toBe("in_progress");
    });

    it("still rejects a genuinely unknown Statut, listing the labels actually shown on screen", () => {
      const preview = validateLeverImportRows(
        { ...emptySheets, leviers: [baseLeverRow({ Statut: "Statut bidon" })] },
        ctx(),
        "c1",
        singleProgram
      );
      expect(preview.errors[0].reason).toMatch(/Statut "Statut bidon" inconnu/);
      // Les libellés suggérés sont ceux du référentiel par défaut réellement affiché (courts),
      // pas le vocabulaire Excel historique que l'utilisateur ne voit jamais à l'écran.
      expect(preview.errors[0].reason).toContain("Identifié");
      expect(preview.errors[0].reason).toContain("Exécuté");
    });
  });
});

describe("leverExcelImport — programme par défaut et modèle", () => {
  // Cas ACME : un programme Performance + un Plan Stratégique. La page ne passe plus que les
  // programmes Performance, et le programme sélectionné sert de cible par défaut.
  const perfAndOther = [
    { id: "p1", name: "Transformation Excellence 2026" },
    { id: "p2", name: "Autre programme Performance" },
  ];

  it("rattache une ligne sans colonne Programme au programme sélectionné", () => {
    const preview = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow()] },
      ctx(),
      "c1",
      perfAndOther,
      undefined,
      "p2"
    );
    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.toUpsert[0].programId).toBe("p2");
  });

  it("ignore un programme par défaut qui n'est pas dans la liste autorisée", () => {
    const preview = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow()] },
      ctx(),
      "c1",
      perfAndOther,
      undefined,
      "strategic-1"
    );
    expect(preview.errors).toHaveLength(1);
    expect(preview.errors[0].reason).toMatch(/Programme/);
  });

  it("aligne chaque valeur d'exemple du modèle sur sa colonne", () => {
    const rows = leverImportTemplateRows("Transformation Excellence 2026");
    expect(rows.leviers[0]).toHaveLength(LEVER_IMPORT_HEADERS.length);
    expect(rows.actions[0]).toHaveLength(ACTION_IMPORT_HEADERS.length);
    expect(rows.impacts[0]).toHaveLength(IMPACT_IMPORT_HEADERS.length);
    const commentIdx = IMPACT_IMPORT_HEADERS.indexOf("Commentaire");
    expect(String(rows.impacts[0][commentIdx])).toMatch(/Exemple/);
    expect(rows.impacts[0][IMPACT_IMPORT_HEADERS.indexOf("Mode")]).toBe("");
    expect(rows.leviers[0][LEVER_IMPORT_HEADERS.indexOf("Programme")]).toBe(
      "Transformation Excellence 2026"
    );
  });

  it.each([
    ["colonne Programme pré-remplie", "Transformation Excellence 2026", null],
    ["colonne Programme vide + programme sélectionné", "", "p1"],
  ])("importe le modèle téléchargé tel quel sans erreur (%s)", (_label, programName, def) => {
    // Aller-retour réel par un classeur XLSX, comme le bouton (aoa_to_sheet -> sheet_to_json).
    const rows = leverImportTemplateRows(programName);
    const toJson = (headers: readonly string[], data: (string | number)[][]) =>
      XLSX.utils.sheet_to_json<Record<string, unknown>>(
        XLSX.utils.aoa_to_sheet([[...headers], ...data]),
        { defval: "" }
      );
    const preview = validateLeverImportRows(
      {
        leviers: toJson(LEVER_IMPORT_HEADERS, rows.leviers),
        actions: toJson(ACTION_IMPORT_HEADERS, rows.actions),
        impacts: toJson(IMPACT_IMPORT_HEADERS, rows.impacts),
      },
      ctx(),
      "c1",
      perfAndOther,
      undefined,
      def
    );
    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert).toHaveLength(1);
    expect(preview.toUpsert[0].programId).toBe("p1");
    expect(preview.toCreateWorkstreams ?? []).toEqual([]);
  });

  it("n'utilise pas un code d'exemple qui écraserait un vrai levier", () => {
    const rows = leverImportTemplateRows();
    const code = rows.leviers[0][LEVER_IMPORT_HEADERS.indexOf("Code")];
    expect(code).toBe("EXEMPLE-001");
    expect(rows.actions[0][0]).toBe(code);
    expect(rows.impacts[0][0]).toBe(code);
  });
});

describe("leverExcelImport — conservation des plans d'action (aller-retour export/import)", () => {
  const existingWithActions = (): Lever => ({
    id: "L001",
    programId: "prog1",
    code: "PROC-001",
    type: "Sourcing & Achats",
    name: "Optimisation achats indirects",
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
    start: "2026-01-15",
    end: "2026-12-31",
    status: "idea",
    progress: 0,
    risk: "medium",
    grossSavings: 2.5,
    netSavings: 2.1,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    popImpacted: "",
    companyId: "c1",
    dependencies: [],
    description: "",
    createdAt: "2025-01-01",
    lastUpdate: "2025-01-01",
    actions: [
      {
        id: "A001",
        name: "Renégocier contrats classe A",
        owner: "Marc Dubois",
        start: "2026-01-15",
        end: "2026-04-30",
        status: "in_progress",
        weightPct: 60,
        declaredProgressPct: 40,
        description: "Détail non exporté",
        impacts: [],
      },
      {
        id: "A002",
        name: "Centraliser les commandes",
        start: "2026-05-01",
        end: "2026-09-30",
        status: "todo",
        weightPct: 40,
        impacts: [],
      },
    ],
  });

  it("conserve les actions quand le fichier n'a pas de feuille Actions", () => {
    const preview = validateLeverImportRows(
      { leviers: [baseLeverRow()], actions: null, impacts: null },
      ctx([existingWithActions()]),
      "c1",
      singleProgram
    );
    expect(preview.errors).toEqual([]);
    expect(preview.actionsSheetPresent).toBe(false);
    expect(preview.actionsRemoved).toEqual([]);
    expect(preview.toUpsert[0].actions).toEqual(existingWithActions().actions);
  });

  it("fusionne par nom (garde id, poids, avancement) et signale les actions supprimées", () => {
    const preview = validateLeverImportRows(
      {
        leviers: [baseLeverRow()],
        actions: [baseActionRow({ Statut: "Terminé", "Date fin": "2026-05-15" })],
        impacts: [],
      },
      ctx([existingWithActions()]),
      "c1",
      singleProgram
    );
    expect(preview.errors).toEqual([]);
    const actions = preview.toUpsert[0].actions ?? [];
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: "A001",
      status: "done",
      end: "2026-05-15",
      weightPct: 60,
      declaredProgressPct: 40,
      description: "Détail non exporté",
    });
    expect(preview.actionsRemoved).toEqual([{ code: "PROC-001", count: 1 }]);
  });

  it("ré-importer un export tel quel ne modifie aucun plan d'action", () => {
    const lever = existingWithActions();
    const toJson = (headers: readonly string[], rows: Record<string, unknown>[]) =>
      XLSX.utils.sheet_to_json<Record<string, unknown>>(
        XLSX.utils.json_to_sheet(rows, { header: [...headers] }),
        { defval: "" }
      );
    const preview = validateLeverImportRows(
      {
        leviers: [baseLeverRow()],
        actions: toJson(ACTION_IMPORT_HEADERS, leverActionsToExcelRows(lever)),
        impacts: null,
      },
      ctx([lever]),
      "c1",
      singleProgram
    );
    expect(preview.errors).toEqual([]);
    expect(preview.actionsRemoved).toEqual([]);
    expect(preview.toUpsert[0].actions).toEqual(lever.actions);
  });
});

describe("leverExcelImport — portes de validation (XLS-05)", () => {
  const label = (st: string) => st;

  it("refuse un nouveau levier importé au-delà du stade Identifié", () => {
    for (const statut of ["Validé", "Planifié", "Exécuté", "Réalisé"]) {
      const preview = validateLeverImportRows(
        { ...emptySheets, leviers: [baseLeverRow({ Statut: statut })] },
        ctx(),
        "c1",
        singleProgram
      );
      expect(preview.toUpsert).toEqual([]);
      expect(preview.errors[0].reason).toMatch(/nouveau levier ne peut être importé/);
    }
  });

  it("accepte un nouveau levier Identifié ou abandonné", () => {
    for (const statut of ["Identifié", "Levier abandonné"]) {
      const preview = validateLeverImportRows(
        { ...emptySheets, leviers: [baseLeverRow({ Statut: statut })] },
        ctx(),
        "c1",
        singleProgram
      );
      expect(preview.errors).toEqual([]);
    }
  });

  it("refuse un changement de statut vers une étape protégée au lieu de l'ignorer en silence", () => {
    const preview = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ Statut: "Validé" })] },
      ctx([existingLeverAt("idea")]),
      "c1",
      singleProgram
    );
    expect(preview.toUpsert).toEqual([]);
    expect(preview.errors[0].reason).toMatch(/nécessite une validation/);
  });

  it("refuse un retour en arrière dans le cycle", () => {
    const preview = validateLeverImportRows(
      { ...emptySheets, leviers: [baseLeverRow({ Statut: "Identifié" })] },
      ctx([existingLeverAt("validated")]),
      "c1",
      singleProgram
    );
    expect(preview.errors[0].reason).toMatch(/revenir en arrière/);
  });

  it("autorise statut inchangé, abandon, réactivation et Exécuté → Réalisé", () => {
    expect(importStatusTransitionError("validated", "validated", label)).toBeNull();
    expect(importStatusTransitionError("validated", "cancelled", label)).toBeNull();
    expect(importStatusTransitionError("cancelled", "idea", label)).toBeNull();
    expect(importStatusTransitionError("in_progress", "delivered", label)).toBeNull();
    expect(importStatusTransitionError("validated", "delivered", label)).not.toBeNull();
    expect(importStatusTransitionError("cancelled", "in_progress", label)).not.toBeNull();
  });

  it("portes effectives = étapes « validation requise » du programme (même règle que updateLever)", () => {
    const onlyValidatedGated = [
      { key: "idea" as const, label: "Identifié", validationRequired: false },
      { key: "qualified" as const, label: "Validé", validationRequired: false },
      { key: "validated" as const, label: "Planifié", validationRequired: true },
      { key: "in_progress" as const, label: "Exécuté", validationRequired: false },
      { key: "delivered" as const, label: "Réalisé", validationRequired: false },
    ];
    // Étape sans validation requise : progression libre à l'import.
    expect(importStatusTransitionError("idea", "qualified", label, onlyValidatedGated)).toBeNull();
    expect(
      importStatusTransitionError("validated", "delivered", label, onlyValidatedGated)
    ).toBeNull();
    // Viser au-delà d'une porte ne la contourne pas.
    expect(importStatusTransitionError("idea", "in_progress", label, onlyValidatedGated)).toMatch(
      /nécessite une validation/
    );
    expect(
      importStatusTransitionError("qualified", "validated", label, onlyValidatedGated)
    ).toMatch(/nécessite une validation/);
    // Jamais de retour en arrière, ni d'abandonné → Réalisé.
    expect(importStatusTransitionError("in_progress", "idea", label, onlyValidatedGated)).toMatch(
      /revenir en arrière/
    );
    // Abandonné → Réalisé : la porte « Planifié » est franchie d'abord ; sans aucune porte, le
    // passage direct reste refusé (même règle que `updateLever`).
    expect(
      importStatusTransitionError("cancelled", "delivered", label, onlyValidatedGated)
    ).toMatch(/nécessite une validation/);
    const noGates = onlyValidatedGated.map((s) => ({ ...s, validationRequired: false }));
    expect(importStatusTransitionError("idea", "delivered", label, noGates)).toBeNull();
    expect(importStatusTransitionError("cancelled", "delivered", label, noGates)).toMatch(
      /revenir en arrière/
    );
  });
});
