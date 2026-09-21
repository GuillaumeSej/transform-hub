import { describe, it, expect } from "vitest";
import { savingsSeriesByWorkstream } from "@/lib/scurveDetail";
import type { BeTrackData } from "@/types";

describe("savingsSeriesByWorkstream", () => {
  it("retourne une liste vide sans levier", () => {
    const data = { program: { fyStart: "2026-01-01" }, levers: [] } as unknown as BeTrackData;
    expect(savingsSeriesByWorkstream(data, [{ id: "A", name: "A" }], "month")).toEqual([]);
  });
});
