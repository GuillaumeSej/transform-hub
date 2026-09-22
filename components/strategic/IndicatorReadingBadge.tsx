import type { IndicatorRiskStatus } from "@/types";

/**
 * Round 30 : mini visuel "valeur actuelle → cible" d'un indicateur, affiché à l'intérieur de la
 * puce d'axe de la feuille de route (`StrategicDashboardView.renderAxisRoadmapHeader`, ~ligne 751).
 *
 * Remplace le suffixe texte plat `"78 / 75 %"` de l'ancien `formatIndicatorReading` (round 29) —
 * retour utilisateur (voix, traduit) : « on ne sait pas quel chiffre est la valeur actuelle et
 * lequel est la cible, ni si l'écart est bon ou mauvais ». Deux ajouts MINIMAUX, sur une seule
 * ligne compacte (la puce reste dans une liste qui wrap, `max-w-[260px]`, plusieurs par axe) :
 *  - des libellés explicites au-dessus de chaque nombre plutôt qu'une convention implicite type
 *    "62 / 75" (quel chiffre est lequel ?) — pas de nouveau texte : mêmes clés que
 *    `SuccessKpiList`/`ChantierDetailPanel` (`strategicChantierDetail.successKpis.current/target`) ;
 *  - un point de couleur keyé sur le statut EFFECTIF de l'indicateur (`resolveIndicatorStatus`,
 *    surcharge manuelle comprise — même source de vérité que `IndicatorStatusBadge` et
 *    `StrategicAxesView.tsx`), avec EXACTEMENT les mêmes tokens (`bg-rag-green`/`bg-rag-amber`,
 *    `text-rag-green-dark`/`text-rag-amber`) plutôt qu'une logique de couleur maison.
 *
 * Composant pur, sans calcul métier : `current`/`target`/`unit` viennent de `readKpi` côté
 * appelant (jamais de valeur fabriquée ici — l'appelant n'affiche ce composant QUE quand `current`
 * ET `target` sont tous deux connus), `status` de `resolveIndicatorStatus(indicator)`.
 */
export function IndicatorReadingBadge({
  current,
  target,
  unit,
  status,
  currentLabel,
  targetLabel,
  className,
}: {
  current: number;
  target: number;
  unit?: string;
  status: IndicatorRiskStatus;
  /** Libellés traduits fournis par l'appelant (qui a accès à `useTranslation`) — ce composant ne
   *  décide d'aucun texte par défaut, à l'image de `IndicatorStatusBadge`. */
  currentLabel: string;
  targetLabel: string;
  className?: string;
}) {
  const dotColor = status === "at_risk" ? "bg-rag-amber" : "bg-rag-green";
  const currentColor = status === "at_risk" ? "text-rag-amber" : "text-rag-green-dark";
  const suffix = unit ?? "";

  return (
    <span
      className={`mt-0.5 flex min-w-0 items-center gap-1 whitespace-nowrap text-[9px] font-semibold leading-none ${
        className ?? ""
      }`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
      <span className="uppercase tracking-wide opacity-60">{currentLabel}</span>
      <span className={currentColor}>
        {current}
        {suffix}
      </span>
      <span aria-hidden="true" className="opacity-40">
        →
      </span>
      <span className="uppercase tracking-wide opacity-60">{targetLabel}</span>
      <span className="opacity-80">
        {target}
        {suffix}
      </span>
    </span>
  );
}
