import type {
  BeTrackData,
  Employee,
  MovementStatus,
  MovementType,
  SocialScheme,
  WorkforceMovement,
} from "@/types";
import {
  canonicalizeRowKeys,
  excelRowNumber,
  isBlankCell,
  normalizeHeaderKey,
  parseCellDate,
  parseCellNumber,
} from "@/lib/excelParse";
import { makeIssue, type ImportIssue } from "@/lib/importIssue";
import { nextMovementId } from "@/lib/workforceLogic";

/**
 * Mapping Excel <-> base ETP, partagé par l'export et l'import (le fichier généré par
 * "Exporter Excel" est ré-importable tel quel — et une base ETP client au même format peut
 * amorcer la plateforme). Deux feuilles : "Base ETP" (employés) et "Mouvements".
 *
 * Règles d'import (audit du 24/09/2026) :
 * - Mise à jour = PATCH : seules les colonnes présentes ET non vides modifient l'existant. Une
 *   cellule vide ne remplace jamais une valeur existante (pas d'effacement par `undefined`/""), et
 *   les champs non exportés (snapshots, rattachements d'arborescence…) sont conservés.
 * - Nombres/dates via `lib/excelParse.ts` (FR/EN, séries Excel) : valeur illisible = avertissement
 *   explicite + valeur existante conservée (jamais de repli silencieux).
 * - Énumérations (type, statut, niveau, dispositif social, Oui/Non) : comparaison insensible à la
 *   casse/aux accents, synonymes usuels ; valeur inconnue = avertissement (ou erreur pour le type).
 * - Doublons d'identifiant dans le fichier = erreur sur toutes les lignes concernées.
 * - ID de mouvement inconnu = création AVEC cet ID (idempotent : un ré-import ne duplique pas).
 * - Anomalies = codes traduisibles (`HR_IMPORT_ISSUES`, clés `hrImport.issue.*`).
 */

export const HR_EMPLOYEE_SHEET = "Base ETP";
export const HR_MOVEMENT_SHEET = "Mouvements";

export const HR_EMPLOYEE_HEADERS = [
  "Matricule",
  "Nom",
  "Département",
  "Direction",
  "RH local",
  "Région",
  "Pays",
  "Fonction",
  "Équipe",
  "BU",
  "Entité",
  "Niveau",
  "ETP",
  "Salaire brut annuel (€)",
  "Date d'entrée",
  "Départ retraite",
] as const;

export const HR_MOVEMENT_HEADERS = [
  "ID mouvement",
  "Matricule",
  "Employé / Poste",
  "Type",
  "ETP concernés",
  "Département",
  "Département d'arrivée",
  "Pays",
  "RH local",
  "Levier (code)",
  "Programme",
  "Owner Initiative",
  "Date planifiée",
  "Date réalisée",
  "Statut",
  "Validé RH",
  "Dispositif social",
  "PSE",
  "Impact masse salariale (€/an)",
  "Économies (€)",
  "Coût one-off (€)",
  "Commentaire",
] as const;

