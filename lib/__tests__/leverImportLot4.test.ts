import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  ACTION_IMPORT_HEADERS,
  LARGE_AMOUNT_M,
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
import { convertExcelPercentCells, readXlsxWorkbook } from "@/lib/excelParse";
import { bulkUpsertLeversByCode, isActionNameTaken } from "@/lib/leversLogic";
import * as engine from "@/lib/engine";
import { isWorkingCapitalImpact } from "@/lib/impactKinds";
import { flattenOneOffGainImpacts, flattenSavingImpacts } from "@/lib/financeCosts";
import { oneOffGainsTotal } from "@/lib/dashboardSavings";
import {
  formatAmount,
  formatAmountM,
  formatCompactCurrency,
  formatCurrency,
  formatDecimal,
  formatFte,
  formatMeasure,
  formatMillions,
  formatNumber,
  formatPct,
  setFormatLocale,
} from "@/lib/format";
import type { BeTrackData, Lever, LeverImpact } from "@/types";

/** Audit lot 4 — fiabilisation des imports/exports Excel des leviers (points 1 à 10). */

type Ctx = Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">;

const workstreams: Ctx["workstreams"] = [
  { id: "WS-PROC", name: "Achats & Supply Chain", sponsor: "IR", color: "#000", target: 0 },
];
const pnlAccounts: Ctx["pnlAccounts"] = [
  { id: "GA", name: "General & Admin", baseline: -72, sign: -1 },
];
const programs = [{ id: "p1", name: "Programme 1" }];

function lever(overrides: Partial<Lever> = {}): Lever {
  return {
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
    status: "idea",
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
    actions: [],
    ...overrides,
  };
}

function impact(overrides: Partial<LeverImpact> = {}): LeverImpact {
  return {
    id: "IMP-1",
    label: "Renégociation",
    type: "saving",
    nature: "opex_rec",
    amount: 1,
    gainDate: "2026-07-01",
    ...overrides,
  };
}

const ctx = (levers: Lever[]): Ctx => ({ levers, workstreams, pnlAccounts });
const asData = (levers: Lever[]) =>
  ({ ...ctx(levers), program: {}, alerts: [] }) as unknown as BeTrackData;

/** Export réel (mêmes appels que `ExportButton`) → classeur .xlsx → relecture comme l'appli
 *  (`readXlsxWorkbook` + `convertExcelPercentCells`, `sheet_to_json` avec `defval: ""`). */
function exportThenRead(levers: Lever[]): LeverImportRawSheets {
  const data = asData(levers);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      levers.map((l) => leverToExcelRow(l, data, [], undefined, undefined, programs))
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
  return readBack(wb);
}

function readBack(wb: XLSX.WorkBook): LeverImportRawSheets {
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const read = convertExcelPercentCells(readXlsxWorkbook(XLSX, buf));
  const sheet = (name: string) =>
    read.Sheets[name]
      ? XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets[name], { defval: "" })
      : null;
  return { leviers: sheet("Leviers") ?? [], actions: sheet("Actions"), impacts: sheet("Impacts") };
}

/** Jeu de leviers couvrant les cas de l'audit : levier sans action à 40 % stocké (point 1), levier
 *  à actions + impacts (dont un impact BFR et un « Réalisé » validé), levier macro au plan figé. */
function auditLevers(): Lever[] {
  return [
    lever({ status: "in_progress", progress: 40, popImpacted: 120 }),
    lever({
      id: "c1-L002",
      code: "PROC-002",
      status: "in_progress",
      progress: 12,
      actions: [
        { id: "A1", name: "Cadrage", start: "2026-01-15", end: "2026-03-01", status: "done" },
        {
          id: "A2",
          name: "Déploiement",
          owner: "Léa",
          start: "2026-03-01",
          end: "2026-09-01",
          status: "in_progress",
          weightPct: 60,
        },
      ],
      impacts: [
        impact(),
        impact({
          id: "IMP-2",
          label: "Stock",
          savingType: "working_capital",
          amount: 3,
          costCenter: "CC-9",
        }),
        impact({
          id: "IMP-3",
          label: "Licences",
          type: "cost",
          nature: "opex_rec",
          amount: 0.2,
          capexDeploymentDate: "2026-02-01",
          // OPEX récurrent réalisé = « En cours » (statut cohérent, voir coerceImpactStatus).
          status: "ongoing",
          realizedApproval: { status: "approved", decidedBy: "Fin" },
        }),
      ],
    }),
    lever({
      id: "c1-L003",
      code: "PROC-003",
      status: "validated",
      lockedPlan: { grossSavings: 2, netSavings: 1.5, opexOneOff: 0.1, opexRec: 0.5, capex: 0.2 },
    }),
  ];
}

