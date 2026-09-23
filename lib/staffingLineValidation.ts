/**
 * Validation PURE d'une ligne de staffing (« ETP mobilisés ») saisie dans le mini-formulaire
 * d'ajout/édition — partagée par `ChantierStaffingEditor.tsx` (fiche chantier/projet, persisté) et
 * `StaffingDraftTable.tsx` (brouillon de création de projet), pour qu'une même ligne obéisse aux
 * mêmes règles quel que soit l'endroit où elle est saisie.
 *
 * Règles (retour PO) :
 * - équipe OBLIGATOIRE — jamais pré-remplie, l'utilisateur doit la choisir explicitement ;
 * - nombre d'ETP OBLIGATOIRE, strictement positif, virgule décimale française acceptée ("0,5") ;
 * - dates de début ET de fin OBLIGATOIRES (plus de « toute la durée du projet » implicite), fin ≥ début ;
 * - dates hors de la période du projet de rattachement : simple AVERTISSEMENT, non bloquant.
 *
 * Retourne des CODES (pas de libellés) : la traduction reste l'affaire du composant (`t()`).
 */

export type StaffingLineInput = {
  team: string;
  fte: string;
  startDate: string;
  endDate: string;
};

export type StaffingLineError =
  | "teamRequired"
  | "fteRequired"
  | "fteInvalid"
  | "startRequired"
  | "startInvalid"
  | "endRequired"
  | "endInvalid"
  | "endBeforeStart";

export type StaffingLineWarning = "outsideProject";

export type StaffingLineValidation = {
  valid: boolean;
  errors: Partial<Record<keyof StaffingLineInput, StaffingLineError>>;
  warnings: StaffingLineWarning[];
  /** ETP parsé (nombre) quand le champ est valide, `null` sinon. */
  fte: number | null;
};

/** Saisie numérique tolérante à la virgule décimale. `null` = invalide (vide compris) : un ETP doit
 *  être strictement positif, une ligne à 0 ETP n'aurait aucun sens dans les agrégats. */
export function parseFte(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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

export function validateStaffingLine(
  input: StaffingLineInput,
  projectRange?: { start?: string | null; end?: string | null } | null
): StaffingLineValidation {
  const errors: StaffingLineValidation["errors"] = {};
  const warnings: StaffingLineWarning[] = [];

  if (input.team.trim() === "") errors.team = "teamRequired";

  const fte = parseFte(input.fte);
  if (input.fte.trim() === "") errors.fte = "fteRequired";
  else if (fte === null) errors.fte = "fteInvalid";

  const start = input.startDate.trim();
  const end = input.endDate.trim();
  if (start === "") errors.startDate = "startRequired";
  else if (!isIsoDate(start)) errors.startDate = "startInvalid";
  if (end === "") errors.endDate = "endRequired";
  else if (!isIsoDate(end)) errors.endDate = "endInvalid";

  const datesOk = !errors.startDate && !errors.endDate;
  // Comparaison lexicographique valide sur des dates ISO "YYYY-MM-DD" déjà validées.
  if (datesOk && end < start) errors.endDate = "endBeforeStart";

  if (datesOk && !errors.endDate && projectRange) {
    const pStart = isIsoDate(projectRange.start) ? projectRange.start : null;
    const pEnd = isIsoDate(projectRange.end) ? projectRange.end : null;
    if ((pStart && start < pStart) || (pEnd && end > pEnd)) warnings.push("outsideProject");
  }

  return { valid: Object.keys(errors).length === 0, errors, warnings, fte };
}

/** Clés i18n + libellé français de repli pour chaque code d'erreur/avertissement. */
export const STAFFING_LINE_MESSAGES: Record<
  StaffingLineError | StaffingLineWarning,
  [key: string, fallback: string]
> = {
  teamRequired: ["staffing.validation.teamRequired", "Choisissez une équipe."],
  fteRequired: ["staffing.validation.fteRequired", "Indiquez le nombre d'ETP."],
  fteInvalid: [
    "staffing.validation.fteInvalid",
    "Le nombre d'ETP doit être un nombre strictement positif (ex. 0,5).",
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
