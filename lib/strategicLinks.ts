import type { ProgramType } from "@/types";

/**
 * Liens profonds du Plan Stratégique (audit fix #3) — helpers PURS, testés
 * (`lib/__tests__/strategicLinks.test.ts`). Centralise les URL des objets stratégiques (axe,
 * chantier, projet, indicateur) et les décisions « où mène ce lien ? » pour qu'aucun écran ne
 * renvoie vers une liste générique ou une page introuvable.
 */

/** Fiche d'un axe (le routeur `/levers/detail` affiche `AxisDetailClient` en mode stratégique). */
export function axisDetailHref(axisId: string): string {
  return `/levers/detail?id=${encodeURIComponent(axisId)}`;
}

/** Panneau d'un chantier sur la page Axes (`StrategicAxesView` lit `?chantier=`). */
export function chantierHref(chantierId: string): string {
  return `/levers?chantier=${encodeURIComponent(chantierId)}`;
}

/** Panneau du chantier parent, focalisé sur le projet (`&action=`). */
export function projetHref(chantierId: string, actionId: string): string {
  return `${chantierHref(chantierId)}&action=${encodeURIComponent(actionId)}`;
}

/** Carte d'un indicateur sur la page KPI (contrat `/kpi?indicator=<id>`). */
export function indicatorHref(indicatorId: string): string {
  return `/kpi?indicator=${encodeURIComponent(indicatorId)}`;
}

/**
 * Lien vers l'objet ciblé par une demande de validation stratégique, ou `null` quand l'objet
 * n'existe pas (encore / plus) dans les données du programme — une demande de création non
 * encore appliquée, ou un objet supprimé depuis : mieux vaut pas de lien qu'un « introuvable ».
 */
export function approvalTargetHref(
  approval: { targetType: "axe" | "chantier" | "projet" | "indicateur"; targetId: string },
  data: {
    axes: { id: string }[];
    chantiers: { id: string }[];
    chantierActions: { id: string; chantierId: string }[];
    indicators: { id: string }[];
  }
): string | null {
  const id = approval.targetId;
  if (!id) return null;
  switch (approval.targetType) {
    case "axe":
      return data.axes.some((a) => a.id === id) ? axisDetailHref(id) : null;
    case "chantier":
      return data.chantiers.some((c) => c.id === id) ? chantierHref(id) : null;
    case "projet": {
      const action = data.chantierActions.find((a) => a.id === id);
      return action ? projetHref(action.chantierId, action.id) : null;
    }
    case "indicateur":
      return data.indicators.some((i) => i.id === id) ? indicatorHref(id) : null;
    default:
      return null;
  }
}

/**
 * Lien « Levier lié » (Base ETP, onglet mouvements) — un levier appartient TOUJOURS à un Plan
 * Performance. En mode stratégique, `/levers/detail?id=<levier>` chercherait un AXE de ce nom et
 * afficherait « Axe introuvable » :
 *  - `navigate` : le programme actif est Performance (ou le type n'est pas résolu), lien direct ;
 *  - `switch` : programme actif stratégique, le programme du levier est sélectionnable → l'activer
 *    AVANT de naviguer (même mécanisme que le portail « Mon espace ») ;
 *  - `text` : programme actif stratégique et programme du levier inconnu / non sélectionnable →
 *    code affiché en texte simple, sans lien.
 */
export type LeverLinkMode =
  { mode: "navigate" } | { mode: "switch"; programId: string } | { mode: "text" };

export function leverLinkMode(input: {
  leverProgramId: string | null | undefined;
  activeProgramType: ProgramType | null | undefined;
  selectableProgramIds: string[];
}): LeverLinkMode {
  if (input.activeProgramType !== "strategic") return { mode: "navigate" };
  const programId = input.leverProgramId;
  if (programId && input.selectableProgramIds.includes(programId)) {
    return { mode: "switch", programId };
  }
  return { mode: "text" };
}

/**
 * Arrivée sur `/kpi?indicator=<id>` : que faire pour que la carte visée soit réellement visible ?
 *  - `notFound` : l'indicateur n'est pas dans le périmètre chargé (autre programme, hors droits,
 *    supprimé) → message « introuvable dans la vue actuelle » ;
 *  - `reveal` : il existe mais est masqué — par un filtre (`clearFilters`) et/ou par la vue
 *    Tableau (`switchToCards`) → lever ce qui bloque, puis défiler au rendu suivant ;
 *  - `scroll` : la carte est déjà rendue, défiler et surligner.
 */
export type IndicatorDeepLinkPlan =
  | { kind: "notFound" }
  | { kind: "reveal"; clearFilters: boolean; switchToCards: boolean }
  | { kind: "scroll" };

export function planIndicatorDeepLink(input: {
  targetId: string;
  scopeIds: string[];
  filteredIds: string[];
  view: "cards" | "table";
}): IndicatorDeepLinkPlan {
  if (!input.scopeIds.includes(input.targetId)) return { kind: "notFound" };
  const clearFilters = !input.filteredIds.includes(input.targetId);
  const switchToCards = input.view !== "cards";
  if (clearFilters || switchToCards) return { kind: "reveal", clearFilters, switchToCards };
  return { kind: "scroll" };
}
