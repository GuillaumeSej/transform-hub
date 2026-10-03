import { describe, expect, it } from "vitest";
import {
  auditTimestamp,
  compareAuditTsDesc,
  formatAuditTimestamp,
  parseAuditTimestamp,
} from "@/lib/auditFormat";
import { makeAuditEntry } from "@/lib/strategicAuditLogic";

/**
 * Horodatage du journal d'audit (lot 5) : écrit en ISO UTC avec « Z », relu dans le fuseau du
 * navigateur ; les anciennes entrées « AAAA-MM-JJ HH:MM » (UTC sans fuseau) sont relues en UTC —
 * avant, `new Date("2026-10-03 14:05")` les lisait comme heure LOCALE (décalage d'1 à 2 h à
 * Paris). À lancer aussi en Europe/Paris (PowerShell : `$env:TZ='Europe/Paris'`).
 */
describe(`horodatage d'audit (fuseau ${process.env.TZ ?? "(système)"})`, () => {
  it("nouvelles entrées : ISO 8601 UTC avec « Z »", () => {
    expect(auditTimestamp(new Date(Date.UTC(2026, 9, 3, 14, 5)))).toBe("2026-10-03T14:05:00.000Z");
    const entry = makeAuditEntry({
      user: "admin",
      action: "updated",
      entity: "axe",
      field: "name",
      old: "a",
      new: "b",
    } as Parameters<typeof makeAuditEntry>[0]);
    expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("anciennes entrées sans fuseau relues en UTC, nouvelles relues telles quelles", () => {
    const instant = Date.UTC(2026, 9, 3, 14, 5);
    expect(parseAuditTimestamp("2026-10-03 14:05")?.getTime()).toBe(instant);
    expect(parseAuditTimestamp("2026-10-03T14:05:00.000Z")?.getTime()).toBe(instant);
    expect(parseAuditTimestamp("n'importe quoi")).toBeNull();
    expect(parseAuditTimestamp("")).toBeNull();
  });

  it("affichage : même heure locale pour l'ancien et le nouveau format", () => {
    const legacy = formatAuditTimestamp("2026-10-03 14:05", "fr-FR");
    const iso = formatAuditTimestamp("2026-10-03T14:05:00.000Z", "fr-FR");
    expect(legacy).toBe(iso);
    const expected = new Date(Date.UTC(2026, 9, 3, 14, 5)).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(iso).toBe(expected);
    if (process.env.TZ === "Europe/Paris") expect(iso).toBe("03/10/2026 16:05");
    expect(formatAuditTimestamp("illisible", "fr-FR")).toBe("illisible");
  });

  it("tri antichronologique sur les deux formats mélangés", () => {
    const entries = [
      { ts: "2026-10-03 14:05" },
      { ts: "2026-10-03T15:00:00.000Z" },
      { ts: "2026-10-02T23:59:00.000Z" },
      { ts: "2026-10-03 14:30" },
    ];
    expect([...entries].sort(compareAuditTsDesc).map((e) => e.ts)).toEqual([
      "2026-10-03T15:00:00.000Z",
      "2026-10-03 14:30",
      "2026-10-03 14:05",
      "2026-10-02T23:59:00.000Z",
    ]);
  });
});
