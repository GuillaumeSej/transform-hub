import { describe, it, expect } from "vitest";
import { getConsolidatedPerformancePrograms } from "@/lib/consolidatedProgramAccess";
import type { AuthUser, Program } from "@/types";

function program(overrides: Partial<Program> & { id: string }): Program {
  return {
    companyId: "c1",
    name: overrides.id,
    currency: "€M",
    fyStart: "2026-01",
    fyEnd: "2026-12",
    baselineEBIT: 0,
    revenue: 0,
    createdAt: "2026-01-01",
    type: "performance",
    ...overrides,
  };
}

const perfA = program({ id: "p1", sponsor: "alice", owner: "bob" });
const perfB = program({ id: "p2", sponsor: "alice", owner: "carol" });
const perfC = program({ id: "p3", sponsor: "dave", owner: "bob" });
const strategic = program({ id: "p4", type: "strategic", sponsor: "alice", owner: "bob" });

const allPrograms: Program[] = [perfA, perfB, perfC, strategic];

function user(overrides: Partial<AuthUser> & { username: string }): AuthUser {
  return {
    password: "test",
    firstName: overrides.username,
    lastName: overrides.username,
    name: overrides.username,
    companyId: "c1",
    profiles: [],
    ...overrides,
  };
}

describe("getConsolidatedPerformancePrograms", () => {
  it("returns [] for a null/undefined user", () => {
    expect(getConsolidatedPerformancePrograms(null, allPrograms)).toEqual([]);
    expect(getConsolidatedPerformancePrograms(undefined, allPrograms)).toEqual([]);
  });

  it("returns [] for a user with no relevant role", () => {
    const u = user({ username: "alice", profiles: [{ role: "finance" }] });
    expect(getConsolidatedPerformancePrograms(u, allPrograms)).toEqual([]);
  });

  it("cto sees ALL performance programs of the company, regardless of profile programId", () => {
    const u = user({ username: "alice", profiles: [{ role: "cto", programId: "p1" }] });
    const result = getConsolidatedPerformancePrograms(u, allPrograms);
    expect(result.map((p) => p.id).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("cto never includes strategic programs", () => {
    const u = user({ username: "alice", profiles: [{ role: "cto" }] });
    const result = getConsolidatedPerformancePrograms(u, allPrograms);
    expect(result.some((p) => p.id === "p4")).toBe(false);
  });

  it("program_sponsor only sees programs where Program.sponsor matches their username", () => {
    const u = user({ username: "alice", profiles: [{ role: "program_sponsor" }] });
    const result = getConsolidatedPerformancePrograms(u, allPrograms);
    expect(result.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
  });

  it("program_sponsor sees [] when they sponsor no performance program", () => {
    const u = user({ username: "zoe", profiles: [{ role: "program_sponsor" }] });
    expect(getConsolidatedPerformancePrograms(u, allPrograms)).toEqual([]);
  });

  it("program_owner only sees programs where Program.owner matches their username", () => {
    const u = user({ username: "bob", profiles: [{ role: "program_owner" }] });
    const result = getConsolidatedPerformancePrograms(u, allPrograms);
    expect(result.map((p) => p.id).sort()).toEqual(["p1", "p3"]);
  });

  it("prioritizes cto over program_sponsor/program_owner when a user holds multiple roles", () => {
    const u = user({
      username: "dave",
      profiles: [{ role: "cto", programId: "p3" }, { role: "program_sponsor" }],
    });
    const result = getConsolidatedPerformancePrograms(u, allPrograms);
    // cto wins: sees ALL performance programs, not just the ones sponsored by "dave".
    expect(result.map((p) => p.id).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("prioritizes program_sponsor over program_owner when a user holds both", () => {
    const u = user({
      username: "bob",
      profiles: [{ role: "program_owner" }, { role: "program_sponsor" }],
    });
    const result = getConsolidatedPerformancePrograms(u, allPrograms);
    // bob sponsors nothing, owns p1/p3 — but program_sponsor is checked first and returns [].
    expect(result).toEqual([]);
  });
});
