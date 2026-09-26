import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  IMPACT_IMPORT_HEADERS,
  LEVER_IMPORT_HEADERS,
  validateLeverImportRows,
} from "@/lib/leverExcelImport";
import { leverImpactsToExcelRows, leverToExcelRow } from "@/lib/leverExcel";
import { XLSX_READ_OPTIONS } from "@/lib/excelParse";
import { bulkUpsertLeversByCode, upsertLeverByCode } from "@/lib/leversLogic";
import type { AuthUser, BeTrackData, Lever, LeverImpact } from "@/types";

/** Régressions de l'audit import/export Excel des leviers (24/09/2026) : B1, B2, M1, M2, M3, M5,
 *  M6, M8, M9, M10, M12, M13 et en-têtes/valeurs insensibles à la casse et aux accents. */

type Ctx = Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">;

const workstreams: Ctx["workstreams"] = [
  { id: "WS-PROC", name: "Achats & Supply Chain", sponsor: "IR", color: "#000", target: 0 },
];
const pnlAccounts: Ctx["pnlAccounts"] = [
  { id: "GA", name: "General & Admin", baseline: -72, sign: -1 },
];
const programs = [
  { id: "p1", name: "Programme 1" },
  { id: "p2", name: "Programme 2" },
];

function lever(overrides: Partial<Lever> = {}): Lever {
  return {
    id: "c1-L001",
    programId: "p2",
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
    risk: "medium",
    grossSavings: 2.5,
    netSavings: 2.1,
    opexOneOff: 0.4,
    opexRec: 0.1,
    capex: 0.3,
    fteImpact: -1,
    popImpacted: "",
    companyId: "c1",
    dependencies: [],
    description: "Description d'origine",
    createdAt: "2025-01-01",
    lastUpdate: "2025-01-01",
    actions: [],
    ...overrides,
  };
}

const ctx = (levers: Lever[] = []): Ctx => ({ levers, workstreams, pnlAccounts });

function impact(overrides: Partial<LeverImpact> = {}): LeverImpact {
  return {
    id: "IMP-1",
    label: "Renégociation",
    type: "saving",
    nature: "oneoff",
    amount: 1,
    gainDate: "2026-07-01",
    ...overrides,
  };
}

/** Aller-retour réel par un classeur .xlsx (écriture puis lecture avec XLSX_READ_OPTIONS). */
function roundTripSheets(
  sheets: Record<string, unknown[][]>
): Record<string, Record<string, unknown>[]> {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), name);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const read = XLSX.read(buf, XLSX_READ_OPTIONS);
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const name of read.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json(read.Sheets[name], { defval: "" });
  }
  return out;
}

const excelSerial = (y: number, m: number, d: number) =>
  (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;

describe("B1 — fichier à colonnes partielles", () => {
  it("n'applique que les colonnes présentes sur un levier existant", () => {
    const existing = lever();
    const preview = validateLeverImportRows(
      {
        leviers: [{ Code: "PROC-001", "Nom du levier": "Nouveau nom" }],
        actions: null,
        impacts: null,
      },
      ctx([existing]),
      "c1",
      programs,
      undefined,
      "p1"
    );
    expect(preview.errors).toEqual([]);
    expect(preview.updateCount).toBe(1);
    const row = preview.toUpsert[0];
    expect(row.name).toBe("Nouveau nom");
    expect(row.owner).toBe("Marc Dubois");
    expect(row.grossSavings).toBe(2.5);
    expect(row.description).toBe("Description d'origine");
    expect(row.start).toBe("2026-01-15");
    expect(row.ws).toBe("WS-PROC");

    // Écriture : seul le nom change.
    const result = bulkUpsertLeversByCode([existing], preview.toUpsert, "tester");
    const written = result.changedLevers[0];
    expect(written.name).toBe("Nouveau nom");
    expect(written.owner).toBe("Marc Dubois");
    expect(written.capex).toBe(0.3);
    expect(result.auditEntries.map((a) => a.field)).toEqual(["name"]);
  });

  it("refuse une création quand une colonne obligatoire est absente, et une feuille sans colonne Code", () => {
    const newLever = validateLeverImportRows(
      { leviers: [{ Code: "NEW-1", "Nom du levier": "X" }], actions: null, impacts: null },
      ctx(),
      "c1",
      programs,
      undefined,
      "p1"
    );
    expect(newLever.toUpsert).toEqual([]);
    expect(newLever.errors[0].code).toBe("missingColumnsForNew");

    const noCode = validateLeverImportRows(
      { leviers: [{ "Nom du levier": "X" }], actions: null, impacts: null },
      ctx(),
      "c1",
      programs
    );
    expect(noCode.errors[0]).toMatchObject({ code: "missingColumns", rowNumber: 1 });
  });

  it("avertit sur les colonnes inconnues et accepte des en-têtes sans casse ni accents", () => {
    const preview = validateLeverImportRows(
      {
        leviers: [{ CODE: "PROC-001", "nom du levier": "Renommé", Bidule: "x" }],
        actions: null,
        impacts: null,
      },
      ctx([lever()]),
      "c1",
      programs
    );
    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert[0].name).toBe("Renommé");
    expect(preview.warnings).toHaveLength(1);
    expect(preview.warnings[0]).toMatchObject({
      code: "unknownColumns",
      vars: { columns: "Bidule" },
    });
  });
});

