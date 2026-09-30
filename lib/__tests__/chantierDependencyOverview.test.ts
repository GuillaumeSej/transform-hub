import { describe, expect, it } from "vitest";
import { chantierDependencyOverview } from "@/lib/chantierDependencyOverview";
import type { Chantier, ChantierAction } from "@/types";

function makeChantier(id: string, overrides?: Partial<Chantier>): Chantier {
  return {
    id,
    companyId: "c1",
    programId: "p1",
    axisIds: ["AX001"],
    name: `Chantier ${id}`,
    stage: "defined",
    dependencies: [],
    createdAt: "2026-01-01",
    lastUpdate: "2026-01-01",
    ...overrides,
  };
}

function makeAction(
  chantierId: string,
  id: string,
  start: string,
  end: string,
  overrides?: Partial<ChantierAction>
): ChantierAction {
  return {
    id,
    companyId: "c1",
    chantierId,
    name: `Projet ${id}`,
    start,
    end,
    status: "defined",
    ...overrides,
  };
}

const TODAY = new Date(2026, 5, 15); // 15 juin 2026, heure locale
const DONE = {
  currentMilestone: "E4" as const,
  passedMilestones: ["E0", "E1", "E2", "E3", "E4"] as ("E0" | "E1" | "E2" | "E3" | "E4")[],
  checklists: {},
};

describe("chantierDependencyOverview", () => {
  it("returns an empty list when neither the chantier nor its projets have dependencies", () => {
    const ch = makeChantier("CH1");
    expect(
      chantierDependencyOverview(ch, [ch], [makeAction("CH1", "A1", "2026-01-01", "2026-02-01")], {
        today: TODAY,
      })
    ).toEqual([]);
  });

  it("lists chantier predecessors and successors with their type, flagging violated ones as late", () => {
    // CH1 dépend de CH0 (FS) ; CH2 dépend de CH1 (SS).
    const ch0 = makeChantier("CH0");
    const ch1 = makeChantier("CH1", { dependencies: [{ targetId: "CH0", type: "FS" }] });
    const ch2 = makeChantier("CH2", { dependencies: [{ targetId: "CH1", type: "SS" }] });
    const actions = [
      makeAction("CH0", "A0", "2026-01-01", "2026-03-31"), // finit APRÈS le début de CH1 → FS violé
      makeAction("CH1", "A1", "2026-03-01", "2026-06-30"),
      makeAction("CH2", "A2", "2026-03-03", "2026-07-31"), // 2 j de décalage < tolérance SS
    ];
    const rows = chantierDependencyOverview(ch1, [ch0, ch1, ch2], actions, { today: TODAY });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      scope: "chantier",
      direction: "predecessor",
      type: "FS",
      otherKind: "chantier",
      otherId: "CH0",
      otherChantierId: "CH0",
      status: "late",
      delayDays: 30,
    });
    expect(rows[1]).toMatchObject({
      scope: "chantier",
      direction: "successor",
      type: "SS",
      otherId: "CH2",
      status: "ok",
    });
    expect(rows[1].delayDays).toBeUndefined();
  });

  it("maps projet prerequisites to FS rows: done → ok, open → pending, open and overdue → late", () => {
    const ch1 = makeChantier("CH1");
    const ch2 = makeChantier("CH2");
    const actions = [
      makeAction("CH2", "DONE", "2026-01-01", "2026-02-01", { milestones: DONE }),
      makeAction("CH2", "OPEN", "2026-01-01", "2026-12-31"),
      makeAction("CH2", "LATE", "2026-01-01", "2026-03-31"),
      makeAction("CH1", "A1", "2026-01-01", "2026-12-31", {
        prerequisites: [
          { id: "p1", kind: "action", targetActionId: "DONE" },
          { id: "p2", kind: "action", targetActionId: "OPEN" },
          { id: "p3", kind: "action", targetActionId: "LATE" },
          { id: "p4", kind: "action", targetActionId: "GHOST" },
          { id: "p5", kind: "external", label: "Recrutement", done: false },
        ],
      }),
    ];
    const rows = chantierDependencyOverview(ch1, [ch1, ch2], actions, { today: TODAY });
    expect(rows.map((r) => [r.otherName, r.type, r.status])).toEqual([
      ["Projet LATE", "FS", "late"],
      ["Projet OPEN", "FS", "pending"],
      ["Recrutement", undefined, "pending"],
      ["Projet DONE", "FS", "ok"],
    ]);
    expect(rows.every((r) => r.scope === "projet" && r.direction === "predecessor")).toBe(true);
    expect(rows[0]).toMatchObject({ localId: "A1", otherId: "LATE", otherChantierId: "CH2" });
    expect(rows[2].otherKind).toBe("external");
  });

  it("uses the progress resolver to decide whether a predecessor projet is done", () => {
    const ch1 = makeChantier("CH1");
    const actions = [
      makeAction("CH1", "T", "2026-01-01", "2026-03-31"),
      makeAction("CH1", "A", "2026-04-01", "2026-12-31", {
        prerequisites: [{ id: "p1", kind: "action", targetActionId: "T" }],
      }),
    ];
    const rows = chantierDependencyOverview(ch1, [ch1], actions, {
      today: TODAY,
      progressOf: (a) => (a.id === "T" ? 100 : 0),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("ok");
  });

  it("lists projets of OTHER chantiers that wait on one of our projets as successors", () => {
    const ch1 = makeChantier("CH1");
    const ch2 = makeChantier("CH2");
    const actions = [
      makeAction("CH1", "MINE", "2026-01-01", "2026-12-31"),
      makeAction("CH2", "THEIRS", "2026-01-01", "2026-12-31", {
        prerequisites: [{ id: "p1", kind: "action", targetActionId: "MINE" }],
      }),
    ];
    const rows = chantierDependencyOverview(ch1, [ch1, ch2], actions, { today: TODAY });
    expect(rows).toEqual([
      expect.objectContaining({
        scope: "projet",
        direction: "successor",
        type: "FS",
        localId: "MINE",
        otherKind: "projet",
        otherId: "THEIRS",
        otherChantierId: "CH2",
        status: "pending",
      }),
    ]);
    // Vu depuis CH2, la même relation est un prédécesseur.
    const fromCh2 = chantierDependencyOverview(ch2, [ch1, ch2], actions, { today: TODAY });
    expect(fromCh2).toEqual([
      expect.objectContaining({ direction: "predecessor", localId: "THEIRS", otherId: "MINE" }),
    ]);
  });
});
