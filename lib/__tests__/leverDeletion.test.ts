import { describe, it, expect } from "vitest";
import {
  approveLeverDeletion,
  cancelLeverDeletion,
  canApproveLeverDeletion,
  requestLeverDeletion,
} from "@/lib/leversLogic";
import { resolveDeletionQueue } from "@/lib/hooks/useApprovalQueue";
import { formatDateFr, parseDateFr } from "@/lib/format";
import type { AuthUser, Lever, Workstream } from "@/types";

function makeLever(overrides: Partial<Lever> = {}): Lever {
  return {
    id: "L001",
    code: "L001",
    type: "Sourcing",
    name: "Levier test",
    ws: "ws1",
    owner: "Owner Name",
    ownerInit: "ON",
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

function makeUser(username: string, role: "cto" | "sponsor" | "lever"): AuthUser {
  return {
    username,
    password: "",
    profiles: [{ role }],
    firstName: username,
    lastName: "",
    name: username,
    companyId: "c1",
  };
}

const ws = [{ id: "ws1", name: "Achats", sponsorUsername: "resp" } as Workstream];
const cto = makeUser("cto", "cto");
const resp = makeUser("resp", "sponsor");
const otherResp = makeUser("other", "sponsor");
const owner = makeUser("owner", "lever");

describe("suppression de levier à double validation", () => {
  it("refuse la demande à un porteur de levier", () => {
    expect(() => requestLeverDeletion([makeLever()], "L001", owner, ws)).toThrow();
  });

  it("refuse la demande à un responsable d'un autre chantier", () => {
    expect(() => requestLeverDeletion([makeLever()], "L001", otherResp, ws)).toThrow();
  });

  it("CTO demande → seul le responsable de chantier confirme", () => {
    const { levers, lever } = requestLeverDeletion([makeLever()], "L001", cto, ws, "doublon");
    expect(lever.deletionRequest?.requestedByRole).toBe("cto");
    expect(canApproveLeverDeletion(lever, cto, ws)).toBe(false);
    expect(canApproveLeverDeletion(lever, resp, ws)).toBe(true);
    expect(resolveDeletionQueue({ levers, workstreams: ws }, resp)).toHaveLength(1);
    expect(resolveDeletionQueue({ levers, workstreams: ws }, cto)).toHaveLength(0);
    const result = approveLeverDeletion(levers, "L001", resp, ws);
    expect(result.levers).toHaveLength(0);
    expect(result.auditEntries[0].action).toBe("deleted");
  });

  it("responsable de chantier demande → seul le CTO confirme", () => {
    const { levers } = requestLeverDeletion([makeLever()], "L001", resp, ws);
    expect(() => approveLeverDeletion(levers, "L001", resp, ws)).toThrow();
    expect(approveLeverDeletion(levers, "L001", cto, ws).levers).toHaveLength(0);
  });

  it("refus par l'approbateur ou annulation par le demandeur", () => {
    const { levers } = requestLeverDeletion([makeLever()], "L001", resp, ws);
    expect(cancelLeverDeletion(levers, "L001", cto, ws).lever.deletionRequest).toBeUndefined();
    expect(cancelLeverDeletion(levers, "L001", resp, ws).lever.deletionRequest).toBeUndefined();
    expect(() => cancelLeverDeletion(levers, "L001", owner, ws)).toThrow();
  });
});

describe("dates au format français", () => {
  it("formate et parse JJ/MM/AAAA", () => {
    expect(formatDateFr("2026-03-07")).toBe("07/03/2026");
    expect(formatDateFr("2026-03-07T10:00:00Z")).toBe("07/03/2026");
    expect(parseDateFr("07/03/2026")).toBe("2026-03-07");
    expect(parseDateFr("31/02/2026")).toBeNull();
    expect(parseDateFr("07/03/26")).toBeNull();
  });
});
