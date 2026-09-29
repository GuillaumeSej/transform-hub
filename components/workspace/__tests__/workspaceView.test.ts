import { describe, expect, it } from "vitest";
import { EMPTY_WORKSPACE, type MyWorkspace, type WorkspaceItem } from "@/lib/myWorkspaceTypes";
import {
  availableCategories,
  CATEGORY_ORDER,
  categoryLabel,
  effectiveCategory,
  filterTodoItems,
  filterWorkspaceByPlan,
  greetingName,
  groupTodoByCategory,
  groupByWeek,
  isOverdue,
  itemsOfCategory,
  presentPlans,
  resolvePlan,
  roundedPercents,
  summarySentence,
  visibleSections,
  weekLabel,
  weekOffset,
  workspaceBreakdown,
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
    const strat = filterWorkspaceByPlan(ws, "strategic");
    expect(strat.todo.map((i) => i.id)).toEqual(["t2", "t3"]);
    expect(strat.upcoming.map((i) => i.id)).toEqual(["u1"]);
    expect(strat.blocked).toEqual([]);
    // Portail vide (aucun plan) : inchangé.
    expect(filterWorkspaceByPlan(EMPTY_WORKSPACE, null)).toBe(EMPTY_WORKSPACE);
  });

  it("filters the perimeter too, and the counts follow the selected plan only", () => {
    const withPerimeter: MyWorkspace = {
      ...ws,
      perimeter: [
        { id: "p1", kind: "lever", plan: "performance", label: "L", role: "R", health: "red" },
        { id: "p2", kind: "axis", plan: "strategic", label: "A", role: "S", health: "amber" },
      ],
    };
    const perf = filterWorkspaceByPlan(withPerimeter, "performance");
    expect(perf.perimeter.map((p) => p.id)).toEqual(["p1"]);
    expect(workspaceCounts(perf)).toEqual({ todo: 1, late: 1, upcoming: 0, blocked: 1 });
    const strat = filterWorkspaceByPlan(withPerimeter, "strategic");
    expect(strat.perimeter.map((p) => p.id)).toEqual(["p2"]);
    expect(workspaceCounts(strat)).toEqual({ todo: 2, late: 0, upcoming: 1, blocked: 0 });
  });

  it("resolves the displayed plan: explicit choice, else active program type, else the plan with items", () => {
    const both = ["strategic", "performance"] as const;
    // Défaut = type du programme actif quand il a des éléments.
    expect(resolvePlan([...both], "performance")).toBe("performance");
    expect(resolvePlan([...both], "strategic")).toBe("strategic");
    // Choix explicite de la bascule.
    expect(resolvePlan([...both], "performance", "strategic")).toBe("strategic");
    // Programme actif sans élément : le plan qui en a.
    expect(resolvePlan(["strategic"], "performance")).toBe("strategic");
    expect(resolvePlan(["performance"], "strategic")).toBe("performance");
    // Choix devenu vide (données rechargées) : on retombe sur le défaut.
    expect(resolvePlan(["performance"], "strategic", "strategic")).toBe("performance");
    // Portail vide.
    expect(resolvePlan([], "performance")).toBeNull();
  });

  it("counts todo / late / upcoming / blocked (late = daysLate > 0 only)", () => {
    expect(workspaceCounts(ws)).toEqual({ todo: 3, late: 1, upcoming: 1, blocked: 1 });
  });

  it("groups todo by the breakdown categories (not by severity), keeping engine order", () => {
    const groups = groupTodoByCategory(ws.todo);
    expect(groups.map((g) => g.category)).toEqual(["overdue", "toHandle"]);
    expect(groups[0].items.map((i) => i.id)).toEqual(["t1"]);
    // t3 est critique mais sans échéance dépassée → « À traiter », comme dans la barre.
    expect(groups[1].items.map((i) => i.id)).toEqual(["t2", "t3"]);
  });

  it("list groups match the breakdown bar exactly (test.finance: 10 critical cost alerts)", () => {
    const finance: MyWorkspace = {
      ...EMPTY_WORKSPACE,
      todo: [
        ...Array.from({ length: 10 }, (_, i) =>
          item({ id: `cost${i}`, source: "leverAlert", severity: "critical", plan: "performance" })
        ),
        item({ id: "real", source: "realizedApproval", severity: "warning", plan: "performance" }),
      ],
    };
    const groups = groupTodoByCategory(finance.todo);
    const bar = workspaceBreakdown(finance).parts.filter(
      (p) => (p.category === "overdue" || p.category === "toHandle") && p.count > 0
    );
    expect(groups.map((g) => [g.category, g.items.length])).toEqual(
      bar.map((p) => [p.category, p.count])
    );
    expect(groups).toEqual([{ category: "toHandle", items: finance.todo }]);
  });

  it("omits empty groups; a filtered list yields a single group", () => {
    expect(groupTodoByCategory([])).toEqual([]);
    const late = filterTodoItems(ws.todo, "overdue");
    expect(groupTodoByCategory(late).map((g) => g.category)).toEqual(["overdue"]);
  });

  it("derives the greeting first name", () => {
    expect(greetingName({ firstName: "Claire", name: "Claire Martin" })).toBe("Claire");
  });
});

