import type {
  BeTrackData,
  Employee,
  MovementStatus,
  MovementType,
  WorkforceMovement,
} from "@/types";

/**
 * Mapping Excel <-> base ETP, partagé par l'export et l'import (le fichier généré par
 * "Exporter Excel" est ré-importable tel quel — et une base ETP client au même format peut
 * amorcer la plateforme). Deux feuilles : "Base ETP" (employés) et "Mouvements".
 */

// ---------- Export ----------

export function employeeToExcelRow(e: Employee): Record<string, string | number> {
  return {
    Matricule: e.id,
    Nom: e.name,
    Département: e.department,
    Direction: e.direction,
    "RH local": e.hrOwner,
    Région: e.region,
    Pays: e.country,
    Fonction: e.func,
    Équipe: e.team,
    BU: e.bu,
    Entité: e.entity,
    Niveau: e.level,
    ETP: e.fte,
    "Salaire brut annuel (€)": e.salary,
    "Date d'entrée": e.hireDate,
    "Départ retraite": e.retirement,
  };
}

export function movementToExcelRow(
  m: WorkforceMovement,
  data: BeTrackData
): Record<string, string | number> {
  const lever = data.levers.find((l) => l.id === m.leverId);
  return {
    "ID mouvement": m.id,
    Matricule: m.empId ?? "",
    "Employé / Poste": m.label,
    Type: m.type,
    "ETP concernés": m.fte,
    Département: m.department,
    "Département d'arrivée": m.toDepartment ?? "",
    Pays: m.country,
    "RH local": m.hrOwner,
    "Levier (code)": lever?.code ?? m.leverId,
    "Date planifiée": m.plannedDate,
    "Date réalisée": m.actualDate ?? "",
    Statut: m.status,
    "Validé RH": m.hrValidated ? "Oui" : "Non",
    PSE: m.inPSE ? "Oui" : "Non",
    "Impact masse salariale (€/an)": m.salaryImpact,
    "Économies (€)": m.savings,
    "Coût one-off (€)": m.cost,
    Commentaire: m.comment ?? "",
  };
}

// ---------- Import ----------

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

function bool(v: unknown): boolean {
  const s = str(v).toLowerCase();
  return s === "oui" || s === "yes" || s === "true" || s === "1" || s === "x";
}

export type ParsedEmployeeRow = { values: Employee | null; warnings: string[] };

export function parseEmployeeRow(
  row: Record<string, unknown>,
  data: BeTrackData,
  rowNumber: number
): ParsedEmployeeRow {
  const warnings: string[] = [];
  const id = str(row["Matricule"]);
  const name = str(row["Nom"]);
  if (!id || !name) {
    return {
      values: null,
      warnings: [`Base ETP ligne ${rowNumber} ignorée : "Matricule" et "Nom" obligatoires`],
    };
  }

  const department = str(row["Département"]);
  if (department && !data.workforce.departments.some((d) => d.name === department)) {
    warnings.push(
      `Base ETP ligne ${rowNumber} : département "${department}" inconnu (accepté tel quel)`
    );
  }

  const levelRaw = str(row["Niveau"]);
  const level: Employee["level"] =
    levelRaw === "Global" || levelRaw === "Régional" || levelRaw === "Local" ? levelRaw : "Local";
  if (levelRaw && level !== levelRaw) {
    warnings.push(`Base ETP ligne ${rowNumber} : niveau "${levelRaw}" inconnu — "Local" utilisé`);
  }

  return {
    values: {
      id,
      name,
      department: department || data.workforce.departments[0]?.name || "",
      direction: str(row["Direction"]),
      hrOwner: str(row["RH local"]),
      region: str(row["Région"]) || "Europe",
      country: str(row["Pays"]) || "France",
      func: str(row["Fonction"]),
      team: str(row["Équipe"]) || str(row["Fonction"]),
      bu: str(row["BU"]),
      entity: str(row["Entité"]),
      level,
      fte: numOr(row["ETP"], 1),
      salary: numOr(row["Salaire brut annuel (€)"], 0),
      hireDate: str(row["Date d'entrée"]),
      retirement: str(row["Départ retraite"]),
    },
    warnings,
  };
}

const MOVEMENT_TYPES: MovementType[] = ["Redéploiement", "Reconversion", "Suppression", "Recrutement"];
const MOVEMENT_STATUSES: MovementStatus[] = ["Planifié", "En cours", "Réalisé"];

export type ParsedMovementRow = { values: WorkforceMovement | null; warnings: string[] };

export function parseMovementRow(
  row: Record<string, unknown>,
  data: BeTrackData,
  rowNumber: number
): ParsedMovementRow {
  const warnings: string[] = [];
  const id = str(row["ID mouvement"]);
  const label = str(row["Employé / Poste"]);
  if (!label) {
    return {
      values: null,
      warnings: [`Mouvements ligne ${rowNumber} ignorée : "Employé / Poste" obligatoire`],
    };
  }

  const typeRaw = str(row["Type"]);
  const type = MOVEMENT_TYPES.find((t) => t.toLowerCase() === typeRaw.toLowerCase()) ?? "Redéploiement";
  if (typeRaw && type.toLowerCase() !== typeRaw.toLowerCase()) {
    warnings.push(`Mouvements ligne ${rowNumber} : type "${typeRaw}" inconnu — "Redéploiement" utilisé`);
  }

  const statusRaw = str(row["Statut"]);
  const status =
    MOVEMENT_STATUSES.find((s) => s.toLowerCase() === statusRaw.toLowerCase()) ?? "Planifié";
  if (statusRaw && status.toLowerCase() !== statusRaw.toLowerCase()) {
    warnings.push(`Mouvements ligne ${rowNumber} : statut "${statusRaw}" inconnu — "Planifié" utilisé`);
  }

  const leverCode = str(row["Levier (code)"]);
  const lever = data.levers.find(
    (l) => l.code.toLowerCase() === leverCode.toLowerCase() || l.id === leverCode
  );
  if (leverCode && !lever) {
    warnings.push(
      `Mouvements ligne ${rowNumber} : levier "${leverCode}" inconnu — mouvement non rattaché`
    );
  }

  const empId = str(row["Matricule"]) || null;
  if (empId && !data.workforce.employees.some((e) => e.id === empId)) {
    warnings.push(`Mouvements ligne ${rowNumber} : matricule "${empId}" absent de la base ETP`);
  }

  const today = new Date().toISOString().slice(0, 10);
  return {
    values: {
      // id vide → généré à l'import (création) ; id existant → mise à jour
      id,
      empId: type === "Recrutement" ? null : empId,
      label,
      leverId: lever?.id ?? "",
      type,
      fte: numOr(row["ETP concernés"], 1),
      department: str(row["Département"]),
      toDepartment: str(row["Département d'arrivée"]) || undefined,
      country: str(row["Pays"]) || "France",
      hrOwner: str(row["RH local"]),
      plannedDate: str(row["Date planifiée"]) || today,
      actualDate: str(row["Date réalisée"]) || null,
      status,
      hrValidated: bool(row["Validé RH"]),
      inPSE: bool(row["PSE"]),
      salaryImpact: numOr(row["Impact masse salariale (€/an)"], 0),
      savings: numOr(row["Économies (€)"], 0),
      cost: numOr(row["Coût one-off (€)"], 0),
      comment: str(row["Commentaire"]) || undefined,
    },
    warnings,
  };
}