/** Modèles français des anomalies d'import RH — recopiés dans fr.ts sous `hrImport.issue.*`. */
export const HR_IMPORT_ISSUES: Record<string, string> = {
  missingColumns: "Colonnes obligatoires absentes : {columns}",
  unknownColumn: 'Colonne "{column}" non reconnue — ignorée',
  missingIdOrName: '"Matricule" et "Nom" obligatoires — ligne ignorée',
  duplicateEmployeeId:
    'Matricule "{id}" présent plusieurs fois dans le fichier (lignes {rows}) — lignes ignorées',
  missingLabel: '"Employé / Poste" obligatoire — ligne ignorée',
  duplicateMovementId:
    'ID mouvement "{id}" présent plusieurs fois dans le fichier (lignes {rows}) — lignes ignorées',
  missingType: '"Type" obligatoire pour créer un mouvement — ligne ignorée',
  unknownType: 'Type "{value}" inconnu (attendu : {expected}) — ligne ignorée',
  missingRequiredDate: '"{column}" obligatoire pour créer un mouvement — ligne ignorée',
  invalidRequiredDate: '{column} "{value}" illisible — ligne ignorée',
  unknownDepartment: 'Département "{value}" inconnu (accepté tel quel)',
  unknownEnumKept: '{column} "{value}" non reconnu — valeur existante conservée',
  unknownEnumDefault: '{column} "{value}" non reconnu — "{fallback}" utilisé',
  emptyDefault: '{column} vide — "{fallback}" utilisé',
  invalidNumberKept: '{column} "{value}" illisible — valeur existante conservée',
  invalidNumberDefault: '{column} "{value}" illisible — {fallback} utilisé',
  invalidDateKept: '{column} "{value}" illisible — valeur existante conservée',
  invalidDateEmpty: '{column} "{value}" illisible — laissé vide',
  legacyType: 'Type "{value}" (typologie 4-types) converti en "{type}"',
  legacyTypeRetraining:
    'Type "{value}" (typologie 4-types) converti en "{type}" avec reconversion (formation lourde)',
  legacyStatus: 'Statut historique "{value}" converti en "{status}"',
  unknownLever: 'Levier "{value}" inconnu — rattachement levier inchangé',
  unknownProgram: 'Programme "{value}" inconnu — programme inchangé',
  unknownEmployee: 'Matricule "{id}" absent de la base ETP',
  recruitmentEmpIdIgnored:
    'Matricule "{id}" ignoré : un Recrutement ne vise pas un employé existant',
  matriculeZeroPadded:
    'Matricule lu comme nombre ({value}) — rattaché au matricule existant "{id}" (formatez la colonne en texte pour conserver les zéros)',
  matriculeNumeric:
    "Matricule lu comme nombre ({value}) — les zéros de tête ont pu être perdus (formatez la colonne en texte)",
  unknownMovementIdCreated: 'ID mouvement "{id}" inconnu — mouvement créé avec cet ID',
  unknownSocialScheme: 'Dispositif social "{value}" inconnu — "Autre" utilisé',
  hrValidatedNotRealised: '"Validé RH" = Oui alors que le statut est "{status}"',
  actualDateNotRealised: 'Date réalisée renseignée alors que le statut est "{status}"',
};

export type ProgramRef = { id: string; name: string };

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

/** `programs` (facultatif) : exporte le NOM du programme (ré-importable par nom ou par id). */
export function movementToExcelRow(
  m: WorkforceMovement,
  data: Pick<BeTrackData, "levers">,
  programs?: ProgramRef[]
): Record<string, string | number> {
  const lever = data.levers.find((l) => l.id === m.leverId);
  const programId = m.programId ?? lever?.programId ?? "";
  const program = programs?.find((p) => p.id === programId);
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
    Programme: program?.name ?? programId,
    "Owner Initiative": lever?.owner ?? "",
    "Date planifiée": m.plannedDate,
    "Date réalisée": m.actualDate ?? "",
    Statut: m.status,
    "Validé RH": m.hrValidated ? "Oui" : "Non",
    "Dispositif social": m.socialScheme ?? (m.inPSE ? "PSE" : ""),
    PSE: m.inPSE ? "Oui" : "Non",
    "Impact masse salariale (€/an)": m.salaryImpact,
    "Économies (€)": m.savings,
    "Coût one-off (€)": m.cost,
    Commentaire: m.comment ?? "",
  };
}

// ---------- Import : helpers ----------

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) {
    const d = parseCellDate(v);
    return d?.ok ? d.value : "";
  }
  return String(v).trim();
}

/** Clé de comparaison d'énumération : casse, accents, espaces, tirets et underscores ignorés. */
function enumKey(raw: string): string {
  return normalizeHeaderKey(raw.replace(/[-_]/g, " "));
}

function has(row: Record<string, unknown>, col: string): boolean {
  return col in row && !isBlankCell(row[col]);
}

const TYPE_SYNONYMS: Record<string, MovementType> = {
  recrutement: "Recrutement",
  embauche: "Recrutement",
  recruitment: "Recrutement",
  hiring: "Recrutement",
  attrition: "Attrition",
  "depart volontaire": "Attrition",
  demission: "Attrition",
  "depart force": "Départ forcé",
  licenciement: "Départ forcé",
  "forced departure": "Départ forcé",
  "transfert entrant": "Transfert entrant",
  "mobilite entrante": "Transfert entrant",
  "transfer in": "Transfert entrant",
  "transfert sortant": "Transfert sortant",
  "mobilite sortante": "Transfert sortant",
  "transfer out": "Transfert sortant",
};

/** Alias de l'ancienne typologie 4-types (Suppression / Redéploiement / Reconversion) : convertis
 *  vers la typologie actuelle avec avertissement explicite. */
const LEGACY_TYPE_ALIASES: Record<string, MovementType> = {
  suppression: "Départ forcé",
  redeploiement: "Transfert entrant",
  reconversion: "Transfert entrant",
};

