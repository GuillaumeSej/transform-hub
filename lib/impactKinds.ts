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

/** Type d'impact fusionné (type + mode) pour l'éditeur en tableau. */
export type ImpactTypeKey =
  "fte" | "opex_rec" | "opex_oneoff" | "capex" | "gain_rec" | "gain_oneoff";

export function impactTypeOf(imp: LeverImpact): ImpactTypeKey {
  if (imp.type === "fte") return "fte";
  if (imp.type === "saving") return imp.gainRecurrence === "oneoff" ? "gain_oneoff" : "gain_rec";
  if (imp.nature === "capex") return "capex";
  return imp.nature === "oneoff" ? "opex_oneoff" : "opex_rec";
}

/** Date de début / fin d'un impact selon le champ de stockage qui dépend du type. */
export function impactDatesOf(imp: LeverImpact): { start?: string; end?: string } {
  const key = impactTypeOf(imp);
  if (key === "gain_rec" || key === "gain_oneoff") return { start: imp.gainDate, end: imp.endDate };
  if (key === "fte" && imp.fteDirection === "departure")
    return { start: imp.gainDate, end: imp.endDate };
  if (key === "capex" && imp.capexAllocationMode === "smoothed")
    return { start: imp.capexStartDate, end: imp.capexDeploymentDate };
  return { start: imp.capexDeploymentDate ?? imp.capexStartDate, end: imp.endDate };
}

/** Patch pour fixer la date de début (`start`) et/ou de fin (`end`) — `undefined` = inchangé. */
export function impactDatesPatch(
  imp: LeverImpact,
  dates: { start?: string | null; end?: string | null }
): Partial<LeverImpact> {
  const key = impactTypeOf(imp);
  const patch: Partial<LeverImpact> = {};
  const has = (v: string | null | undefined) => v !== undefined;
  const val = (v: string | null | undefined) => v || undefined;
  if (
    key === "gain_rec" ||
    key === "gain_oneoff" ||
    (key === "fte" && imp.fteDirection === "departure")
  ) {
    if (has(dates.start)) patch.gainDate = val(dates.start);
    if (has(dates.end)) patch.endDate = val(dates.end);
  } else if (key === "capex" && imp.capexAllocationMode === "smoothed") {
    if (has(dates.start)) patch.capexStartDate = val(dates.start);
    if (has(dates.end)) patch.capexDeploymentDate = val(dates.end);
  } else {
    if (has(dates.start)) {
      patch.capexDeploymentDate = val(dates.start);
      patch.capexStartDate = undefined;
    }
    if (has(dates.end)) patch.endDate = val(dates.end);
  }
  return patch;
}

/** Patch pour basculer vers un type fusionné, en conservant la date de début. */
export function impactTypePatch(imp: LeverImpact, key: ImpactTypeKey): Partial<LeverImpact> {
  const { start } = impactDatesOf(imp);
  let patch: Partial<LeverImpact>;
  switch (key) {
    case "fte":
      patch = impactKindPatch("fte");
      break;
    case "opex_rec":
      patch = impactKindPatch("opex");
      break;
    case "opex_oneoff":
      patch = { ...impactKindPatch("opex"), nature: "oneoff" };
      break;
    case "capex":
      patch = impactKindPatch("capex");
      break;
    case "gain_rec":
      patch = impactKindPatch("gain");
      break;
    case "gain_oneoff":
      patch = { ...impactKindPatch("gain"), gainRecurrence: "oneoff" };
      break;
  }
  const next = { ...imp, ...patch, endDate: undefined } as LeverImpact;
  return { ...patch, endDate: undefined, ...impactDatesPatch(next, { start: start ?? null }) };
}

/** Champs obligatoires manquants d'un impact financier : nature et maille financière. */
export function missingImpactFields(imp: LeverImpact): ("nature" | "hierarchy")[] {
  if (imp.type === "fte") return [];
  const out: ("nature" | "hierarchy")[] = [];
  if (!imp.natureId) out.push("nature");
  if (!imp.hierarchyLeafId && !imp.costCenter) out.push("hierarchy");
  return out;
}
