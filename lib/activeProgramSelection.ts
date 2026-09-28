import { resolveProgramType } from "@/lib/axisLogic";
import type { Program, ProgramType } from "@/types";

/**
 * Règles PURES du « programme actif » unique de l'app (décision PO, audit fix #1) : UN seul
 * programme sélectionné pour toute l'application = celui du sélecteur du Topbar
 * (`ProgramSwitcher`, état porté par `useActiveProgram`). Les pages ne choisissent plus leur
 * programme elles-mêmes ; elles lisent ce contexte (ou, pour un sélecteur local conservé, en sont
 * une simple vue qui écrit dans le MÊME état).
 *
 * Isolées ici (sans React ni Firestore) pour être testées unitairement.
 */

/**
 * Valeur sentinelle de `activeProgramId` qui active la « vue consolidée » (voir
 * `useActiveProgram`). Définie ici (module pur) et ré-exportée par le hook.
 */
export const CONSOLIDATED_PROGRAM_ID = "__consolidated__";

/** Paramètre d'URL historique (`/dashboard?program=…`) — conservé UNIQUEMENT comme point
 *  d'entrée : il pose le programme actif au chargement, puis est retiré de l'URL. */
export const PROGRAM_URL_PARAM = "program";

export type ActiveSelection =
  { kind: "none" } | { kind: "consolidated" } | { kind: "program"; program: Program };

/**
 * Résout la sélection effective à partir des ids candidats, par ordre de préférence (ex. `?program=`
 * d'un lien entrant, puis choix mémorisé en localStorage). Le premier candidat VALIDE l'emporte :
 *  - `CONSOLIDATED_PROGRAM_ID` n'est valide que si l'utilisateur a une vue consolidée
 *    (`canConsolidate`) ;
 *  - un id de programme n'est valide que s'il fait partie des programmes SÉLECTIONNABLES :
 *    `authorizedPrograms` (voir `getAuthorizedPrograms`), ou — repli historique pour un compte dont
 *    aucun profil ne couvre de programme (admin global, compte en cours de configuration) — tous
 *    les programmes de l'entreprise.
 * Aucun candidat valide : premier programme sélectionnable (comportement historique), ou rien.
 */
export function resolveActiveSelection(input: {
  candidates: (string | null | undefined)[];
  programs: Program[];
  authorizedPrograms: Program[];
  canConsolidate: boolean;
}): ActiveSelection {
  const { candidates, programs, authorizedPrograms, canConsolidate } = input;
  if (programs.length === 0) return { kind: "none" };
  const selectable = selectablePrograms(programs, authorizedPrograms);
  for (const id of candidates) {
    if (!id) continue;
    if (id === CONSOLIDATED_PROGRAM_ID) {
      if (canConsolidate) return { kind: "consolidated" };
      continue;
    }
    const program = selectable.find((p) => p.id === id);
    if (program) return { kind: "program", program };
  }
  return selectable.length > 0 ? { kind: "program", program: selectable[0] } : { kind: "none" };
}

/** Programmes sélectionnables un à un : les programmes autorisés, ou (repli) tous les programmes
 *  de l'entreprise quand aucun ne l'est explicitement. */
export function selectablePrograms(programs: Program[], authorizedPrograms: Program[]): Program[] {
  return authorizedPrograms.length > 0 ? authorizedPrograms : programs;
}

/** Programmes sélectionnables d'un type donné (ex. liste « Performance » d'une page RH). */
export function selectableProgramsOfType(
  programs: Program[],
  authorizedPrograms: Program[],
  type: ProgramType
): Program[] {
  return selectablePrograms(programs, authorizedPrograms).filter(
    (p) => resolveProgramType(p) === type
  );
}

/** Lit l'id de programme d'une query string (`?program=…`), ou null. */
export function readProgramParam(search: string): string | null {
  const value = new URLSearchParams(search).get(PROGRAM_URL_PARAM);
  return value ? value : null;
}

/** Retire `program` d'une query string ; renvoie la nouvelle query (avec `?`, ou "" si vide). */
export function stripProgramParam(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(PROGRAM_URL_PARAM);
  const next = params.toString();
  return next ? `?${next}` : "";
}

/**
 * Retire d'une query string tous les paramètres dont la clé satisfait `isProgramScoped` (ex. les
 * filtres `f_*` de la bibliothèque des leviers) ; renvoie la query SANS `?` (vide possible).
 */
export function stripParams(search: string, isProgramScoped: (key: string) => boolean): string {
  const params = new URLSearchParams(search);
  for (const key of Array.from(params.keys())) {
    if (isProgramScoped(key)) params.delete(key);
  }
  return params.toString();
}

/**
 * Faut-il réinitialiser l'état dérivé du programme (filtres de page, plages de dates…) ? Oui
 * seulement sur un VRAI changement de programme actif (`prev` et `next` connus et différents) —
 * jamais au premier rendu (`prev` null) : un lien profond arrivant avec des filtres dans l'URL
 * (ex. drill-down du dashboard vers `/levers?f_ws=…`) doit les conserver.
 */
export function shouldResetProgramScopedState(
  prev: string | null | undefined,
  next: string | null | undefined
): boolean {
  return !!prev && !!next && prev !== next;
}

/**
 * Programme à activer AVANT de suivre un lien portant un `programId` (portail « Mon espace ») :
 *  - rien si le lien n'a pas de programme, ou s'il vise déjà le programme actif ;
 *  - rien en vue consolidée si le programme visé en fait partie (le lien reste dans le périmètre
 *    affiché — inutile de faire sortir l'utilisateur de sa vue consolidée) ;
 *  - rien si le programme n'est pas sélectionnable par l'utilisateur (on navigue quand même, la
 *    page cible applique ses propres gardes) ;
 *  - sinon, l'id à passer à `setActiveProgramId`.
 */
export function programSwitchForLink(input: {
  targetProgramId: string | null | undefined;
  activeProgramId: string | null;
  isConsolidatedView: boolean;
  consolidatedProgramIds: string[];
  selectableProgramIds: string[];
}): string | null {
  const { targetProgramId, activeProgramId, isConsolidatedView } = input;
  if (!targetProgramId || targetProgramId === activeProgramId) return null;
  if (isConsolidatedView && input.consolidatedProgramIds.includes(targetProgramId)) return null;
  if (!input.selectableProgramIds.includes(targetProgramId)) return null;
  return targetProgramId;
}
