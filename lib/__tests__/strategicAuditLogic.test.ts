import { describe, it, expect } from "vitest";
import {
  buildUpdateAuditEntries,
  makeAuditEntry,
  makeCreatedAuditEntry,
  makeDeletedAuditEntry,
} from "@/lib/strategicAuditLogic";

describe("strategicAuditLogic — makeAuditEntry", () => {
  it("stamps a ts field and keeps the rest of the entry untouched", () => {
    const entry = makeAuditEntry({
      user: "alice",
      action: "updated",
      entity: "CH-abc123",
      field: "name",
      old: "before",
      new: "after",
    });
    expect(entry.ts).toBeTruthy();
    expect(entry.user).toBe("alice");
    expect(entry.action).toBe("updated");
    expect(entry.entity).toBe("CH-abc123");
    expect(entry.field).toBe("name");
    expect(entry.old).toBe("before");
    expect(entry.new).toBe("after");
  });
});

describe("strategicAuditLogic — makeCreatedAuditEntry", () => {
  it("produces a single 'created' entry with old='' and new=name", () => {
    const entry = makeCreatedAuditEntry("alice", "AX-abc123", "axe", "Axe Digital");
    expect(entry.action).toBe("created");
    expect(entry.entity).toBe("AX-abc123");
    expect(entry.field).toBe("axe");
    expect(entry.old).toBe("");
    expect(entry.new).toBe("Axe Digital");
    expect(entry.user).toBe("alice");
  });
});

describe("strategicAuditLogic — makeDeletedAuditEntry", () => {
  it("produces a single 'deleted' entry with old=name and new='supprimé'", () => {
    const entry = makeDeletedAuditEntry("alice", "CH-abc123", "chantier", "Chantier Cloud");
    expect(entry.action).toBe("deleted");
    expect(entry.entity).toBe("CH-abc123");
    expect(entry.field).toBe("chantier");
    expect(entry.old).toBe("Chantier Cloud");
    expect(entry.new).toBe("supprimé");
  });
});

describe("strategicAuditLogic — buildUpdateAuditEntries", () => {
  type Fixture = {
    id: string;
    name: string;
    stage: string;
    axisIds: string[];
    lastUpdate: string;
  };

  const before: Fixture = {
    id: "CH-1",
    name: "Chantier A",
    stage: "planned",
    axisIds: ["AX-1"],
    lastUpdate: "2026-01-01",
  };

  it("emits one entry per changed field present in the patch", () => {
    const patch: Partial<Fixture> = { name: "Chantier B", stage: "in_progress" };
    const after: Fixture = { ...before, ...patch, lastUpdate: "2026-02-01" };
    const entries = buildUpdateAuditEntries("bob", before.id, patch, before, after);
    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.action === "updated" && e.entity === "CH-1")).toBe(true);
    const byField = Object.fromEntries(entries.map((e) => [e.field, e]));
    expect(byField.name.old).toBe("Chantier A");
    expect(byField.name.new).toBe("Chantier B");
    expect(byField.stage.old).toBe("planned");
    expect(byField.stage.new).toBe("in_progress");
  });

  it("ignores fields injected outside the caller's patch (e.g. lastUpdate)", () => {
    const patch: Partial<Fixture> = { name: "Chantier B" };
    const after: Fixture = { ...before, ...patch, lastUpdate: "2026-02-01" };
    const entries = buildUpdateAuditEntries("bob", before.id, patch, before, after);
    expect(entries).toHaveLength(1);
    expect(entries[0].field).toBe("name");
  });

  it("skips a patched field whose value did not actually change", () => {
    const patch: Partial<Fixture> = { name: "Chantier A" };
    const after: Fixture = { ...before, ...patch };
    const entries = buildUpdateAuditEntries("bob", before.id, patch, before, after);
    expect(entries).toHaveLength(0);
  });

  it("diffs array fields by value (JSON.stringify comparison), not by reference", () => {
    const patch: Partial<Fixture> = { axisIds: ["AX-1", "AX-2"] };
    const after: Fixture = { ...before, ...patch };
    const entries = buildUpdateAuditEntries("bob", before.id, patch, before, after);
    expect(entries).toHaveLength(1);
    expect(entries[0].field).toBe("axisIds");
    // `old`/`new` are stringified via `String(...)` (not `JSON.stringify`) — same convention as
    // `workforceLogic.updateMovement`.
    expect(entries[0].old).toBe(String(before.axisIds));
    expect(entries[0].new).toBe(String(after.axisIds));

    // A same-VALUE array passed as a new reference is not treated as a change (JSON.stringify
    // comparison, not `!==` on the reference).
    const samePatch: Partial<Fixture> = { axisIds: ["AX-1"] };
    const sameAfter: Fixture = { ...before, axisIds: ["AX-1"] };
    expect(buildUpdateAuditEntries("bob", before.id, samePatch, before, sameAfter)).toHaveLength(0);
  });
});