afterEach(() => setFormatLocale("fr"));

describe("points 1-2 — aller-retour export → import (vrai .xlsx) sans modification", () => {
  it("donne 0 création, 0 mise à jour, aucune erreur ni avertissement", () => {
    const levers = auditLevers();
    const sheets = exportThenRead(levers);
    const preview = validateLeverImportRows(sheets, ctx(levers), "c1", programs);
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toEqual([]);
    expect(preview.createCount).toBe(0);
    expect(preview.updateCount).toBe(0);
    expect(preview.unchangedCount).toBe(3);
    expect(preview.toUpsert).toEqual([]);
    expect(preview.actionsRemoved).toEqual([]);
    expect(preview.impactsRemoved).toEqual([]);
    expect(preview.needsConfirmation).toBe(false);

    // Côté écriture : aucun levier écrit, aucune entrée d'audit.
    const inputs = levers.map(({ id: _i, createdAt: _c, lastUpdate: _u, ...rest }) => {
      void _i;
      void _c;
      void _u;
      return rest;
    });
    const result = bulkUpsertLeversByCode(levers, inputs, "u");
    expect(result.changedLevers).toEqual([]);
    expect(result.auditEntries).toEqual([]);
  });

  it("« Progression (%) » n'est jamais appliquée : l'avancement stocké est conservé", () => {
    const existing = lever({ status: "in_progress", progress: 40 });
    const preview = validateLeverImportRows(
      { leviers: [{ Code: "PROC-001", "Progression (%)": 75 }], actions: null, impacts: null },
      ctx([existing]),
      "c1",
      programs
    );
    expect(preview.errors).toEqual([]);
    expect(preview.unchangedCount).toBe(1);
    // Avertissement explicite : valeur calculée depuis le plan d'action (0 % sans action).
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toMatchObject({
      code: "computedFromActions",
      vars: { field: "Progression (%)", value: 75, computed: 0 },
    });
    expect(preview.warnings[0].reason).toMatch(/modification ignorée/);
  });

  it("signale les colonnes calculées modifiées (net, ETP, CAPEX d'un levier porteur d'impacts)", () => {
    const existing = auditLevers()[1];
    const row = leverToExcelRow(existing, asData([existing]), [], undefined, undefined, programs);
    const preview = validateLeverImportRows(
      {
        leviers: [
          { ...row, "Impact estimé net (€M)": 9, "Impact estimé (ETP)": 4, "CAPEX (€M)": 7 },
        ],
        actions: null,
        impacts: null,
      },
      ctx([existing]),
      "c1",
      programs
    );
    expect(preview.errors).toEqual([]);
    expect(preview.unchangedCount).toBe(1); // valeurs calculées conservées
    const flagged = preview.warnings.map((w) => [w.code, w.vars?.field]);
    expect(flagged).toEqual([
      ["computedFromImpacts", "Impact estimé net (€M)"],
      ["computedFromImpacts", "CAPEX (€M)"],
      ["computedFromImpacts", "Impact estimé (ETP)"],
    ]);
  });

  it("levier macro au plan figé : modification du brut signalée « plan figé / réactualisation »", () => {
    const existing = auditLevers()[2];
    const preview = validateLeverImportRows(
      {
        leviers: [{ Code: "PROC-003", "Impact estimé brut (€M)": 5 }],
        actions: null,
        impacts: null,
      },
      ctx([existing]),
      "c1",
      programs
    );
    expect(preview.unchangedCount).toBe(1);
    expect(preview.warnings.map((w) => w.code)).toEqual(["computedFromPlan"]);
  });
});

