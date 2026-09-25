import { describe, expect, it } from "vitest";
import { EMPTY_WORKSPACE, type MyWorkspace, type WorkspaceItem } from "@/lib/myWorkspaceTypes";
import {
  filterWorkspaceByPlan,
  greetingName,
  groupBySeverity,
  groupByWeek,
  presentPlans,
  summarySentence,
  weekLabel,
  weekOffset,
  workspaceCounts,
} from "@/components/workspace/workspaceView";

const t = (_key: string, fallback?: string) => fallback ?? _key;

function item(partial: Partial<WorkspaceItem> & { id: string }): WorkspaceItem {
  return {
    source: "chantierAction",
    plan: "strategic",
    severity: "info",
    title: partial.id,
    context: "",
    href: "/levers",
    ...partial,
  };
}

// Jeudi 24 septembre 2026 (semaine du lundi 21).
const TODAY = new Date(2026, 8, 24);

describe("weekOffset / groupByWeek", () => {
  it("computes calendar-week offsets (Monday-based)", () => {
    expect(weekOffset(new Date(2026, 8, 21), TODAY)).toBe(0); // lundi même semaine
    expect(weekOffset(new Date(2026, 8, 27), TODAY)).toBe(0); // dimanche même semaine
    expect(weekOffset(new Date(2026, 8, 28), TODAY)).toBe(1); // lundi suivant
    expect(weekOffset(new Date(2026, 9, 12), TODAY)).toBe(3);
    // Traverse le passage à l'heure d'hiver (25 oct. 2026) sans décalage.
    expect(weekOffset(new Date(2026, 9, 26), TODAY)).toBe(5);
  });

  it("groups upcoming items by week, chronologically, undated last", () => {
    const groups = groupByWeek(
      [
        item({ id: "c", dueDate: "2026-10-06" }),
        item({ id: "nodate" }),
        item({ id: "b", dueDate: "2026-09-29" }),
        item({ id: "a2", dueDate: "2026-09-26" }),
        item({ id: "a1", dueDate: "2026-09-25" }),
        item({ id: "past", dueDate: "2026-09-10" }),
      ],
      TODAY
    );
    expect(groups.map((g) => g.offset)).toEqual([0, 1, 2, null]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["past", "a1", "a2"]);
    expect(groups[1].items.map((i) => i.id)).toEqual(["b"]);
    expect(groups[3].items.map((i) => i.id)).toEqual(["nodate"]);
  });

  it("labels week groups", () => {
    expect(weekLabel(0, t)).toBe("Cette semaine");
    expect(weekLabel(1, t)).toBe("Semaine prochaine");
    expect(weekLabel(3, t)).toBe("Dans 3 semaines");
    expect(weekLabel(null, t)).toBe("Sans échéance");
  });
});

describe("summarySentence", () => {
  it("builds the plural sentence with late count", () => {
    expect(summarySentence({ todo: 3, late: 1, upcoming: 5, blocked: 0 }, t)).toBe(
      "3 actions à faire, dont 1 en retard · 5 échéances dans les 4 prochaines semaines"
    );
  });
  it("handles singular and zero cases", () => {
    expect(summarySentence({ todo: 1, late: 0, upcoming: 1, blocked: 0 }, t)).toBe(
      "1 action à faire · 1 échéance dans les 4 prochaines semaines"
    );
    expect(summarySentence({ todo: 0, late: 0, upcoming: 2, blocked: 0 }, t)).toBe(
      "Aucune action à faire · 2 échéances dans les 4 prochaines semaines"
    );
    expect(summarySentence({ todo: 0, late: 0, upcoming: 0, blocked: 4 }, t)).toBe(
      "Aucune action en attente ni échéance proche."
    );
  });
});

describe("plans, counts, grouping", () => {
  const ws: MyWorkspace = {
    ...EMPTY_WORKSPACE,
    todo: [
      item({ id: "t1", severity: "critical", daysLate: 4, plan: "performance" }),
      item({ id: "t2", severity: "warning" }),
      item({ id: "t3", severity: "critical" }),
    ],
    upcoming: [item({ id: "u1", dueDate: "2026-10-01" })],
    blocked: [item({ id: "b1", plan: "performance", source: "blockedValidation" })],
  };

  it("detects plans and filters every list", () => {
    expect(presentPlans(ws)).toEqual(["strategic", "performance"]);
    expect(presentPlans(EMPTY_WORKSPACE)).toEqual([]);
    const perf = filterWorkspaceByPlan(ws, "performance");
    expect(perf.todo.map((i) => i.id)).toEqual(["t1"]);
    expect(perf.upcoming).toEqual([]);
    expect(perf.blocked.map((i) => i.id)).toEqual(["b1"]);
    expect(filterWorkspaceByPlan(ws, "all")).toBe(ws);
  });

  it("counts todo / late / upcoming / blocked", () => {
    expect(workspaceCounts(ws)).toEqual({ todo: 3, late: 1, upcoming: 1, blocked: 1 });
  });

  it("groups by severity keeping engine order", () => {
    const groups = groupBySeverity(ws.todo);
    expect(groups.map((g) => g.severity)).toEqual(["critical", "warning"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["t1", "t3"]);
  });

  it("derives the greeting first name", () => {
    expect(greetingName({ firstName: "Claire", name: "Claire Martin" })).toBe("Claire");
    expect(greetingName({ firstName: "", name: "Paul Durand" })).toBe("Paul");
    expect(greetingName(null)).toBe("");
  });
});
