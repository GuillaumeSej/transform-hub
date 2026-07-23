import { describe, it, expect } from "vitest";
import {
  STATUS_LEVEL,
  STATUS_LABEL,
  STATUS_SHORT_LABEL,
  STATUS_CYCLE,
  STATUS_ORDER,
  DEFAULT_LIFECYCLE_STAGES,
  resolveStatusLabel,
  resolveStatusShortLabel,
  resolveActiveCycle,
  DEPENDENCY_TYPE_LABEL,
  DEPENDENCY_TYPES,
} from "@/lib/status-config";

describe("status-config — STATUS_LEVEL", () => {
  it("maps all statuses to a plain step number, without the old L-prefix convention", () => {
    expect(STATUS_LEVEL.idea).toBe("1");
    expect(STATUS_LEVEL.qualified).toBe("2");
    expect(STATUS_LEVEL.validated).toBe("3");
    expect(STATUS_LEVEL.in_progress).toBe("4");
    expect(STATUS_LEVEL.delivered).toBe("5");
    expect(STATUS_LEVEL.cancelled).toBe("—");
    Object.values(STATUS_LEVEL).forEach((v) => expect(v.startsWith("L")).toBe(false));
  });
});

describe("status-config — STATUS_CYCLE", () => {
  it("does not include cancelled", () => {
    expect(STATUS_CYCLE).not.toContain("cancelled");
  });

  it("has 5 entries", () => {
    expect(STATUS_CYCLE).toHaveLength(5);
  });
});

describe("status-config — STATUS_ORDER", () => {
  it("orders from 1 to 5", () => {
    expect(STATUS_ORDER.idea).toBe(1);
    expect(STATUS_ORDER.delivered).toBe(5);
    expect(STATUS_ORDER.cancelled).toBe(0);
  });
});

describe("status-config — resolveStatusLabel", () => {
  it("uses default label without lifecycle override", () => {
    expect(resolveStatusLabel("idea")).toBe(STATUS_LABEL.idea);
    expect(resolveStatusLabel("cancelled")).toBe("Annulé");
  });

  it("uses lifecycle override verbatim when provided (no numeric prefix)", () => {
    const stages = [
      { key: "idea" as const, label: "Proposition", validationRequired: false },
      { key: "qualified" as const, label: "Analyse", validationRequired: true },
      { key: "validated" as const, label: "Approuvé", validationRequired: true },
      { key: "in_progress" as const, label: "En cours", validationRequired: false },
      { key: "delivered" as const, label: "Terminé", validationRequired: false },
    ];
    expect(resolveStatusLabel("idea", stages)).toBe("Proposition");
    expect(resolveStatusLabel("qualified", stages)).toBe("Analyse");
  });
});

describe("status-config — resolveStatusShortLabel", () => {
  it("uses default without lifecycle", () => {
    expect(resolveStatusShortLabel("validated")).toBe(STATUS_SHORT_LABEL.validated);
  });

  it("uses lifecycle override", () => {
    const stages = [{ key: "validated" as const, label: "Approuvé", validationRequired: true }];
    expect(resolveStatusShortLabel("validated", stages)).toBe("Approuvé");
  });
});

describe("status-config — resolveActiveCycle", () => {
  it("returns default cycle when no config", () => {
    expect(resolveActiveCycle()).toEqual(STATUS_CYCLE);
  });

  it("returns only configured stages", () => {
    const stages = [
      { key: "idea" as const, label: "A", validationRequired: false },
      { key: "validated" as const, label: "B", validationRequired: true },
      { key: "delivered" as const, label: "C", validationRequired: false },
    ];
    expect(resolveActiveCycle(stages)).toEqual(["idea", "validated", "delivered"]);
  });
});

describe("status-config — DEFAULT_LIFECYCLE_STAGES", () => {
  it("has 5 stages", () => {
    expect(DEFAULT_LIFECYCLE_STAGES).toHaveLength(5);
  });

  it("only validated has validationRequired", () => {
    DEFAULT_LIFECYCLE_STAGES.forEach((s) => {
      if (s.key === "validated") {
        expect(s.validationRequired).toBe(true);
      } else {
        expect(s.validationRequired).toBe(false);
      }
    });
  });
});

describe("status-config — DEPENDENCY_TYPES", () => {
  it("has 4 types", () => {
    expect(DEPENDENCY_TYPES).toHaveLength(4);
  });

  it("all have labels", () => {
    DEPENDENCY_TYPES.forEach((dt) => {
      expect(DEPENDENCY_TYPE_LABEL[dt]).toBeDefined();
    });
  });
});
