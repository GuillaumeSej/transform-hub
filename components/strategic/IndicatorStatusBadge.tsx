import { cn } from "@/lib/utils";
import type { IndicatorRiskStatus } from "@/types";

/**
 * Badge de statut de risque d'un indicateur. Clone du pattern de
 * `components/shared/StatusBadge.tsx` (badge RAG des leviers), sur l'échelle BINAIRE propre aux
 * indicateurs : "sur la trajectoire" / "à risque", sans les 4 niveaux de `RiskLevel`.
 *
 * Le statut passé doit être le statut EFFECTIF (`axisLogic.resolveIndicatorStatus`, surcharge
 * manuelle comprise) — ce composant n'applique aucune résolution lui-même.
 *
 * Round 6, point 2 : `title` explicatif optionnel (attribut `title` HTML natif), même esprit que
 * le `title` déjà porté par `AtRiskCountPill`/`IndicatorDeltaStat` — utile en particulier sur
 * l'état "à risque" une fois le bloc dédié "Indicateurs à risque" retiré du dashboard : l'info
 * ("pourquoi ce badge ?") doit rester lisible sur CHAQUE indicateur, pas seulement dans un bloc à
 * part. L'appelant fournit le texte traduit (ex. `strategicAxes.atRiskTooltip`) — ce composant ne
 * décide d'aucun libellé par défaut, à l'image du reste de ses props.
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
  title,
  className,
}: {
  status: IndicatorRiskStatus;
  /** Libellé traduit (`indicatorStatus.onTrack` / `indicatorStatus.atRisk`) fourni par l'appelant
   *  qui a accès à `useTranslation` — repli sur le libellé français par défaut. */
  label?: string;
  /** Infobulle native (`title` HTML), typiquement fournie par l'appelant pour l'état "à risque"
   *  (ex. `t("strategicAxes.atRiskTooltip")`) — absente pour "sur la trajectoire", qui n'a rien à
   *  expliquer. `undefined` ne rend aucun attribut `title`. */
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
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
