import { describe, expect, it } from "vitest";
import {
  CONSOLIDATED_PROGRAM_ID,
  programSwitchForLink,
  readProgramParam,
  resolveActiveSelection,
  selectablePrograms,
  selectableProgramsOfType,
  shouldResetProgramScopedState,
  stripParams,
  stripProgramParam,
} from "@/lib/activeProgramSelection";
import type { Program } from "@/types";

function program(id: string, type: Program["type"] = "performance"): Program {
  return {
    id,
    companyId: "c1",
    name: `Programme ${id}`,
    currency: "EUR",
    fyStart: "2026-01-01",
    fyEnd: "2026-12-31",
    baselineEBIT: 0,
    revenue: 0,
    createdAt: "2026-01-01",
    type,
  };
}

const perfA = program("pA");
const perfB = program("pB");
const strat = program("pS", "strategic");
const all = [perfA, perfB, strat];

describe("resolveActiveSelection", () => {
  it("aucun programme → none", () => {
    expect(
      resolveActiveSelection({
        candidates: ["pA"],
        programs: [],
        authorizedPrograms: [],
        canConsolidate: true,
      })
    ).toEqual({ kind: "none" });
  });

  it("le premier candidat valide l'emporte (lien entrant avant choix mémorisé)", () => {
    const sel = resolveActiveSelection({
      candidates: ["pS", "pB"],
      programs: all,
      authorizedPrograms: all,
      canConsolidate: false,
    });
    expect(sel).toEqual({ kind: "program", program: strat });
  });

  it("ignore un candidat NON autorisé et passe au suivant", () => {
    const sel = resolveActiveSelection({
      candidates: ["pS", "pB"],
      programs: all,
      authorizedPrograms: [perfA, perfB],
      canConsolidate: false,
    });
    expect(sel).toEqual({ kind: "program", program: perfB });
  });

  it("aucun candidat valide → premier programme autorisé (pas le premier de l'entreprise)", () => {
    const sel = resolveActiveSelection({
      candidates: [null, "inconnu"],
      programs: all,
      authorizedPrograms: [strat],
      canConsolidate: false,
    });
    expect(sel).toEqual({ kind: "program", program: strat });
  });

  it("vue consolidée seulement si l'utilisateur y a droit", () => {
    const base = { programs: all, authorizedPrograms: all };
    expect(
      resolveActiveSelection({
        ...base,
        candidates: [CONSOLIDATED_PROGRAM_ID],
        canConsolidate: true,
      })
    ).toEqual({ kind: "consolidated" });
    expect(
      resolveActiveSelection({
        ...base,
        candidates: [CONSOLIDATED_PROGRAM_ID, "pB"],
        canConsolidate: false,
      })
    ).toEqual({ kind: "program", program: perfB });
  });

  it("repli historique : aucun programme autorisé → tous les programmes sélectionnables", () => {
    const sel = resolveActiveSelection({
      candidates: ["pB"],
      programs: all,
      authorizedPrograms: [],
      canConsolidate: false,
    });
    expect(sel).toEqual({ kind: "program", program: perfB });
  });
});

describe("selectablePrograms / selectableProgramsOfType", () => {
  it("autorisés, sinon tous", () => {
    expect(selectablePrograms(all, [perfA])).toEqual([perfA]);
    expect(selectablePrograms(all, [])).toEqual(all);
  });
  it("filtre par type (ex. HR : Performance seulement, jamais les stratégiques)", () => {
    expect(selectableProgramsOfType(all, all, "performance")).toEqual([perfA, perfB]);
    expect(selectableProgramsOfType(all, [perfA, strat], "strategic")).toEqual([strat]);
  });
});

describe("paramètre d'URL ?program=", () => {
  it("lit l'id", () => {
    expect(readProgramParam("?program=pA&f_ws=x")).toBe("pA");
    expect(readProgramParam("?f_ws=x")).toBeNull();
    expect(readProgramParam("?program=")).toBeNull();
  });
  it("retire le paramètre en conservant les autres", () => {
    expect(stripProgramParam("?program=pA&f_ws=x")).toBe("?f_ws=x");
    expect(stripProgramParam("?program=pA")).toBe("");
    expect(stripProgramParam("")).toBe("");
  });
});

describe("stripParams", () => {
  it("retire les filtres f_* et garde le reste", () => {
    expect(stripParams("view=kanban&f_ws=a%2Cb&f_owner=x", (k) => k.startsWith("f_"))).toBe(
      "view=kanban"
    );
    expect(stripParams("f_ws=a", (k) => k.startsWith("f_"))).toBe("");
  });
});

