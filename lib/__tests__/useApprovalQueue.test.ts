import { describe, it, expect } from "vitest";
import { resolveApprovalQueue, resolveMilestoneApprovalQueue } from "@/lib/hooks/useApprovalQueue";
import type { AuthUser, BeTrackData, Chantier, ChantierAction, Lever, Workstream } from "@/types";

/**
 * Teste la logique PURE de résolution de la file d'attente de validation
 * (`resolveApprovalQueue`), extraite de `useApprovalQueue` pour être testable sans rendu React —
 * le projet n'a pas de dépendance de test de hooks React (`@testing-library/react-hooks` ou
 * équivalent) dans les tests existants (voir lib/__tests__/*.test.ts), qui testent tous de la
 * logique pure.
 */

function makeLever(overrides: Partial<Lever> = {}): Lever {
  return {
    id: "L001",
    code: "L001",
    type: "Sourcing",
    name: "Levier test",
    ws: "ws1",
    owner: "Owner Name",
    ownerInit: "ON",
    sponsor: "Sponsor Name",
    sponsorInit: "SN",
    geography: "",
    country: "",
    entity: "",
    function: "",
    costCenter: "",
    pnlMap: "",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "qualified",
    progress: 0,
    risk: "low",
    grossSavings: 0,
    netSavings: 0,
    opexOneOff: 0,
    opexRec: 0,
    capex: 0,
    fteImpact: 0,
    popImpacted: "",
    dependencies: [],
    description: "",
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    programId: "prog1",
    ...overrides,
  };
}

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    username: "user1",
    password: "",
    profiles: [],
    firstName: "Test",
    lastName: "User",
    name: "Test User",
    companyId: "c1",
    ...overrides,
  };
}

function makeData(
  levers: Lever[],
  workstreams: Workstream[] = []
): Pick<BeTrackData, "levers" | "workstreams"> {
  return { levers, workstreams };
}

describe("resolveApprovalQueue", () => {
  it("retourne une liste vide sans utilisateur", () => {
    expect(resolveApprovalQueue(makeData([makeLever()]), null)).toEqual([]);
  });

  it("ignore les leviers sans approval en cours", () => {
    const lever = makeLever();
    const user = makeUser({ profiles: [{ role: "sponsor" }] });
    expect(resolveApprovalQueue(makeData([lever]), user)).toEqual([]);
  });

  it.each(["qualified", "validated", "in_progress"] as const)(
    "inclut un levier en attente (porte '%s') quand l'utilisateur sponsorise le workstream parent",
    (gate) => {
      const lever = makeLever({
        ws: "ws1",
        approval: {
          targetStatus: gate,
          requestedBy: "owner1",
          requestedAt: "2026-01-01",
        },
      });
      const workstreams: Workstream[] = [
        {
          id: "ws1",
          name: "WS1",
          sponsor: "",
          sponsorUsername: "user1",
          color: "#000",
          target: 0,
        },
      ];
      const user = makeUser({ username: "user1", profiles: [{ role: "sponsor" }] });
      expect(resolveApprovalQueue(makeData([lever], workstreams), user)).toEqual([lever]);
    }
  );

  it("exclut un levier en attente pour un sponsor d'un AUTRE workstream", () => {
    const lever = makeLever({
      ws: "ws1",
      approval: {
        targetStatus: "qualified",
        requestedBy: "owner1",
        requestedAt: "2026-01-01",
      },
    });
    const workstreams: Workstream[] = [
      {
        id: "ws1",
        name: "WS1",
        sponsor: "",
        sponsorUsername: "other-user",
        color: "#000",
        target: 0,
      },
    ];
    const user = makeUser({ username: "user1", profiles: [{ role: "sponsor" }] });
    expect(resolveApprovalQueue(makeData([lever], workstreams), user)).toEqual([]);
  });

  it("inclut un levier en attente quand l'utilisateur a le rôle cto sur le programme", () => {
    const lever = makeLever({
      programId: "prog1",
      approval: {
        targetStatus: "validated",
        requestedBy: "sponsor1",
        requestedAt: "2026-01-01",
      },
    });
    const user = makeUser({ profiles: [{ role: "cto", programId: "prog1" }] });
    expect(resolveApprovalQueue(makeData([lever]), user)).toEqual([lever]);
  });

  it("un profil cto global (sans programId) couvre tous les programmes", () => {
    const lever = makeLever({
      programId: "prog2",
      approval: {
        targetStatus: "in_progress",
        requestedBy: "sponsor1",
        requestedAt: "2026-01-01",
      },
    });
    const user = makeUser({ profiles: [{ role: "cto" }] });
    expect(resolveApprovalQueue(makeData([lever]), user)).toEqual([lever]);
  });

  it("exclut un levier en attente pour un cto scopé à un AUTRE programme", () => {
    const lever = makeLever({
      programId: "prog2",
      approval: {
        targetStatus: "qualified",
        requestedBy: "sponsor1",
        requestedAt: "2026-01-01",
      },
    });
    const user = makeUser({ profiles: [{ role: "cto", programId: "prog1" }] });
    expect(resolveApprovalQueue(makeData([lever]), user)).toEqual([]);
  });

  it("exclut un levier en attente pour un utilisateur ni sponsor ni cto", () => {
    const lever = makeLever({
      approval: {
        targetStatus: "qualified",
        requestedBy: "sponsor1",
        requestedAt: "2026-01-01",
      },
    });
    const user = makeUser({ profiles: [{ role: "lever" }] });
    expect(resolveApprovalQueue(makeData([lever]), user)).toEqual([]);
  });

  it("un admin voit tous les leviers en attente, tous rôles confondus", () => {
    const lever = makeLever({
      approval: {
        targetStatus: "qualified",
        requestedBy: "owner1",
        requestedAt: "2026-01-01",
      },
    });
    const user = makeUser({ profiles: [], isCompanyAdmin: true });
    expect(resolveApprovalQueue(makeData([lever]), user)).toEqual([lever]);
  });
});

