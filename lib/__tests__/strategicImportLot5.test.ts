import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readXlsxWorkbook } from "@/lib/excelParse";
import {
  STRATEGIC_IMPORT_GUIDE_ROWS,
  STRATEGIC_IMPORT_MESSAGES,
  buildStrategicPlanExportWorkbook,
  parseStrategicImportWorkbook,
  validateStrategicImportRows,
  type StrategicImportExistingData,
} from "@/lib/strategicExcelImport";
import fr from "@/lib/i18n/dictionaries/fr";
import en from "@/lib/i18n/dictionaries/en";
import de from "@/lib/i18n/dictionaries/de";
import es from "@/lib/i18n/dictionaries/es";
import type {
  Chantier,
  ChantierAction,
  ChantierStaffing,
  MaturityStageConfig,
  StrategicAxis,
} from "@/types";

/**
 * Import du plan stratégique — lot 5 : règle vide/tiret sur TOUTES les colonnes facultatives,
 * « Code Projet » de la feuille ETP, copie d'une ligne ETP existante, dépendances vers un chantier
 * non visible. Allers-retours .xlsx réels : export → modification de cellules → relecture comme
 * l'appli (`readXlsxWorkbook`) → import. À lancer aussi en Europe/Paris.
 */

const companyId = "C1";
const programId = "P1";
const stages: MaturityStageConfig[] = [
  { id: "defined", order: 1, label: "Défini", programId, companyId },
  { id: "validated", order: 2, label: "Validé", programId, companyId },
];
const NOW = new Date(2026, 0, 15);
const knownDepartments = ["Data & Analytics", "Ressources Humaines"];
const fteByTeam: Record<string, number> = { "Data & Analytics": 14, "Ressources Humaines": 2.5 };
const teams = { knownDepartments, fteByTeam };
const users = [{ username: "jdupont", name: "Jean Dupont" }];

const axis = {
  id: "AX-1",
  companyId,
  programId,
  name: "Axe 1",
  description: "Axe décrit",
  owner: "jdupont",
  color: "#123456",
  stage: "defined",
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  importCode: "AX1",
} as StrategicAxis;
const chantier = {
  id: "CH-1",
  companyId,
  programId,
  axisIds: ["AX-1"],
  name: "Chantier 1",
  description: "Chantier décrit",
  pilote: "jdupont",
  allocatedBudget: 100,
  consumedFte: 2,
  stage: "defined",
  dependencies: [],
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  importCode: "CH1",
} as Chantier;
const action = {
  id: "CA-1",
  companyId,
  chantierId: "CH-1",
  name: "Projet 1",
  description: "Projet décrit",
  owner: "jdupont",
  contributors: ["jdupont"],
  budget: 50,
  chantierWeightPct: 40,
  start: "2026-01-01",
  end: "2026-06-30",
  status: "defined",
  deliverables: [
    { id: "DL-1", label: "Livrable 1", phases: [], status: "todo", dueDate: "2026-03-31" },
  ],
  importCode: "P1",
} as ChantierAction;
const lineA: ChantierStaffing = {
  id: "ST-A",
  companyId,
  programId,
  chantierId: "CH-1",
  function: "Data & Analytics",
  fte: 2,
  note: "Squad data",
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  createdAt: "2025-12-01",
};
const lineP: ChantierStaffing = {
  ...lineA,
  id: "ST-P",
  actionId: "CA-1",
  note: undefined,
  startDate: "2026-02-01",
  endDate: "2026-05-31",
};

const data = (): StrategicImportExistingData => ({
  axes: [{ ...axis }],
  chantiers: [{ ...chantier }],
  actions: [{ ...action }],
  indicators: [],
  measurements: [],
  staffing: [{ ...lineA }, { ...lineP }],
});

/** Écrit le classeur en .xlsx puis le relit comme l'appli. */
function roundTrip(wb: XLSX.WorkBook): XLSX.WorkBook {
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return readXlsxWorkbook(XLSX, bytes);
}

/** Modifie les lignes d'une feuille d'un classeur exporté (en-têtes conservés). */
function editSheet(
  wb: XLSX.WorkBook,
  name: string,
  edit: (rows: Record<string, unknown>[]) => Record<string, unknown>[]
): XLSX.WorkBook {
  const ws = wb.Sheets[name];
  const header = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] ?? []) as string[];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  wb.Sheets[name] = XLSX.utils.json_to_sheet(edit(rows), { header });
  return wb;
}

const exportPlan = (d = data()) => buildStrategicPlanExportWorkbook(d, stages, XLSX, teams);
const reimport = (wb: XLSX.WorkBook, d = data()) =>
  validateStrategicImportRows(
    parseStrategicImportWorkbook(roundTrip(wb), XLSX),
    d,
    companyId,
    programId,
    stages,
    "admin",
    { now: NOW, knownDepartments, teamAvailableFte: fteByTeam, users }
  );
