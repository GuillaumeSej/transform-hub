import { describe, expect, it } from "vitest";
import { matchesLeverSearch, normalizeSearchText, type LeverSearchable } from "@/lib/leverSearch";

const row = (over: Partial<LeverSearchable> & Record<string, unknown> = {}) => ({
  code: "DIG-002",
  name: "Transformation digitale CRM",
  owner: "Claire Bernard",
  sponsor: "Paul Martin",
  wsName: "Digital Transformation",
  type: "Digital",
  function: "IT",
  geography: "Europe",
  country: "France",
  entity: "Acme SAS",
  programName: "",
  ...over,
});

describe("matchesLeverSearch", () => {
  it("empty / blank query matches everything", () => {
    expect(matchesLeverSearch(row(), "")).toBe(true);
    expect(matchesLeverSearch(row(), "   ")).toBe(true);
  });

  it("matches each visible field, case- and accent-insensitive", () => {
    expect(matchesLeverSearch(row(), "dig-002")).toBe(true);
    expect(matchesLeverSearch(row(), "crm")).toBe(true);
    expect(matchesLeverSearch(row(), "bernard")).toBe(true);
    expect(matchesLeverSearch(row(), "martin")).toBe(true);
    expect(matchesLeverSearch(row(), "digital transf")).toBe(true);
    expect(matchesLeverSearch(row(), "it")).toBe(true);
    expect(matchesLeverSearch(row(), "europe")).toBe(true);
    expect(matchesLeverSearch(row(), "FRANCE")).toBe(true);
    expect(matchesLeverSearch(row(), "acme")).toBe(true);
    expect(matchesLeverSearch(row({ name: "Réduction énergie" }), "reduction ENERGIE")).toBe(true);
    expect(matchesLeverSearch(row({ programName: "Excellence 2026" }), "excellence")).toBe(true);
  });

  it("never matches on hidden / technical fields (QA: « PROC » returned DIG-002)", () => {
    const dig002 = row({
      id: "lever-proc-legacy",
      ws: "WS-PROC",
      description: "Procurement CRM tooling",
      dependencies: ["PROC-003"],
      status: "cancelled",
    });
    expect(matchesLeverSearch(dig002, "proc")).toBe(false);
    expect(matchesLeverSearch(row({ code: "PROC-003", name: "Achats" }), "PROC")).toBe(true);
  });

  it("same predicate for active and abandoned levers", () => {
    const levers = [
      row({ code: "PROC-001", status: "in_progress" }),
      row({ code: "PROC-003", status: "cancelled" }),
      row({ code: "PROC-006", status: "cancelled" }),
      row({ code: "DIG-002", status: "cancelled", ws: "WS-PROC" }),
    ];
    const matched = levers.filter((l) => matchesLeverSearch(l, "PROC")).map((l) => l.code);
    expect(matched).toEqual(["PROC-001", "PROC-003", "PROC-006"]);
  });

  it("ignores null / undefined fields", () => {
    expect(matchesLeverSearch({ code: "X-1", owner: undefined, sponsor: null }, "x-1")).toBe(true);
    expect(matchesLeverSearch({ code: "X-1", owner: undefined, sponsor: null }, "zz")).toBe(false);
  });
});

describe("normalizeSearchText", () => {
  it("lowercases, strips accents and trims", () => {
    expect(normalizeSearchText("  Élévation Énergétique ")).toBe("elevation energetique");
  });
});
