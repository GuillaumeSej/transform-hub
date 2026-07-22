import * as engine from "@/lib/engine";
import { STATUS_LABEL } from "@/lib/status-config";
import type {
  BeTrackData,
  DependencyType,
  Lever,
  LeverDependency,
  LeverStatus,
  PriorityLevel,
  RiskLevel,
  SubLever,
} from "@/types";

/**
 * Mapping Excel <-> Lever partagé par ExportButton et ExcelUploadButton, pour garantir que
 * le fichier généré par "Export Excel" est ré-importable tel quel par "Importer Excel".
 */

export type LeverImportInput = Omit<Lever, "id" | "createdAt" | "lastUpdate">;

const ENUM_LISTS = {
  status: ["idea", "qualified", "validated", "in_progress", "delivered", "cancelled"] as LeverStatus[],
  risk: ["low", "medium", "high", "critical"] as RiskLevel[],
  priority: ["low", "medium", "high", "critical"] as PriorityLevel[],
};

const DEP_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

/** "L002:FS; SL003:SS" -> LeverDependency[] — tolérant : id sans `:type` = FS. */
function parseDependencies(raw: string): LeverDependency[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [targetId, typeRaw] = entry.split(":").map((s) => s.trim());
      const type = DEP_TYPES.find((t) => t === typeRaw?.toUpperCase()) ?? "FS";
      return { targetId, type };
    })
    .filter((d) => d.targetId.length > 0);
}

/** Statut accepté sous forme de clé ("in_progress") ou de label L1-L5 ("L4 · Planifié", "L4",
 * "Planifié"). */
function parseStatus(raw: string): LeverStatus | undefined {
  const s = raw.toLowerCase();
  return ENUM_LISTS.status.find((st) => {
    const label = STATUS_LABEL[st].toLowerCase();
    const [level, name] = label.split(" · ");
    return st === s || label === s || level === s || name === s;
  });
}

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
    "Réalisé à date (€M)": engine.realizedSavings(lever, data),
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

  // Nouveau format "ID:type" avec fallback sur l'ancien header "IDs" (fichiers déjà exportés).
  const depsRaw =
    str(row["Dépendances (ID:type, séparées par ;)"]) ||
    str(row["Dépendances (IDs, séparées par ;)"]);
  const dependencies = parseDependencies(depsRaw);

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
    status: (() => {
      const raw = str(row["Statut"]);
      if (!raw) return "idea";
      const parsed = parseStatus(raw);
      if (!parsed) {
        warnings.push(`Ligne ${rowNumber} : statut "${raw}" inconnu — "L1 · Idée" utilisé`);
        return "idea";
      }
      return parsed;
    })(),
    progress: Math.min(100, Math.max(0, numOr(row["Progression (%)"], 0))),
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
    "ETP": subLever.fteImpact,
    "Population impactée": subLever.popImpacted,
    "Date de départ": subLever.start,
    "Date de fin": subLever.end,
    Statut: STATUS_LABEL[subLever.status],
    "Priorité": subLever.priority,
    "Risque": subLever.risk,
    Dépendances: subLever.dependencies.map((d) => `${d.targetId}:${d.type}`).join("; "),
    Description: "",
  };
}

export type SubLeverImportInput = {
  leverCode: string;
  name: string;
  owner?: string;
  expensePost: string;
  businessUnit: string;
  pnlMap: string;
  grossSavings: number;
  netSavings: number;
  opexOneOff: number;
  opexRec: number;
  capex: number;
  fteImpact: number;
  popImpacted: number;
  start: string;
  end: string;
  status: LeverStatus;
  priority: PriorityLevel;
  risk: RiskLevel;
  dependencies: LeverDependency[];
};

export type ParsedSubLeverRow = { values: SubLeverImportInput | null; warnings: string[] };

export function parseSubLeverExcelRow(
  row: Record<string, unknown>,
  data: BeTrackData,
  rowNumber: number
): ParsedSubLeverRow {
  const warnings: string[] = [];
  const leverCode = str(row["Code levier"]);
  const name = str(row["Nom sous-levier"]);
  if (!leverCode || !name) {
    return {
      values: null,
      warnings: [`Sous-levier ligne ${rowNumber} ignorée : "Code levier" et "Nom sous-levier" obligatoires`],
    };
  }
  const lever = data.levers.find((l) => l.code.toLowerCase() === leverCode.toLowerCase());
  if (!lever) {
    return {
      values: null,
      warnings: [`Sous-levier ligne ${rowNumber} : levier "${leverCode}" introuvable — ligne ignorée`],
    };
  }

  const pnlName = str(row["Compte P&L"]);
  const pnl = data.pnlAccounts.find((p) => p.name.toLowerCase() === pnlName.toLowerCase());
  const today = new Date().toISOString().slice(0, 10);

  return {
    values: {
      leverCode,
      name,
      owner: str(row["Owner"]),
      expensePost: str(row["Poste de dépense"]),
      businessUnit: str(row["Business Unit"]),
      pnlMap: pnl?.id ?? data.pnlAccounts[0].id,
      grossSavings: numOr(row["Impact brut (€M)"], 0),
      netSavings: numOr(row["Impact net (€M)"], 0),
      opexOneOff: numOr(row["OPEX one-off (€M)"], 0),
      opexRec: numOr(row["OPEX récurrent (€M/an)"], 0),
      capex: numOr(row["CAPEX (€M)"], 0),
      fteImpact: numOr(row["ETP"], 0),
      popImpacted: numOr(row["Population impactée"], 0),
      start: str(row["Date de départ"]) || today,
      end: str(row["Date de fin"]) || today,
      status: parseStatus(str(row["Statut"])) ?? "idea",
      priority: enumOr(row["Priorité"], ENUM_LISTS.priority, "medium", warnings, `SL ligne ${rowNumber}: priorité`),
      risk: enumOr(row["Risque"], ENUM_LISTS.risk, "low", warnings, `SL ligne ${rowNumber}: risque`),
      dependencies: parseDependencies(str(row["Dépendances"])),
    },
    warnings,
  };
}
