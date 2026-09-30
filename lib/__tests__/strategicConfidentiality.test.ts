import { describe, expect, it } from "vitest";
import { resolveConfidentialityClearance } from "@/lib/leversLogic";
import {
  filterStrategicByClearance,
  isChantierVisibleForClearance,
} from "@/lib/strategicConfidentiality";

const LEVELS = ["Public", "Interne", "Secret"];
// Habilitation "Interne" (voit Public + Interne, pas Secret) vs habilitation complète.
const notCleared = resolveConfidentialityClearance(
  { profiles: [], confidentialityClearance: "Interne" },
  {},
  "strategic",
  LEVELS
);
const cleared = resolveConfidentialityClearance(
  { profiles: [], confidentialityClearance: "Secret" },
  {},
  "strategic",
  LEVELS
);

const axes = [
  { id: "AX-open", confidentialityLevel: undefined },
  { id: "AX-secret", confidentialityLevel: "Secret" },
];

function run(
  chantiers: { id: string; axisIds: string[]; confidentialityLevel?: string }[],
  clearance: "all" | string[]
) {
  return filterStrategicByClearance(
    {
      axes,
      chantiers,
      indicators: [
        {
          axisId: "AX-secret",
          chantierId: undefined,
          confidentialityLevel: undefined,
          id: "macro",
        },
        { axisId: "AX-secret", chantierId: "CH-1", confidentialityLevel: undefined, id: "kpi-ch1" },
        {
          axisId: "AX-open",
          chantierId: "CH-open",
          confidentialityLevel: undefined,
          id: "kpi-open",
        },
      ],
      staffing: [
        { chantierId: "CH-1", id: "st-ch1" },
        { chantierId: "CH-open", id: "st-open" },
      ],
    },
    clearance
  );
}

describe("strategic confidentiality — chantier inherits its axis level", () => {
  it("hides a chantier (and its indicators / staffing) without own level under a confidential axis", () => {
    const out = run(
      [
        { id: "CH-1", axisIds: ["AX-secret"] },
        { id: "CH-open", axisIds: ["AX-open"] },
      ],
      notCleared
    );
    expect(out.axes.map((a) => a.id)).toEqual(["AX-open"]);
    expect(out.chantiers.map((c) => c.id)).toEqual(["CH-open"]);
    expect(out.indicators.map((i) => i.id)).toEqual(["kpi-open"]);
    expect(out.staffing.map((s) => s.id)).toEqual(["st-open"]);
  });

  it("keeps everything visible for a cleared user", () => {
    const chantiers = [
      { id: "CH-1", axisIds: ["AX-secret"] },
      { id: "CH-open", axisIds: ["AX-open"] },
    ];
    for (const clearance of [cleared, "all" as const]) {
      const out = run(chantiers, clearance);
      expect(out.chantiers.map((c) => c.id)).toEqual(["CH-1", "CH-open"]);
      expect(out.indicators).toHaveLength(3);
      expect(out.staffing).toHaveLength(2);
    }
  });

  it("still applies a chantier's own level when stricter than its axis", () => {
    const out = run(
      [
        { id: "CH-1", axisIds: ["AX-open"], confidentialityLevel: "Secret" },
        { id: "CH-open", axisIds: ["AX-open"] },
      ],
      notCleared
    );
    expect(out.chantiers.map((c) => c.id)).toEqual(["CH-open"]);
    expect(out.staffing.map((s) => s.id)).toEqual(["st-open"]);
    // Le chantier-scopé indicateur suit son chantier masqué.
    expect(out.indicators.map((i) => i.id)).not.toContain("kpi-ch1");
    expect(
      isChantierVisibleForClearance(
        { axisIds: ["AX-open"], confidentialityLevel: "Secret" },
        axes,
        cleared
      )
    ).toBe(true);
  });

  it("multi-axis: hidden as soon as ANY of its axes is not accessible, whatever the order", () => {
    for (const axisIds of [
      ["AX-open", "AX-secret"],
      ["AX-secret", "AX-open"],
    ]) {
      expect(isChantierVisibleForClearance({ axisIds }, axes, notCleared)).toBe(false);
      expect(isChantierVisibleForClearance({ axisIds }, axes, cleared)).toBe(true);
    }
    // Axe inconnu (supprimé / hors programme) : ignoré.
    expect(isChantierVisibleForClearance({ axisIds: ["AX-gone"] }, axes, notCleared)).toBe(true);
  });
});
