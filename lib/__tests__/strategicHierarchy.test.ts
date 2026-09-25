import { describe, expect, it } from "vitest";
import {
  approvalChain,
  authorLevel,
  canDesignate,
  type HierarchyContext,
} from "@/lib/strategicHierarchy";

const ctx: HierarchyContext = {
  axis: { owner: "sa" },
  chantier: { pilote: "sc" },
  projet: { owner: "rp", contributors: ["c1", "c2"] },
  pilots: ["pilot"],
};

const levels = (chain: { level: string }[]) => chain.map((s) => s.level);

describe("strategicHierarchy", () => {
  it("resolves the highest level held", () => {
    expect(authorLevel("c1", ctx)).toBe("contributor");
    expect(authorLevel("rp", ctx)).toBe("projectOwner");
    expect(authorLevel("pilot", ctx)).toBe("pilot");
    expect(authorLevel("nobody", ctx)).toBeNull();
  });

  it("two validations = the two levels above the author", () => {
    expect(levels(approvalChain("c1", ctx, 2))).toEqual(["projectOwner", "chantierSponsor"]);
    expect(levels(approvalChain("rp", ctx, 2))).toEqual(["chantierSponsor", "axisSponsor"]);
    expect(levels(approvalChain("sc", ctx, 2))).toEqual(["axisSponsor", "pilot"]);
    expect(levels(approvalChain("sa", ctx, 2))).toEqual(["pilot"]);
    expect(approvalChain("pilot", ctx, 2)).toEqual([]);
  });

  it("one validation = N+1 only", () => {
    expect(approvalChain("c1", ctx, 1)).toEqual([{ level: "projectOwner", usernames: ["rp"] }]);
  });

  it("skips empty levels and never includes the author", () => {
    const noSponsor = { ...ctx, chantier: { pilote: undefined } };
    expect(levels(approvalChain("rp", noSponsor, 2))).toEqual(["axisSponsor", "pilot"]);
    const selfAbove = { ...ctx, chantier: { pilote: "rp" } };
    expect(levels(approvalChain("rp", selfAbove, 2))).toEqual(["axisSponsor", "pilot"]);
  });

  it("KPI floor: designated responsible outside the hierarchy → axis sponsor then pilot", () => {
    expect(levels(approvalChain("kpiResp", ctx, 2, "chantierSponsor"))).toEqual([
      "axisSponsor",
      "pilot",
    ]);
    expect(levels(approvalChain("c1", ctx, 2, "chantierSponsor"))).toEqual([
      "axisSponsor",
      "pilot",
    ]);
  });

  it("multi-axe : les sponsors de tous les axes détiennent le palier axe ; jamais deux paliers pour la même personne", () => {
    const multi = { ...ctx, axes: [{ owner: "sa" }, { owner: "sa2" }] };
    expect(approvalChain("sc", multi, 2)).toEqual([
      { level: "axisSponsor", usernames: ["sa", "sa2"] },
      { level: "pilot", usernames: ["pilot"] },
    ]);
    // Le sponsor d'axe est aussi pilote : retiré du palier pilote (vide → sauté).
    const both = { ...ctx, pilots: ["sa"] };
    expect(approvalChain("sc", both, 2)).toEqual([{ level: "axisSponsor", usernames: ["sa"] }]);
    const twoPilots = { ...ctx, pilots: ["sa", "p2"] };
    expect(levels(approvalChain("sc", twoPilots, 2))).toEqual(["axisSponsor", "pilot"]);
    expect(approvalChain("sc", twoPilots, 2)[1].usernames).toEqual(["p2"]);
  });

  it("designation rights", () => {
    expect(canDesignate("chantierSponsor", "sa", ctx, false)).toBe(false);
    expect(canDesignate("chantierSponsor", "pilot", ctx, false)).toBe(true);
    expect(canDesignate("axisSponsor", "sa", ctx, false)).toBe(false);
    expect(canDesignate("projectOwner", "sc", ctx, false)).toBe(true);
    expect(canDesignate("projectOwner", "rp", ctx, false)).toBe(false);
    expect(canDesignate("contributors", "rp", ctx, false)).toBe(true);
    expect(canDesignate("contributors", "c1", ctx, false)).toBe(false);
    expect(canDesignate("axisSponsor", "anyone", ctx, true)).toBe(true);
  });
});
