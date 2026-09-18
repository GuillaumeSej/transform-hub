import { describe, expect, it } from "vitest";
import { etpMovementDeepLink } from "@/lib/hrMovementLink";

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
