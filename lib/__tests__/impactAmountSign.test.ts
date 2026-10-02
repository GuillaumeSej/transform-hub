import { describe, expect, it } from "vitest";
import { formatImpactSignedAmount, impactSignedAmount } from "@/lib/impactAmountSign";
import { fmtCurr, impactNetSigned } from "@/lib/engine";
import type { LeverImpact } from "@/types";

const imp = (o: Partial<LeverImpact>) => ({ id: "i", amount: 0.4, ...o }) as LeverImpact;

describe("impactSignedAmount — colonne « Montant » de Validation = signe du net (lot 2)", () => {
  const hire = imp({ type: "fte", fteDirection: "hire", fteCount: 2 });

  it("avant : un recrutement ETP s'affichait sans « − » alors qu'il est déduit du net", () => {
    // Ancienne colonne : « − » pour les seuls `type === "cost"`.
    const oldLabel = `${hire.type === "cost" ? "−" : ""}${fmtCurr(hire.amount)}`;
    expect(oldLabel.startsWith("−")).toBe(false);
    expect(impactNetSigned(hire)).toBe(-0.4);
  });

  it("après : même signe que le net pour toutes les lignes qui y entrent", () => {
    const lines = [
      hire,
      imp({ type: "fte", fteDirection: "departure" }),
      imp({ type: "saving" }),
      imp({ type: "cost", nature: "opex_rec" }),
    ];
    for (const line of lines) expect(impactSignedAmount(line)).toBe(impactNetSigned(line));
    expect(formatImpactSignedAmount(hire)).toBe(`−${fmtCurr(0.4)}`);
  });

  it("coûts hors net (CAPEX, OPEX ponctuel) : toujours affichés en déduction", () => {
    expect(impactSignedAmount(imp({ type: "cost", nature: "capex" }))).toBe(-0.4);
    expect(impactSignedAmount(imp({ type: "cost", nature: "oneoff" }))).toBe(-0.4);
    expect(formatImpactSignedAmount(imp({ type: "saving" }))).toBe(fmtCurr(0.4));
  });
});