describe("category breakdown & filter", () => {
  const todo = [
    item({ id: "late", severity: "warning", daysLate: 3 }),
    item({ id: "crit", severity: "critical" }),
    item({ id: "warn", severity: "warning", plan: "performance" }),
    item({ id: "info", severity: "info" }),
  ];
  const pilot: MyWorkspace = {
    ...EMPTY_WORKSPACE,
    pilotView: true,
    todo,
    upcoming: [item({ id: "u1" }), item({ id: "u2", plan: "performance" })],
    blocked: [item({ id: "b1", source: "blockedValidation", plan: "performance" })],
  };
  const member: MyWorkspace = { ...pilot, pilotView: false };

  it("splits todo into disjoint overdue / toHandle", () => {
    expect(itemsOfCategory(pilot, "overdue").map((i) => i.id)).toEqual(["late"]);
    expect(itemsOfCategory(pilot, "toHandle").map((i) => i.id)).toEqual(["crit", "warn", "info"]);
    expect(filterTodoItems(todo, null)).toBe(todo);
    expect(filterTodoItems(todo, "overdue").every(isOverdue)).toBe(true);
  });

  it("pilot view: 4 disjoint parts summing to the total, percents summing to 100", () => {
    const { total, parts } = workspaceBreakdown(pilot);
    expect(parts.map((p) => [p.category, p.count])).toEqual([
      ["overdue", 1],
      ["toHandle", 3],
      ["upcoming", 2],
      ["blocked", 1],
    ]);
    expect(total).toBe(7);
    expect(parts.reduce((s, p) => s + p.count, 0)).toBe(total);
    expect(parts.reduce((s, p) => s + p.pct, 0)).toBe(100);
    const ids = CATEGORY_ORDER.flatMap((c) => itemsOfCategory(pilot, c).map((i) => i.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("non-pilot view: no blocked category, even if the list is filled", () => {
    expect(availableCategories(member)).toEqual(["overdue", "toHandle", "upcoming"]);
    const { total, parts } = workspaceBreakdown(member);
    expect(parts.map((p) => p.category)).not.toContain("blocked");
    expect(total).toBe(6);
    expect(itemsOfCategory(member, "blocked")).toEqual([]);
    expect(effectiveCategory("blocked", member)).toBeNull();
    expect(effectiveCategory("blocked", pilot)).toBe("blocked");
  });

  it("stays coherent with the plan filter and the header counts", () => {
    const perf = filterWorkspaceByPlan(pilot, "performance");
    const { total, parts } = workspaceBreakdown(perf);
    expect(parts.map((p) => p.count)).toEqual([0, 1, 1, 1]);
    expect(total).toBe(3);
    const counts = workspaceCounts(pilot);
    const byCat = Object.fromEntries(
      workspaceBreakdown(pilot).parts.map((p) => [p.category, p.count])
    );
    expect(byCat.overdue).toBe(counts.late);
    expect(byCat.overdue + byCat.toHandle).toBe(counts.todo);
  });

  it("empty workspace: total 0, all percents 0", () => {
    const { total, parts } = workspaceBreakdown(EMPTY_WORKSPACE);
    expect(total).toBe(0);
    expect(parts.every((p) => p.count === 0 && p.pct === 0)).toBe(true);
  });

  it("rounds percents with the largest remainder", () => {
    expect(roundedPercents([1, 1, 1], 3)).toEqual([34, 33, 33]);
    expect(roundedPercents([2, 1], 3)).toEqual([67, 33]);
  });

  it("shows only the matching section when a category is active", () => {
    expect(visibleSections(null, pilot)).toEqual(["todo", "blocked", "upcoming"]);
    expect(visibleSections(null, member)).toEqual(["todo", "upcoming"]);
    expect(visibleSections("overdue", pilot)).toEqual(["todo"]);
    expect(visibleSections("toHandle", member)).toEqual(["todo"]);
    expect(visibleSections("upcoming", member)).toEqual(["upcoming"]);
    expect(visibleSections("blocked", pilot)).toEqual(["blocked"]);
    expect(visibleSections("blocked", member)).toEqual(["todo", "upcoming"]);
  });

  it("labels categories", () => {
    expect(categoryLabel("overdue", t)).toBe("En retard");
    expect(categoryLabel("blocked", t)).toBe("Bloqué chez d'autres");
  });

  it("derives the greeting first name (fallbacks)", () => {
    expect(greetingName({ firstName: "Claire", name: "Claire Martin" })).toBe("Claire");
    expect(greetingName({ firstName: "", name: "Paul Durand" })).toBe("Paul");
    expect(greetingName(null)).toBe("");
  });
});
