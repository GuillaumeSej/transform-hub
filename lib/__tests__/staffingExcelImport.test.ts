import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  STAFFING_IMPORT_HEADERS,
  STAFFING_IMPORT_ISSUES,
  STAFFING_IMPORT_SHEET_NAME,
  STAFFING_TEAMS_EMPTY_TEXT,
  STAFFING_TEAMS_RULE,
  STAFFING_TEAMS_SHEET_NAME,
  buildStaffingExportWorkbook,
  buildStaffingTeamsRows,
  buildStaffingTemplateRows,
  buildStaffingTemplateWorkbook,
  readStaffingImportSheet,
  staffingToExcelRows,
  validateStaffingImportRows,
} from "@/lib/staffingExcelImport";
import { readSpreadsheet } from "@/lib/excelFileRead";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";
import de from "@/lib/i18n/dictionaries/de";
import es from "@/lib/i18n/dictionaries/es";
import type { Chantier, ChantierAction, ChantierStaffing } from "@/types";

const companyId = "C1";
const programId = "P1";

// Round 13 : la colonne "Fonction" matche désormais une équipe RÉELLE de la base ETP entreprise
// (plus l'ancienne union fermée à 9 valeurs) — voir `validateStaffingImportRows`.
const knownDepartments = ["RH", "IT / SI"];
/** Effectif disponible par équipe (base ETP) — feuille "Équipes" et avertissement ETP > effectif. */
const fteByTeam: Record<string, number> = { RH: 14, "IT / SI": 3.456 };

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
      knownDepartments,
      fteByTeam
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

  it("ETP > 0 sans plafond fixe ; au-delà de l'effectif de l'équipe = avertissement, ligne importée", () => {
    const result = run([
      baseRow({ ETP: 0 }),
      baseRow({ ETP: "8", Fonction: "IT / SI" }),
      baseRow({ ETP: "abc", "Date fin": "2026-07-31" }),
      baseRow({ ETP: 8, "Date début": "2026-02-01" }),
      baseRow({ ETP: "", "Date début": "2026-03-01" }),
      baseRow({ ETP: 50, "Date début": "2026-04-01" }),
      baseRow({ ETP: -1, "Date début": "2026-05-01" }),
    ]);
    expect(result.errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [2, "fteNotPositive"],
      [4, "invalidFte"],
      [6, "missingFte"],
      [8, "fteNotPositive"],
    ]);
    expect(result.errors.map((e) => e.reason)).toEqual([
      '"ETP" doit être strictement positif (lu : 0)',
      '"ETP" doit être un nombre, ex. 0,5 (lu : "abc")',
      '"ETP" est obligatoire',
      '"ETP" doit être strictement positif (lu : -1)',
    ]);
    // 8 ETP pour IT / SI (3,46 ETP) et 50 ETP pour RH (14 ETP) : avertis mais importés ; 8 ETP
    // pour RH reste sous l'effectif de l'équipe.
    expect(result.warnings.map((w) => [w.rowNumber, w.code])).toEqual([
      [3, "fteAboveTeam"],
      [7, "fteAboveTeam"],
    ]);
    expect(result.warnings.map((w) => w.reason)).toEqual([
      "8 ETP sur cette ligne, au-delà de l'effectif de l'équipe IT / SI dans la base ETP (3,46 ETP) — vérifiez la saisie",
      "50 ETP sur cette ligne, au-delà de l'effectif de l'équipe RH dans la base ETP (14 ETP) — vérifiez la saisie",
    ]);
    expect(result.rows.map((r) => [r.rowNumber, r.entry.fte])).toEqual([
      [3, 8],
      [5, 8],
      [7, 50],
    ]);
  });

  it("effectif de l'équipe inconnu (0 ou base non chiffrée) : aucun avertissement", () => {
    const rows = [baseRow({ ETP: 50 })];
    const none = (byTeam?: Record<string, number>) =>
      validateStaffingImportRows(
        rows,
        companyId,
        programId,
        [baseChantier()],
        [baseAction()],
        [],
        knownDepartments,
        byTeam
      );
    for (const byTeam of [undefined, {}, { RH: 0 }] as (Record<string, number> | undefined)[]) {
      const r = none(byTeam);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
      expect(r.rows).toHaveLength(1);
    }
  });

  it("même règle que l'écran : dates obligatoires à la création, équipe de la base ETP", () => {
    const result = run([
      baseRow({ "Date fin": "" }),
      baseRow({ "Date début": "", Fonction: "IT / SI" }),
      baseRow({ Fonction: "" }),
      baseRow({ ETP: 7, Fonction: "Astrologie" }),
    ]);
    // Équipe inconnue de la base ETP = toujours une ERREUR (7 ETP, en revanche, n'en est plus une).
    expect(result.errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [2, "missingDate"],
      [3, "missingDate"],
      [4, "missingFunction"],
      [5, "unknownFunction"],
    ]);
    expect(result.errors[0].reason).toBe('"Date fin" est obligatoire (date JJ/MM/AAAA)');
    expect(result.rows).toEqual([]);
  });

  it("avertit (sans bloquer) quand les dates sortent de la période du levier", () => {
    const result = run([
      baseRow({ Levier: "Cartographier le processus actuel", "Date fin": "2026-06-30" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(["outsideProject"]);
    expect(result.rows).toHaveLength(1);
  });

  it("Note : cellule vide = note conservée, tiret = note effacée", () => {
    const existing: ChantierStaffing = {
      id: "ST-1",
      companyId,
      programId,
      chantierId: "CH1",
      function: "RH",
      fte: 1,
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      note: "Marie",
      createdAt: "2025-12-01",
    };
    const kept = run([baseRow({ Note: "", ETP: 2 })], [existing]);
    expect(kept.rows[0].entry.note).toBe("Marie");
    const cleared = run([baseRow({ Note: "-" })], [existing]);
    expect(cleared.rows).toHaveLength(1);
    expect(cleared.rows[0].isUpdate).toBe(true);
    expect(cleared.rows[0].entry).not.toHaveProperty("note");
  });

  it("ligne historique sans dates : mise à jour acceptée avec avertissement « dates à compléter »", () => {
    const legacy: ChantierStaffing = {
      id: "ST-legacy",
      companyId,
      programId,
      chantierId: "CH1",
      function: "RH",
      fte: 1,
      createdAt: "2025-12-01",
    };
    const result = run(
      [baseRow({ "Date début": "", "Date fin": "", ETP: 2, "ID ligne": "ST-legacy" })],
      [legacy]
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings.map((w) => w.code)).toEqual(["datesMissing"]);
    expect(result.rows[0]).toMatchObject({ isUpdate: true, entry: { id: "ST-legacy", fte: 2 } });
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
    // ST-2 est une ligne historique sans dates : signalée « à compléter », mais inchangée ; ST-1
    // déborde de la période de son levier (avertissement non bloquant, comme à l'écran).
    expect(result.warnings.map((w) => [w.rowNumber, w.code])).toEqual([
      [2, "datesMissing"],
      [3, "outsideProject"],
    ]);
    expect(result.rows).toEqual([]);
    expect(result.unchanged).toBe(2);
  });

  it("numéros de ligne Excel exacts malgré les lignes vides (__rowNum__)", () => {
    const row = baseRow({ Chantier: "Inconnu" });
    Object.defineProperty(row, "__rowNum__", { value: 6, enumerable: false });
    expect(run([row]).errors[0].rowNumber).toBe(7);
  });
});

describe(`Effectifs — vrai classeur .xlsx, rapprochement par ID ligne (fuseau ${process.env.TZ ?? "(système)"})`, () => {
  const chantiers = [baseChantier()];
  const actions = [baseAction()];
  const existing: ChantierStaffing[] = [
    {
      id: "ST-A",
      companyId,
      programId,
      chantierId: "CH1",
      function: "RH",
      fte: 1,
      startDate: "2026-01-01",
      endDate: "2026-03-31",
      note: "Marie",
      createdAt: "2025-12-01",
    },
    {
      id: "ST-B",
      companyId,
      programId,
      chantierId: "CH1",
      function: "IT / SI",
      fte: 0.5,
      startDate: "2026-03-01",
      endDate: "2026-12-31",
      createdAt: "2025-12-01",
    },
  ];

  const exportWorkbook = () =>
    buildStaffingExportWorkbook(XLSX, existing, chantiers, actions, knownDepartments, fteByTeam);

  /** Classeur → octets .xlsx → relecture comme l'appli (readSpreadsheet). */
  async function writeAndRead(wb: XLSX.WorkBook, name = "effectifs.xlsx") {
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    return readSpreadsheet(bytes, name);
  }

  /** Export réel → octets .xlsx → relecture et lecture de la feuille comme l'appli
   *  (`readStaffingImportSheet`, utilisé par `StaffingImportButton`). */
  async function exportAndRead(
    edit?: (ws: XLSX.WorkSheet) => void
  ): Promise<Record<string, unknown>[]> {
    const wb = exportWorkbook();
    if (edit) edit(wb.Sheets[STAFFING_IMPORT_SHEET_NAME]);
    return readStaffingImportSheet(XLSX, await writeAndRead(wb));
  }
  const run = (rows: Record<string, unknown>[], current = existing) =>
    validateStaffingImportRows(
      rows,
      companyId,
      programId,
      chantiers,
      actions,
      current,
      knownDepartments,
      fteByTeam
    );

  it("l'export écrit de vraies cellules date JJ/MM/AAAA et une colonne ID ligne", () => {
    const wb = exportWorkbook();
    const ws = wb.Sheets[STAFFING_IMPORT_SHEET_NAME];
    expect(ws["H1"].v).toBe("ID ligne");
    // Ligne 2 = "IT / SI" (tri par fonction) : date début 01/03/2026.
    expect(ws["D2"]).toMatchObject({ t: "n", v: 46082, z: "dd/mm/yyyy" });
    expect(ws["H2"].v).toBe("ST-B");
  });

  it("l'export et le modèle contiennent l'onglet Équipes (base ETP + effectif disponible)", async () => {
    const template = buildStaffingTemplateWorkbook(
      XLSX,
      chantiers,
      actions,
      knownDepartments,
      fteByTeam
    );
    for (const wb of [exportWorkbook(), template]) {
      const read = await writeAndRead(wb);
      // Feuille de données d'abord (repli « 1re feuille » d'un fichier renommé), Équipes ensuite.
      expect(read.SheetNames).toEqual([STAFFING_IMPORT_SHEET_NAME, STAFFING_TEAMS_SHEET_NAME]);
      expect(
        XLSX.utils.sheet_to_json<unknown[]>(read.Sheets[STAFFING_TEAMS_SHEET_NAME], { header: 1 })
      ).toEqual([
        ["Équipe", "Effectif disponible (ETP)"],
        ["IT / SI", 3.46],
        ["RH", 14],
      ]);
    }
    // Base ETP vide : une ligne explicative.
    expect(buildStaffingTeamsRows([], {})).toEqual([
      ["Équipe", "Effectif disponible (ETP)"],
      [STAFFING_TEAMS_EMPTY_TEXT],
    ]);
    expect(STAFFING_TEAMS_EMPTY_TEXT).toBe("Aucune équipe : importez d'abord la base ETP");
  });

  it("l'onglet Équipes est ignoré à l'import (même seul, même en 1re position)", async () => {
    const read = await writeAndRead(exportWorkbook());
    // Seule la feuille ETP est lue : les deux lignes exportées, aucune ligne d'équipe.
    expect(readStaffingImportSheet(XLSX, read).map((r) => r["ID ligne"])).toEqual(["ST-B", "ST-A"]);
    // Classeur réduit à l'onglet Équipes : rien à importer, aucune erreur, aucune donnée créée.
    const teamsOnly = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      teamsOnly,
      read.Sheets[STAFFING_TEAMS_SHEET_NAME],
      STAFFING_TEAMS_SHEET_NAME
    );
    const onlyTeams = run(readStaffingImportSheet(XLSX, teamsOnly));
    expect(onlyTeams).toEqual({ rows: [], unchanged: 0, errors: [], warnings: [] });
    // Feuille ETP renommée ("Feuil1") derrière l'onglet Équipes : le repli prend la feuille de
    // données, jamais l'onglet Équipes.
    const renamed = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      renamed,
      read.Sheets[STAFFING_TEAMS_SHEET_NAME],
      STAFFING_TEAMS_SHEET_NAME
    );
    XLSX.utils.book_append_sheet(renamed, read.Sheets[STAFFING_IMPORT_SHEET_NAME], "Feuil1");
    const viaFallback = run(readStaffingImportSheet(XLSX, renamed));
    expect(viaFallback.errors).toEqual([]);
    expect(viaFallback.rows).toEqual([]);
    expect(viaFallback.unchanged).toBe(2);
  });

  it("aller-retour .xlsx sans modification : 0 création, 0 mise à jour, aucune anomalie", async () => {
    const rows = await exportAndRead();
    expect(rows[0]["Date début"]).toBeInstanceOf(Date);
    const result = run(rows);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.unchanged).toBe(2);
  });

  it("export → date de fin modifiée → import = 1 mise à jour, 0 création (plus de doublon)", async () => {
    const rows = await exportAndRead((ws) => {
      // Ligne 3 = "RH" (ST-A) : fin 31/03/2026 → 30/06/2026, saisie comme dans Excel.
      ws["E3"] = { t: "n", v: 46203, z: "dd/mm/yyyy" };
    });
    const result = run(rows);
    expect(result.errors).toEqual([]);
    expect(result.rows.filter((r) => !r.isUpdate)).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].entry).toEqual({ ...existing[0], endDate: "2026-06-30" });
    expect(result.unchanged).toBe(1);
  });

  it("sans colonne ID ligne (ancien fichier) : rapprochement sans les dates si unique", () => {
    const rows = staffingToExcelRows(existing, chantiers, actions).map((r) => {
      const { ["ID ligne"]: _id, ...rest } = r;
      void _id;
      return rest.Fonction === "RH" ? { ...rest, "Date fin": "2026-06-30" } : rest;
    });
    const result = run(rows);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ isUpdate: true, entry: { id: "ST-A" } });

    // Deux lignes existantes candidates (même chantier + équipe) : pas de rapprochement deviné.
    const twin: ChantierStaffing = {
      ...existing[0],
      id: "ST-A2",
      startDate: "2026-07-01",
      endDate: "2026-09-30",
    };
    const ambiguous = run([rows.find((r) => r.Fonction === "RH")!], [existing[0], twin]);
    expect(ambiguous.rows).toHaveLength(1);
    expect(ambiguous.rows[0].isUpdate).toBe(false);
  });

  it("ID ligne copié sur deux lignes = erreur ; ID inconnu = avertissement et création", () => {
    const [it1] = staffingToExcelRows(existing, chantiers, actions);
    const dup = run([it1, { ...it1, "Date début": "2026-04-01" }]);
    expect(dup.errors.map((e) => [e.rowNumber, e.code])).toEqual([
      [2, "duplicateLineId"],
      [3, "duplicateLineId"],
    ]);
    expect(dup.rows).toEqual([]);

    // ID inconnu : avertissement, puis rapprochement « sans identifiant » (ici : clé sans dates
    // unique → mise à jour de ST-B)…
    const unknown = run([{ ...it1, "ID ligne": "ST-ailleurs", "Date début": "2026-04-01" }]);
    expect(unknown.warnings.map((w) => w.code)).toEqual(["unknownLineId"]);
    expect(unknown.rows).toHaveLength(1);
    expect(unknown.rows[0]).toMatchObject({ isUpdate: true, entry: { id: "ST-B" } });
    // …ou création (nouvel id, jamais celui du fichier) quand rien ne correspond.
    const created = run([
      {
        ...it1,
        "ID ligne": "ST-ailleurs",
        Levier: "Cartographier le processus actuel",
        "Date début": "2026-02-01",
        "Date fin": "2026-03-31",
      },
    ]);
    expect(created.rows).toHaveLength(1);
    expect(created.rows[0].isUpdate).toBe(false);
    expect(created.rows[0].entry.id).not.toBe("ST-ailleurs");
  });

  it("le modèle (exemples commentés, vraies dates) ne produit aucune ligne", async () => {
    const wb = buildStaffingTemplateWorkbook(XLSX, chantiers, actions, knownDepartments, fteByTeam);
    const read = await writeAndRead(wb, "modele.xlsx");
    const rows = readStaffingImportSheet(XLSX, read);
    // Règles rappelées en tête du modèle : plus de plafond « au plus 5 », onglet Équipes.
    const comments = rows.map((r) => String(r.Chantier)).filter((c) => c.startsWith("#"));
    expect(comments).toContain(`# ${STAFFING_TEAMS_RULE}`);
    expect(comments.join(" ")).not.toMatch(/au plus/);
    expect(STAFFING_TEAMS_RULE).toBe(
      "La colonne Fonction doit reprendre exactement un nom de l'onglet Équipes ; une équipe se crée uniquement dans la base ETP."
    );
    const result = run(rows);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual([]);
    // Retirer le "#" d'un exemple suffit à l'importer.
    const example = rows.find((r) => String(r.Chantier).startsWith("# Refonte"))!;
    const activated = run([{ ...example, Chantier: "Refonte du parcours achats" }], []);
    expect(activated.errors).toEqual([]);
    expect(activated.rows[0].entry).toMatchObject({
      startDate: "2026-01-01",
      endDate: "2026-06-30",
    });
  });
});

describe("STAFFING_IMPORT_ISSUES ↔ dictionnaire français", () => {
  it("chaque modèle est présent à l'identique dans fr.ts", () => {
    for (const [code, template] of Object.entries(STAFFING_IMPORT_ISSUES)) {
      expect(fr[`staffingImport.issue.${code}`], code).toBe(template);
      for (const dict of [en, de, es])
        expect(dict[`staffingImport.issue.${code}`], code).toBeTruthy();
    }
  });
});
