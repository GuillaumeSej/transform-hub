import { describe, it, expect } from "vitest";
import { leverImpactTotals } from "@/lib/engine";
import { financialImpactsWithFte, impactFteContribution } from "@/lib/fteImpactLines";
import type { LeverImpact } from "@/types";

const impacts = [
  { id: "a", label: "Gain transport", type: "saving", amount: 1.42 },
  { id: "b", label: "Réduction 1 ETP", type: "saving", amount: 0.06, fteCount: -1 },
  { id: "c", label: "Pilotage", type: "cost", nature: "opex_rec", amount: 0.02 },
  { id: "d", label: "Recrutement", type: "fte", fteDirection: "hire", fteCount: 2, amount: 0.2 },
  { id: "e", label: "Départ", type: "fte", fteDirection: "departure", fteCount: 1, amount: 0.1 },
] as LeverImpact[];

describe("fteImpactLines — tableau « Impact RH » = même source que les tuiles", () => {
  it("liste les lignes financières portant un fteCount (et elles seules)", () => {
    expect(financialImpactsWithFte(impacts).map((i) => i.id)).toEqual(["b"]);
  });
  it("Σ contributions (lignes ETP + lignes financières liées) = fteNet des tuiles", () => {
    const rhRows = [
      ...impacts.filter((i) => i.type === "fte"),
      ...financialImpactsWithFte(impacts),
    ];
    const sum = rhRows.reduce((s, i) => s + impactFteContribution(i), 0);
    expect(sum).toBe(leverImpactTotals(impacts).fteNet);
    expect(sum).toBe(0); // +2 − 1 − 1
  });
  it("cas PROC-005 : seule une ligne de gain porte −1 ETP → le tableau RH n'est pas vide", () => {
    const only = impacts.filter((i) => i.id !== "d" && i.id !== "e");
    expect(leverImpactTotals(only).fteNet).toBe(-1);
    expect(financialImpactsWithFte(only)).toHaveLength(1);
    expect(impactFteContribution(financialImpactsWithFte(only)[0])).toBe(-1);
  });
});
