import { describe, expect, it } from "vitest";
import { applyEvenWeights, clearWeights, distributeEvenly, weightsState } from "../actionWeights";

describe("actionWeights", () => {
  it("distributes evenly to exactly 100", () => {
    for (const n of [1, 2, 3, 7, 9]) {
      const w = distributeEvenly(n);
      expect(Math.round(w.reduce((s, x) => s + x, 0) * 10) / 10).toBe(100);
    }
    expect(distributeEvenly(0)).toEqual([]);
  });
  it("state detection", () => {
    expect(weightsState([{}, {}]).mode).toBe("none");
    expect(weightsState([{ weightPct: 60 }, { weightPct: 40 }]).mode).toBe("weighted");
    const bad = weightsState([{ weightPct: 60 }, { weightPct: 30 }]);
    expect(bad.mode).toBe("invalid");
    expect(bad.total).toBe(90);
    expect(weightsState([{ weightPct: 100 }, {}]).valid).toBe(false);
  });
  it("apply/clear", () => {
    const a = applyEvenWeights(
      [1, 2, 3].map((n) => ({ id: String(n) }) as { id: string; weightPct?: number })
    );
    expect(weightsState(a).mode).toBe("weighted");
    expect(weightsState(clearWeights(a)).mode).toBe("none");
  });
});