const STATUS_SYNONYMS: Record<string, MovementStatus> = {
  realise: "Réalisé",
  realisee: "Réalisé",
  fait: "Réalisé",
  termine: "Réalisé",
  done: "Réalisé",
  completed: "Réalisé",
  planifie: "Planifié",
  planifiee: "Planifié",
  prevu: "Planifié",
  planned: "Planifié",
  "a faire": "À faire",
  todo: "À faire",
  "to do": "À faire",
  abandonne: "Abandonné",
  abandonnee: "Abandonné",
  annule: "Abandonné",
  abandoned: "Abandonné",
  cancelled: "Abandonné",
  canceled: "Abandonné",
};
const LEGACY_STATUS_ALIASES: Record<string, MovementStatus> = { "en cours": "À faire" };

const LEVEL_SYNONYMS: Record<string, Employee["level"]> = {
  global: "Global",
  regional: "Régional",
  local: "Local",
};

const SOCIAL_SCHEME_SYNONYMS: Record<string, SocialScheme> = {
  pse: "PSE",
  rc: "RC",
  "rupture conventionnelle": "RC",
  rcc: "RCC",
  "rupture conventionnelle collective": "RCC",
  pdv: "PDV",
  "plan de depart volontaire": "PDV",
  "plan de departs volontaires": "PDV",
  autre: "Autre",
  other: "Autre",
};

const BOOL_SYNONYMS: Record<string, boolean> = {
  oui: true,
  yes: true,
  true: true,
  vrai: true,
  "1": true,
  x: true,
  ja: true,
  si: true,
  non: false,
  no: false,
  false: false,
  faux: false,
  "0": false,
  nein: false,
};

type Sink = { issues: ImportIssue[]; row: number; sheet: string };

function warn(s: Sink, code: string, vars: Record<string, string | number> = {}) {
  s.issues.push(makeIssue(HR_IMPORT_ISSUES, "warning", s.row, code, vars, s.sheet));
}
function fail(s: Sink, code: string, vars: Record<string, string | number> = {}) {
  s.issues.push(makeIssue(HR_IMPORT_ISSUES, "error", s.row, code, vars, s.sheet));
}

/** Matricule : un nombre (cellule Excel numérique) perd ses zéros de tête — on le rattache au
 *  matricule existant zéro-paddé correspondant s'il y en a un, avec avertissement. */
function readMatricule(v: unknown, knownIds: string[], s: Sink | null): string {
  if (typeof v === "number" && Number.isFinite(v)) {
    const raw = String(v);
    const padded = knownIds.find(
      (id) => id !== raw && /^0+\d+$/.test(id) && id.replace(/^0+/, "") === raw
    );
    if (padded) {
      if (s) warn(s, "matriculeZeroPadded", { value: raw, id: padded });
      return padded;
    }
    if (s && knownIds.some((id) => /^0\d/.test(id))) warn(s, "matriculeNumeric", { value: raw });
    return raw;
  }
  return text(v);
}

type Read<T> = { kind: "empty" } | { kind: "ok"; value: T } | { kind: "invalid"; raw: string };

function readNumber(row: Record<string, unknown>, col: string): Read<number> {
  if (!(col in row)) return { kind: "empty" };
  const r = parseCellNumber(row[col]);
  if (!r) return { kind: "empty" };
  return r.ok ? { kind: "ok", value: r.value } : { kind: "invalid", raw: r.raw };
}

function readDate(row: Record<string, unknown>, col: string): Read<string> {
  if (!(col in row)) return { kind: "empty" };
  const r = parseCellDate(row[col]);
  if (!r) return { kind: "empty" };
  return r.ok ? { kind: "ok", value: r.value } : { kind: "invalid", raw: r.raw };
}

/** Lit un nombre ; en cas de valeur illisible : avertissement et valeur existante conservée
 *  (création : `fallback`). */
function numberField(
  row: Record<string, unknown>,
  col: string,
  s: Sink,
  isNew: boolean,
  fallback: number
): number | undefined {
  const r = readNumber(row, col);
  if (r.kind === "ok") return r.value;
  if (r.kind === "invalid") {
    if (isNew) warn(s, "invalidNumberDefault", { column: col, value: r.raw, fallback });
    else warn(s, "invalidNumberKept", { column: col, value: r.raw });
  }
  return undefined;
}

function boolField(row: Record<string, unknown>, col: string, s: Sink): boolean | undefined {
  if (!has(row, col)) return undefined;
  const raw = text(row[col]);
  const b = BOOL_SYNONYMS[enumKey(raw)];
  if (b === undefined) warn(s, "unknownEnumKept", { column: col, value: raw });
  return b;
}

