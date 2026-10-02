import { dependencyAlertMessage, type ChantierDependencyAlert } from "@/lib/axisLogic";
import type { DependencyOverviewRow } from "@/lib/chantierDependencyOverview";
import type {
  Chantier,
  ChantierAction,
  ChantierStaffing,
  Indicator,
  IndicatorMeasurement,
  StrategicAxis,
} from "@/types";

/**
 * « Calculer sur le programme complet, afficher le périmètre du lecteur » (lot 3, audit de
 * cohérence) — point de vérité des règles qui séparent CALCUL et AFFICHAGE dans le Plan
 * Stratégique.
 *
 * Problème corrigé : taux de staffing, alertes de sur-staffing, avancement d'axe et de programme,
 * santé des chantiers, prérequis, validation et budget étaient calculés sur les données DÉJÀ
 * filtrées par confidentialité et périmètre du rôle (`useStrategicData`) — le même chiffre
 * changeait donc selon qui regardait (équipe IT d'octobre à 125 % pour l'admin, 75 % pour une RH
 * non habilitée…).
 *
 * Règle désormais :
 *  - les CALCULS portent sur `useStrategicData().program` (collections NON filtrées du programme
 *    actif, voir `StrategicProgramData`) : même taux, même avancement, même santé, même verdict de
 *    prérequis, même routage de validation, même budget pour TOUS les profils ;
 *  - l'AFFICHAGE reste borné au périmètre du lecteur (`axes`/`chantiers`/… filtrés du hook) : un
 *    élément non habilité n'apparaît jamais par son nom ni par son détail — seulement sous forme
 *    d'AGRÉGAT anonyme (« autres chantiers », « Autres axes », « prérequis hors de votre
 *    périmètre », « chantier hors de votre périmètre »). Les helpers ci-dessous font ce masquage.
 */

/** Collections NON filtrées du programme actif (scopées au `programId`, AVANT confidentialité et
 *  ownership) — à n'utiliser QUE pour des calculs dont seul le résultat agrégé est affiché. */
export type StrategicProgramData = {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  chantierActions: ChantierAction[];
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  staffing: ChantierStaffing[];
};

/** Identifiant SENTINELLE du regroupement anonyme « autres chantiers » (lignes ETP masquées). */
export const OUT_OF_SCOPE_CHANTIER_ID = "__hors-perimetre__";

/** Sentinelle simple, ou suffixée par les axes VISIBLES du chantier masqué
 *  (`__hors-perimetre__:A1,A2`, voir `maskStaffingForDisplay`). */
export function isOutOfScopeChantierId(id: string | undefined): boolean {
  return id === OUT_OF_SCOPE_CHANTIER_ID || (!!id && id.startsWith(`${OUT_OF_SCOPE_CHANTIER_ID}:`));
}

/** Axes VISIBLES portés par une clé « autres chantiers » suffixée ([] pour la sentinelle simple). */
export function outOfScopeAxisIds(id: string): string[] {
  if (!id.startsWith(`${OUT_OF_SCOPE_CHANTIER_ID}:`)) return [];
  return id
    .slice(OUT_OF_SCOPE_CHANTIER_ID.length + 1)
    .split(",")
    .filter(Boolean);
}

/**
 * Lignes ETP du programme COMPLET prêtes à l'affichage : une ligne d'un chantier hors périmètre
 * GARDE son équipe, ses ETP et ses dates (le mobilisé — donc le taux et les alertes — reste
 * identique pour tous les profils) mais perd tout ce qui l'identifie : son chantier est remplacé
 * par la sentinelle `OUT_OF_SCOPE_CHANTIER_ID` (toutes ces lignes se regroupent en une seule part
 * « autres chantiers »), son projet (`actionId`) et sa note (nom de la personne) sont retirés.
 * L'ordre et les ids des lignes sont conservés.
 *
 * `axisScope` (optionnel, vues ventilées PAR AXE) : la sentinelle est alors suffixée par les axes
 * VISIBLES du chantier masqué (jamais un axe masqué) — la ligne reste comptée sous l'axe visible
 * auquel elle appartient (même ETP d'axe pour tous les profils), toujours sans nom ; l'appelant
 * résout ces axes par `outOfScopeAxisIds`.
 */
export function maskStaffingForDisplay(
  entries: ChantierStaffing[],
  visibleChantierIds: ReadonlySet<string>,
  axisScope?: {
    axisIdsByChantier: Record<string, string[] | undefined>;
    visibleAxisIds: ReadonlySet<string>;
  }
): ChantierStaffing[] {
  return entries.map((entry) => {
    if (visibleChantierIds.has(entry.chantierId)) return entry;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { actionId, note, ...rest } = entry;
    const visibleAxes = axisScope
      ? (axisScope.axisIdsByChantier[entry.chantierId] ?? [])
          .filter((id) => axisScope.visibleAxisIds.has(id))
          .sort()
      : [];
    return {
      ...rest,
      chantierId:
        visibleAxes.length > 0
          ? `${OUT_OF_SCOPE_CHANTIER_ID}:${visibleAxes.join(",")}`
          : OUT_OF_SCOPE_CHANTIER_ID,
    };
  });
}

/**
 * Alertes de dépendance calculées sur le programme COMPLET, prêtes à l'affichage :
 *  - `keep` : `"source"` = seules les alertes dont le chantier BLOQUÉ est visible (cloche, carte
 *    du chantier) ; `"either"` = au moins une extrémité visible (liste du dashboard, fiche d'axe) ;
 *  - l'extrémité hors périmètre est renommée `outOfScopeLabel` (nom ET message recomposé), son
 *    id conservé (jamais rendu : sert seulement de clé).
 */
export function maskDependencyAlerts(
  alerts: ChantierDependencyAlert[],
  visibleChantierIds: ReadonlySet<string>,
  outOfScopeLabel: string,
  keep: "source" | "either" = "either"
): ChantierDependencyAlert[] {
  const out: ChantierDependencyAlert[] = [];
  for (const alert of alerts) {
    const sourceVisible = visibleChantierIds.has(alert.sourceId);
    const targetVisible = visibleChantierIds.has(alert.targetId);
    if (keep === "source" ? !sourceVisible : !sourceVisible && !targetVisible) continue;
    if (sourceVisible && targetVisible) {
      out.push(alert);
      continue;
    }
    const sourceName = sourceVisible ? alert.sourceName : outOfScopeLabel;
    const targetName = targetVisible ? alert.targetName : outOfScopeLabel;
    out.push({
      ...alert,
      sourceName,
      targetName,
      message: dependencyAlertMessage(alert.type, sourceName, targetName, alert.delayDays),
    });
  }
  return out;
}

/**
 * Lignes de la carte « Dépendances » d'une fiche chantier (`chantierDependencyOverview`, calculée
 * sur le programme COMPLET) : l'autre extrémité hors périmètre (chantier masqué, ou projet d'un
 * chantier masqué) est renommée `outOfScopeLabel` et rendue NON cliquable (ids retirés). Statut
 * et retard conservés — même verdict pour tous les profils.
 */
export function maskDependencyOverviewRows(
  rows: DependencyOverviewRow[],
  visibleChantierIds: ReadonlySet<string>,
  outOfScopeLabel: string
): DependencyOverviewRow[] {
  return rows.map((row) => {
    if (row.otherKind === "external") return row;
    if (row.otherChantierId && visibleChantierIds.has(row.otherChantierId)) return row;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { otherId, otherChantierId, ...rest } = row;
    return { ...rest, otherName: outOfScopeLabel };
  });
}
