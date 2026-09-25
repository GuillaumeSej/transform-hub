import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  canBeKpiResponsible,
  canFillIndicator,
  indicatorResponsibleUsernames,
  isProjetMember,
  resolveStrategicOwnershipScope,
  resolveStrategicRoleForProgram,
  strategicProfileForProgram,
} from "@/lib/axisLogic";
import {
  applyPeopleMapping,
  buildStrategicPlanExportWorkbook,
  parseStrategicImportWorkbook,
  splitPersonList,
  validateStrategicImportRows,
  type StrategicImportExistingData,
  type StrategicImportRawSheets,
} from "@/lib/strategicExcelImport";
import type {
  AuthUser,
  Chantier,
  ChantierAction,
  Indicator,
  MaturityStageConfig,
  ProfileAssignment,
  StrategicAxis,
} from "@/types";

/** Contributeurs projet (visibilité), rôles par programme, responsables de saisie des KPI et
 *  colonnes d'import correspondantes. */

const user = (username: string, profiles: ProfileAssignment[]) => ({ username, profiles });

const axis = (id: string, o: Partial<StrategicAxis> = {}): StrategicAxis =>
  ({
    id,
    companyId: "c1",
    programId: "p1",
    name: id,
    stage: "defined",
    ...o,
  }) as StrategicAxis;
const chantier = (id: string, o: Partial<Chantier> = {}): Chantier =>
  ({
    id,
    companyId: "c1",
    programId: "p1",
    axisIds: ["AX1"],
    name: id,
    stage: "defined",
    ...o,
  }) as Chantier;
const action = (
  id: string,
  chantierId: string,
  o: Partial<ChantierAction> = {}
): ChantierAction => ({
  id,
  companyId: "c1",
  chantierId,
  name: id,
  start: "2026-01-01",
  end: "2026-06-30",
  status: "defined",
  ...o,
});
const indicator = (o: Partial<Indicator> = {}): Indicator => ({
  id: "K1",
  companyId: "c1",
  programId: "p1",
  axisId: "AX1",
  name: "KPI",
  kind: "quantitative",
  frequency: "monthly",
  objective: "80",
  responsibleRoles: [],
  status: "on_track",
  createdAt: "2026-01-01",
  lastUpdate: "2026-01-01",
  ...o,
});

// ─── Rôle par programme ──────────────────────────────────────────────────────────────────────

describe("strategicProfileForProgram / resolveStrategicRoleForProgram", () => {
  it("never applies another program's profile (no fallback to profiles[0])", () => {
    const u = user("u", [{ role: "strategic_lead", programId: "p2" }]);
    expect(strategicProfileForProgram(u, "p1")).toBeUndefined();
    expect(resolveStrategicRoleForProgram(u, "p1")).toBeUndefined();
    expect(resolveStrategicRoleForProgram(u, "p2")).toBe("strategic_lead");
  });

  it("prefers the exact program, then a program-less profile", () => {
    const u = user("u", [{ role: "strategic_lead", programId: "p2" }, { role: "axis_sponsor" }]);
    expect(resolveStrategicRoleForProgram(u, "p2")).toBe("strategic_lead");
    expect(resolveStrategicRoleForProgram(u, "p1")).toBe("axis_sponsor");
  });
});

// ─── Visibilité : contributeurs projet ─────────────────────────────────────────────────────────