type ImportContext = {
  levers: BeTrackData["levers"];
  employees: Employee[];
  movements: WorkforceMovement[];
  departments: { name: string }[];
  programs?: ProgramRef[];
};

function contextFrom(data: Pick<BeTrackData, "levers" | "workforce">, programs?: ProgramRef[]) {
  return {
    levers: data.levers ?? [],
    employees: data.workforce?.employees ?? [],
    movements: data.workforce?.movements ?? [],
    departments: data.workforce?.departments ?? [],
    programs,
  } satisfies ImportContext;
}

function isBlankRow(row: Record<string, unknown>): boolean {
  return Object.entries(row).every(([k, v]) => k === "__rowNum__" || isBlankCell(v));
}

// ---------- Import : employés ----------

export type ParsedEmployeeRow = {
  /** Enregistrement fusionné (existant + colonnes renseignées), null si ligne rejetée. */
  values: Employee | null;
  isNew: boolean;
  /** false = ligne identique à l'existant (aucune écriture nécessaire). */
  changed: boolean;
  /** Rendu français des anomalies (compat). */
  warnings: string[];
  issues: ImportIssue[];
};

function parseEmployee(
  row: Record<string, unknown>,
  ctx: ImportContext,
  rowNumber: number
): ParsedEmployeeRow {
  const s: Sink = { issues: [], row: rowNumber, sheet: HR_EMPLOYEE_SHEET };
  const done = (values: Employee | null, isNew: boolean, changed: boolean): ParsedEmployeeRow => ({
    values,
    isNew,
    changed,
    warnings: s.issues.map((i) => i.reason),
    issues: s.issues,
  });

  const id = readMatricule(
    row["Matricule"],
    ctx.employees.map((e) => e.id),
    s
  );
  const existing = id ? ctx.employees.find((e) => e.id === id) : undefined;
  const name = text(row["Nom"]);
  if (!id || (!existing && !name)) {
    fail(s, "missingIdOrName");
    return done(null, false, false);
  }
  const isNew = !existing;
  const patch: Partial<Employee> = {};

  const textCols: [string, keyof Employee][] = [
    ["Nom", "name"],
    ["Direction", "direction"],
    ["RH local", "hrOwner"],
    ["Région", "region"],
    ["Pays", "country"],
    ["Fonction", "func"],
    ["Équipe", "team"],
    ["BU", "bu"],
    ["Entité", "entity"],
  ];
  for (const [col, key] of textCols) {
    if (has(row, col)) (patch as Record<string, unknown>)[key] = text(row[col]);
  }

  if (has(row, "Département")) {
    const raw = text(row["Département"]);
    const known = ctx.departments.find((d) => enumKey(d.name) === enumKey(raw));
    if (!known) warn(s, "unknownDepartment", { value: raw });
    patch.department = known?.name ?? raw;
  }

  if (has(row, "Niveau")) {
    const raw = text(row["Niveau"]);
    const level = LEVEL_SYNONYMS[enumKey(raw)];
    if (level) patch.level = level;
    else if (isNew)
      warn(s, "unknownEnumDefault", { column: "Niveau", value: raw, fallback: "Local" });
    else warn(s, "unknownEnumKept", { column: "Niveau", value: raw });
  } else if (isNew) {
    warn(s, "emptyDefault", { column: "Niveau", fallback: "Local" });
  }

  const fte = numberField(row, "ETP", s, isNew, 1);
  if (fte !== undefined) patch.fte = fte;
  else if (isNew && readNumber(row, "ETP").kind === "empty")
    warn(s, "emptyDefault", { column: "ETP", fallback: 1 });
  const salary = numberField(row, "Salaire brut annuel (€)", s, isNew, 0);
  if (salary !== undefined) patch.salary = salary;

  const hire = readDate(row, "Date d'entrée");
  if (hire.kind === "ok") patch.hireDate = hire.value;
  else if (hire.kind === "invalid")
    warn(s, isNew ? "invalidDateEmpty" : "invalidDateKept", {
      column: "Date d'entrée",
      value: hire.raw,
    });

  // "Départ retraite" : texte libre (date, année ou mention) — une date Excel est normalisée.
  if (has(row, "Départ retraite")) {
    const v = row["Départ retraite"];
    const d = v instanceof Date ? parseCellDate(v) : undefined;
    patch.retirement = d?.ok ? d.value : text(v);
  }

  const base: Employee = {
    id,
    name,
    region: "",
    country: "",
    department: "",
    direction: "",
    hrOwner: "",
    func: "",
    team: "",
    bu: "",
    entity: "",
    level: "Local",
    fte: 1,
    salary: 0,
    hireDate: "",
    retirement: "",
  };
  const merged: Employee = { ...(existing ?? base), ...patch, id: existing?.id ?? id };
  const changed =
    isNew || (Object.keys(patch) as (keyof Employee)[]).some((k) => existing![k] !== merged[k]);
  return done(merged, isNew, changed);
}

