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

// Ancien circuit de jalon à approbateur unique SUPPRIMÉ : la file historique est désormais
// toujours vide (les demandes de jalon à chaîne sont dans useStrategicApprovals().pending).
describe("resolveMilestoneApprovalQueue (déprécié)", () => {
  it("renvoie toujours une liste vide, quel que soit l'utilisateur (ancien circuit supprimé)", () => {
    const admin = makeUser({ isGlobalAdmin: true } as Partial<AuthUser>);
    const lead = makeUser({ profiles: [{ role: "strategic_lead" }] });
    const chantier = makeChantier({ programId: "p1", pilote: "pilote1" });
    for (const user of [null, admin, lead]) {
      expect(resolveMilestoneApprovalQueue([makeAction()], [chantier], user)).toEqual([]);
    }
  });
});
