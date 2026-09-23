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

/**
 * Refonte visuelle (retour PO — « la case est trop grosse, les couleurs ne sont pas jolies, on ne
 * sait pas si c'est à risque ou sur la trajectoire ») : la charte monochrome historique
 * (`rag-green` = encre quasi noire, `rag-amber` = taupe) rendait les deux statuts quasi
 * indiscernables. Palette DÉDIÉE aux statuts d'indicateur, vert/ambre adoucis (texte ≥ 4.5:1 sur
 * son fond clair), exportée pour que TOUS les rendus de statut d'indicateur (badge, lecture
 * actuel→cible, puces de la feuille de route, légende, barre de synthèse) partagent exactement les
 * mêmes teintes. Classes Tailwind littérales (arbitraires) pour rester détectables par le JIT.
 *
 * `IndicatorRiskStatus` n'a que DEUX valeurs (`on_track` / `at_risk`) — toutes deux mappées ici.
 */
export const INDICATOR_STATUS_TONE: Record<
  IndicatorRiskStatus,
  { pill: string; dot: string; text: string; bar: string; hex: string }
> = {
  on_track: {
    pill: "border-[#bfe3cf] bg-[#ebf6ef] text-[#1e6b45]",
    dot: "bg-[#3a9d6a]",
    text: "text-[#1e6b45]",
    bar: "bg-[#3a9d6a]",
    hex: "#3a9d6a",
  },
  at_risk: {
    pill: "border-[#f1d7a2] bg-[#fdf4e2] text-[#8a5a00]",
    dot: "bg-[#e0a030]",
    text: "text-[#8a5a00]",
    bar: "bg-[#e0a030]",
    hex: "#e0a030",
  },
};

export const INDICATOR_STATUS_DEFAULT_LABEL: Record<IndicatorRiskStatus, string> = {
  on_track: "Sur la trajectoire",
  at_risk: "À risque",
};

export function IndicatorStatusBadge({
  status,
  label,
  title,
  size = "sm",
  className,
}: {
  status: IndicatorRiskStatus;
  /** Libellé traduit (`indicatorStatus.onTrack` / `indicatorStatus.atRisk`) fourni par l'appelant
   *  qui a accès à `useTranslation` — repli sur le libellé français par défaut. */
  label?: string;
  /** Infobulle native (`title` HTML), typiquement fournie par l'appelant pour l'état "à risque"
   *  (ex. `t("strategicAxes.atRiskTooltip")`). Repli sur le libellé du statut, pour que le statut
   *  reste explicite au survol même quand le badge est affiché en version compacte. */
  title?: string;
  /** `"xs"` : pastille compacte dimensionnée sur un texte de ~10px (puces d'indicateur de la
   *  feuille de route) ; `"sm"` (défaut) : badge standard des listes/tableaux. */
  size?: "xs" | "sm";
  className?: string;
}) {
  const text = label ?? INDICATOR_STATUS_DEFAULT_LABEL[status];
  return (
    <span
      title={title ?? text}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border font-semibold leading-none",
        size === "xs" ? "px-1.5 py-[3px] text-[10px]" : "px-2 py-1 text-[11px]",
        INDICATOR_STATUS_TONE[status].pill,
        className
      )}
    >
      <span
        aria-hidden
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", INDICATOR_STATUS_TONE[status].dot)}
      />
      {text}
    </span>
  );
}

/** Légende compacte des statuts d'indicateur (pastille + libellé), pour lire le code couleur d'un
 *  coup d'œil à côté d'une liste de puces d'indicateur. */
export function IndicatorStatusLegend({
  labels,
  className,
}: {
  labels?: Partial<Record<IndicatorRiskStatus, string>>;
  className?: string;
}) {
  const statuses: IndicatorRiskStatus[] = ["on_track", "at_risk"];
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {statuses.map((status) => (
        <span
          key={status}
          className="inline-flex items-center gap-1 text-[10.5px] font-medium text-secondary"
        >
          <span
            aria-hidden
            className={cn("h-2 w-2 shrink-0 rounded-full", INDICATOR_STATUS_TONE[status].dot)}
          />
          {labels?.[status] ?? INDICATOR_STATUS_DEFAULT_LABEL[status]}
        </span>
      ))}
    </span>
  );
}
