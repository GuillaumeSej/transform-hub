import * as engine from "@/lib/engine";
import type { BeTrackData, Lever, LeverStatus, MaturityLevel, PriorityLevel, RiskLevel } from "@/types";

/**
 * Mapping Excel <-> Lever partagé par ExportButton et ExcelUploadButton, pour garantir que
 * le fichier généré par "Export Excel" est ré-importable tel quel par "Importer Excel".
 */

export type LeverImportInput = Omit<Lever, "id" | "createdAt" | "lastUpdate">;

const ENUM_LISTS = {
  status: ["idea", "qualified", "validated", "in_progress", "delivered", "cancelled"] as LeverStatus[],
  risk: ["low", "medium", "high", "critical"] as RiskLevel[],
  priority: ["low", "medium", "high", "critical"] as PriorityLevel[],
  maturity: ["L1", "L2", "L3", "L4", "L5"] as MaturityLevel[],
};

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
    Statut: lever.status,
    "Progression (%)": lever.progress,
    "Niveau d'avancement": lever.maturityLevel,
    Priorité: lever.priority,
    Risque: lever.risk,
    "Impact estimé brut (€M)": lever.grossSavings,
    "Impact estimé net (€M)": lever.netSavings,
    "Réalisé à date (€M)": engine.realizedSavings(lever, data),
    "Impact estimé (ETP)": lever.fteImpact,
    "Réalisé à date (ETP)": engine.realizedFte(lever),
    "Population impactée": lever.popImpacted,
    "CAPEX (€M)": lever.capex,
    "OPEX one-off (€M)": lever.opexOneOff,
    "OPEX récurrent (€M/an)": lever.opexRec,
    "Dépendances (IDs, séparées par ;)": lever.dependencies.join("; "),
    Description: lever.description,
    "Créé le": lever.createdAt,
    "Dernière mise à jour": lever.lastUpdate,
  };
}

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

function numOr(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function enumOr<T extends string>(
  v: unknown,
  allowed: T[],
  fallback: T,
  warnings: string[],
  label: string
): T {
  const s = str(v);
  if (!s) return fallback;
  const match = allowed.find((a) => a.toLowerCase() === s.toLowerCase());
  if (!match) {
    warnings.push(`${label} "${s}" inconnu(e) — valeur par défaut "${fallback}" utilisée`);
    return fallback;
  }
  return match;
}

export type ParsedLeverRow = { values: LeverImportInput | null; warnings: string[] };

/** Parse une ligne issue de `XLSX.utils.sheet_to_json` (colonnes = headers de `leverToExcelRow`). */
export function parseLeverExcelRow(
  row: Record<string, unknown>,
  data: BeTrackData,
  rowNumber: number
): ParsedLeverRow {
  const warnings: string[] = [];
  const code = str(row["Code"]);
  const name = str(row["Nom du levier"]);
  if (!code || !name) {
    return {
      values: null,
      warnings: [`Ligne ${rowNumber} ignorée : "Code" et "Nom du levier" sont obligatoires`],
    };
  }

  const wsName = str(row["Workstream"]);
  const ws = data.workstreams.find((w) => w.name.toLowerCase() === wsName.toLowerCase());
  if (wsName && !ws) {
    warnings.push(
      `Ligne ${rowNumber} : workstream "${wsName}" inconnu — "${data.workstreams[0].name}" utilisé par défaut`
    );
  }

  const pnlName = str(row["Compte P&L impacté"]);
  const pnl = data.pnlAccounts.find((p) => p.name.toLowerCase() === pnlName.toLowerCase());
  if (pnlName && !pnl) {
    warnings.push(
      `Ligne ${rowNumber} : compte P&L "${pnlName}" inconnu — "${data.pnlAccounts[0].name}" utilisé par défaut`
    );
  }

  const depsRaw = str(row["Dépendances (IDs, séparées par ;)"]);
  const dependencies = depsRaw
    ? depsRaw
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const today = new Date().toISOString().slice(0, 10);

  const values: LeverImportInput = {
    code,
    type: str(row["Type de levier"]) || data.leverTypes[0],
    name,
    ws: ws?.id ?? data.workstreams[0].id,
    owner: str(row["Owner"]),
    ownerInit: str(row["Owner (initiales)"]),
    sponsor: str(row["Sponsor"]),
    sponsorInit: str(row["Sponsor (initiales)"]),
    geography: str(row["Géographie"]) || data.geographies[0],
    country: str(row["Pays"]),
    entity: str(row["Entité"]),
    function: str(row["Fonction"]) || data.functions[0],
    costCenter: str(row["Centre de coût"]),
    pnlMap: pnl?.id ?? data.pnlAccounts[0].id,
    start: str(row["Date de départ"]) || today,
    end: str(row["Date de fin estimée"]) || today,
    status: enumOr(row["Statut"], ENUM_LISTS.status, "idea", warnings, `Ligne ${rowNumber} : statut`),
    progress: Math.min(100, Math.max(0, numOr(row["Progression (%)"], 0))),
    maturityLevel: enumOr(
      row["Niveau d'avancement"],
      ENUM_LISTS.maturity,
      "L1",
      warnings,
      `Ligne ${rowNumber} : niveau d'avancement`
    ),
    priority: enumOr(
      row["Priorité"],
      ENUM_LISTS.priority,
      "medium",
      warnings,
      `Ligne ${rowNumber} : priorité`
    ),
    risk: enumOr(row["Risque"], ENUM_LISTS.risk, "low", warnings, `Ligne ${rowNumber} : risque`),
    grossSavings: numOr(row["Impact estimé brut (€M)"], 0),
    netSavings: numOr(row["Impact estimé net (€M)"], 0),
    opexOneOff: numOr(row["OPEX one-off (€M)"], 0),
    opexRec: numOr(row["OPEX récurrent (€M/an)"], 0),
    capex: numOr(row["CAPEX (€M)"], 0),
    fteImpact: numOr(row["Impact estimé (ETP)"], 0),
    popImpacted: numOr(row["Population impactée"], 0),
    dependencies,
    description: str(row["Description"]),
  };

  return { values, warnings };
}
