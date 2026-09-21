import type { LeverImpact } from "@/types";

export type ImpactKind = "opex" | "capex" | "gain" | "fte";

export function impactKindOf(imp: LeverImpact): ImpactKind {
  if (imp.type === "fte") return "fte";
  if (imp.type === "saving") return "gain";
  return imp.nature === "capex" ? "capex" : "opex";
}

/** Patch à appliquer pour basculer une ligne vers un autre type d'impact (valeurs par défaut). */
export function impactKindPatch(kind: ImpactKind): Partial<LeverImpact> {
  const clear: Partial<LeverImpact> = {
    capexAllocationMode: undefined,
    capexStartDate: undefined,
    capexDeploymentDate: undefined,
    gainDate: undefined,
    gainRecurrence: undefined,
    fteDirection: undefined,
    fteCount: undefined,
    natureId: undefined,
  };
  switch (kind) {
    case "opex":
      return { ...clear, type: "cost", nature: "opex_rec" };
    case "capex":
      return { ...clear, type: "cost", nature: "capex", capexAllocationMode: "one_shot" };
    case "gain":
      return { ...clear, type: "saving", nature: "opex_rec", gainRecurrence: "annual" };
    case "fte":
      return { ...clear, type: "fte", nature: "opex_rec", fteDirection: "hire" };
  }
}

/** Ligne prête à enregistrer : renseignée (libellé ou montant) — les lignes vides sont écartées. */
export function cleanImpacts(impacts: LeverImpact[]): LeverImpact[] {
  return impacts.filter((i) => i.label.trim() !== "" || i.amount > 0);
}
