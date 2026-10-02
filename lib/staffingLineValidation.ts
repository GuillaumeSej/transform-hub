import type { ChantierStaffing } from "@/types";
import { normalizeHeaderKey } from "@/lib/excelParse";
import { formatFte } from "@/lib/format";

/**
 * Validation PURE d'une ligne de staffing (« ETP mobilisés ») — RÈGLE UNIQUE partagée par :
 * - la saisie à l'écran : `ChantierStaffingEditor.tsx` (fiche chantier/projet, persisté) et
 *   `StaffingDraftTable.tsx` (brouillon de création de projet), via `validateStaffingLine` ;
 * - l'import Excel « Effectifs » (`lib/staffingExcelImport.ts`) et la feuille « ETP » de l'import
 *   du plan stratégique (`lib/strategicExcelImport.ts`), via `checkStaffingLine` (valeurs déjà lues
 *   dans les cellules par `lib/excelParse.ts`).
 * Une même ligne obéit ainsi aux mêmes règles quel que soit l'endroit où elle est saisie (audit
 * lot 4 : l'écran, l'import Effectifs et l'import du plan appliquaient chacun leurs propres bornes
 * et l'import du plan acceptait n'importe quelle équipe).
 *
 * Règles :
 * - équipe OBLIGATOIRE — jamais pré-remplie à l'écran ; elle doit exister dans la base ETP
 *   (`knownTeams`, comparaison insensible à la casse/aux accents/aux espaces). Exception : une
 *   ligne EXISTANTE dont l'équipe a quitté la base ETP depuis la saisie reste modifiable (simple
 *   avertissement `teamLeftBase`) ;
 * - nombre d'ETP OBLIGATOIRE, nombre (virgule décimale acceptée), strictement positif — AUCUN
 *   plafond fixe (décision PO : l'ancien plafond de 5 ETP par ligne n'était qu'un garde-fou
 *   anti-faute de frappe, pas une règle métier) ;
 * - nombre d'ETP SUPÉRIEUR à l'effectif disponible de l'équipe dans la base ETP : simple
 *   AVERTISSEMENT `fteAboveTeam`, non bloquant (même « disponible » que le taux de staffing,
 *   `availableForTeam` de `lib/staffingRate.ts`) ; disponible inconnu (0 ou non chargé) = pas
 *   d'avertissement ;
 * - dates de début ET de fin OBLIGATOIRES, fin ≥ début ;
 * - dates hors de la période du projet de rattachement : simple AVERTISSEMENT, non bloquant.
 *
 * Retourne des CODES (pas de libellés) : la traduction reste l'affaire de l'appelant (`t()` pour
 * l'écran, gabarits d'anomalie pour les imports).
 */

export type StaffingLineInput = {
  team: string;
  fte: string;
  startDate: string;
  endDate: string;
};

export type StaffingLineError =
  | "teamRequired"
  | "teamUnknown"
  | "fteRequired"
  | "fteInvalid"
  | "fteNotPositive"
  | "startRequired"
  | "startInvalid"
  | "endRequired"
  | "endInvalid"
  | "endBeforeStart";

export type StaffingLineWarning = "outsideProject" | "teamLeftBase" | "fteAboveTeam";

export type StaffingLineValidation = {
  valid: boolean;
  errors: Partial<Record<keyof StaffingLineInput, StaffingLineError>>;
  warnings: StaffingLineWarning[];
  /** ETP parsé (nombre) quand le champ est valide, `null` sinon. */
  fte: number | null;
  /** Équipe retenue : orthographe de la base ETP quand elle y figure, sinon la saisie. */
  team: string;
  /** Effectif disponible de l'équipe dans la base ETP (`teamAvailableFte`) quand il est connu
   *  (> 0), `null` sinon — repris par le message de l'avertissement `fteAboveTeam`. */
  teamAvailableFte: number | null;
};

/** Contexte de validation, commun à l'écran et aux imports. */
export type StaffingLineRules = {
  /** Période du projet de rattachement (avertissement « hors période »). */
  projectRange?: { start?: string | null; end?: string | null } | null;
  /** Équipes de la base ETP de l'entreprise. Absent = référentiel indisponible (chargement en
   *  cours, appel historique) : l'équipe n'est alors pas contrôlée. Liste vide = aucune équipe :
   *  toute équipe est inconnue. */
  knownTeams?: readonly string[];
  /** Équipe déjà enregistrée sur la ligne modifiée : acceptée même si elle a quitté la base ETP
   *  (avertissement `teamLeftBase` au lieu de l'erreur `teamUnknown`). */
  currentTeam?: string | null;
  /** Effectif DISPONIBLE par équipe dans la base ETP (`useCompanyDepartments().fteByDept`, même
   *  notion que le taux de staffing — voir `availableForTeam`, `lib/staffingRate.ts`). Une ligne
   *  dont le nombre d'ETP le dépasse reçoit l'avertissement `fteAboveTeam` (non bloquant). Absent,
   *  équipe absente ou disponible ≤ 0 = inconnu : pas d'avertissement. */
  teamAvailableFte?: Readonly<Record<string, number>>;
};