describe("resolveStrategicOwnershipScope — contributors & projet_contributor", () => {
  const axes = [axis("AX1"), axis("AX2")];
  const chantiers = [
    chantier("CH1", { axisIds: ["AX1"], pilote: "sponsorCh1" }),
    chantier("CH2", { axisIds: ["AX2"] }),
  ];
  const actions = [
    action("A1", "CH1", { owner: "owner1", contributors: ["contrib1"] }),
    action("A2", "CH1", { owner: "someone" }),
    action("A3", "CH2", { owner: "someone" }),
  ];

  it("isProjetMember: owner and contributors alike", () => {
    expect(isProjetMember(actions[0], "owner1")).toBe(true);
    expect(isProjetMember(actions[0], "contrib1")).toBe(true);
    expect(isProjetMember(actions[0], "someone")).toBe(false);
  });

  it("a projet_contributor listed in contributors sees and opens the project exactly like its owner", () => {
    const asContributor = resolveStrategicOwnershipScope(
      { username: "contrib1", profiles: [{ role: "projet_contributor" }] },
      "p1",
      axes,
      chantiers,
      actions
    );
    const asOwner = resolveStrategicOwnershipScope(
      { username: "owner1", profiles: [{ role: "chantier_contributor" }] },
      "p1",
      axes,
      chantiers,
      actions
    );
    for (const scope of [asContributor, asOwner]) {
      if (scope.mode !== "scoped") throw new Error("expected scoped");
      expect(scope.chantierIds).toEqual(new Set(["CH1"]));
      expect(scope.axisIds).toEqual(new Set(["AX1"]));
      expect(scope.clickableActionIds).toEqual(new Set(["A1"]));
    }
  });

  it("a chantier_contributor also sees projects where he is only a contributor", () => {
    const scope = resolveStrategicOwnershipScope(
      { username: "contrib1", profiles: [{ role: "chantier_contributor" }] },
      "p1",
      axes,
      chantiers,
      actions
    );
    if (scope.mode !== "scoped") throw new Error("expected scoped");
    expect(scope.clickableActionIds).toEqual(new Set(["A1"]));
  });

  it("a chantier sponsor keeps his whole chantier, and a project he contributes to elsewhere is added (clickable only for that project)", () => {
    const withExtra = [
      ...actions,
      action("A4", "CH2", { owner: "x", contributors: ["sponsorCh1"] }),
    ];
    const scope = resolveStrategicOwnershipScope(
      { username: "sponsorCh1", profiles: [{ role: "chantier_owner" }] },
      "p1",
      axes,
      chantiers,
      withExtra
    );
    if (scope.mode !== "scoped") throw new Error("expected scoped");
    expect(scope.chantierIds).toEqual(new Set(["CH1", "CH2"]));
    expect(scope.axisIds).toEqual(new Set(["AX1", "AX2"]));
    // CH1 entier (A1, A2) + seulement A4 dans CH2 (A3 visible mais inerte).
    expect(scope.clickableActionIds).toEqual(new Set(["A1", "A2", "A4"]));
  });

  it("a chantier sponsor with no extra project keeps clickableActionIds undefined (all clickable)", () => {
    const scope = resolveStrategicOwnershipScope(
      { username: "sponsorCh1", profiles: [{ role: "chantier_owner" }] },
      "p1",
      axes,
      chantiers,
      actions
    );
    if (scope.mode !== "scoped") throw new Error("expected scoped");
    expect(scope.chantierIds).toEqual(new Set(["CH1"]));
    expect(scope.clickableActionIds).toBeUndefined();
  });

  it("hr on a strategic program has unrestricted read", () => {
    expect(
      resolveStrategicOwnershipScope(
        { username: "rh", profiles: [{ role: "hr", programId: "p1" }] },
        "p1",
        axes,
        chantiers,
        actions
      )
    ).toEqual({ mode: "unrestricted" });
  });

  it("a user whose strategic profiles all belong to another program is scoped to his named positions only", () => {
    const scope = resolveStrategicOwnershipScope(
      { username: "contrib1", profiles: [{ role: "strategic_lead", programId: "p2" }] },
      "p1",
      axes,
      chantiers,
      actions
    );
    if (scope.mode !== "scoped") throw new Error("expected scoped");
    expect(scope.chantierIds).toEqual(new Set(["CH1"]));
    expect(scope.clickableActionIds).toEqual(new Set(["A1"]));
  });
});

// ─── Droit de saisie des KPI ───────────────────────────────────────────────────────────────────