describe("shouldResetProgramScopedState", () => {
  it("jamais au premier rendu ni pendant un chargement", () => {
    expect(shouldResetProgramScopedState(null, "pA")).toBe(false);
    expect(shouldResetProgramScopedState(undefined, "pA")).toBe(false);
    expect(shouldResetProgramScopedState("pA", null)).toBe(false);
  });
  it("seulement sur un vrai changement", () => {
    expect(shouldResetProgramScopedState("pA", "pA")).toBe(false);
    expect(shouldResetProgramScopedState("pA", "pB")).toBe(true);
    expect(shouldResetProgramScopedState("pA", CONSOLIDATED_PROGRAM_ID)).toBe(true);
  });
});

describe("programSwitchForLink", () => {
  const programs = [
    { id: "pA", type: "performance" as const },
    { id: "pB", type: "performance" as const },
    { id: "pS", type: "strategic" as const },
  ];
  const base = {
    activeProgramId: "pA",
    activeProgramType: "performance" as const,
    isConsolidatedView: false,
    consolidatedProgramIds: [] as string[],
    selectablePrograms: programs,
  };
  it("rien sans programme cible ou si c'est déjà le programme actif", () => {
    expect(programSwitchForLink({ ...base, targetProgramId: undefined })).toBeNull();
    expect(programSwitchForLink({ ...base, targetProgramId: "pA" })).toBeNull();
    expect(
      programSwitchForLink({ ...base, targetProgramId: "pA", targetPlan: "performance" })
    ).toBeNull();
  });
  it("bascule vers un autre programme sélectionnable (ex. item stratégique depuis un Plan Perf)", () => {
    expect(programSwitchForLink({ ...base, targetProgramId: "pS" })).toBe("pS");
    expect(programSwitchForLink({ ...base, targetProgramId: "pB" })).toBe("pB");
  });
  it("levier (Performance) ouvert depuis un programme STRATÉGIQUE actif : active le programme du levier", () => {
    // Bug PO : `/levers/detail?id=L005` suivi sans bascule rendait la fiche axe (« Axe introuvable »).
    const fromStrategic = {
      ...base,
      activeProgramId: "pS",
      activeProgramType: "strategic" as const,
    };
    expect(
      programSwitchForLink({ ...fromStrategic, targetProgramId: "pB", targetPlan: "performance" })
    ).toBe("pB");
  });
  it("programme non sélectionnable ou absent : même plan → rien ; autre plan → 1er programme de ce plan", () => {
    expect(programSwitchForLink({ ...base, targetProgramId: "autre" })).toBeNull();
    expect(
      programSwitchForLink({ ...base, targetProgramId: "autre", targetPlan: "performance" })
    ).toBeNull();
    const fromStrategic = {
      ...base,
      activeProgramId: "pS",
      activeProgramType: "strategic" as const,
    };
    expect(
      programSwitchForLink({
        ...fromStrategic,
        targetProgramId: "autre",
        targetPlan: "performance",
      })
    ).toBe("pA");
    expect(
      programSwitchForLink({
        ...fromStrategic,
        targetProgramId: undefined,
        targetPlan: "performance",
      })
    ).toBe("pA");
    expect(
      programSwitchForLink({ ...base, targetProgramId: undefined, targetPlan: "strategic" })
    ).toBe("pS");
    // Aucun programme sélectionnable du plan visé : rien.
    expect(
      programSwitchForLink({
        ...fromStrategic,
        selectablePrograms: [programs[2]],
        targetProgramId: undefined,
        targetPlan: "performance",
      })
    ).toBeNull();
  });
  it("vue consolidée (= Performance) : reste consolidée pour un programme du périmètre, bascule sinon", () => {
    const consolidated = {
      ...base,
      activeProgramId: CONSOLIDATED_PROGRAM_ID,
      activeProgramType: "performance" as const,
      isConsolidatedView: true,
      consolidatedProgramIds: ["pA", "pB"],
    };
    expect(programSwitchForLink({ ...consolidated, targetProgramId: "pB" })).toBeNull();
    expect(
      programSwitchForLink({ ...consolidated, targetProgramId: "pB", targetPlan: "performance" })
    ).toBeNull();
    expect(programSwitchForLink({ ...consolidated, targetProgramId: "pS" })).toBe("pS");
    expect(
      programSwitchForLink({ ...consolidated, targetProgramId: undefined, targetPlan: "strategic" })
    ).toBe("pS");
  });
});
