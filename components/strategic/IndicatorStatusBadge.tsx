import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { IndicatorReadingState } from "@/lib/axisLogic";

/**
 * Badge de statut d'un indicateur. Clone du pattern de `components/shared/StatusBadge.tsx` (badge
 * RAG des leviers), sur l'échelle À TROIS ÉTATS propre aux indicateurs : "sur la trajectoire" /
 * "à risque" / "sans donnée".
 *
 * Le statut passé doit être le statut AFFICHÉ (`axisLogic.resolveIndicatorStatus(indicator,
 * measurements)`, état LIVE — audit fix #2) — ce composant n'applique aucune résolution lui-même.
 * Jamais le champ stocké `Indicator.status` (binaire, « rien à comparer » y vaut `on_track`).
 *
 * Round 6, point 2 : `title` explicatif optionnel (attribut `title` HTML natif), même esprit que
 * le `title` déjà porté par `AtRiskCountPill`/`IndicatorDeltaStat` — utile en particulier sur
 * l'état "à risque" une fois le bloc dédié "Indicateurs à risque" retiré du dashboard : l'info
 * ("pourquoi ce badge ?") doit rester lisible sur CHAQUE indicateur, pas seulement dans un bloc à
 * part. L'appelant fournit le texte traduit (ex. `strategicAxes.atRiskTooltip`) — ce composant ne
 * décide d'aucun libellé par défaut, à l'image du reste de ses props.
 */

/** Statut d'indicateur affichable — alias de l'état de lecture live (`indicatorReadingState`). */
export type IndicatorDisplayStatus = IndicatorReadingState;

/**
 * Palette des statuts d'indicateur — CHARTE BEARINGPOINT UNIQUEMENT (la marque interdit
 * vert/orange/bleu, voir `app/globals.css` : le token « green » `--green` y vaut l'encre #1a1a1a).
 *  - `on_track` : token `rag-green` (encre) PARTOUT — pastille pleine ronde, liséré, segment de
 *    barre et pilule sont tous dérivés du MÊME token (audit fix #2 : le liséré gauche des puces
 *    d'axe était un hex en dur, désormais `rgb(var(--green-rgb))` comme la pastille) ;
 *  - `at_risk`  : BearingPoint Red (`rag-red` = #ff3c47), icône TRIANGLE d'alerte, pilule rose
 *    pâle (`rag-red-light`) au texte rouge brique (`bp-red-brick`, ≥ 4.5:1 sur ce fond) ;
 *  - `no_data`  : gris neutre (`neutral-300`), pastille CREUSE, pilule en pointillés — un
 *    indicateur sans lecture comparable n'est ni dans les clous ni en retard.
 * Le statut est porté par la FORME (rond plein / triangle / rond creux) + le libellé + la couleur,
 * jamais par la couleur seule.
 *
 * Exportée pour que TOUS les rendus de statut d'indicateur (badge, lecture actuel→cible, puces de
 * la feuille de route, légende, synthèse de la page KPI) partagent exactement les mêmes teintes.
 * `color` (valeur CSS) sert aux attributs `style` (liséré gauche des puces) où une classe ne suffit
 * pas.
 */
export const INDICATOR_STATUS_TONE: Record<
  IndicatorDisplayStatus,
  { pill: string; dot: string; text: string; bar: string; color: string }
> = {
  on_track: {
    pill: "border-rag-green/25 bg-rag-green-light text-rag-green-dark",
    dot: "bg-rag-green",
    text: "text-rag-green-dark",
    bar: "bg-rag-green",
    color: "rgb(var(--green-rgb))",
  },
  at_risk: {
    pill: "border-bp-light-pink bg-rag-red-light text-bp-red-brick",
    dot: "bg-rag-red",
    text: "text-bp-red-brick",
    bar: "bg-rag-red",
    color: "rgb(var(--red-rgb))",
  },
  no_data: {
    pill: "border-dashed border-neutral-300 bg-white text-tertiary",
    dot: "border-[1.5px] border-neutral-400 bg-transparent",
    text: "text-tertiary",
    bar: "bg-neutral-300",
    color: "rgb(var(--n-300-rgb))",
  },
};

/**
 * Marqueur de statut seul (sans libellé) : rond plein encre pour `on_track`, triangle d'alerte
 * BearingPoint Red pour `at_risk`, rond creux gris pour `no_data`. Forme ET couleur diffèrent →
 * lisible même en niveaux de gris. `size` = diamètre du rond en px ; le triangle est légèrement
 * plus grand pour un poids visuel égal.
 */
export function IndicatorStatusMark({
  status,
  size = 8,
  className,
}: {
  status: IndicatorDisplayStatus;
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
      className={cn("shrink-0 rounded-full", INDICATOR_STATUS_TONE[status].dot, className)}
      style={{ width: size, height: size }}
    />
  );
}

export const INDICATOR_STATUS_DEFAULT_LABEL: Record<IndicatorDisplayStatus, string> = {
  on_track: "Sur la trajectoire",
  at_risk: "À risque",
  no_data: "Sans donnée",
};

/** Clé i18n du libellé par défaut de chaque statut (repli quand l'appelant ne fournit rien). */
export const INDICATOR_STATUS_LABEL_KEY: Record<IndicatorDisplayStatus, string> = {
  on_track: "indicatorStatus.onTrack",
  at_risk: "indicatorStatus.atRisk",
  no_data: "indicatorStatus.noData",
};

/** Ordre d'affichage canonique des trois états (légendes, barres, filtres). */
export const INDICATOR_DISPLAY_STATUSES: readonly IndicatorDisplayStatus[] = [
  "on_track",
  "at_risk",
  "no_data",
];

export function IndicatorStatusBadge({
  status,
  label,
  title,
  size = "sm",
  className,
}: {
  status: IndicatorDisplayStatus;
  /** Libellé traduit fourni par l'appelant — repli sur la clé `indicatorStatus.*` du statut. */
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
  const { t } = useTranslation();
  const text =
    label ?? t(INDICATOR_STATUS_LABEL_KEY[status], INDICATOR_STATUS_DEFAULT_LABEL[status]);
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

/** Légende compacte des statuts d'indicateur (marqueur + libellé), pour lire le code couleur d'un
 *  coup d'œil à côté d'une liste de puces d'indicateur. Trois états par défaut. */
export function IndicatorStatusLegend({
  labels,
  statuses = INDICATOR_DISPLAY_STATUSES,
  className,
}: {
  labels?: Partial<Record<IndicatorDisplayStatus, string>>;
  statuses?: readonly IndicatorDisplayStatus[];
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {statuses.map((status) => (
        <span
          key={status}
          className="inline-flex items-center gap-1 text-[10.5px] font-medium text-secondary"
        >
          <IndicatorStatusMark status={status} size={8} />
          {labels?.[status] ??
            t(INDICATOR_STATUS_LABEL_KEY[status], INDICATOR_STATUS_DEFAULT_LABEL[status])}
        </span>
      ))}
    </span>
  );
}