describe("canFillIndicator — named responsibles & hierarchy", () => {
  const ctx = {
    axes: [axis("AX1", { owner: "axisSponsor" })],
    chantiers: [chantier("CH1", { pilote: "chSponsor" })],
  };
  const axisKpi = indicator({ additionalAuthorizedUserIds: ["resp1"] });
  const chantierKpi = indicator({ chantierId: "CH1", additionalAuthorizedUserIds: ["resp1"] });
  const plain = (username: string, profiles: ProfileAssignment[] = []) =>
    ({ username, profiles }) as Pick<AuthUser, "username" | "profiles">;

  it("indicatorResponsibleUsernames trims and dedupes", () => {
    expect(
      indicatorResponsibleUsernames({ additionalAuthorizedUserIds: [" a ", "a", "", "b"] })
    ).toEqual(["a", "b"]);
  });

  it("the named responsible can fill, whatever his role", () => {
    expect(canFillIndicator(axisKpi, plain("resp1", [{ role: "chantier_contributor" }]))).toBe(
      true
    );
  });

  it("admin and the program's pilote can fill; a pilote of ANOTHER program cannot", () => {
    expect(canFillIndicator(axisKpi, { ...plain("root"), isCompanyAdmin: true })).toBe(true);
    expect(
      canFillIndicator(axisKpi, plain("lead", [{ role: "strategic_lead", programId: "p1" }]))
    ).toBe(true);
    expect(
      canFillIndicator(axisKpi, plain("lead", [{ role: "strategic_lead", programId: "p2" }]))
    ).toBe(false);
  });

  it("chantier KPI: the chantier sponsor can fill, the axis sponsor cannot", () => {
    expect(canFillIndicator(chantierKpi, plain("chSponsor"), ctx)).toBe(true);
    expect(canFillIndicator(chantierKpi, plain("axisSponsor"), ctx)).toBe(false);
  });

  it("axis KPI: the axis sponsor can fill, a chantier sponsor cannot", () => {
    expect(canFillIndicator(axisKpi, plain("axisSponsor"), ctx)).toBe(true);
    expect(canFillIndicator(axisKpi, plain("chSponsor"), ctx)).toBe(false);
  });

  it("without context, sponsors are not recognized", () => {
    expect(canFillIndicator(chantierKpi, plain("chSponsor"))).toBe(false);
  });

  it("responsibleRoles no longer grants a whole role once a responsible is named", () => {
    const k = indicator({
      responsibleRoles: ["chantier_owner"],
      additionalAuthorizedUserIds: ["resp1"],
    });
    expect(canFillIndicator(k, plain("other", [{ role: "chantier_owner" }]))).toBe(false);
  });

  it("legacy fallback: responsibleRoles applies only without named responsible, program-aware", () => {
    const k = indicator({ responsibleRoles: ["chantier_owner"] });
    expect(canFillIndicator(k, plain("o", [{ role: "chantier_owner", programId: "p1" }]))).toBe(
      true
    );
    expect(canFillIndicator(k, plain("o", [{ role: "chantier_owner", programId: "p2" }]))).toBe(
      false
    );
  });

  it("comex and hr never fill, even when named or listed in responsibleRoles", () => {
    const k = indicator({
      responsibleRoles: ["comex_member", "hr"],
      additionalAuthorizedUserIds: ["boss", "rh"],
    });
    expect(canFillIndicator(k, plain("boss", [{ role: "comex_member" }]))).toBe(false);
    expect(canFillIndicator(k, plain("rh", [{ role: "hr", programId: "p1" }]))).toBe(false);
    const legacy = indicator({ responsibleRoles: ["hr", "comex_member"] });
    expect(canFillIndicator(legacy, plain("rh2", [{ role: "hr" }]))).toBe(false);
  });

  it("canBeKpiResponsible excludes comex/hr on the program", () => {
    expect(canBeKpiResponsible({ profiles: [{ role: "comex_member" }] }, "p1")).toBe(false);
    expect(canBeKpiResponsible({ profiles: [{ role: "hr", programId: "p1" }] }, "p1")).toBe(false);
    expect(canBeKpiResponsible({ profiles: [{ role: "chantier_owner" }] }, "p1")).toBe(true);
    expect(canBeKpiResponsible({ profiles: [] }, "p1")).toBe(true);
    expect(canBeKpiResponsible(null, "p1")).toBe(false);
  });
});

// ─── Import Excel : contributeurs & responsables de saisie ───────────────────────────────────

