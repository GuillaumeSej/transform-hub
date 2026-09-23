import { ArrowRight } from "lucide-react";
import type { IndicatorRiskStatus } from "@/types";

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
  const dotColor = status === "at_risk" ? "bg-rag-amber" : "bg-rag-green";
  const currentColor = status === "at_risk" ? "text-rag-amber" : "text-rag-green-dark";
  const suffix = unit ? ` ${unit}` : "";

  return (
    <span
      className={`mt-1 flex min-w-0 items-center gap-2 whitespace-nowrap rounded-md bg-black/[0.03] px-2 py-1.5 ${
        className ?? ""
      }`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[9px] font-semibold uppercase tracking-wide opacity-60">
          {currentLabel}
        </span>
        <span className={`text-[13px] font-bold ${currentColor}`}>
          {current}
          {suffix}
        </span>
      </span>
      <ArrowRight aria-hidden="true" size={13} className="mt-2.5 shrink-0 opacity-35" />
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[9px] font-semibold uppercase tracking-wide opacity-60">
          {targetLabel}
        </span>
        <span className="text-[13px] font-bold text-text-primary opacity-90">
          {target}
          {suffix}
        </span>
      </span>
    </span>
  );
}
