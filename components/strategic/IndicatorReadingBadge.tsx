import { ArrowRight } from "lucide-react";
import type { IndicatorRiskStatus } from "@/types";
import { INDICATOR_STATUS_TONE } from "@/components/strategic/IndicatorStatusBadge";

/**
 * Mini visuel "valeur actuelle → cible" d'un indicateur, affiché à l'intérieur de la puce d'axe de
 * la feuille de route (`StrategicDashboardView.renderAxisRoadmapHeader`, ~ligne 778).
 *
 * Round "KPI pro" (retour PO — voix, traduit) : la version round 30 tenait tout sur UNE ligne à
 * 9px à l'intérieur d'une puce `rounded-full` — illisible ("écrit petit"), pas de séparateur entre
 * le nombre et son unité ("19sources" collé), et une puce en forme de pastille ne se prêtait pas à
 * porter un second signal visuel ("ça fait un rond, c'est pas beau"). Refonte en deux BLOCS
 * "Actuel"/"Cible" côte à côte (libellé au-dessus, valeur EN DESSOUS, jamais sur la même ligne que
 * l'unité collée au nombre — un espace explicite les sépare toujours), reliés par une flèche
 * Lucide plutôt qu'un caractère "→" plus discret, sur une taille de police doublée (12px) pour
 * rester lisible dans une puce qui reste par ailleurs compacte. Le conteneur appelant
 * (`StrategicDashboardView.tsx`) est passé de `rounded-full` à `rounded-lg` : un rectangle à coins
 * adoucis porte mieux ce contenu à deux lignes qu'une pastille.
 *
 * Statut EFFECTIF de l'indicateur (`resolveIndicatorStatus`, surcharge manuelle comprise — même
 * source de vérité que `IndicatorStatusBadge`/`StrategicAxesView.tsx`), EXACTEMENT les mêmes tokens
 * (`bg-rag-green`/`bg-rag-amber`, `text-rag-green-dark`/`text-rag-amber`) qu'ailleurs dans l'appli,
 * jamais une logique de couleur maison.
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
  // Refonte visuelle (retour PO — « la case est trop grosse ») : plus de boîte grisée à deux
  // lignes par valeur ni de pastille de couleur redondante (le statut est désormais porté par
  // `IndicatorStatusBadge` juste à côté, avec son libellé explicite). Une seule ligne compacte
  // « Actuel 12 u → Cible 20 u », valeurs à 12px (lisibles), l'unité toujours séparée du nombre
  // par un espace, la valeur actuelle teintée par la palette partagée `INDICATOR_STATUS_TONE`.
  const suffix = unit ? ` ${unit}` : "";

  return (
    <span
      className={`flex min-w-0 items-baseline gap-1 whitespace-nowrap leading-none ${className ?? ""}`}
    >
      <span className="text-[9.5px] font-semibold uppercase tracking-wide text-tertiary">
        {currentLabel}
      </span>
      <span className={`text-[12px] font-bold ${INDICATOR_STATUS_TONE[status].text}`}>
        {current}
        {suffix}
      </span>
      <ArrowRight aria-hidden="true" size={11} className="shrink-0 self-center text-tertiary" />
      <span className="text-[9.5px] font-semibold uppercase tracking-wide text-tertiary">
        {targetLabel}
      </span>
      <span className="text-[12px] font-bold text-primary">
        {target}
        {suffix}
      </span>
    </span>
  );
}