describe("B2 — dates Excel (numéros de série, objets Date)", () => {
  it("lit les dates de toutes les feuilles depuis un vrai classeur", () => {
    const leverHeaders = [
      "Code",
      "Nom du levier",
      "Chantier",
      "Statut",
      "Compte P&L impacté",
      "Date de départ",
      "Date de fin estimée",
    ];
    const read = roundTripSheets({
      Leviers: [
        leverHeaders,
        [
          "NEW-1",
          "Levier",
          "Achats & Supply Chain",
          "Identifié",
          "GA",
          new Date(2026, 0, 15),
          excelSerial(2026, 12, 31),
        ],
      ],
      Actions: [
        ["Code Levier", "Nom de l'action", "Date début", "Date fin", "Statut"],
        ["NEW-1", "Action 1", excelSerial(2026, 2, 1), "15/03/2026", "a faire"],
      ],
      Impacts: [
        ["Code Levier", "Type", "Montant (€M)", "Date gain", "Date CAPEX"],
        ["NEW-1", "gain", 1.2, excelSerial(2026, 7, 1), ""],
        ["NEW-1", "Coût", 0.5, "", excelSerial(2026, 3, 15)],
      ],
    });
    const preview = validateLeverImportRows(
      { leviers: read.Leviers, actions: read.Actions, impacts: read.Impacts },
      ctx(),
      "c1",
      programs,
      undefined,
      "p1"
    );
    // La ligne "Coût" sans Nature doit être rejetée, le reste passe.
    expect(preview.errors.map((e) => e.code)).toEqual(["required"]);
    const row = preview.toUpsert[0];
    expect(row.start).toBe("2026-01-15");
    expect(row.end).toBe("2026-12-31");
    expect(row.actions?.[0]).toMatchObject({
      start: "2026-02-01",
      end: "2026-03-15",
      status: "todo",
    });
    expect(row.impacts?.[0].gainDate).toBe("2026-07-01");
  });

  it("rejette une date impossible au lieu de la décaler (M4)", () => {
    const preview = validateLeverImportRows(
      {
        leviers: [{ Code: "PROC-001", "Date de départ": "31/02/2026" }],
        actions: null,
        impacts: null,
      },
      ctx([lever()]),
      "c1",
      programs
    );
    expect(preview.toUpsert).toEqual([]);
    expect(preview.errors[0].code).toBe("invalidDate");
  });
});

describe("M3 — nombres au format français", () => {
  it("lit « 1,5 » et rejette une valeur illisible", () => {
    const ok = validateLeverImportRows(
      { leviers: [{ Code: "PROC-001", "CAPEX (€M)": "1,5" }], actions: null, impacts: null },
      ctx([lever()]),
      "c1",
      programs
    );
    expect(ok.toUpsert[0].capex).toBe(1.5);
    const ko = validateLeverImportRows(
      { leviers: [{ Code: "PROC-001", "CAPEX (€M)": "beaucoup" }], actions: null, impacts: null },
      ctx([lever()]),
      "c1",
      programs
    );
    expect(ko.toUpsert).toEqual([]);
    expect(ko.errors[0].code).toBe("invalidNumber");
  });
});

describe("M1 — Code rapproché sans tenir compte de la casse à l'écriture", () => {
  it("met à jour le levier existant au lieu d'en créer un doublon", () => {
    const existing = lever();
    const { id: _i, createdAt: _c, lastUpdate: _u, ...rest } = lever({ name: "Renommé" });
    void _i;
    void _c;
    void _u;
    const result = upsertLeverByCode([existing], { ...rest, code: "  proc-001 " }, "u");
    expect(result.created).toBe(false);
    expect(result.levers).toHaveLength(1);
    expect(result.lever.name).toBe("Renommé");
    expect(result.lever.code).toBe("PROC-001");
  });
});

