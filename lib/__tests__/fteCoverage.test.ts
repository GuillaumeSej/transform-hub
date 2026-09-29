import { describe, expect, it } from "vitest";
import { fteCoverage } from "@/lib/fteCoverage";
import { leverTargetFte } from "@/lib/engine";

describe("fteCoverage — ETP visés par les leviers vs couverts par les mouvements RH", () => {
  it("reductions partially covered: remaining = |levers| − |movements|", () => {
    const c = fteCoverage(-34, -11.3);
    expect(c.status).toBe("remaining");
    expect(c.remaining).toBe(22.7);
    expect(c.exceeded).toBe(0);
    expect(c.coveragePct).toBe(33);
  });

  it("movements beyond the lever ambition: exceeded, no remaining", () => {
    const c = fteCoverage(-10, -12.5);
    expect(c.status).toBe("exceeded");
    expect(c.exceeded).toBe(2.5);
    expect(c.remaining).toBe(0);
    expect(c.coveragePct).toBe(100);
  });

  it("exact coverage (float noise tolerated at 0.1 FTE)", () => {
    const c = fteCoverage(-0.3, -(0.1 + 0.2));
    expect(c.status).toBe("covered");
    expect(c.remaining).toBe(0);
    expect(c.exceeded).toBe(0);
  });

  it("is sign-aware: opposite-direction movements increase the remaining gap", () => {
    const c = fteCoverage(-10, 2);
    expect(c.status).toBe("remaining");
    expect(c.remaining).toBe(12);
    expect(c.coveragePct).toBe(0);
  });

  it("works for hiring levers (positive ambition)", () => {
    expect(fteCoverage(8, 5)).toMatchObject({ status: "remaining", remaining: 3 });
    expect(fteCoverage(8, 9)).toMatchObject({ status: "exceeded", exceeded: 1 });
  });

  it("no lever ambition: empty or noLeverTarget", () => {
    expect(fteCoverage(0, 0).status).toBe("empty");
    expect(fteCoverage(0, -3)).toMatchObject({ status: "noLeverTarget", remaining: 0 });
  });

  it("non-finite inputs are treated as 0", () => {
    expect(fteCoverage(NaN, Infinity).status).toBe("empty");
  });
});

describe("leverTargetFte — same computation as the dashboard KPI", () => {
  it("sums non-cancelled levers, rounded to 0.1", () => {
    expect(
      leverTargetFte([
        { status: "in_progress", fteImpact: 0.1 },
        { status: "validated", fteImpact: 0.2 },
        { status: "cancelled", fteImpact: -50 },
      ] as never)
    ).toBe(0.3);
  });
});
