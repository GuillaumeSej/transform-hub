import { TriangleAlert } from "lucide-react";
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
 * Palette des statuts d'indicateur — CHARTE BEARINGPOINT UNIQUEMENT (retour PO : le vert/orange
 * introduit par la refonte précédente est hors charte, la marque interdit vert/orange/bleu, voir
 * `app/globals.css`). Même convention que le reste du Plan Stratégique pour une échelle binaire :
 * les deux extrêmes de l'échelle RAG de marque (`ProgressBar`, ancien bandeau héros round 10) —
 *  - `on_track` : encre (`rag-green` = #1a1a1a), pastille PLEINE ronde, pilule neutre grise ;
 *  - `at_risk`  : BearingPoint Red (`rag-red` = #ff3c47), icône TRIANGLE d'alerte, pilule rose
 *    pâle (`rag-red-light`) au texte rouge brique (`bp-red-brick`, ≥ 4.5:1 sur ce fond — le corail
 *    pur est trop clair pour un texte de 10-11px).
 * Le statut est donc porté par la FORME (rond plein vs triangle) + le libellé + la couleur, jamais
 * par la couleur seule. Le taupe (`rag-amber`) est volontairement écarté : trop proche de l'encre,
 * c'était précisément la confusion d'origine du PO.
 *
 * Exportée pour que TOUS les rendus de statut d'indicateur (badge, lecture actuel→cible, puces de
 * la feuille de route, légende, synthèse de la page KPI) partagent exactement les mêmes teintes.
 * `hex` sert aux attributs `style` (liséré gauche des puces) où une classe ne suffit pas.
 */
export const INDICATOR_STATUS_TONE: Record<
  IndicatorRiskStatus,
  { pill: string; dot: string; text: string; bar: string; hex: string }
> = {
  on_track: {
    pill: "border-neutral-200 bg-neutral-100 text-primary",
    dot: "bg-rag-green",
    text: "text-primary",
    bar: "bg-rag-green",
    hex: "#1a1a1a",
  },
  at_risk: {
    pill: "border-bp-light-pink bg-rag-red-light text-bp-red-brick",
    dot: "bg-rag-red",
    text: "text-bp-red-brick",
    bar: "bg-rag-red",
    hex: "#ff3c47",
  },
};

/**
 * Marqueur de statut seul (sans libellé) : rond plein encre pour `on_track`, triangle d'alerte
 * BearingPoint Red pour `at_risk`. Forme ET couleur diffèrent → lisible même en niveaux de gris.
 * `size` = diamètre du rond en px ; le triangle est légèrement plus grand pour un poids visuel égal.
 */
export function IndicatorStatusMark({
  status,
  size = 8,
  className,
}: {
  status: IndicatorRiskStatus;
  size?: number;
  className?: string;
}) {
  if (status === "at_risk") {
    return (
      <TriangleAlert
        aria-hidden
        size={Math.round(size * 1.5)}
        strokeWidth={2.5}
        className={cn("shrink-0 text-rag-red", className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-full", INDICATOR_STATUS_TONE.on_track.dot, className)}
      style={{ width: size, height: size }}
    />
  );
}

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
      <IndicatorStatusMark status={status} size={size === "xs" ? 6 : 7} />
      {text}
    </span>
  );
}

/** Légende compacte des statuts d'indicateur (marqueur rond/triangle + libellé), pour lire le code couleur d'un
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
          <IndicatorStatusMark status={status} size={8} />
          {labels?.[status] ?? INDICATOR_STATUS_DEFAULT_LABEL[status]}
        </span>
      ))}
    </span>
  );
}
