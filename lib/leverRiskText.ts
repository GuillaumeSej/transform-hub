import type { LeverRiskAssessment } from "@/lib/engine";
import { formatCompactCurrency, formatNumber } from "@/lib/format";
import type { RiskLevel } from "@/types";

/** Signature de `t` (useTranslation) — passée en argument pour garder ce module pur (sans hook). */
type Translate = (key: string, fallback?: string) => string;

const LEVEL_FALLBACK: Record<RiskLevel, string> = {
  critical: "critique",
  high: "élevé",
  medium: "moyen",
  low: "faible",
};

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);
}

/** Motif du niveau de risque d'un levier (`engine.computeLeverRisk`) dans la langue active, montants
 *  au format compact de la devise du programme. */
export function leverRiskReasonText(t: Translate, assessment: LeverRiskAssessment): string {
  const r = assessment.reasonI18n;
  if (r.kind === "none")
    return t("risk.reason.none", "Aucun critère de risque dépassé : niveau faible.");
  const level = t(`risk.level.${r.level}`, LEVEL_FALLBACK[r.level]);
  if (r.kind === "delay") {
    return fill(
      t(
        "risk.reason.delay",
        "Retard : la plus ancienne alerte ouverte date de {days} jours (seuil {level} : {threshold} jours)."
      ),
      { days: formatNumber(r.days), level, threshold: formatNumber(r.thresholdDays) }
    );
  }
  const amt = (v: number) => formatCompactCurrency(v, { maximumFractionDigits: 0 });
  return fill(
    t(
      "risk.reason.amount",
      "Montant à risque : {amount} d'alertes ouvertes (seuil {level} : {threshold})."
    ),
    { amount: amt(r.amount), level, threshold: amt(r.thresholdAmount) }
  );
}
