import { cn } from "@/lib/utils";
import type { IndicatorRiskStatus } from "@/types";

/**
 * Badge de statut de risque d'un indicateur. Clone du pattern de
 * `components/shared/StatusBadge.tsx` (badge RAG des leviers), sur l'échelle BINAIRE propre aux
 * indicateurs : "sur la trajectoire" / "à risque", sans les 4 niveaux de `RiskLevel`.
 *
 * Le statut passé doit être le statut EFFECTIF (`axisLogic.resolveIndicatorStatus`, surcharge
 * manuelle comprise) — ce composant n'applique aucune résolution lui-même.
 */

const STYLES: Record<IndicatorRiskStatus, string> = {
  on_track: "bg-rag-green-light text-rag-green-dark",
  at_risk: "bg-rag-amber-light text-rag-amber",
};

const DOT: Record<IndicatorRiskStatus, string> = {
  on_track: "bg-rag-green",
  at_risk: "bg-rag-amber",
};

const DEFAULT_LABEL: Record<IndicatorRiskStatus, string> = {
  on_track: "Sur la trajectoire",
  at_risk: "À risque",
};

export function IndicatorStatusBadge({
  status,
  label,
  className,
}: {
  status: IndicatorRiskStatus;
  /** Libellé traduit (`indicatorStatus.onTrack` / `indicatorStatus.atRisk`) fourni par l'appelant
   *  qui a accès à `useTranslation` — repli sur le libellé français par défaut. */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        STYLES[status],
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[status])} />
      {label ?? DEFAULT_LABEL[status]}
    </span>
  );
}