/** Analyse une ligne "Base ETP" (colonnes tolérées : casse/accents/espaces). */
export function parseEmployeeRow(
  row: Record<string, unknown>,
  data: Pick<BeTrackData, "levers" | "workforce">,
  rowNumber: number
): ParsedEmployeeRow {
  const canonical = canonicalizeRowKeys(row, HR_EMPLOYEE_HEADERS).row;
  return parseEmployee(canonical, contextFrom(data), rowNumber);
}

// ---------- Import : mouvements ----------

export type ParsedMovementRow = {
  /** Mouvement fusionné (existant + colonnes renseignées). `id` vide = à générer. */
  values: WorkforceMovement | null;
  isNew: boolean;
  changed: boolean;
  warnings: string[];
  issues: ImportIssue[];
};

function resolveProgram(raw: string, ctx: ImportContext): string | undefined {
  const knownIds = new Set<string>([
    ...(ctx.programs ?? []).map((p) => p.id),
    ...ctx.levers.map((l) => l.programId).filter((id): id is string => Boolean(id)),
  ]);
  if (knownIds.has(raw)) return raw;
  const byName = (ctx.programs ?? []).filter((p) => enumKey(p.name) === enumKey(raw));
  return byName.length === 1 ? byName[0].id : undefined;
}

function parseMovement(
  row: Record<string, unknown>,
  ctx: ImportContext,
  rowNumber: number,
  knownEmployeeIds: string[]
): ParsedMovementRow {
  const s: Sink = { issues: [], row: rowNumber, sheet: HR_MOVEMENT_SHEET };
  const done = (
    values: WorkforceMovement | null,
    isNew: boolean,
    changed: boolean
  ): ParsedMovementRow => ({
    values,
    isNew,
    changed,
    warnings: s.issues.map((i) => i.reason),
    issues: s.issues,
  });

  const id = text(row["ID mouvement"]);
  const existing = id ? ctx.movements.find((m) => m.id === id) : undefined;
  const isNew = !existing;
  const label = text(row["Employé / Poste"]);
  if (isNew && !label) {
    fail(s, "missingLabel");
    return done(null, true, false);
  }
  const patch: Partial<WorkforceMovement> = {};
  if (label) patch.label = label;

  // Type — obligatoire à la création, jamais deviné.
  let requiresRetraining = false;
  if (has(row, "Type")) {
    const raw = text(row["Type"]);
    const key = enumKey(raw);
    const exact = TYPE_SYNONYMS[key];
    const legacy = exact ? undefined : LEGACY_TYPE_ALIASES[key];
    if (exact) patch.type = exact;
    else if (legacy) {
      patch.type = legacy;
      requiresRetraining = key === "reconversion";
      warn(s, requiresRetraining ? "legacyTypeRetraining" : "legacyType", {
        value: raw,
        type: legacy,
      });
    } else {
      fail(s, "unknownType", {
        value: raw,
        expected: "Recrutement, Attrition, Départ forcé, Transfert entrant, Transfert sortant",
      });
      return done(null, isNew, false);
    }
  } else if (isNew) {
    fail(s, "missingType");
    return done(null, true, false);
  }

  // Date planifiée — obligatoire à la création.
  const planned = readDate(row, "Date planifiée");
  if (planned.kind === "ok") patch.plannedDate = planned.value;
  else if (planned.kind === "invalid") {
    if (isNew) {
      fail(s, "invalidRequiredDate", { column: "Date planifiée", value: planned.raw });
      return done(null, true, false);
    }
    warn(s, "invalidDateKept", { column: "Date planifiée", value: planned.raw });
  } else if (isNew) {
    fail(s, "missingRequiredDate", { column: "Date planifiée" });
    return done(null, true, false);
  }

  const actual = readDate(row, "Date réalisée");
  if (actual.kind === "ok") patch.actualDate = actual.value;
  else if (actual.kind === "invalid")
    warn(s, isNew ? "invalidDateEmpty" : "invalidDateKept", {
      column: "Date réalisée",
      value: actual.raw,
    });

  // Statut
  if (has(row, "Statut")) {
    const raw = text(row["Statut"]);
    const key = enumKey(raw);
    const status = STATUS_SYNONYMS[key];
    const legacy = status ? undefined : LEGACY_STATUS_ALIASES[key];
    if (status) patch.status = status;
    else if (legacy) {
      patch.status = legacy;
      warn(s, "legacyStatus", { value: raw, status: legacy });
    } else if (isNew) {
      patch.status = "Planifié";
      warn(s, "unknownEnumDefault", { column: "Statut", value: raw, fallback: "Planifié" });
    } else warn(s, "unknownEnumKept", { column: "Statut", value: raw });
  } else if (isNew) {
    patch.status = "Planifié";
    warn(s, "emptyDefault", { column: "Statut", fallback: "Planifié" });
  }

  const fte = numberField(row, "ETP concernés", s, isNew, 1);
  if (fte !== undefined) patch.fte = fte;
  else if (isNew && readNumber(row, "ETP concernés").kind === "empty")
    warn(s, "emptyDefault", { column: "ETP concernés", fallback: 1 });
  const salaryImpact = numberField(row, "Impact masse salariale (€/an)", s, isNew, 0);
  if (salaryImpact !== undefined) patch.salaryImpact = salaryImpact;
  const savings = numberField(row, "Économies (€)", s, isNew, 0);
  if (savings !== undefined) patch.savings = savings;
  const cost = numberField(row, "Coût one-off (€)", s, isNew, 0);
  if (cost !== undefined) patch.cost = cost;

  if (has(row, "Département")) patch.department = text(row["Département"]);
  if (has(row, "Département d'arrivée")) patch.toDepartment = text(row["Département d'arrivée"]);
  if (has(row, "Pays")) patch.country = text(row["Pays"]);
  if (has(row, "RH local")) patch.hrOwner = text(row["RH local"]);
  if (has(row, "Commentaire")) patch.comment = text(row["Commentaire"]);

  const hrValidated = boolField(row, "Validé RH", s);
  if (hrValidated !== undefined) patch.hrValidated = hrValidated;

  // Dispositif social (le booléen "PSE" historique n'est lu qu'en l'absence de dispositif).
  if (has(row, "Dispositif social")) {
    const raw = text(row["Dispositif social"]);
    let scheme = SOCIAL_SCHEME_SYNONYMS[enumKey(raw)];
    if (!scheme) {
      warn(s, "unknownSocialScheme", { value: raw });
      scheme = "Autre";
    }
    patch.socialScheme = scheme;
    patch.inPSE = scheme === "PSE";
  } else if (boolField(row, "PSE", s) === true) {
    patch.socialScheme = "PSE";
    patch.inPSE = true;
  }

  // Levier : ne réaffecte chantier/fonction/programme que si le levier CHANGE (sinon on
  // conserverait mal des valeurs saisies à la main sur le mouvement).
  let leverProgramId: string | undefined = existing
    ? ctx.levers.find((l) => l.id === existing.leverId)?.programId
    : undefined;
  if (has(row, "Levier (code)")) {
    const raw = text(row["Levier (code)"]);
    const lever = ctx.levers.find((l) => enumKey(l.code) === enumKey(raw) || l.id === raw);
    if (!lever) warn(s, "unknownLever", { value: raw });
    else if (!existing || lever.id !== existing.leverId) {
      patch.leverId = lever.id;
      patch.workstream = lever.ws;
      patch.function = lever.function;
      if (lever.programId) patch.programId = lever.programId;
      leverProgramId = lever.programId;
    }
  }

  if (has(row, "Programme")) {
    const raw = text(row["Programme"]);
    const programId = resolveProgram(raw, ctx);
    const effective = patch.programId ?? existing?.programId ?? leverProgramId;
    if (!programId) warn(s, "unknownProgram", { value: raw });
    else if (programId !== effective) patch.programId = programId;
  }

  const type = patch.type ?? existing?.type;
  if (has(row, "Matricule")) {
    const empId = readMatricule(row["Matricule"], knownEmployeeIds, s);
    if (type === "Recrutement") {
      if (!existing || existing.empId !== null) warn(s, "recruitmentEmpIdIgnored", { id: empId });
      patch.empId = null;
    } else {
      if (!knownEmployeeIds.includes(empId)) warn(s, "unknownEmployee", { id: empId });
      patch.empId = empId;
    }
  } else if (patch.type === "Recrutement") {
    patch.empId = null;
  }

  const defaults: WorkforceMovement = {
    id,
    empId: null,
    label,
    leverId: "",
    type: "Transfert entrant",
    fte: 1,
    department: "",
    country: "",
    hrOwner: "",
    plannedDate: "",
    actualDate: null,
    status: "Planifié",
    hrValidated: false,
    salaryImpact: 0,
    savings: 0,
    cost: 0,
  };
  const merged: WorkforceMovement = { ...(existing ?? defaults), ...patch };
  if (requiresRetraining) merged.requiresRetraining = true;
  if (isNew && id) warn(s, "unknownMovementIdCreated", { id });

  // Cohérence statut / validation / date réelle (avertissements, jamais corrigés d'office).
  if (merged.hrValidated && merged.status !== "Réalisé")
    warn(s, "hrValidatedNotRealised", { status: merged.status });
  if (merged.actualDate && merged.status !== "Réalisé")
    warn(s, "actualDateNotRealised", { status: merged.status });

  const changed =
    isNew ||
    (requiresRetraining && !existing!.requiresRetraining) ||
    (Object.keys(patch) as (keyof WorkforceMovement)[]).some(
      (k) => JSON.stringify(existing![k]) !== JSON.stringify(merged[k])
    );
  return done(merged, isNew, changed);
}

