import * as engine from "@/lib/engine";
import { STATUS_LABEL } from "@/lib/status-config";
import type { BeTrackData, Lever, SubLever } from "@/types";

/**
 * Mapping Lever/SubLever -> ligne Excel, utilisé par `ExportButton` (type="excel") pour générer
 * le fichier .xlsx téléchargé sur la page Leviers. Pas d'import Excel dans cette app — voir
 * historique git si besoin de retrouver l'ancien parsing (`ExcelUploadButton`, retiré).
 */

export function leverToExcelRow(lever: Lever, data: BeTrackData): Record<string, string | number> {
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
    Priorité: lever.priority,
    Risque: lever.risk,
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

export function subLeverToExcelRow(
  subLever: SubLever,
  leverCode: string,
  data: BeTrackData
): Record<string, string | number> {
  const pnl = data.pnlAccounts.find((p) => p.id === subLever.pnlMap);
  return {
    "Code levier": leverCode,
    "Nom sous-levier": subLever.name,
    Owner: subLever.owner ?? "",
    "Poste de dépense": subLever.expensePost,
    "Business Unit": subLever.businessUnit,
    "Compte P&L": pnl?.name ?? subLever.pnlMap,
    "Impact brut (€M)": subLever.grossSavings,
    "Impact net (€M)": subLever.netSavings,
    "OPEX one-off (€M)": subLever.opexOneOff,
    "OPEX récurrent (€M/an)": subLever.opexRec,
    "CAPEX (€M)": subLever.capex,
    ETP: subLever.fteImpact,
    "Population impactée": subLever.popImpacted,
    "Date de départ": subLever.start,
    "Date de fin": subLever.end,
    Statut: STATUS_LABEL[subLever.status],
    Priorité: subLever.priority,
    Risque: subLever.risk,
    Dépendances: subLever.dependencies.map((d) => `${d.targetId}:${d.type}`).join("; "),
    Description: "",
  };
}
