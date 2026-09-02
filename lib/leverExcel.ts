import * as engine from "@/lib/engine";
import { DEFAULT_LIFECYCLE_STAGES, resolveStatusLabel } from "@/lib/status-config";
import type { Alert, BeTrackData, Lever, LifecycleStage, RiskLevel } from "@/types";

/**
 * Mapping Lever -> ligne Excel, utilisé par `ExportButton` (type="excel") pour générer
 * le fichier .xlsx téléchargé sur la page Leviers. L'import (leviers + actions + impacts) vit
 * dans `lib/leverExcelImport.ts`, utilisé par `LeverImportButton` — voir ce fichier pour le format
 * des 3 feuilles attendues et la logique de validation/upsert par Code.
 */

export function leverToExcelRow(
  lever: Lever,
  data: BeTrackData,
  alerts: Alert[],
  riskThresholds?: { level: RiskLevel; minAmount: number }[],
  /** Référentiel de cycle de vie ACTIF de l'entreprise (voir `subscribeLifecycleConfig` /
   *  `useLifecycleLabels`) — la colonne "Statut" doit toujours écrire le libellé RÉELLEMENT
   *  affiché sur la plateforme pour ce levier (Kanban, dropdown de statut...), jamais un libellé
   *  Excel figé qui diverge silencieusement dès que le cycle de vie par défaut ou personnalisé
   *  change. Absent = référentiel par défaut (`DEFAULT_LIFECYCLE_STAGES`), déjà celui réellement
   *  affiché pour toute entreprise sans personnalisation — voir `lib/leverExcelImport.ts` pour le
   *  mapping inverse, qui accepte ce même libellé au ré-import. */
  lifecycleStages: LifecycleStage[] = DEFAULT_LIFECYCLE_STAGES
): Record<string, string | number> {
  const ws = data.workstreams.find((w) => w.id === lever.ws);
  const pnl = data.pnlAccounts.find((p) => p.id === lever.pnlMap);
  return {
    Code: lever.code,
    "Type de levier": lever.type,
    "Nom du levier": lever.name,
    Workstream: ws?.name ?? lever.ws,
    Owner: lever.owner,
    "Owner (initiales)": lever.ownerInit,
    Sponsor: lever.sponsor,
    "Sponsor (initiales)": lever.sponsorInit,
    Géographie: lever.geography,
    Pays: lever.country,
    Entité: lever.entity,
    Fonction: lever.function,
    "Centre de coût": lever.costCenter,
    "Compte P&L impacté": pnl?.name ?? lever.pnlMap,
    "Date de départ": lever.start,
    "Date de fin estimée": lever.end,
    Statut: resolveStatusLabel(lever.status, lifecycleStages),
    "Progression (%)": lever.progress,
    Risque: engine.computeLeverRisk(lever.id, alerts, riskThresholds),
    "Impact estimé brut (€M)": lever.grossSavings,
    "Impact estimé net (€M)": lever.netSavings,
    "Réalisé à date (€M)": engine.realizedSavings(lever),
    "Impact estimé (ETP)": lever.fteImpact,
    "Réalisé à date (ETP)": engine.realizedFte(lever),
    "Population impactée": lever.popImpacted,
    "CAPEX (€M)": lever.capex,
    "OPEX one-off (€M)": lever.opexOneOff,
    "OPEX récurrent (€M/an)": lever.opexRec,
    "Dépendances (ID:type, séparées par ;)": lever.dependencies
      .map((d) => `${d.targetId}:${d.type}`)
      .join("; "),
    Description: lever.description,
    "Créé le": lever.createdAt,
    "Dernière mise à jour": lever.lastUpdate,
  };
}