/** Analyse une ligne "Mouvements" (colonnes tolérées : casse/accents/espaces). */
export function parseMovementRow(
  row: Record<string, unknown>,
  data: Pick<BeTrackData, "levers" | "workforce">,
  rowNumber: number,
  programs?: ProgramRef[]
): ParsedMovementRow {
  const canonical = canonicalizeRowKeys(row, HR_MOVEMENT_HEADERS).row;
  const ctx = contextFrom(data, programs);
  return parseMovement(
    canonical,
    ctx,
    rowNumber,
    ctx.employees.map((e) => e.id)
  );
}

// ---------- Import : plan complet (les deux feuilles) ----------

export type HrImportPlan = {
  /** Employés à écrire (créés + modifiés), enregistrements complets. */
  employees: Employee[];
  /** Mouvements à écrire (créés + modifiés), ids définitifs attribués. */
  movements: WorkforceMovement[];
  createdEmployees: number;
  updatedEmployees: number;
  unchangedEmployees: number;
  createdMovements: number;
  updatedMovements: number;
  unchangedMovements: number;
  /** Lignes rejetées (au moins une erreur). */
  rejectedRows: number;
  issues: ImportIssue[];
};

type PreparedRow = { row: Record<string, unknown>; rowNumber: number };

function prepareRows(
  rawRows: Record<string, unknown>[],
  headers: readonly string[],
  sheet: string,
  required: string[],
  issues: ImportIssue[]
): PreparedRow[] | null {
  const unknown = new Set<string>();
  const present = new Set<string>();
  const out: PreparedRow[] = [];
  rawRows.forEach((raw, i) => {
    const { row, unknown: u } = canonicalizeRowKeys(raw, headers);
    u.forEach((c) => unknown.add(c));
    Object.keys(row).forEach((k) => present.add(k));
    if (isBlankRow(row)) return;
    out.push({ row, rowNumber: excelRowNumber(raw, i) });
  });
  if (rawRows.length > 0) {
    // "A|B" = l'une ou l'autre colonne suffit.
    const missing = required.filter((c) => !c.split("|").some((alt) => present.has(alt)));
    if (missing.length > 0) {
      issues.push(
        makeIssue(
          HR_IMPORT_ISSUES,
          "error",
          0,
          "missingColumns",
          { columns: missing.map((c) => c.split("|").join(" / ")).join(", ") },
          sheet
        )
      );
      return null;
    }
  }
  unknown.forEach((column) =>
    issues.push(makeIssue(HR_IMPORT_ISSUES, "warning", 0, "unknownColumn", { column }, sheet))
  );
  return out;
}

