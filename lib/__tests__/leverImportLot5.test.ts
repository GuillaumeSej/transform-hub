import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  ACTION_IMPORT_HEADERS,
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
import type { BeTrackData, ImpactNatureDef, Lever, LeverImpact } from "@/types";

/**
 * Import leviers — lot 5 : (a) un « Réalisé » refusé par la finance (impact repassé « Planifié »
 * avec la trace du refus) ré-importé tel quel ne change rien ; (b) natures d'impact
 * personnalisées de l'entreprise reconnues à l'import et exportées par libellé.
 * Allers-retours .xlsx réels (mêmes appels que `ExportButton`, relecture comme l'appli).
 */

type Ctx = Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">;
const workstreams: Ctx["workstreams"] = [
  { id: "WS-PROC", name: "Achats & Supply Chain", sponsor: "IR", color: "#000", target: 0 },
];
const pnlAccounts: Ctx["pnlAccounts"] = [
  { id: "GA", name: "General & Admin", baseline: -72, sign: -1 },
];
const programs = [{ id: "p1", name: "Programme 1" }];

const customNatures: ImpactNatureDef[] = [
  { id: "nat-acme-freight", label: "Fret maritime", appliesTo: "both" },
  { id: "nat-acme-royalties", label: "Redevances", appliesTo: "cost" },
];

function lever(impacts: LeverImpact[]): Lever {
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
    actions: [],
    impacts,
  };
}

const rejectedImpact: LeverImpact = {
  id: "IMP-1",
  label: "Renégociation",
  type: "saving",
  nature: "opex_rec",
  amount: 1,
  gainDate: "2026-07-01",
  // Refus finance (`decideRealizedPatch`, lib/impactStatus.ts) : statut repassé « Planifié »,
  // validation conservée avec le statut « rejected » (trace du refus).
  status: "planned",
  realizedApproval: {
    status: "rejected",
    requestedBy: "Marc Dubois",
    requestedAt: "2026-05-01T08:00:00.000Z",
    decidedBy: "Fanny Finance",
    decidedAt: "2026-05-02T09:00:00.000Z",
  },
};

const ctx = (levers: Lever[]): Ctx => ({ levers, workstreams, pnlAccounts });

function exportThenRead(levers: Lever[], natures?: ImpactNatureDef[]): LeverImportRawSheets {
  const data = { ...ctx(levers), program: {}, alerts: [] } as unknown as BeTrackData;
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
      levers.flatMap((l) => leverImpactsToExcelRows(l, natures)),
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

const importer = { name: "Paul Import", username: "pimport", profiles: [] };

describe("lot 5 — leviers : refus finance d'un « Réalisé » conservé au ré-import", () => {
  it("export → ré-import sans modification : 0 mise à jour, trace du refus intacte", () => {
    const levers = [lever([rejectedImpact])];
    const preview = validateLeverImportRows(
      exportThenRead(levers),
      ctx(levers),
      "c1",
      programs,
      undefined,
      undefined,
      { importer }
    );
    expect(preview.errors).toEqual([]);
    expect(preview.updateCount).toBe(0);
    expect(preview.unchangedCount).toBe(1);
    expect(preview.toUpsert).toEqual([]);
  });

  it("statut changé (Planifié → Réalisé) : nouvelle demande de validation en attente", () => {
    const levers = [lever([rejectedImpact])];
    const sheets = exportThenRead(levers);
    sheets.impacts = sheets.impacts!.map((r) => ({ ...r, "Statut impact": "Réalisé" }));
    const preview = validateLeverImportRows(
      sheets,
      ctx(levers),
      "c1",
      programs,
      undefined,
      undefined,
      { importer }
    );
    expect(preview.errors).toEqual([]);
    const [imp] = preview.toUpsert[0].impacts ?? [];
    expect(imp.id).toBe("IMP-1");
    // « Réalisé » d'un gain récurrent : ramené à « En cours » par `coerceImpactStatus`.
    expect(["done", "ongoing"]).toContain(imp.status);
    expect(imp.realizedApproval).toMatchObject({ status: "pending", requestedBy: "Paul Import" });
  });

  it("statut changé (Réalisé → Planifié) : validation retirée", () => {
    const done: LeverImpact = {
      ...rejectedImpact,
      status: "done",
      realizedApproval: { status: "approved", requestedBy: "Marc Dubois" },
    };
    const levers = [lever([done])];
    const sheets = exportThenRead(levers);
    sheets.impacts = sheets.impacts!.map((r) => ({ ...r, "Statut impact": "Planifié" }));
    const preview = validateLeverImportRows(
      sheets,
      ctx(levers),
      "c1",
      programs,
      undefined,
      undefined,
      { importer }
    );
    const [imp] = preview.toUpsert[0].impacts ?? [];
    expect(imp.status).toBe("planned");
    expect(imp).not.toHaveProperty("realizedApproval");
  });
});

describe("lot 5 — leviers : natures d'impact personnalisées de l'entreprise", () => {
  const withNature = (natureId: string) => [lever([{ ...rejectedImpact, natureId }])];

  it("export par libellé de la nature de l'entreprise ; ré-import = 0 changement, aucun avertissement", () => {
    const levers = withNature("nat-acme-freight");
    const sheets = exportThenRead(levers, customNatures);
    expect(sheets.impacts![0]["Nature de l'impact"]).toBe("Fret maritime");
    const preview = validateLeverImportRows(
      sheets,
      ctx(levers),
      "c1",
      programs,
      undefined,
      undefined,
      { importer, impactNatures: customNatures }
    );
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toEqual([]);
    expect(preview.unchangedCount).toBe(1);
  });

  it("nature personnalisée saisie par libellé (ou id) → reconnue (avant : « inconnue », natures par défaut)", () => {
    const levers = withNature("nat-acme-freight");
    const sheets = exportThenRead(levers, customNatures);
    sheets.impacts = sheets.impacts!.map((r) => ({ ...r, "Nature de l'impact": "redevances" }));
    const preview = validateLeverImportRows(
      sheets,
      ctx(levers),
      "c1",
      programs,
      undefined,
      undefined,
      { importer, impactNatures: customNatures }
    );
    expect(preview.warnings).toEqual([]);
    expect(preview.toUpsert[0].impacts?.[0].natureId).toBe("nat-acme-royalties");

    // Sans la configuration de l'entreprise (comportement d'avant) : avertissement « inconnue ».
    const legacy = validateLeverImportRows(sheets, ctx(levers), "c1", programs);
    expect(legacy.warnings.map((w) => w.code)).toContain("unknownImpactNature");
  });

  it("entreprise sans natures personnalisées : natures par défaut, exportées par libellé", () => {
    const levers = withNature("nat-energy");
    const sheets = exportThenRead(levers);
    expect(sheets.impacts![0]["Nature de l'impact"]).toBe("Énergie");
    const preview = validateLeverImportRows(sheets, ctx(levers), "c1", programs);
    expect(preview.warnings).toEqual([]);
    expect(preview.unchangedCount).toBe(1);
  });
});