describe("point 3 — actions de même nom", () => {
  it("isActionNameTaken compare sans casse ni accents et ignore l'action éditée", () => {
    const actions = [
      { id: "A1", name: "Déploiement" },
      { id: "A2", name: "Cadrage" },
    ];
    expect(isActionNameTaken(actions, "  deploiement ")).toBe(true);
    expect(isActionNameTaken(actions, "Déploiement", "A1")).toBe(false);
    expect(isActionNameTaken(actions, "Pilote")).toBe(false);
    expect(isActionNameTaken(actions, "  ")).toBe(false);
  });

  it("refuse deux actions de même nom dans un levier (erreur bloquante)", () => {
    const existing = auditLevers()[1];
    const sheets = exportThenRead([existing]);
    sheets.actions = (sheets.actions ?? []).map((r) => ({ ...r, "Nom de l'action": "Cadrage" }));
    const preview = validateLeverImportRows(sheets, ctx([existing]), "c1", programs);
    expect(preview.errors.map((e) => e.code)).toContain("duplicateAction");
  });

  it("l'identifiant d'action exporté permet de renommer une action sans la perdre", () => {
    const existing = auditLevers()[1];
    const sheets = exportThenRead([existing]);
    sheets.actions = (sheets.actions ?? []).map((r) =>
      r["ID action"] === "A2" ? { ...r, "Nom de l'action": "Déploiement vague 1" } : r
    );
    const preview = validateLeverImportRows(sheets, ctx([existing]), "c1", programs);
    expect(preview.errors).toEqual([]);
    expect(preview.actionsRemoved).toEqual([]);
    expect(preview.updateCount).toBe(1);
    const a2 = preview.toUpsert[0].actions!.find((a) => a.id === "A2")!;
    expect(a2.name).toBe("Déploiement vague 1");
    expect(a2.weightPct).toBe(60); // fusionnée, pas recréée
  });

  it("refuse un même identifiant d'action utilisé deux fois", () => {
    const existing = auditLevers()[1];
    const sheets = exportThenRead([existing]);
    sheets.actions = (sheets.actions ?? []).map((r) => ({ ...r, "ID action": "A1" }));
    const preview = validateLeverImportRows(sheets, ctx([existing]), "c1", programs);
    expect(preview.errors.map((e) => e.code)).toEqual(["duplicateActionId"]);
  });
});

describe("point 4 — impact BFR (trésorerie) hors économies", () => {
  const wc = impact({ id: "W", label: "Stock", savingType: "working_capital", amount: 3 });
  const gain = impact({ id: "G", amount: 1, gainDate: "2020-01-01" });
  const l = lever({
    status: "in_progress",
    impacts: [gain, { ...wc, gainDate: "2020-01-01" }],
  });

  it("isWorkingCapitalImpact ne vise que les gains BFR", () => {
    expect(isWorkingCapitalImpact(wc)).toBe(true);
    expect(isWorkingCapitalImpact(gain)).toBe(false);
    expect(isWorkingCapitalImpact({ type: "cost", savingType: "working_capital" })).toBe(false);
  });

  it("n'entre ni dans le brut/net, ni dans le réalisé, ni dans le P&L — total à part", () => {
    const t = engine.leverImpactTotals(l);
    expect(t.grossAnnual).toBe(1);
    expect(t.netAnnual).toBe(1);
    expect(t.oneOffGains).toBe(0);
    expect(t.workingCapital).toBe(3);
    expect(engine.displayedReforecastNet(l).value).toBe(1);
    expect(engine.realizedSavings(l)).toBe(1);
    expect(engine.realizedGrossSavings(l)).toBe(1);
    expect(engine.impactNetSigned(wc)).toBeNull();
  });

  it("n'entre pas dans la courbe, la Finance ni les gains one-off du dashboard", () => {
    const onlyWc = lever({ status: "in_progress", impacts: [wc] });
    const traj = engine.impactTrajectory(onlyWc, { today: new Date("2026-12-31") });
    expect(traj.points.every((p) => p.gains === 0 && p.oneOffGains === 0)).toBe(true);
    const oneOffWc = lever({ impacts: [{ ...wc, gainRecurrence: "oneoff" }] });
    const data = asData([onlyWc, oneOffWc]);
    expect(flattenSavingImpacts(data)).toEqual([]);
    expect(flattenOneOffGainImpacts(data)).toEqual([]);
    expect(oneOffGainsTotal(data)).toBe(0);
  });

  it("reste visible dans l'export (libellé explicite) et l'ancien libellé « Impact BFR » est accepté", () => {
    const row = leverImpactsToExcelRows(lever({ impacts: [wc] }))[0];
    expect(row["Type de gain"]).toMatch(/BFR.*hors économies/);
    const exported = leverToExcelRow(lever({ impacts: [wc] }), asData([]), []);
    expect(Object.entries(exported).find(([k]) => k.startsWith("Impact BFR"))?.[1]).toBe(3);
    const preview = validateLeverImportRows(
      {
        leviers: [{ Code: "PROC-001" }],
        actions: null,
        impacts: [
          {
            "Code Levier": "PROC-001",
            Type: "Gain",
            "Montant (€M)": 2,
            "Type de gain": "Impact BFR",
          },
        ],
      },
      ctx([lever()]),
      "c1",
      programs
    );
    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert[0].impacts![0].savingType).toBe("working_capital");
  });
});