/** Rejette TOUTES les lignes partageant un même identifiant (on ne sait pas laquelle est juste). */
function duplicateRows(
  rows: PreparedRow[],
  idOf: (r: PreparedRow) => string,
  code: string,
  sheet: string,
  issues: ImportIssue[]
): Set<number> {
  const byId = new Map<string, number[]>();
  for (const r of rows) {
    const id = idOf(r);
    if (!id) continue;
    byId.set(id, [...(byId.get(id) ?? []), r.rowNumber]);
  }
  const rejected = new Set<number>();
  byId.forEach((rowNumbers, id) => {
    if (rowNumbers.length < 2) return;
    for (const n of rowNumbers) {
      rejected.add(n);
      issues.push(
        makeIssue(HR_IMPORT_ISSUES, "error", n, code, { id, rows: rowNumbers.join(", ") }, sheet)
      );
    }
  });
  return rejected;
}

/**
 * Construit le plan d'import des deux feuilles (lignes brutes `sheet_to_json`) sans rien écrire :
 * enregistrements fusionnés à écrire + compteurs + anomalies. L'appelant écrit le tout en une fois
 * (`useBeTrackData().importWorkforce`).
 */
export function buildHrImportPlan(
  sheets: { employeeRows?: Record<string, unknown>[]; movementRows?: Record<string, unknown>[] },
  data: Pick<BeTrackData, "levers" | "workforce">,
  programs?: ProgramRef[]
): HrImportPlan {
  const ctx = contextFrom(data, programs);
  const issues: ImportIssue[] = [];
  const plan: HrImportPlan = {
    employees: [],
    movements: [],
    createdEmployees: 0,
    updatedEmployees: 0,
    unchangedEmployees: 0,
    createdMovements: 0,
    updatedMovements: 0,
    unchangedMovements: 0,
    rejectedRows: 0,
    issues,
  };

  // --- Employés ---
  const empRows =
    prepareRows(
      sheets.employeeRows ?? [],
      HR_EMPLOYEE_HEADERS,
      HR_EMPLOYEE_SHEET,
      // "Nom" n'est obligatoire que pour une création (contrôlé ligne par ligne) : un fichier de
      // mise à jour partielle peut ne contenir que Matricule + colonnes modifiées.
      ["Matricule"],
      issues
    ) ?? [];
  const existingEmpIds = ctx.employees.map((e) => e.id);
  const dupEmp = duplicateRows(
    empRows,
    (r) => readMatricule(r.row["Matricule"], existingEmpIds, null),
    "duplicateEmployeeId",
    HR_EMPLOYEE_SHEET,
    issues
  );
  plan.rejectedRows += dupEmp.size;
  for (const r of empRows) {
    if (dupEmp.has(r.rowNumber)) continue;
    const parsed = parseEmployee(r.row, ctx, r.rowNumber);
    issues.push(...parsed.issues);
    if (!parsed.values) {
      plan.rejectedRows += 1;
      continue;
    }
    if (parsed.isNew) plan.createdEmployees += 1;
    else if (parsed.changed) plan.updatedEmployees += 1;
    else plan.unchangedEmployees += 1;
    if (parsed.changed) plan.employees.push(parsed.values);
  }

  // --- Mouvements ---
  const knownEmployeeIds = Array.from(
    new Set([...existingEmpIds, ...plan.employees.map((e) => e.id)])
  );
  const movRows =
    prepareRows(
      sheets.movementRows ?? [],
      HR_MOVEMENT_HEADERS,
      HR_MOVEMENT_SHEET,
      ["ID mouvement|Employé / Poste"],
      issues
    ) ?? [];
  const dupMov = duplicateRows(
    movRows,
    (r) => text(r.row["ID mouvement"]),
    "duplicateMovementId",
    HR_MOVEMENT_SHEET,
    issues
  );
  plan.rejectedRows += dupMov.size;
  const usedIds = new Set<string>([
    ...ctx.movements.map((m) => m.id),
    ...movRows.map((r) => text(r.row["ID mouvement"])).filter(Boolean),
  ]);
  for (const r of movRows) {
    if (dupMov.has(r.rowNumber)) continue;
    const parsed = parseMovement(r.row, ctx, r.rowNumber, knownEmployeeIds);
    issues.push(...parsed.issues);
    if (!parsed.values) {
      plan.rejectedRows += 1;
      continue;
    }
    const values = parsed.values;
    if (!values.id) {
      values.id = nextMovementId(Array.from(usedIds));
      usedIds.add(values.id);
    }
    if (parsed.isNew) plan.createdMovements += 1;
    else if (parsed.changed) plan.updatedMovements += 1;
    else plan.unchangedMovements += 1;
    if (parsed.changed) plan.movements.push(values);
  }

  issues.sort(
    (a, b) =>
      (a.sheet ?? "").localeCompare(b.sheet ?? "") ||
      a.rowNumber - b.rowNumber ||
      (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1)
  );
  return plan;
}