describe("strategic Excel import — Contributeurs / Responsables saisie", () => {
  const stages: MaturityStageConfig[] = [
    { id: "defined", order: 1, label: "Défini", programId: "P1", companyId: "C1" },
  ];
  const users = [
    { username: "marc.dubois", name: "Marc Dubois" },
    { username: "iroy", name: "Isabelle Roy" },
  ];
  const empty = (): StrategicImportExistingData => ({
    axes: [],
    chantiers: [],
    actions: [],
    indicators: [],
    measurements: [],
    staffing: [],
  });
  const sheets = (p: Partial<StrategicImportRawSheets>): StrategicImportRawSheets => ({
    axes: [{ Code: "AX1", Nom: "Axe 1" }],
    chantiers: [{ Code: "CH1", "Codes Axes (séparés par ;)": "AX1", Nom: "Chantier 1" }],
    actions: [],
    livrables: [],
    indicateurs: [],
    etp: [],
    ...p,
  });
  const run = (s: StrategicImportRawSheets, existing = empty()) =>
    validateStrategicImportRows(s, existing, "C1", "P1", stages, "admin", { users });
  const projet = (o: Record<string, unknown>) => ({
    Code: "P1",
    "Code Chantier": "CH1",
    Nom: "Projet 1",
    "Date début": "2026-01-01",
    "Date fin": "2026-06-30",
    ...o,
  });
  const kpi = (o: Record<string, unknown>) => ({
    "Code Axe": "AX1",
    Nom: "KPI",
    Type: "Quantitatif",
    Fréquence: "Mensuelle",
    Objectif: "80",
    "Valeur cible": 80,
    ...o,
  });

  it("splitPersonList splits on ; and , and dedupes", () => {
    expect(splitPersonList(" a ; b, a ,, c ")).toEqual(["a", "b", "c"]);
  });

  it("resolves contributors like owners; unresolved names are kept and reported as warnings", () => {
    const result = run(
      sheets({ actions: [projet({ Contributeurs: "Marc Dubois, iroy; Paul Inconnu" })] })
    );
    expect(result.errors).toEqual([]);
    expect(result.toCreate.actions[0].contributors).toEqual([
      "marc.dubois",
      "iroy",
      "Paul Inconnu",
    ]);
    const w = result.warnings.filter((x) => x.code === "personNotLinked");
    expect(w).toHaveLength(1);
    expect(w[0].vars?.name).toBe("Paul Inconnu");
    expect(result.people.map((p) => p.name)).toContain("Paul Inconnu");
  });

  it("imports KPI 'Responsable saisie' (alias) without any role column", () => {
    const result = run(sheets({ indicateurs: [kpi({ "Responsable saisie": "Isabelle Roy" })] }));
    expect(result.errors).toEqual([]);
    expect(result.toCreate.indicators[0].additionalAuthorizedUserIds).toEqual(["iroy"]);
    expect(result.toCreate.indicators[0].responsibleRoles).toEqual([]);
  });

  it("a KPI with neither responsible nor role is rejected", () => {
    const result = run(sheets({ indicateurs: [kpi({})] }));
    expect(result.errors.map((e) => e.code)).toContain("responsibleRequired");
    expect(result.toCreate.indicators).toHaveLength(0);
  });

  it("legacy role column alone is still accepted", () => {
    const result = run(
      sheets({ indicateurs: [kpi({ "Rôles responsables (séparés par ;)": "strategic_lead" })] })
    );
    expect(result.errors).toEqual([]);
    expect(result.toCreate.indicators[0].responsibleRoles).toEqual(["strategic_lead"]);
  });

  it("applyPeopleMapping rewrites contributors and KPI responsibles", () => {
    const result = run(
      sheets({
        actions: [projet({ Contributeurs: "Paul Inconnu" })],
        indicateurs: [kpi({ "Responsables saisie": "Paul Inconnu" })],
      })
    );
    const key = result.people.find((p) => p.name === "Paul Inconnu")!.key;
    const mapped = applyPeopleMapping(result.toCreate, new Map([[key, "paul.inconnu"]]));
    expect(mapped.actions[0].contributors).toEqual(["paul.inconnu"]);
    expect(mapped.indicators[0].additionalAuthorizedUserIds).toEqual(["paul.inconnu"]);
  });

  it("export → reimport round-trips contributors and KPI responsibles unchanged", () => {
    const first = run(
      sheets({
        actions: [projet({ Contributeurs: "iroy;marc.dubois" })],
        indicateurs: [kpi({ Code: "K1", "Responsables saisie": "iroy" })],
      })
    );
    expect(first.errors).toEqual([]);
    const existing: StrategicImportExistingData = {
      ...empty(),
      axes: first.toCreate.axes,
      chantiers: first.toCreate.chantiers,
      actions: first.toCreate.actions,
      indicators: first.toCreate.indicators,
      measurements: first.toCreate.measurements,
    };
    const wb = buildStrategicPlanExportWorkbook(existing, stages, XLSX);
    const second = run(parseStrategicImportWorkbook(wb, XLSX), existing);
    expect(second.errors).toEqual([]);
    expect(second.toCreate.actions).toHaveLength(0);
    expect(second.toUpdate.actions).toHaveLength(0);
    expect(second.toUpdate.indicators).toHaveLength(0);
  });
});