describe("M2 — ré-import sans changement", () => {
  const withReforecast = () =>
    lever({
      status: "in_progress",
      lockedPlan: { grossSavings: 2.5, netSavings: 2.1, opexOneOff: 0.4, opexRec: 0.1, capex: 0.3 },
      reforecast: { grossSavings: 9, netSavings: 9, opexOneOff: 0, opexRec: 0, capex: 0 },
      actions: [
        { id: "A1", name: "Action 1", start: "2026-01-15", end: "2026-03-01", status: "todo" },
      ],
      impacts: [impact()],
    });

  it("l'aperçu marque le levier inchangé et l'écriture ne fait rien", () => {
    const existing = withReforecast();
    const exported = leverToExcelRow(
      existing,
      { ...ctx([existing]), program: {} } as unknown as BeTrackData,
      [],
      undefined,
      undefined,
      programs
    );
    const preview = validateLeverImportRows(
      {
        leviers: [exported],
        actions: [
          {
            "Code Levier": "PROC-001",
            "Nom de l'action": "Action 1",
            "Date début": "2026-01-15",
            "Date fin": "2026-03-01",
            Statut: "À faire",
          },
        ],
        impacts: leverImpactsToExcelRows(existing),
      },
      ctx([existing]),
      "c1",
      programs
    );
    expect(preview.errors).toEqual([]);
    expect(preview.updateCount).toBe(0);
    expect(preview.unchangedCount).toBe(1);
    expect(preview.toUpsert).toEqual([]);

    const { id: _i, createdAt: _c, lastUpdate: _u, ...input } = existing;
    void _i;
    void _c;
    void _u;
    const result = bulkUpsertLeversByCode([existing], [input], "u");
    expect(result.unchangedCount).toBe(1);
    expect(result.changedLevers).toEqual([]);
    expect(result.auditEntries).toEqual([]);
  });

  it("ne réaligne pas la réactualisation quand seules les actions changent", () => {
    const existing = withReforecast();
    const { id: _i, createdAt: _c, lastUpdate: _u, ...input } = existing;
    void _i;
    void _c;
    void _u;
    const result = bulkUpsertLeversByCode(
      [existing],
      [{ ...input, actions: [{ ...existing.actions![0], name: "Action renommée" }] }],
      "u"
    );
    expect(result.updatedCount).toBe(1);
    expect(result.changedLevers[0].reforecast).toEqual(existing.reforecast);
  });
});

describe("M5/M6 — rapprochement des impacts et validation finance", () => {
  const approved = impact({
    status: "done",
    realizedApproval: { status: "approved", decidedBy: "Finance" },
    comments: [{ user: "Alice", ts: "2026-01-01", text: "Hypothèse validée" }],
  });
  const other = impact({
    id: "IMP-2",
    label: "Licence",
    type: "cost",
    nature: "opex_rec",
    amount: 0.2,
  });

  it("conserve id, commentaires et approbation ; signale les impacts supprimés", () => {
    const existing = lever({ impacts: [approved, other] });
    const preview = validateLeverImportRows(
      {
        leviers: [],
        actions: null,
        impacts: [
          {
            "Code Levier": "proc-001",
            Libellé: "Renégociation",
            Type: "Gain",
            "Montant (€M)": 1.4,
            "Date gain": "01/07/2026",
            "Statut impact": "Réalisé",
          },
        ],
      },
      ctx([existing]),
      "c1",
      programs
    );
    expect(preview.errors).toEqual([]);
    // M8 : levier absent de la feuille Leviers mais cité dans Impacts → mis à jour.
    expect(preview.updateCount).toBe(1);
    const imps = preview.toUpsert[0].impacts!;
    expect(imps).toHaveLength(1);
    expect(imps[0]).toMatchObject({
      id: "IMP-1",
      amount: 1.4,
      realizedApproval: { status: "approved" },
      comments: approved.comments,
    });
    expect(preview.impactsRemoved).toEqual([{ code: "PROC-001", labels: ["Licence"] }]);
  });

  it("un nouvel impact importé « Réalisé » attend TOUJOURS la validation finance (même importateur finance/admin)", () => {
    const rows = {
      leviers: [],
      actions: null,
      impacts: [
        {
          "Code Levier": "PROC-001",
          Type: "Gain",
          "Montant (€M)": 1,
          "Date gain": "2026-01-01",
          "Statut impact": "réalisé",
        },
      ],
    };
    const lambda = { name: "Léa", profiles: [{ role: "lever" }] } as unknown as AuthUser;
    const finance = { name: "Fanny", profiles: [{ role: "finance" }] } as unknown as AuthUser;
    const pending = validateLeverImportRows(rows, ctx([lever()]), "c1", programs, undefined, null, {
      importer: lambda,
    });
    expect(pending.toUpsert[0].impacts![0].realizedApproval).toMatchObject({
      status: "pending",
      requestedBy: "Léa",
    });
    for (const importer of [
      finance,
      { name: "Adam", username: "adam", profiles: [], isCompanyAdmin: true } as unknown as AuthUser,
    ]) {
      const res = validateLeverImportRows(rows, ctx([lever()]), "c1", programs, undefined, null, {
        importer,
      });
      // Demandeur = importateur : il ne pourra pas décider lui-même (lib/impactStatus.ts).
      expect(res.toUpsert[0].impacts![0].realizedApproval).toMatchObject({
        status: "pending",
        requestedBy: importer.name,
      });
    }
  });
});