/** Valeurs d'une ligne DÉJÀ LUES (cellules Excel ou champs de formulaire) :
 *  `undefined` = vide, `null` = illisible. */
export type StaffingLineValues = {
  team: string;
  fte: number | null | undefined;
  /** Dates ISO "AAAA-MM-JJ". */
  startDate: string | null | undefined;
  endDate: string | null | undefined;
};

/** Saisie numérique tolérante à la virgule décimale. `null` = invalide (vide compris) : un ETP doit
 *  être strictement positif, une ligne à 0 ETP n'aurait aucun sens dans les agrégats. */
export function parseFte(raw: string): number | null {
  const n = readFteText(raw);
  return typeof n === "number" && n > 0 ? n : null;
}

/** Texte → nombre : `undefined` si vide, `null` si illisible. */
function readFteText(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!/^[+-]?(\d+([.,]\d+)?|[.,]\d+)$/.test(trimmed)) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Date ISO simple "YYYY-MM-DD" réellement existante (rejette "2026-02-30"). */
export function isIsoDate(value: string | undefined | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Ligne existante (données antérieures à la règle « dates obligatoires ») à compléter. */
export function isStaffingLineMissingDates(line: {
  startDate?: string | null;
  endDate?: string | null;
}): boolean {
  return !isIsoDate(line.startDate) || !isIsoDate(line.endDate);
}

const teamKey = (v: string) => normalizeHeaderKey(v);

/** Disponible de l'équipe dans la base ETP (orthographe exacte, comme `availableForTeam`, sinon
 *  comparaison normalisée) ; `null` = inconnu (équipe absente, disponible nul ou négatif). */
function teamAvailable(
  byTeam: Readonly<Record<string, number>> | undefined,
  team: string
): number | null {
  if (!byTeam || team === "") return null;
  let value: number | undefined = byTeam[team];
  if (value === undefined) {
    const key = Object.keys(byTeam).find((k) => teamKey(k) === teamKey(team));
    value = key === undefined ? undefined : byTeam[key];
  }
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Cœur de la règle, sur des valeurs déjà lues — utilisé tel quel par les imports Excel et, après
 * lecture des champs texte, par `validateStaffingLine` (écran).
 */
export function checkStaffingLine(
  values: StaffingLineValues,
  rules: StaffingLineRules = {}
): StaffingLineValidation {
  const errors: StaffingLineValidation["errors"] = {};
  const warnings: StaffingLineWarning[] = [];

  const rawTeam = values.team.trim();
  let team = rawTeam;
  if (rawTeam === "") errors.team = "teamRequired";
  else if (rules.knownTeams) {
    const known = rules.knownTeams.find((d) => teamKey(d) === teamKey(rawTeam));
    if (known) team = known;
    else if (rules.currentTeam && teamKey(rules.currentTeam) === teamKey(rawTeam)) {
      team = rules.currentTeam;
      warnings.push("teamLeftBase");
    } else errors.team = "teamUnknown";
  }

  const fte = values.fte;
  if (fte === undefined) errors.fte = "fteRequired";
  else if (fte === null || !Number.isFinite(fte)) errors.fte = "fteInvalid";
  else if (fte <= 0) errors.fte = "fteNotPositive";

  // Plus de plafond fixe : au-delà de l'effectif de l'équipe dans la base ETP, simple
  // avertissement (faute de frappe probable, « 80 » pour 0,8) — l'enregistrement reste possible.
  const available = errors.team ? null : teamAvailable(rules.teamAvailableFte, team);
  if (!errors.fte && available !== null && (fte as number) > available + 1e-9)
    warnings.push("fteAboveTeam");

  const start = values.startDate;
  const end = values.endDate;
  if (start === undefined || start === "") errors.startDate = "startRequired";
  else if (start === null || !isIsoDate(start)) errors.startDate = "startInvalid";
  if (end === undefined || end === "") errors.endDate = "endRequired";
  else if (end === null || !isIsoDate(end)) errors.endDate = "endInvalid";

  const datesOk = !errors.startDate && !errors.endDate;
  // Comparaison lexicographique valide sur des dates ISO "YYYY-MM-DD" déjà validées.
  if (datesOk && (end as string) < (start as string)) errors.endDate = "endBeforeStart";

  if (datesOk && !errors.endDate && rules.projectRange) {
    const pStart = isIsoDate(rules.projectRange.start) ? rules.projectRange.start : null;
    const pEnd = isIsoDate(rules.projectRange.end) ? rules.projectRange.end : null;
    if ((pStart && (start as string) < pStart) || (pEnd && (end as string) > pEnd))
      warnings.push("outsideProject");
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    warnings,
    fte: errors.fte ? null : (fte as number),
    team,
    teamAvailableFte: available,
  };
}

/** Validation du mini-formulaire de l'écran (champs texte). Le 2e paramètre accepte encore une
 *  simple période de projet (appels historiques) ou l'ensemble des règles. */
export function validateStaffingLine(
  input: StaffingLineInput,
  projectRangeOrRules?: { start?: string | null; end?: string | null } | StaffingLineRules | null
): StaffingLineValidation {
  const rules: StaffingLineRules =
    projectRangeOrRules &&
    ("knownTeams" in projectRangeOrRules ||
      "currentTeam" in projectRangeOrRules ||
      "teamAvailableFte" in projectRangeOrRules ||
      "projectRange" in projectRangeOrRules)
      ? (projectRangeOrRules as StaffingLineRules)
      : { projectRange: projectRangeOrRules as StaffingLineRules["projectRange"] };
  const date = (v: string) => {
    const s = v.trim();
    if (s === "") return undefined;
    return isIsoDate(s) ? s : null;
  };
  return checkStaffingLine(
    {
      team: input.team,
      fte: readFteText(input.fte),
      startDate: date(input.startDate),
      endDate: date(input.endDate),
    },
    rules
  );
}

/** Clés i18n + libellé français de repli pour chaque code d'erreur/avertissement (`{fte}`,
 *  `{team}` et `{dispo}` remplis par `staffingLineMessage`). */
export const STAFFING_LINE_MESSAGES: Record<
  StaffingLineError | StaffingLineWarning,
  [key: string, fallback: string]
> = {
  teamRequired: ["staffing.validation.teamRequired", "Choisissez une équipe."],
  teamUnknown: ["staffing.validation.teamUnknown", "Cette équipe n'existe pas dans la base ETP."],
  teamLeftBase: [
    "staffing.validation.teamLeftBase",
    "Attention : cette équipe ne figure plus dans la base ETP.",
  ],
  fteRequired: ["staffing.validation.fteRequired", "Indiquez le nombre d'ETP."],
  fteInvalid: ["staffing.validation.fteInvalid", "Le nombre d'ETP doit être un nombre (ex. 0,5)."],
  fteNotPositive: [
    "staffing.validation.fteNotPositive",
    "Le nombre d'ETP doit être strictement positif.",
  ],
  fteAboveTeam: [
    "staffing.validation.fteAboveTeam",
    "{fte} ETP sur cette ligne, au-delà de l'effectif de l'équipe {team} dans la base ETP ({dispo} ETP) — vérifiez la saisie.",
  ],
  startRequired: ["staffing.validation.startRequired", "La date de début est obligatoire."],
  startInvalid: ["staffing.validation.startInvalid", "Date de début invalide."],
  endRequired: ["staffing.validation.endRequired", "La date de fin est obligatoire."],
  endInvalid: ["staffing.validation.endInvalid", "Date de fin invalide."],
  endBeforeStart: [
    "staffing.validation.endBeforeStart",
    "La date de fin doit être postérieure ou égale à la date de début.",
  ],
  outsideProject: [
    "staffing.validation.outsideProject",
    "Attention : ces dates sortent de la période du projet.",
  ],
};

// ---------- Rapprochement d'une ligne importée avec le staffing existant ----------

/** Ligne d'import à rapprocher (`matched` est renseigné par `matchStaffingRows`). */
export type StaffingMatchRow = {
  rowNumber: number;
  chantierId: string;
  actionId?: string;
  /** Équipe telle que saisie (comparée normalisée). */
  fn: string;
  startDate?: string;
  endDate?: string;
  /** Colonne technique "ID ligne" (vide = nouvelle ligne ou fichier antérieur). */
  lineId: string;
  matched?: ChantierStaffing;
};

function looseStaffingKey(chantierId: string, fn: string, actionId: string | undefined): string {
  return [chantierId, teamKey(fn), actionId ?? ""].join("|");
}

/** Clé métier exacte d'une ligne : chantier + équipe + levier/projet + début + fin. */
export function staffingBusinessKey(
  chantierId: string,
  fn: string,
  startDate: string | undefined,
  endDate: string | undefined,
  actionId: string | undefined
): string {
  return [looseStaffingKey(chantierId, fn, actionId), startDate ?? "", endDate ?? ""].join("|");
}

/**
 * Rapproche les lignes d'un fichier du staffing existant (règle commune aux deux imports — audit
 * lot 4 : auparavant, changer une date dans un export créait un doublon) :
 * 1. par "ID ligne" quand il est renseigné et connu ;
 * 2. sinon par clé métier exacte (chantier + équipe + levier/projet + début + fin) ;
 * 3. sinon SANS les dates, si la correspondance est UNIQUE des deux côtés (une seule entrée
 *    existante libre, une seule ligne du fichier).
 * Une entrée existante n'est rapprochée qu'une fois. Renseigne `row.matched` ; renvoie les ID
 * présents plusieurs fois dans le fichier (lignes rejetées, non rapprochées) et les ID inconnus.
 */
export function matchStaffingRows<T extends StaffingMatchRow>(
  rows: T[],
  existing: ChantierStaffing[]
): { duplicateIds: Map<string, number[]>; unknownIds: { rowNumber: number; id: string }[] } {
  const rowsById = new Map<string, number[]>();
  for (const r of rows) {
    if (r.lineId) rowsById.set(r.lineId, [...(rowsById.get(r.lineId) ?? []), r.rowNumber]);
  }
  const duplicateIds = new Map(Array.from(rowsById).filter(([, list]) => list.length > 1));
  const rejected = new Set(Array.from(duplicateIds.values()).flat());
  const candidates = rows.filter((r) => !rejected.has(r.rowNumber));
  const unknownIds: { rowNumber: number; id: string }[] = [];
  const used = new Set<string>();
  const byId = new Map(existing.map((e) => [e.id, e]));

  for (const r of candidates) {
    if (!r.lineId) continue;
    const e = byId.get(r.lineId);
    if (e) {
      r.matched = e;
      used.add(e.id);
    } else unknownIds.push({ rowNumber: r.rowNumber, id: r.lineId });
  }
  for (const r of candidates) {
    if (r.matched || !r.fn) continue;
    const key = staffingBusinessKey(r.chantierId, r.fn, r.startDate, r.endDate, r.actionId);
    const e = existing.find(
      (s) =>
        !used.has(s.id) &&
        staffingBusinessKey(s.chantierId, s.function, s.startDate, s.endDate, s.actionId) === key
    );
    if (e) {
      r.matched = e;
      used.add(e.id);
    }
  }
  const pending = new Map<string, T[]>();
  for (const r of candidates) {
    if (r.matched || !r.fn) continue;
    const key = looseStaffingKey(r.chantierId, r.fn, r.actionId);
    pending.set(key, [...(pending.get(key) ?? []), r]);
  }
  pending.forEach((list, key) => {
    if (list.length !== 1) return;
    const free = existing.filter(
      (s) => !used.has(s.id) && looseStaffingKey(s.chantierId, s.function, s.actionId) === key
    );
    if (free.length !== 1) return;
    list[0].matched = free[0];
    used.add(free[0].id);
  });
  return { duplicateIds, unknownIds };
}

/** ETP affiché dans un message (2 décimales au plus, langue active). */
export function formatStaffingFte(value: number): string {
  return formatFte(value, { maximumFractionDigits: 2 });
}

/** Message traduit d'un code ; `{fte}`, `{team}` et `{dispo}` remplis depuis la validation. */
export function staffingLineMessage(
  t: (key: string, fallback?: string) => string,
  code: StaffingLineError | StaffingLineWarning,
  validation?: Pick<StaffingLineValidation, "fte" | "team" | "teamAvailableFte">
): string {
  const [key, fallback] = STAFFING_LINE_MESSAGES[code];
  const vars: Record<string, string> = {
    fte: validation?.fte != null ? formatStaffingFte(validation.fte) : "",
    team: validation?.team ?? "",
    dispo:
      validation?.teamAvailableFte != null ? formatStaffingFte(validation.teamAvailableFte) : "",
  };
  return t(key, fallback).replace(/\{(fte|team|dispo)\}/g, (_m, name: string) => vars[name]);
}
