import { describe, expect, it } from "vitest";
import { parseFilterValues } from "@/lib/filterUtils";
import {
  etpAlertFilterLink,
  etpMovementDeepLink,
  etpMovementFilterLink,
} from "@/lib/hrMovementLink";

describe("hrMovementLink — etpMovementDeepLink", () => {
  it("builds a link to the movements tab with a single movement id", () => {
    expect(etpMovementDeepLink(["M1"])).toBe("/hr/etp?tab=mouvements&movementIds=M1");
  });

  it("joins several movement ids with commas", () => {
    expect(etpMovementDeepLink(["M1", "M2", "M3"])).toBe(
      "/hr/etp?tab=mouvements&movementIds=M1%2CM2%2CM3"
    );
  });

  it("dedupes ids and drops falsy entries", () => {
    expect(etpMovementDeepLink(["M1", "M1", "", "M2"])).toBe(
      "/hr/etp?tab=mouvements&movementIds=M1%2CM2"
    );
  });

  it("omits the movementIds param entirely when given no ids", () => {
    expect(etpMovementDeepLink([])).toBe("/hr/etp?tab=mouvements");
  });
});

describe("hrMovementLink — etpAlertFilterLink", () => {
  it("targets the movements tab with the namespaced alert filter, readable by the filter bar", () => {
    const link = etpAlertFilterLink(["En retard", "Désynchronisé levier"]);
    const params = new URLSearchParams(link.split("?")[1]);
    expect(link.startsWith("/hr/etp?")).toBe(true);
    expect(params.get("tab")).toBe("mouvements");
    expect(parseFilterValues(params.get("mov_f_alert"))).toEqual([
      "En retard",
      "Désynchronisé levier",
    ]);
  });

  it("omits the filter when no category is given", () => {
    expect(etpAlertFilterLink([])).toBe("/hr/etp?tab=mouvements");
  });
});

describe("hrMovementLink — etpMovementFilterLink (M5/M6)", () => {
  it("prefixes filter keys with the movements namespace `mov_`", () => {
    const url = new URL(
      etpMovementFilterLink({ f_hrOwner: ["Nadia"], f_execution: ["En retard"] }),
      "http://x"
    );
    expect(url.pathname).toBe("/hr/etp");
    expect(url.searchParams.get("tab")).toBe("mouvements");
    expect(parseFilterValues(url.searchParams.get("mov_f_hrOwner"))).toEqual(["Nadia"]);
    expect(parseFilterValues(url.searchParams.get("mov_f_execution"))).toEqual(["En retard"]);
    expect(url.searchParams.has("f_hrOwner")).toBe(false);
  });

  it("links a lever row to the movements tab filtered on the lever code", () => {
    const url = new URL(etpMovementFilterLink({ f_lever: ["L001"] }), "http://x");
    expect(parseFilterValues(url.searchParams.get("mov_f_lever"))).toEqual(["L001"]);
    expect(etpMovementFilterLink({ f_lever: [] })).toBe("/hr/etp?tab=mouvements");
  });
});