// ─── Pendant Plan Stratégique — jalons E0→E4 (round "jalon validation gate") ───────────────────

function makeChantier(overrides: Partial<Chantier> = {}): Chantier {
  return {
    id: "CH1",
    companyId: "c1",
    programId: "p1",
    axisIds: ["AX1"],
    name: "Chantier test",
    stage: "defined",
    dependencies: [],
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

function makeAction(overrides: Partial<ChantierAction> = {}): ChantierAction {
  return {
    id: "A1",
    companyId: "c1",
    chantierId: "CH1",
    name: "Projet test",
    start: "2026-01-01",
    end: "2026-06-30",
    status: "defined",
    milestoneApproval: { targetMilestone: "E3", requestedBy: "owner1", requestedAt: "2026-01-01" },
    ...overrides,
  };
}

describe("resolveMilestoneApprovalQueue", () => {
  it("retourne une liste vide sans utilisateur", () => {
    expect(resolveMilestoneApprovalQueue([makeAction()], [makeChantier()], null)).toEqual([]);
  });

  it("ignore les projets sans demande de validation de jalon en cours", () => {
    const action = makeAction({ milestoneApproval: undefined });
    const user = makeUser({ profiles: [{ role: "strategic_lead" }] });
    expect(resolveMilestoneApprovalQueue([action], [makeChantier()], user)).toEqual([]);
  });

  it("ignore un projet dont le chantier parent est introuvable (référence orpheline)", () => {
    const action = makeAction({ chantierId: "GHOST" });
    const user = makeUser({ profiles: [{ role: "strategic_lead" }] });
    expect(resolveMilestoneApprovalQueue([action], [makeChantier()], user)).toEqual([]);
  });

  it("inclut un projet en attente pour un strategic_lead scopé au bon programme", () => {
    const action = makeAction();
    const chantier = makeChantier({ programId: "p1" });
    const user = makeUser({ profiles: [{ role: "strategic_lead", programId: "p1" }] });
    expect(resolveMilestoneApprovalQueue([action], [chantier], user)).toEqual([
      { action, chantier },
    ]);
  });

  it("un strategic_lead sans programId (global) couvre tous les programmes", () => {
    const action = makeAction();
    const chantier = makeChantier({ programId: "p2" });
    const user = makeUser({ profiles: [{ role: "strategic_lead" }] });
    expect(resolveMilestoneApprovalQueue([action], [chantier], user)).toEqual([
      { action, chantier },
    ]);
  });

  it("exclut un projet en attente pour un strategic_lead scopé à un AUTRE programme", () => {
    const action = makeAction();
    const chantier = makeChantier({ programId: "p2" });
    const user = makeUser({ profiles: [{ role: "strategic_lead", programId: "p1" }] });
    expect(resolveMilestoneApprovalQueue([action], [chantier], user)).toEqual([]);
  });

  it("exclut un projet en attente pour un utilisateur qui n'est pas strategic_lead", () => {
    const action = makeAction();
    const user = makeUser({ profiles: [{ role: "chantier_contributor" }] });
    expect(resolveMilestoneApprovalQueue([action], [makeChantier()], user)).toEqual([]);
  });

  it("un admin voit tous les projets en attente, tous rôles confondus", () => {
    const action = makeAction();
    const chantier = makeChantier();
    const user = makeUser({ profiles: [], isCompanyAdmin: true });
    expect(resolveMilestoneApprovalQueue([action], [chantier], user)).toEqual([
      { action, chantier },
    ]);
  });
});
