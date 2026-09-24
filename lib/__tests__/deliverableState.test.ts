import { describe, expect, it } from "vitest";
import {
  countDeliverableStates,
  deliverableLateDays,
  deliverableState,
  effectiveDueDate,
  isDeliverableDone,
  toISODay,
} from "@/lib/deliverableState";
import type { Deliverable } from "@/types";

const TODAY = "2026-09-24";

function d(overrides: Partial<Deliverable> = {}): Deliverable {
  return { id: "D1", label: "Livrable", phases: [], ...overrides };
}

describe("deliverableState", () => {
  it("done quand le statut est 'done', même échéance dépassée", () => {
    expect(deliverableState(d({ status: "done", dueDate: "2026-01-01" }), TODAY)).toBe("done");
  });

  it("late quand à faire et échéance strictement dépassée", () => {
    expect(deliverableState(d({ status: "todo", dueDate: "2026-09-23" }), TODAY)).toBe("late");
  });

  it("todo quand l'échéance est aujourd'hui ou future", () => {
    expect(deliverableState(d({ status: "todo", dueDate: TODAY }), TODAY)).toBe("todo");
    expect(deliverableState(d({ status: "todo", dueDate: "2026-12-31" }), TODAY)).toBe("todo");
  });

  it("todo sans échéance (jamais en retard)", () => {
    expect(deliverableState(d(), TODAY)).toBe("todo");
  });

  it("rétrocompat : 'in_progress' et statut absent sont lus comme à faire", () => {
    expect(isDeliverableDone(d({ status: "in_progress" }))).toBe(false);
    expect(isDeliverableDone(d())).toBe(false);
    expect(deliverableState(d({ status: "in_progress", dueDate: "2026-01-01" }), TODAY)).toBe(
      "late"
    );
    expect(deliverableState(d({ status: "in_progress", dueDate: "2027-01-01" }), TODAY)).toBe(
      "todo"
    );
  });

  it("rétrocompat : sans dueDate, l'échéance est la fin de la dernière phase (début ignoré)", () => {
    const legacy = d({
      phases: [
        { id: "p1", start: "2025-01-01", end: "2025-06-30" },
        { id: "p2", start: "2026-01-01", end: "2026-03-31" },
      ],
    });
    expect(effectiveDueDate(legacy)).toBe("2026-03-31");
    expect(deliverableState(legacy, TODAY)).toBe("late");
    // Une dueDate explicite l'emporte sur les phases.
    expect(effectiveDueDate({ ...legacy, dueDate: "2027-01-01" })).toBe("2027-01-01");
  });

  it("accepte une Date (jour local) comme référence", () => {
    expect(deliverableState(d({ dueDate: "2026-09-23" }), new Date(2026, 8, 24, 0, 30))).toBe(
      "late"
    );
    expect(toISODay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("deliverableLateDays", () => {
  it("nombre de jours de retard, 0 si pas en retard", () => {
    expect(deliverableLateDays(d({ dueDate: "2026-09-14" }), TODAY)).toBe(10);
    expect(deliverableLateDays(d({ dueDate: TODAY }), TODAY)).toBe(0);
    expect(deliverableLateDays(d({ status: "done", dueDate: "2026-09-14" }), TODAY)).toBe(0);
  });
});

describe("countDeliverableStates", () => {
  it("2 statuts + retard dérivé", () => {
    expect(
      countDeliverableStates(
        [
          d({ status: "done", dueDate: "2026-01-01" }),
          d({ status: "todo", dueDate: "2026-01-01" }),
          d({ status: "in_progress", dueDate: "2027-01-01" }),
          d(),
        ],
        TODAY
      )
    ).toEqual({ done: 1, todo: 2, late: 1, total: 4 });
  });
});