describe("M8/M9 — feuille Actions", () => {
  it("applique les actions d'un levier existant absent de la feuille Leviers et refuse les doublons", () => {
    const preview = validateLeverImportRows(
      {
        leviers: [],
        actions: [
          {
            "Code Levier": "PROC-001",
            "Nom de l'action": "Action A",
            "Date début": "2026-01-01",
            "Date fin": "2026-02-01",
            Statut: "Terminée",
          },
          {
            "Code Levier": "PROC-001",
            "Nom de l'action": "action a",
            "Date début": "2026-01-01",
            "Date fin": "2026-02-01",
            Statut: "À faire",
          },
        ],
        impacts: null,
      },
      ctx([lever()]),
      "c1",
      programs
    );
    expect(preview.errors.map((e) => e.code)).toEqual(["duplicateAction"]);
    expect(preview.toUpsert[0].actions).toHaveLength(1);
    expect(preview.toUpsert[0].actions![0].status).toBe("done");
  });
});

describe("M10/M12 — programme et entreprise d'un levier existant", () => {
  it("garde le programme actuel quand la colonne Programme est vide, et ne touche jamais companyId", () => {
    const existing = lever({ programId: "p2" });
    const preview = validateLeverImportRows(
      {
        leviers: [{ Code: "PROC-001", Programme: "", Description: "Nouvelle" }],
        actions: null,
        impacts: null,
      },
      ctx([existing]),
      null,
      programs,
      undefined,
      "p1"
    );
    expect(preview.errors).toEqual([]);
    expect(preview.toUpsert[0].programId).toBe("p2");
    expect(preview.toUpsert[0].companyId).toBe("c1");

    const written = upsertLeverByCode([existing], { ...preview.toUpsert[0], companyId: null }, "u");
    expect(written.lever.companyId).toBe("c1");
  });
});

describe("M13 — chantiers auto-créés", () => {
  const base = {
    "Nom du levier": "Levier",
    Statut: "identifie",
    "Compte P&L impacté": "general & admin",
    "Date de départ": "2026-01-01",
    "Date de fin estimée": "2026-06-30",
  };

  it("rapproche un chantier existant sans casse ni accents", () => {
    const preview = validateLeverImportRows(
      {
        leviers: [{ Code: "N-1", Chantier: "ACHATS & SUPPLY CHAIN", ...base }],
        actions: null,
        impacts: null,
      },
      ctx(),
      "c1",
      programs,
      undefined,
      "p1"
    );
    expect(preview.errors).toEqual([]);
    expect(preview.toCreateWorkstreams).toEqual([]);
    expect(preview.toUpsert[0].ws).toBe("WS-PROC");
  });

  it("n'attribue jamais l'id d'un chantier existant à un chantier créé", () => {
    const preview = validateLeverImportRows(
      { leviers: [{ Code: "N-1", Chantier: "Proc", ...base }], actions: null, impacts: null },
      ctx(),
      "c1",
      programs,
      undefined,
      "p1"
    );
    expect(preview.errors).toEqual([]);
    expect(preview.toCreateWorkstreams).toHaveLength(1);
    expect(preview.toCreateWorkstreams[0].id).toBe("WS-PROC-2");
    expect(preview.toUpsert[0].ws).toBe("WS-PROC-2");
  });
});

describe("Divers — statuts et dépendances", () => {
  it("accepte l'ancien libellé « M3 · Validé » (résolu par son niveau) et refuse un type de dépendance inconnu", () => {
    const status = validateLeverImportRows(
      { leviers: [{ Code: "PROC-001", Statut: "M3 · Validé" }], actions: null, impacts: null },
      ctx([lever({ status: "validated" })]),
      "c1",
      programs
    );
    expect(status.errors).toEqual([]);

    const dep = validateLeverImportRows(
      {
        leviers: [{ Code: "PROC-001", "Dépendances (ID:type, séparées par ;)": "L002:XX" }],
        actions: null,
        impacts: null,
      },
      ctx([lever()]),
      "c1",
      programs
    );
    expect(dep.errors[0].code).toBe("invalidDependency");
  });

  it("les en-têtes d'export des impacts correspondent à ceux de l'import", () => {
    const rows = leverImpactsToExcelRows(lever({ impacts: [impact()] }));
    expect(Object.keys(rows[0]).sort()).toEqual([...IMPACT_IMPORT_HEADERS].sort());
    expect(LEVER_IMPORT_HEADERS).toContain("Chantier");
  });
});
