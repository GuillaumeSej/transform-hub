"use client";

import { useTranslation } from "@/lib/i18n/useTranslation";
import { leverApprovalStepInfo } from "@/lib/leversLogic";
import type { LeverApproval, LeverApprovalLevel } from "@/types";

export function leverApprovalLevelLabel(
  level: LeverApprovalLevel,
  t: (key: string, fallback?: string) => string
): string {
  if (level === "cto") return t("levers.approval.level.cto", "CTO");
  if (level === "admin") return t("levers.approval.level.admin", "Admin");
  return t("levers.approval.level.sponsor", "Responsable de chantier");
}

/**
 * « Étape x/n — attend {name} » et, hors mode compact, le circuit complet d'une demande de
 * validation de levier à chaîne (double validation hiérarchique, voir
 * lib/leversLogic.ts::leverApprovalChain). Rien pour une demande legacy (palier unique).
 */
export function LeverApprovalSteps({
  approval,
  compact = false,
}: {
  approval: LeverApproval;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const info = leverApprovalStepInfo(approval);
  if (!info || !approval.chain) return null;
  const waiting = info.names.length
    ? info.names.join(", ")
    : leverApprovalLevelLabel(info.level, t);
  return (
    <div className="text-[11px] text-secondary">
      <div className="font-semibold">
        {t("levers.approval.step", "Étape {current}/{total} — attend {names}")
          .replace("{current}", String(info.current))
          .replace("{total}", String(info.total))
          .replace("{names}", waiting)}
      </div>
      {!compact && (
        <ol className="mt-1 flex flex-wrap items-center gap-1.5">
          {approval.chain.map((step, i) => {
            const who = step.names?.length ? step.names.join(", ") : step.usernames.join(", ");
            const done = !!step.decidedBy;
            const current = i === info.current - 1;
            return (
              <li key={`${step.level}-${i}`} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>→</span>}
                <span
                  className={
                    done
                      ? "text-rag-green-dark"
                      : current
                        ? "font-semibold text-primary"
                        : "text-tertiary"
                  }
                >
                  {leverApprovalLevelLabel(step.level, t)}
                  {who ? ` (${who})` : ""}
                  {done &&
                    ` ✓ ${step.decidedByName ?? step.decidedBy}${
                      step.byAdmin
                        ? ` — ${t("levers.approval.byAdmin", "débloqué par un admin")}`
                        : ""
                    }`}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