describe("point 5 — contrôles de grandeur", () => {
  it("450 000 dans une colonne en M€ : avertissement à confirmer", () => {
    const preview = validateLeverImportRows(
      {
        leviers: [{ Code: "PROC-001", "Impact estimé brut (€M)": 450000 }],
        actions: null,
        impacts: [{ "Code Levier": "PROC-001", Type: "Gain", "Montant (€M)": 450000, ETP: 20000 }],
      },
      ctx([lever()]),
      "c1",
      programs
    );
    expect(preview.errors).toEqual([]);
    const large = preview.warnings.filter((w) => w.code === "largeValue");
    expect(large).toHaveLength(3);
    expect(large.every((w) => w.needsConfirmation)).toBe(true);
    expect(preview.needsConfirmation).toBe(true);
    expect(large[0].vars).toMatchObject({ threshold: `${LARGE_AMOUNT_M} M€` });
  });

  it("refuse les négatifs sans signification (brut, CAPEX, montant d'impact, population)", () => {
    const preview = validateLeverImportRows(
      {
        leviers: [
          { Code: "PROC-001", "Impact estimé brut (€M)": -2 },
          { Code: "PROC-002", "Population impactée": -5 },
          // Net et ETP signés : acceptés.
          { Code: "PROC-003", "Impact estimé net (€M)": -0.5, "Impact estimé (ETP)": -3 },
        ],
        actions: null,
        impacts: [
          { "Code Levier": "PROC-003", Type: "Coût", Nature: "CAPEX", "Montant (€M)": -1 },
          { "Code Levier": "PROC-003", Type: "ETP", "Montant (€M)": 0.1, ETP: -2 },
        ],
      },
      ctx([
        lever(),
        lever({ id: "c1-L002", code: "PROC-002" }),
        lever({ id: "c1-L003", code: "PROC-003" }),
      ]),
      "c1",
      programs
    );
    expect(preview.errors.map((e) => [e.sheet, e.rowNumber, e.code])).toEqual([
      ["Leviers", 2, "negativeNotAllowed"],
      ["Leviers", 3, "negativeNotAllowed"],
      ["Impacts", 2, "negativeNotAllowed"],
      ["Impacts", 3, "negativeNotAllowed"],
    ]);
  });
});

describe("point 6 — cellules au format pourcentage", () => {
  it("40 % (valeur 0,4, format %) est lu 40 dans une colonne (%) ; ailleurs inchangé", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Code", "Progression (%)", "CAPEX (€M)"],
      ["PROC-001", 0.4, 0.05],
      ["PROC-002", 1.5, 0.3],
    ]);
    ws["B2"].z = "0%";
    ws["B3"].z = "0.0%";
    ws["C2"].z = "0%"; // colonne non « % » : valeur stockée conservée
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Leviers");
    const rows = readBack(wb).leviers;
    expect(rows[0]["Progression (%)"]).toBe("40%");
    expect(rows[1]["Progression (%)"]).toBe("150%");
    expect(rows[0]["CAPEX (€M)"]).toBe(0.05);

    // Levier existant à 40 % calculés (2 actions pondérées) : aucune alerte ; 150 % ramené à 100.
    const existing = lever({
      actions: [
        {
          id: "A1",
          name: "a",
          start: "2026-01-01",
          end: "2026-02-01",
          status: "done",
          weightPct: 40,
        },
        {
          id: "A2",
          name: "b",
          start: "2026-01-01",
          end: "2026-02-01",
          status: "todo",
          weightPct: 60,
        },
      ],
    });
    expect(engine.leverProgressPct(existing)).toBe(40);
    const preview = validateLeverImportRows(
      { leviers: [rows[0]], actions: null, impacts: null },
      ctx([existing]),
      "c1",
      programs
    );
    expect(preview.warnings).toEqual([]);
    const clamped = validateLeverImportRows(
      { leviers: [{ Code: "PROC-001", "Progression (%)": "150%" }], actions: null, impacts: null },
      ctx([existing]),
      "c1",
      programs
    );
    expect(clamped.warnings.map((w) => w.code)).toEqual(["valueClamped", "computedFromActions"]);
    expect(clamped.warnings[0].vars).toMatchObject({ value: 150, bound: 100 });
  });
});