type Result = ReturnType<typeof reimport>;
const totalWrites = (r: Result) =>
  Object.values(r.toCreate).flat().length + Object.values(r.toUpdate).flat().length;
const dash =
  (cols: string[]) =>
  (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
    rows.map((r) => ({ ...r, ...Object.fromEntries(cols.map((c) => [c, "-"])) }));

describe(`lot 5 — plan stratégique, vide = conservé / « - » = effacé (fuseau ${process.env.TZ ?? "(système)"})`, () => {
  it("aller-retour sans modification : 0 changement, aucune anomalie", () => {
    const r = reimport(exportPlan());
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(totalWrites(r)).toBe(0);
  });

  it("le tiret efface Description, Couleur, sponsors, budgets, poids, contributeurs, échéance — sans avertissement « compte »", () => {
    let wb = exportPlan();
    wb = editSheet(wb, "Axes", dash(["Description", "Sponsor d'axe", "Couleur"]));
    wb = editSheet(
      wb,
      "Chantiers",
      dash(["Description", "Sponsor de chantier", "Budget alloué", "ETP consommés"])
    );
    wb = editSheet(
      wb,
      "Projets",
      dash([
        "Description",
        "Responsable projet",
        "Budget",
        "Poids dans le chantier (%)",
        "Contributeurs (séparés par ;)",
      ])
    );
    wb = editSheet(wb, "Livrables", dash(["Échéance"]));
    const r = reimport(wb);
    expect(r.errors).toEqual([]);
    // Avant : « « - » ne correspond à aucun compte » et « - » enregistré tel quel.
    expect(r.warnings).toEqual([]);
    expect(r.people).toEqual([]);
    const [a] = r.toUpdate.axes;
    for (const k of ["description", "owner", "color"]) expect(a).not.toHaveProperty(k);
    expect(a).toMatchObject({ id: "AX-1", name: "Axe 1", stage: "defined" });
    const [c] = r.toUpdate.chantiers;
    for (const k of ["description", "pilote", "allocatedBudget", "consumedFte"])
      expect(c).not.toHaveProperty(k);
    expect(c).toMatchObject({ id: "CH-1", name: "Chantier 1" });
    const [p] = r.toUpdate.actions;
    for (const k of ["description", "owner", "budget", "chantierWeightPct", "contributors"])
      expect(p).not.toHaveProperty(k);
    expect(p.deliverables?.[0]).not.toHaveProperty("dueDate");
    expect(p.deliverables?.[0]).toMatchObject({ id: "DL-1", label: "Livrable 1" });
    expect(Object.values(r.toCreate).flat()).toEqual([]);
  });

  it("une cellule vide conserve la valeur (aucune mise à jour)", () => {
    let wb = exportPlan();
    wb = editSheet(wb, "Axes", (rows) =>
      rows.map((r) => ({ ...r, Description: "", "Sponsor d'axe": "", Couleur: "" }))
    );
    wb = editSheet(wb, "Projets", (rows) =>
      rows.map((r) => ({ ...r, Description: "", Budget: "", "Contributeurs (séparés par ;)": "" }))
    );
    const r = reimport(wb);
    expect(r.errors).toEqual([]);
    expect(totalWrites(r)).toBe(0);
  });

  it("le tiret est refusé dans une colonne obligatoire ou l'étape de maturité", () => {
    let wb = exportPlan();
    wb = editSheet(wb, "Axes", (rows) => rows.map((r) => ({ ...r, Nom: "-" })));
    wb = editSheet(wb, "Chantiers", (rows) =>
      rows.map((r) => ({ ...r, "Étape de maturité": "-" }))
    );
    wb = editSheet(wb, "Projets", (rows) => rows.map((r) => ({ ...r, "Date fin": "-" })));
    const r = reimport(wb);
    expect(r.errors.map((e) => [e.sheet, e.code, e.vars?.column ?? e.vars?.code])).toEqual([
      ["Axes", "notClearable", "Nom"],
      ["Chantiers", "notClearable", "Étape de maturité"],
      ["Projets", "notClearable", "Date fin"],
      // Conséquence attendue : le livrable du projet en erreur n'a plus de projet.
      ["Livrables", "projectNotInFile", "P1"],
    ]);
  });

  it("le Lisez-moi documente le tiret et la règle bloquante", () => {
    const guide = STRATEGIC_IMPORT_GUIDE_ROWS.flat().join("\n");
    expect(guide).toContain("Effacer une valeur");
    expect(guide).toContain("l'import est impossible");
    expect(guide).not.toContain("n'invalide qu'elle-même");
  });

  it("nouveaux messages présents à l'identique en français et traduits", () => {
    for (const code of ["notClearable", "staffingDuplicateExisting"] as const) {
      const key = `strategicImport.msg.${code}`;
      expect(fr[key], code).toBe(STRATEGIC_IMPORT_MESSAGES[code]);
      for (const dict of [en, de, es]) expect(dict[key], code).toBeTruthy();
    }
  });
});

describe("lot 5 — feuille ETP du plan (vrais .xlsx)", () => {
  const onLine =
    (id: string, patch: Record<string, unknown>) => (rows: Record<string, unknown>[]) =>
      rows.map((r) => (r["ID ligne"] === id ? { ...r, ...patch } : r));

  it("« Code Projet » vide = rattachement conservé, « - » = retiré", () => {
    const keep = reimport(editSheet(exportPlan(), "ETP", onLine("ST-P", { "Code Projet": "" })));
    expect(keep.errors).toEqual([]);
    expect(totalWrites(keep)).toBe(0);

    const clear = reimport(editSheet(exportPlan(), "ETP", onLine("ST-P", { "Code Projet": "-" })));
    // Avant : « Projet "-" introuvable ».
    expect(clear.errors).toEqual([]);
    expect(clear.toUpdate.staffing).toHaveLength(1);
    expect(clear.toUpdate.staffing[0]).toMatchObject({ id: "ST-P", chantierId: "CH-1" });
    expect(clear.toUpdate.staffing[0]).not.toHaveProperty("actionId");
  });

  it("ligne copiée avec « ID ligne » vidé, identique à une existante = erreur", () => {
    const r = reimport(
      editSheet(exportPlan(), "ETP", (rows) => [
        ...rows,
        { ...rows.find((x) => x["ID ligne"] === "ST-A")!, "ID ligne": "" },
      ])
    );
    expect(r.errors.map((e) => [e.code, e.vars?.id])).toEqual([
      ["staffingDuplicateExisting", "ST-A"],
    ]);
    expect(r.toCreate.staffing).toEqual([]);

    // Légitime : la ligne existante change de dates, la nouvelle reprend l'ancienne période.
    const moved = reimport(
      editSheet(exportPlan(), "ETP", (rows) => {
        const a = rows.find((x) => x["ID ligne"] === "ST-A")!;
        return [
          ...rows.map((x) =>
            x === a ? { ...a, "Date début": "2026-09-01", "Date fin": "2026-12-31" } : x
          ),
          { ...a, "ID ligne": "" },
        ];
      })
    );
    expect(moved.errors).toEqual([]);
    expect(moved.toCreate.staffing).toHaveLength(1);
    expect(moved.toUpdate.staffing.map((s) => s.id)).toEqual(["ST-A"]);
  });
});

describe("lot 5 — dépendance vers un chantier non visible", () => {
  const hiddenDep = { targetId: "CH-HIDDEN", type: "FS" as const };
  const withDeps = (): StrategicImportExistingData => {
    const d = data();
    d.chantiers = [
      { ...chantier, dependencies: [hiddenDep, { targetId: "CH-2", type: "SS" }] },
      {
        ...chantier,
        id: "CH-2",
        name: "Chantier 2",
        importCode: "CH2",
        dependencies: [],
      } as Chantier,
    ];
    return d;
  };

  it("non exportée (jamais son id Firestore) ; ré-import sans modification = 0 changement", () => {
    const wb = exportPlan(withDeps());
    const deps = XLSX.utils
      .sheet_to_json<Record<string, unknown>>(wb.Sheets["Chantiers"], { defval: "" })
      .map((r) => r["Dépendances (Code:type, séparées par ;)"]);
    expect(deps).toEqual(["CH2:SS", ""]);
    expect(JSON.stringify(deps)).not.toContain("CH-HIDDEN");

    const r = reimport(wb, withDeps());
    expect(r.errors).toEqual([]);
    expect(totalWrites(r)).toBe(0);
  });

  it("dépendances visibles retirées par « - » : la dépendance masquée reste en base", () => {
    const r = reimport(
      editSheet(exportPlan(withDeps()), "Chantiers", (rows) =>
        rows.map((x) =>
          x.Code === "CH1" ? { ...x, "Dépendances (Code:type, séparées par ;)": "-" } : x
        )
      ),
      withDeps()
    );
    expect(r.errors).toEqual([]);
    expect(r.toUpdate.chantiers.map((c) => [c.id, c.dependencies])).toEqual([
      ["CH-1", [hiddenDep]],
    ]);
  });
});
