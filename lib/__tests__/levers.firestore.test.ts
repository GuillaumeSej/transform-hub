import { describe, it, expect } from "vitest";
import { byCompany, filterAuditByCompany } from "@/lib/firestore/levers";
import type { AuditEntry, Lever } from "@/types";

/**
 * Verrouille le comportement multi-tenant de lib/firestore/levers.ts : une entreprise fraîchement
 * créée (ou toute entreprise scopée) ne doit voir NI les leviers, NI les entrées d'audit d'une
 * autre entreprise, ni les leviers/entrées orphelins (companyId null/undefined) — voir le
 * commentaire de `byCompany` pour le contexte (ancien leak-through volontairement supprimé).
 */

function lever(id: string, companyId?: string | null): Lever {
  return {
    id,
    code: id,
    type: "Sourcing",
    name: id,
    ws: "WS-01",
    owner: "Owner",
    ownerInit: "OW",
    sponsor: "Sponsor",
    sponsorInit: "SP",
    geography: "Europe",
    country: "France",
    entity: "Entity A",
    function: "Supply Chain",
    costCenter: "CC01",
    pnlMap: "PNL01",
    start: "2026-01-01",
    end: "2026-12-31",
    status: "idea",
    risk: "low",
    progress: 0,
    savingsTarget: 0,
    savingsActual: 0,
    dependencies: [],
    companyId: companyId ?? undefined,
  } as unknown as Lever;
}

function auditEntry(entity: string): AuditEntry {
  return {
    ts: "2026-01-01T00:00:00.000Z",
    user: "u",
    action: "created",
    entity,
    field: "lever",
    old: "",
    new: "x",
  } as AuditEntry;
}

describe("byCompany", () => {
  const levers = [lever("L001", "c1"), lever("L002", "c2"), lever("L003", undefined)];

  it("admin global (companyId null/undefined) voit tout, y compris les orphelins", () => {
    expect(byCompany(levers, null).map((l) => l.id)).toEqual(["L001", "L002", "L003"]);
    expect(byCompany(levers, undefined).map((l) => l.id)).toEqual(["L001", "L002", "L003"]);
  });

  it("une entreprise existante (c1) ne voit que ses propres leviers", () => {
    expect(byCompany(levers, "c1").map((l) => l.id)).toEqual(["L001"]);
  });

  it("une entreprise fraîchement créée (aucun levier taggué) ne voit AUCUN levier, y compris les orphelins", () => {
    expect(byCompany(levers, "c-nouvelle-entreprise")).toEqual([]);
  });
});

describe("filterAuditByCompany", () => {
  const levers = [lever("L001", "c1"), lever("L002", "c2"), lever("L003", undefined)];
  const audit: AuditEntry[] = [
    auditEntry("L001"),
    auditEntry("L002"),
    auditEntry("L003"),
    auditEntry("MV001"), // mouvement RH — entité non-levier, pas encore multi-tenant
  ];

  it("super-admin (companyId null) ne filtre rien", () => {
    expect(filterAuditByCompany(audit, levers, null)).toHaveLength(4);
  });

  it("une entreprise existante (c1) ne voit que l'audit de ses propres leviers + les entités hors-levier", () => {
    const scoped = filterAuditByCompany(audit, levers, "c1");
    expect(scoped.map((e) => e.entity)).toEqual(["L001", "MV001"]);
  });

  it("une entreprise fraîchement créée ne voit aucun historique de levier (ni les orphelins), seulement les entités hors-levier", () => {
    const scoped = filterAuditByCompany(audit, levers, "c-nouvelle-entreprise");
    expect(scoped.map((e) => e.entity)).toEqual(["MV001"]);
  });
});
