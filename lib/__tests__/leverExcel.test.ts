import { describe, it, expect } from "vitest";
import { leverToExcelRow } from "@/lib/leverExcel";
import { validateLeverImportRows, type LeverImportRawSheets } from "@/lib/leverExcelImport";
import { DEFAULT_LIFECYCLE_STAGES, STATUS_LABEL } from "@/lib/status-config";
import type { Alert, BeTrackData, Lever, LeverStatus } from "@/types";

/**
 * `lib/leverExcel.ts` (export) et `lib/leverExcelImport.ts` (import) doivent rester cohérents
 * entre eux ET avec ce que la plateforme affiche réellement (Kanban, dropdown de statut du
 * formulaire, stepper du détail levier — voir `lib/hooks/useLifecycleLabels.ts`, qui résout
 * toujours contre `DEFAULT_LIFECYCLE_STAGES` en l'absence de personnalisation entreprise). Avant
 * le correctif, l'export écrivait `STATUS_LABEL` (libellés longs, ex. "En cours d'exécution")
 * alors que la plateforme affiche `DEFAULT_LIFECYCLE_STAGES` (libellés courts, ex. "Exécuté") —
 * exporter puis ré-importer restait techniquement possible (l'import ne validait QUE
 * `STATUS_LABEL`), mais le texte visible à l'écran ne correspondait jamais à celui du fichier
 * Excel, ce qui est le bug rapporté par le PO.
 */

const baseLever: Lever = {
  id: "L001",
  code: "L001",
  type: "Sourcing",
  name: "Test Lever",
  ws: "WS-01",
  owner: "Test Owner",
  ownerInit: "TO",
  sponsor: "Test Sponsor",
  sponsorInit: "TS",
  geography: "Europe",
  country: "France",
  entity: "Entity A",
  function: "Supply Chain",
  costCenter: "CC01",
  pnlMap: "GA",
  start: "2026-01-01",
  end: "2026-12-31",
  status: "in_progress",
  progress: 50,
  risk: "low",
  grossSavings: 10,
  netSavings: 8,
  opexOneOff: 1,
  opexRec: 0.5,
  capex: 2,
  fteImpact: -5,
  popImpacted: 100,
  dependencies: [],
  description: "Test lever",
  createdAt: "2026-01-01",
  lastUpdate: "2026-06-01",
  actions: [],
};

const workstreams: Pick<BeTrackData, "workstreams">["workstreams"] = [
  { id: "WS-01", name: "Achats & Supply Chain", sponsor: "Isabelle Roy", color: "#000", target: 0 },
];

const pnlAccounts: Pick<BeTrackData, "pnlAccounts">["pnlAccounts"] = [
  { id: "GA", name: "General & Admin", baseline: -72, sign: -1 },
];

function makeData(overrides?: Partial<BeTrackData>): BeTrackData {
  return {
    program: {
      id: "P01",
      name: "Test Program",
      sponsor: "CEO",
      target: 50,
      currency: "€M",
      fyStart: "2026-01-01",
      fyEnd: "2026-12-31",
      baselineEBIT: 100,
      revenue: 500,
    },
    workstreams,
    leverStatuses: [],
    riskLevels: [],
    leverTypes: [],
    geographies: [],
    functions: [],
    pnlAccounts,
    levers: [],
    workforce: {
      totalFTE: 200,
      massSalary: 15,
      budgetSalary: 16,
      departments: [],
      employees: [],
      movements: [],
    },
    operations: {
      lines: [],
      kpisBaseline: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
      kpisTarget: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
      kpisActual: { oeeAvg: 0, throughput: 0, scrapRate: 0, otd: 0 },
    },
    alerts: [],
    audit: [],
    comments: {},
    ...overrides,
  };
}

const noAlerts: Alert[] = [];

