import * as engine from "@/lib/engine";
import { STATUS_LABEL } from "@/lib/status-config";
import type { Alert, BeTrackData, Lever, RiskLevel } from "@/types";

/**
 * Mapping Lever -> ligne Excel, utilisé par `ExportButton` (type="excel") pour générer
 * le fichier .xlsx téléchargé sur la page Leviers. Pas d'import Excel dans cette app — voir
 * historique git si besoin de retrouver l'ancien parsing (`ExcelUploadButton`, retiré).
 */

export function leverToExcelRow(
  lever: Lever,
  data: BeTrackData,
  alerts: Alert[],
  riskThresholds?: { level: RiskLevel; minAmount: number }[]
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
    Statut: STATUS_LABEL[lever.status],
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
