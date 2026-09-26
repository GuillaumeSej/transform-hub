import { describe, it, expect } from "vitest";
import {
  approveLeverDeletion,
  approveLeverGate,
  canApproveLeverDeletion,
  canDecideLeverApproval,
  canRequestLeverDeletion,
  leverApprovalChain,
  leverApprovalStepInfo,
  rejectLeverApproval,
  requestLeverApproval,
  requestLeverDeletion,
} from "@/lib/leversLogic";
import { resolveApprovalQueue, resolveRealizedApprovalQueue } from "@/lib/hooks/useApprovalQueue";
import {
  canDecideImpactRealizedOn,
  decideImpactRealized,
  realizedTogglePatch,
} from "@/lib/impactStatus";
import type { AuthUser, Lever, LeverImpact, Role, Workstream } from "@/types";

function makeLever(overrides: Partial<Lever> = {}): Lever {
  return {
    id: "L001",
    code: "L001",
    type: "Sourcing",
    name: "Levier test",
    ws: "ws1",
    owner: "Owen Owner",
    ownerUsername: "owner",
    ownerInit: "OO",
    sponsor: "",
    sponsorInit: "",
    geography: "",
    country: "",
    entity: "",
    function: "",
    costCenter: "",
    pnlMap: "",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "idea",
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

function makeUser(
  username: string,
  roles: (Role | { role: Role; programId?: string })[],
  extra: Partial<AuthUser> = {}
): AuthUser {
  return {
    username,
    password: "",
    profiles: roles.map((r) => (typeof r === "string" ? { role: r } : r)),
    firstName: username,
    lastName: "",
    name: `Name ${username}`,
    companyId: "c1",
    ...extra,
  };
}

const owner = makeUser("owner", ["lever"]);
const sponsor = makeUser("sponsor", ["sponsor"]);
const cto = makeUser("cto", [{ role: "cto", programId: "prog1" }]);
const otherCto = makeUser("cto2", [{ role: "cto", programId: "prog2" }]);
const admin = makeUser("admin", [], { isCompanyAdmin: true });
const admin2 = makeUser("admin2", [], { isGlobalAdmin: true });
const stranger = makeUser("stranger", ["lever"]);
const ws: Workstream[] = [
  { id: "ws1", name: "Achats", sponsor: "", sponsorUsername: "sponsor", color: "#000", target: 0 },
];
const directory = [owner, sponsor, cto, otherCto, admin, admin2, stranger];

describe("chaîne de validation des portes de levier (double validation hiérarchique)", () => {
  it("porteur → responsable de chantier PUIS CTO", () => {
    const chain = leverApprovalChain(makeLever(), owner, ws, directory);
    expect(chain.map((s) => [s.level, s.usernames])).toEqual([
      ["sponsor", ["sponsor"]],
      ["cto", ["cto"]],
    ]);
  });

  it("responsable de chantier → CTO seul", () => {
    const chain = leverApprovalChain(makeLever(), sponsor, ws, directory);
    expect(chain.map((s) => s.level)).toEqual(["cto"]);
  });

  it("CTO → application directe (porte franchie sans demande en attente)", () => {
    const result = requestLeverApproval([makeLever()], "L001", cto, {
      workstreams: ws,
      users: directory,
    });
    expect(result.lever.approval).toBeUndefined();
    expect(result.lever.status).toBe("qualified");
  });

  it("niveau vide sauté : sans responsable de chantier, le porteur est validé par le CTO seul", () => {
    const chain = leverApprovalChain(makeLever({ ws: "none" }), owner, ws, directory);
    expect(chain.map((s) => s.level)).toEqual(["cto"]);
  });

  it("aucun niveau au-dessus d'un non-CTO → palier admin (jamais d'application directe)", () => {
    const result = requestLeverApproval(
      [makeLever({ ws: "none", programId: "prog9" })],
      "L001",
      owner,
      {
        workstreams: ws,
        users: [owner],
      }
    );
    expect(result.lever.status).toBe("idea");
    expect(result.lever.approval?.chain?.map((s) => s.level)).toEqual(["admin"]);
    const approved = approveLeverGate(result.levers, "L001", admin, ws);
    expect(approved.lever.status).toBe("qualified");
  });

  it("une même personne n'apparaît jamais dans deux paliers", () => {
    const both = makeUser("both", ["sponsor", { role: "cto", programId: "prog1" }]);
    const lever = makeLever();
    const chain = leverApprovalChain(
      lever,
      owner,
      [{ ...ws[0], sponsorUsername: "both" }],
      [owner, both, cto]
    );
    expect(chain.map((s) => [s.level, s.usernames])).toEqual([
      ["sponsor", ["both"]],
      ["cto", ["cto"]],
    ]);
  });

  it("parcours complet : étape 1/2 chez le responsable de chantier, puis 2/2 chez le CTO", () => {
    let levers = requestLeverApproval([makeLever()], "L001", owner, {
      workstreams: ws,
      users: directory,
    }).levers;
    expect(leverApprovalStepInfo(levers[0].approval)).toMatchObject({
      current: 1,
      total: 2,
      level: "sponsor",
      names: ["Name sponsor"],
    });
    // Le CTO ne peut pas court-circuiter l'étape 1.
    expect(canDecideLeverApproval(levers[0], cto, ws)).toBe(false);
    expect(resolveApprovalQueue({ levers, workstreams: ws }, cto)).toHaveLength(0);
    expect(resolveApprovalQueue({ levers, workstreams: ws }, sponsor)).toHaveLength(1);

    levers = approveLeverGate(levers, "L001", sponsor, ws).levers;
    expect(levers[0].status).toBe("idea");
    expect(levers[0].approval?.stepIndex).toBe(1);
    expect(levers[0].approval?.chain?.[0].decidedBy).toBe("sponsor");
    expect(resolveApprovalQueue({ levers, workstreams: ws }, cto)).toHaveLength(1);
    expect(() => approveLeverGate(levers, "L001", sponsor, ws)).toThrow();

    const final = approveLeverGate(levers, "L001", cto, ws);
    expect(final.lever.status).toBe("qualified");
    expect(final.lever.approval).toBeUndefined();
  });

  it("le demandeur ne peut jamais valider sa propre demande (admin compris)", () => {
    const { levers } = requestLeverApproval([makeLever()], "L001", admin, {
      workstreams: ws,
      users: directory,
    });
    expect(() => approveLeverGate(levers, "L001", admin, ws)).toThrow(/propre demande/);
    const own = requestLeverApproval([makeLever()], "L001", owner, {
      workstreams: ws,
      users: directory,
    }).levers;
    expect(canDecideLeverApproval(own[0], owner, ws)).toBe(false);
    // Le demandeur peut en revanche retirer sa demande.
    expect(rejectLeverApproval(own, "L001", owner).lever.approval).toBeUndefined();
  });

  it("un admin débloque UN palier, jamais les deux", () => {
    let levers = requestLeverApproval([makeLever()], "L001", owner, {
      workstreams: ws,
      users: directory,
    }).levers;
    levers = approveLeverGate(levers, "L001", admin, ws).levers;
    expect(levers[0].approval?.chain?.[0].byAdmin).toBe(true);
    // Ni le même admin, ni un autre admin, ne débloque l'étape 2.
    expect(() => approveLeverGate(levers, "L001", admin, ws)).toThrow();
    expect(() => approveLeverGate(levers, "L001", admin2, ws)).toThrow(/admin/);
    expect(approveLeverGate(levers, "L001", cto, ws).lever.status).toBe("qualified");
  });

  it("un CTO d'un autre programme ou un inconnu n'est pas approbateur", () => {
    const { levers } = requestLeverApproval([makeLever()], "L001", sponsor, {
      workstreams: ws,
      users: directory,
    });
    expect(canDecideLeverApproval(levers[0], otherCto, ws)).toBe(false);
    expect(() => approveLeverGate(levers, "L001", stranger, ws)).toThrow();
    expect(() => rejectLeverApproval(levers, "L001", stranger, undefined, ws)).toThrow();
  });

  it("auto-parrainage refusé : un porteur saisi comme commanditaire n'approuve pas", () => {
    const selfSponsored = makeLever({
      sponsor: "Name owner",
      sponsorUsername: "owner",
      ws: "none",
    });
    const legacyPending = {
      ...selfSponsored,
      approval: {
        targetStatus: "qualified" as const,
        requestedBy: "someone",
        requestedAt: "2026-01-01",
      },
    };
    expect(canDecideLeverApproval(legacyPending, owner, ws)).toBe(false);
    expect(() => approveLeverGate([legacyPending], "L001", owner, ws)).toThrow();
    expect(resolveApprovalQueue({ levers: [legacyPending], workstreams: ws }, owner)).toEqual([]);
    // … et il ne figure pas comme palier « responsable de chantier » de sa propre demande.
    const chain = leverApprovalChain(selfSponsored, owner, ws, directory);
    expect(chain.map((s) => s.level)).toEqual(["cto"]);
  });

  it("demande legacy (sans chaîne) : palier unique, jamais le demandeur", () => {
    const legacy = makeLever({
      approval: { targetStatus: "qualified", requestedBy: "sponsor", requestedAt: "2026-01-01" },
    });
    expect(leverApprovalStepInfo(legacy.approval)).toBeUndefined();
    expect(canDecideLeverApproval(legacy, sponsor, ws)).toBe(false);
    expect(approveLeverGate([legacy], "L001", cto, ws).lever.status).toBe("qualified");
    const legacyByOwner = makeLever({
      approval: { targetStatus: "qualified", requestedBy: "owner", requestedAt: "2026-01-01" },
    });
    expect(approveLeverGate([legacyByOwner], "L001", sponsor, ws).lever.status).toBe("qualified");
  });

  it("sans annuaire : responsable de chantier puis CTO résolu par rôle", () => {
    const { levers } = requestLeverApproval([makeLever()], "L001", owner, { workstreams: ws });
    expect(levers[0].approval?.chain?.map((s) => s.level)).toEqual(["sponsor", "cto"]);
    const afterSponsor = approveLeverGate(levers, "L001", sponsor, ws).levers;
    expect(approveLeverGate(afterSponsor, "L001", cto, ws).lever.status).toBe("qualified");
  });
});

describe("réalisé finance : demandeur ≠ validateur, droits scopés programme", () => {
  const gain = (o: Partial<LeverImpact> = {}): LeverImpact =>
    ({
      id: "g",
      label: "gain",
      type: "saving",
      amount: 10,
      gainDate: "2026-01-01",
      ...o,
    }) as LeverImpact;
  const finance1 = makeUser("fin1", [{ role: "finance", programId: "prog1" }]);
  const finance2 = makeUser("fin2", [{ role: "finance" }]);
  const financeOther = makeUser("fin3", [{ role: "finance", programId: "prog2" }]);

  it("un profil finance qui coche « Réalisé » passe en attente (plus d'auto-validation)", () => {
    const patch = realizedTogglePatch(gain(), true, finance1);
    expect(patch.realizedApproval?.status).toBe("pending");
    expect(patch.realizedApproval?.requestedByUsername).toBe("fin1");
  });

  it("le demandeur ne valide pas son propre réalisé ; un autre finance ou un admin oui", () => {
    const imp = { ...gain(), ...realizedTogglePatch(gain(), true, finance1) } as LeverImpact;
    const lever = { programId: "prog1" };
    expect(canDecideImpactRealizedOn(finance1, lever, imp)).toBe(false);
    expect(() => decideImpactRealized(imp, "approved", finance1)).toThrow();
    expect(canDecideImpactRealizedOn(finance2, lever, imp)).toBe(true);
    expect(canDecideImpactRealizedOn(admin, lever, imp)).toBe(true);
    expect(decideImpactRealized(imp, "approved", finance2).realizedApproval).toMatchObject({
      status: "approved",
      decidedByUsername: "fin2",
      requestedByUsername: "fin1",
    });
  });

  it("demande legacy (sans username) : repli sur le nom du demandeur", () => {
    const imp = gain({
      status: "done",
      realizedApproval: { status: "pending", requestedBy: "Name fin1" },
    });
    expect(canDecideImpactRealizedOn(finance1, { programId: "prog1" }, imp)).toBe(false);
  });

  it("file finance scopée par programme, confidentialité et hors propres demandes", () => {
    const pending = (id: string, by?: AuthUser) =>
      gain({
        id,
        status: "done",
        realizedApproval: {
          status: "pending",
          requestedBy: by?.name,
          requestedByUsername: by?.username,
        },
      });
    const levers = [
      makeLever({ id: "A", programId: "prog1", impacts: [pending("a1"), pending("a2", finance1)] }),
      makeLever({ id: "B", programId: "prog2", impacts: [pending("b1")] }),
      makeLever({
        id: "C",
        programId: "prog1",
        confidentialityLevel: "secret",
        impacts: [pending("c1")],
      }),
    ];
    const company = { roleClearance: {}, confidentialityLevels: ["public", "secret"] };
    const ids = (u: AuthUser) =>
      resolveRealizedApprovalQueue({ levers }, u, company).map((e) => e.impact.id);
    expect(ids(finance1)).toEqual(["a1"]);
    expect(ids(financeOther)).toEqual(["b1"]);
    expect(ids({ ...finance2, confidentialityClearance: "all" })).toEqual(["a1", "a2", "b1", "c1"]);
    expect(ids(admin)).toEqual(["a1", "a2", "b1", "c1"]);
    expect(ids(cto)).toEqual([]);
  });
});

describe("suppression : un admin tient le rôle manquant", () => {
  const noSponsorWs: Workstream[] = [
    { id: "ws1", name: "Achats", sponsor: "", color: "#000", target: 0 },
  ];

  it("levier sans compte responsable de chantier : CTO demande, un admin confirme", () => {
    const lever = makeLever();
    const { levers } = requestLeverDeletion(
      [lever],
      "L001",
      cto,
      noSponsorWs,
      "doublon",
      directory
    );
    expect(canApproveLeverDeletion(levers[0], admin, noSponsorWs, directory)).toBe(true);
    expect(canApproveLeverDeletion(levers[0], cto, noSponsorWs, directory)).toBe(false);
    expect(approveLeverDeletion(levers, "L001", admin, noSponsorWs, directory).levers).toHaveLength(
      0
    );
  });

  it("programme sans CTO : responsable de chantier demande, un admin confirme", () => {
    const lever = makeLever({ programId: "prog9" });
    const { levers } = requestLeverDeletion([lever], "L001", sponsor, ws, undefined, directory);
    expect(canApproveLeverDeletion(levers[0], admin, ws, directory)).toBe(true);
  });

  it("admin demandeur à la place du rôle manquant, confirmé par le titulaire de l'autre rôle", () => {
    const lever = makeLever();
    expect(canRequestLeverDeletion(lever, admin, noSponsorWs, directory)).toBe(true);
    const { levers, lever: requested } = requestLeverDeletion(
      [lever],
      "L001",
      admin,
      noSponsorWs,
      undefined,
      directory
    );
    expect(requested.deletionRequest).toMatchObject({
      requestedByRole: "sponsor",
      requestedAsAdmin: true,
    });
    // Toujours deux personnes différentes : l'admin demandeur ne confirme pas.
    expect(canApproveLeverDeletion(levers[0], admin, noSponsorWs, directory)).toBe(false);
    expect(canApproveLeverDeletion(levers[0], cto, noSponsorWs, directory)).toBe(true);
  });

  it("pas de substitution admin quand les deux titulaires existent", () => {
    const lever = makeLever();
    expect(canRequestLeverDeletion(lever, admin, ws, directory)).toBe(false);
    const { levers } = requestLeverDeletion([lever], "L001", cto, ws, undefined, directory);
    expect(canApproveLeverDeletion(levers[0], admin, ws, directory)).toBe(false);
  });

  it("auto-parrainage refusé : un porteur saisi comme commanditaire ne demande pas la suppression", () => {
    const lever = makeLever({ sponsor: "Name owner", sponsorUsername: "owner" });
    expect(canRequestLeverDeletion(lever, owner, ws, directory)).toBe(false);
  });
});