describe("point 7 — cellule vide = valeur conservée, « - » = effacée", () => {
  const existing = lever({
    popImpacted: 120,
    dependencies: [{ targetId: "X", type: "FS" }],
    actions: [
      {
        id: "A1",
        name: "Cadrage",
        owner: "Léa",
        start: "2026-01-15",
        end: "2026-03-01",
        status: "todo",
      },
    ],
    impacts: [impact({ costCenter: "CC-9", technology: "SAP" })],
  });
  const run = (cell: string) =>
    validateLeverImportRows(
      {
        leviers: [
          {
            Code: "PROC-001",
            Owner: cell,
            Description: cell,
            "Population impactée": cell,
            "Dépendances (ID:type, séparées par ;)": cell,
          },
        ],
        actions: [{ "Code Levier": "PROC-001", "Nom de l'action": "Cadrage", Owner: cell }],
        impacts: [
          {
            "Code Levier": "PROC-001",
            Libellé: "Renégociation",
            Type: "Gain",
            "Montant (€M)": 1,
            "Centre de coût": cell,
            Technologie: cell,
          },
        ],
      },
      ctx([existing]),
      "c1",
      programs
    );

  it("vide : rien n'est effacé (levier, action, impact)", () => {
    const preview = run("");
    expect(preview.errors).toEqual([]);
    expect(preview.unchangedCount).toBe(1);
  });

  it("« - » : efface texte, population, dépendances, owner d'action et champs d'impact", () => {
    const preview = run("-");
    expect(preview.errors).toEqual([]);
    const l = preview.toUpsert[0];
    expect(l.owner).toBe("");
    expect(l.description).toBe("");
    expect(l.popImpacted).toBeUndefined();
    expect(l.dependencies).toEqual([]);
    expect(l.actions![0].owner).toBeUndefined();
    expect("owner" in l.actions![0]).toBe(false); // pas de clé `undefined` envoyée à Firestore
    expect(l.impacts![0].costCenter).toBeUndefined();
    expect(l.impacts![0].technology).toBeUndefined();
    expect(l.impacts![0].id).toBe("IMP-1");
  });

  it("la règle est documentée dans l'onglet « Aide » du modèle", () => {
    const help = leverImportHelpRows().map((r) => r.join(" "));
    expect(help.some((r) => /Cellule vide.*Conserve/.test(r))).toBe(true);
    expect(help.some((r) => /« - ».*Efface/.test(r))).toBe(true);
  });
});

describe("point 8 — colonne « Risque » de l'export en français", () => {
  it("écrit le libellé affiché (« Faible », « Critique »…) et non le code anglais", () => {
    const l = lever();
    expect(leverToExcelRow(l, asData([l]), [])["Risque"]).toBe("Faible");
    const critical = leverToExcelRow(l, asData([l]), [], [{ level: "critical", minAmount: -1 }]);
    expect(["Faible", "Moyen", "Élevé", "Critique"]).toContain(critical["Risque"]);
  });
});

describe("point 9 — cascade non arrondie en amont", () => {
  it("OPEX récurrent 0,55 M€ : 0,55 dans la cascade (affiché 550 k€), boucle brut − OPEX = net", () => {
    const l = lever({ status: "in_progress", grossSavings: 2, opexRec: 0.55, netSavings: 1.45 });
    const w = engine.savingsWaterfall(asData([l]));
    expect(w.opexRec).toBe(0.55);
    expect(w.target).toBe(1.45);
    expect(w.gross).toBe(2);
    expect(formatAmountM(w.opexRec).replace(/[  ]/g, " ")).toBe("550 k €");
  });
});

describe("point 10 — formatage défensif", () => {
  it("affiche « — » pour NaN, ±∞, undefined et null", () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null]) {
      expect(formatNumber(bad)).toBe("—");
      expect(formatCurrency(bad)).toBe("—");
      expect(formatCompactCurrency(bad)).toBe("—");
      expect(formatMillions(bad)).toBe("—");
      expect(formatAmount(bad)).toBe("—");
      expect(formatAmountM(bad)).toBe("—");
      expect(formatDecimal(bad)).toBe("—");
      expect(formatFte(bad, { unit: "ETP" })).toBe("—");
      expect(formatMeasure(bad, "%")).toBe("—");
      expect(formatPct(bad)).toBe("—");
      expect(engine.fmtPct(bad)).toBe("—");
      expect(engine.fmtCurr(bad)).toBe("—");
      expect(engine.fmtInt(bad)).toBe("—");
    }
    expect(engine.fmtPct(12 / 0)).toBe("—");
    expect(engine.fmtPct(41.6)).toBe("42%");
    expect(formatPct(12.5, 1).replace(/[  ]/g, " ")).toBe("12,5 %");
  });
});