describe("leverExcel — leverToExcelRow (Statut)", () => {
  it("writes the label actually displayed on the platform by default (DEFAULT_LIFECYCLE_STAGES), not the legacy long STATUS_LABEL", () => {
    const row = leverToExcelRow(baseLever, makeData(), noAlerts);
    expect(row["Statut"]).toBe("Exécuté");
    expect(row["Statut"]).not.toBe(STATUS_LABEL.in_progress);
  });

  it("writes STATUS_LABEL verbatim for 'cancelled' (no short form — resolveStatusLabel special-cases it)", () => {
    const row = leverToExcelRow({ ...baseLever, status: "cancelled" }, makeData(), noAlerts);
    expect(row["Statut"]).toBe(STATUS_LABEL.cancelled);
  });

  it("writes a company's custom lifecycle label when explicitly passed", () => {
    const customStages = [
      { key: "in_progress" as const, label: "Déploiement", validationRequired: false },
    ];
    const row = leverToExcelRow(baseLever, makeData(), noAlerts, undefined, customStages);
    expect(row["Statut"]).toBe("Déploiement");
  });

  it.each(Object.keys(STATUS_LABEL) as LeverStatus[])(
    "round-trips through import for status '%s': export -> re-import yields the same status with zero errors",
    (status) => {
      const lever = { ...baseLever, status };
      const data = makeData();
      const exportedRow = leverToExcelRow(lever, data, noAlerts);

      const sheets: LeverImportRawSheets = {
        leviers: [
          {
            Code: lever.code,
            "Type de levier": lever.type,
            "Nom du levier": lever.name,
            Workstream: exportedRow["Workstream"],
            Owner: lever.owner,
            "Owner (initiales)": lever.ownerInit,
            Sponsor: lever.sponsor,
            "Sponsor (initiales)": lever.sponsorInit,
            Géographie: lever.geography,
            Pays: lever.country,
            Entité: lever.entity,
            Fonction: lever.function,
            "Centre de coût": lever.costCenter,
            "Compte P&L impacté": exportedRow["Compte P&L impacté"],
            "Date de départ": lever.start,
            "Date de fin estimée": lever.end,
            Statut: exportedRow["Statut"],
            "Progression (%)": lever.progress,
            "Impact estimé brut (€M)": lever.grossSavings,
            "Impact estimé net (€M)": lever.netSavings,
            "Impact estimé (ETP)": lever.fteImpact,
            "Population impactée": lever.popImpacted,
            "CAPEX (€M)": lever.capex,
            "OPEX one-off (€M)": lever.opexOneOff,
            "OPEX récurrent (€M/an)": lever.opexRec,
            "Dépendances (ID:type, séparées par ;)": "",
            Description: lever.description,
          },
        ],
        actions: [],
        impacts: [],
      };

      const preview = validateLeverImportRows(
        sheets,
        { levers: [], workstreams, pnlAccounts },
        "c1"
      );

      expect(preview.errors).toEqual([]);
      expect(preview.toUpsert[0].status).toBe(status);
    }
  );

  it("also round-trips when the target company has a genuinely custom lifecycle", () => {
    const customStages = DEFAULT_LIFECYCLE_STAGES.map((s) =>
      s.key === "in_progress" ? { ...s, label: "Déploiement" } : s
    );
    const lever = { ...baseLever, status: "in_progress" as const };
    const data = makeData();
    const exportedRow = leverToExcelRow(lever, data, noAlerts, undefined, customStages);
    expect(exportedRow["Statut"]).toBe("Déploiement");

    const sheets: LeverImportRawSheets = {
      leviers: [
        {
          Code: lever.code,
          "Type de levier": lever.type,
          "Nom du levier": lever.name,
          Workstream: exportedRow["Workstream"],
          Owner: lever.owner,
          "Owner (initiales)": lever.ownerInit,
          Sponsor: lever.sponsor,
          "Sponsor (initiales)": lever.sponsorInit,
          Géographie: lever.geography,
          Pays: lever.country,
          Entité: lever.entity,
          Fonction: lever.function,
          "Centre de coût": lever.costCenter,
          "Compte P&L impacté": exportedRow["Compte P&L impacté"],
          "Date de départ": lever.start,
          "Date de fin estimée": lever.end,
          Statut: exportedRow["Statut"],
          "Progression (%)": lever.progress,
          "Impact estimé brut (€M)": lever.grossSavings,
          "Impact estimé net (€M)": lever.netSavings,
          "Impact estimé (ETP)": lever.fteImpact,
          "Population impactée": lever.popImpacted,
          "CAPEX (€M)": lever.capex,
          "OPEX one-off (€M)": lever.opexOneOff,
          "OPEX récurrent (€M/an)": lever.opexRec,
          "Dépendances (ID:type, séparées par ;)": "",
          Description: lever.description,
        },
      ],
      actions: [],
      impacts: [],
    };

    const preview = validateLeverImportRows(
      sheets,
      { levers: [], workstreams, pnlAccounts },
      "c1",
      [],
      customStages
    );

    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert[0].status).toBe("in_progress");
  });
});
