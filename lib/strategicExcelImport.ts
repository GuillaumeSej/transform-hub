import type { WorkBook } from "xlsx";
import { baselineMeasurement, computeIndicatorStatus } from "@/lib/axisLogic";

/** Module SheetJS fourni PAR L'APPELANT aux fonctions qui lisent/composent un classeur : cette
 *  librairie n'importe jamais `xlsx` statiquement (elle est chargée par toutes les pages du plan
 *  stratégique), les composants font `await import("xlsx")` au clic et les tests passent le
 *  module réel — la logique reste pure et synchrone. */
export type XlsxModule = Pick<typeof import("xlsx"), "utils">;
import {
  canonicalizeRowKeys,
  excelRowNumber,
  isBlankCell,
  isPercentFormat,
  normalizeHeaderKey,
  parseCellDate,
  parseCellNumber,
} from "@/lib/excelParse";
import { applyExcelDateColumns, isClearMarker, readOptionalTextCell } from "@/lib/excelCells";
import {
  checkStaffingLine,
  formatStaffingFte,
  matchStaffingRows,
  staffingBusinessKey,
  type StaffingLineError,
  type StaffingMatchRow,
} from "@/lib/staffingLineValidation";
import {
  STAFFING_TEAMS_EMPTY_TEXT,
  STAFFING_TEAMS_RULE,
  appendStaffingTeamsSheet,
} from "@/lib/staffingExcelImport";
import { currentPeriod } from "@/lib/kpiHistory";
import type {
  Chantier,
  ChantierAction,
  ChantierDependency,
  ChantierDependencyType,
  ChantierStaffing,
  Deliverable,
  Indicator,
  IndicatorDirection,
  IndicatorFrequency,
  IndicatorKind,
  IndicatorMeasurement,
  MaturityStageConfig,
  Role,
  StrategicAxis,
} from "@/types";

/**
 * Import Excel d'un plan stratégique complet (Axes → Chantiers → Projets → Livrables →
 * Indicateurs → ETP), utilisé par `StrategicImportButton`. La librairie reste PURE (aucun import de
 * `lib/firestore/*`) : elle produit un aperçu (créations / mises à jour / inchangés + erreurs et
 * avertissements ligne par ligne) ; l'écriture a lieu dans l'appelant, après confirmation.
 *
 * Format : 6 feuilles de données (+ "Lisez-moi"), une ligne par entité.
 *  - "Axes" : `Code` = clé de liaison du fichier, désormais AUSSI conservée sur l'entité
 *    (`importCode`, voir « Ré-import » ci-dessous).
 *  - "Chantiers" : rattachés à un ou plusieurs axes via "Codes Axes (séparés par ;)" (ancien
 *    en-tête "Code Axe" accepté). Dépendances "Code:type" (FS/SS/FF/SF, FS si type omis) ; type
 *    inconnu, auto-dépendance et cycle = erreur de ligne.
 *  - "Projets" (type interne `ChantierAction` ; ancien nom de feuille "Actions" accepté) :
 *    rattachés via `Code Chantier`. Date début <= Date fin obligatoire.
 *  - "Livrables" (facultative) : embarqués dans le projet (`Code Projet`) de ce même fichier.
 *    Livrable = ÉCHÉANCE (colonne "Échéance" ; ancien "Fin" accepté, "Début" ignoré).
 *  - "Indicateurs" : `Code` FACULTATIF (clé de ré-import), rattachés à UN axe OU UN chantier.
 *  - "ETP" (facultative) : `ChantierStaffing`.
 *  - "Équipes" (référence, modèle ET export) : équipes de la base ETP et leur effectif disponible
 *    (`appendStaffingTeamsSheet`, partagé avec l'import Effectifs) — IGNORÉE à l'import (seules
 *    les feuilles de `SHEET_SPECS` sont lues).
 *
 * Ré-import (UPSERT) : chaque ligne est rapprochée d'une entité existante du programme, d'abord par
 * son `Code` (champ `importCode` stocké à la création, ou `id` BeTrack — c'est ce que produit
 * l'export), à défaut par NOM au sein du même parent (programme / axe / chantier) pour une entité
 * sans `importCode` (créée à la main ou par un import antérieur). Entité trouvée → mise à jour
 * (seulement si un champ change réellement), sinon création. Une cellule VIDE ne remplace jamais une
 * valeur existante (upsert non destructif). Réimporter le même fichier = 0 création, 0 mise à jour.
 * L'export (`buildStrategicPlanExportWorkbook`) produit le même format : aller-retour = 0 changement.
 *
 * Personnes (Sponsor d'axe, Sponsor de chantier, Responsable projet/Contributeurs de projet,
 * Responsables de saisie d'un indicateur) : la visibilité
 * (`lib/axisLogic.ts`) et le routage des validations comparent ces champs au `username`. Chaque
 * cellule est donc rapprochée des comptes de l'entreprise (`options.users`) par identifiant,
 * e-mail (synthétique ou partie locale) ou nom affiché (insensible casse/accents) et REMPLACÉE par
 * le `username` trouvé. Une valeur non rapprochée est conservée telle quelle, avec un avertissement,
 * et — si elle ressemble à "Prénom Nom" — proposée à la création de compte (`preview.people`) ;
 * l'appelant réécrit ensuite les entités avec `applyPeopleMapping` une fois les comptes créés.
 *
 * Mesure de référence ("Valeur initiale") : datée de la période PRÉCÉDANT la période courante
 * (`baselinePeriod`) — jamais la période courante, pour ne pas entrer en collision avec la première
 * vraie saisie du mois/trimestre en cours. Le statut de l'indicateur créé est calculé par
 * `computeIndicatorStatus` à partir de cette mesure (une baseline sous la cible = « à risque »).
 *
 * Messages : chaque erreur/avertissement porte un `code` (+ `vars`) traduit par l'UI
 * (`strategicImport.msg.<code>`) et un `reason` déjà rendu en français (fallback, tests).
 */

// ---------- En-têtes (modèle + export) ----------

// Colonnes « personne » nommées comme dans l'UI (rôle porté) : "Sponsor d'axe", "Sponsor de
// chantier", "Responsable projet". Les anciens en-têtes "Owner"/"Pilote" restent acceptés à
// l'import (alias, voir `SHEET_SPECS`).
export const STRATEGIC_AXIS_IMPORT_HEADERS = [
  "Code",
  "Nom",
  "Description",
  "Sponsor d'axe",
  "Couleur",
  "Étape de maturité",
] as const;

export const STRATEGIC_CHANTIER_IMPORT_HEADERS = [
  "Code",
  "Codes Axes (séparés par ;)",
  "Nom",
  "Description",
  "Sponsor de chantier",
  "Étape de maturité",
  "Budget alloué",
  "Budget consommé",
  "ETP consommés",
  "Dépendances (Code:type, séparées par ;)",
] as const;

// Nom de constante inchangé (`ACTION`, type interne `ChantierAction`) — feuille affichée "Projets".
export const STRATEGIC_ACTION_IMPORT_HEADERS = [
  "Code",
  "Code Chantier",
  "Nom",
  "Description",
  "Responsable projet",
  // (Ancienne colonne "Sponsor" de projet supprimée — `ChantierAction.sponsor` n'a plus de rôle :
  //  encore tolérée à l'import, mais ignorée avec un avertissement `projectSponsorIgnored`.)
  "Date début",
  "Date fin",
  "Étape de maturité",
  "Budget",
  "Budget consommé",
  "Poids dans le chantier (%)",
  // Facultatif : contributeurs projet (`ChantierAction.contributors`), rapprochés comme le
  // responsable projet.
  "Contributeurs (séparés par ;)",
] as const;

/** Livrable = ÉCHÉANCE (une seule date). Compatibilité : un ancien fichier aux colonnes
 *  "Début"/"Fin" s'importe toujours — "Fin" sert d'échéance, "Début" est ignoré. */
export const STRATEGIC_DELIVERABLE_IMPORT_HEADERS = ["Code Projet", "Label", "Échéance"] as const;

export const STRATEGIC_INDICATOR_IMPORT_HEADERS = [
  // Facultatif : clé de ré-import (voir doc-comment de tête). Vide = rapprochement par nom.
  "Code",
  "Code Axe",
  "Code Chantier",
  "Nom",
  "Type",
  "Fréquence",
  "Objectif",
  "Valeur cible",
  // Situation de départ du KPI → mesure de référence datée de la période précédente.
  "Valeur initiale",
  "Sens",
  "Unité",
  // LEGACY (droit de saisie par rôle) : lu seulement si aucun "Responsables saisie" — voir
  // `canFillIndicator`, lib/axisLogic.ts.
  "Rôles responsables (séparés par ;)",
  // Responsables de saisie NOMMÉS (`Indicator.additionalAuthorizedUserIds`), rapprochés comme les
  // autres colonnes « personne ».
  "Responsables saisie (séparés par ;)",
] as const;

export const STRATEGIC_STAFFING_IMPORT_HEADERS = [
  "Code Chantier",
  "Code Projet",
  "Fonction (équipe, base ETP)",
  "Nombre d'ETP",
  "Précision",
  "Date début",
  "Date fin",
  // Colonne technique (remplie par l'export) : rapprochement d'une ligne existante même quand ses
  // dates changent — voir `matchStaffingRows`, lib/staffingLineValidation.ts.
  "ID ligne",
] as const;

/** Longueurs maximales des champs texte (au-delà = erreur de ligne). */
export const STRATEGIC_IMPORT_MAX_NAME_LENGTH = 200;
export const STRATEGIC_IMPORT_MAX_TEXT_LENGTH = 5000;

// ---------- Libellés humains <-> valeurs internes ----------

const KIND_LABEL: Record<IndicatorKind, string> = {
  quantitative: "Quantitatif",
  qualitative: "Qualitatif",
};

const FREQUENCY_LABEL: Record<IndicatorFrequency, string> = {
  monthly: "Mensuelle",
  quarterly: "Trimestrielle",
  semiannual: "Semestrielle",
  annual: "Annuelle",
};

const DIRECTION_LABEL: Record<IndicatorDirection, string> = {
  up: "Plus haut vaut mieux",
  down: "Plus bas vaut mieux",
};

/** Synonymes acceptés (comparaison insensible casse/accents/espaces) en plus du libellé et de la
 *  valeur interne. */
const KIND_SYNONYMS: Record<IndicatorKind, string[]> = {
  quantitative: ["Quantitatif", "Quantitative", "Quanti", "Numérique"],
  qualitative: ["Qualitatif", "Qualitative", "Quali"],
};

const FREQUENCY_SYNONYMS: Record<IndicatorFrequency, string[]> = {
  monthly: ["Mensuelle", "Mensuel", "Mois", "Monthly"],
  quarterly: ["Trimestrielle", "Trimestriel", "Trimestre", "Quarterly"],
  semiannual: ["Semestrielle", "Semestriel", "Semestre", "Semi-annual", "Semiannual"],
  annual: ["Annuelle", "Annuel", "Année", "Annee", "An", "Annual", "Yearly"],
};

const DIRECTION_SYNONYMS: Record<IndicatorDirection, string[]> = {
  up: ["Plus haut vaut mieux", "Plus haut", "Hausse", "À la hausse", "Augmenter", "Up", "↑"],
  down: ["Plus bas vaut mieux", "Plus bas", "Baisse", "À la baisse", "Diminuer", "Down", "↓"],
};

const DEPENDENCY_TYPES: ChantierDependencyType[] = ["FS", "SS", "FF", "SF"];

/** Union fermée `Role` — valeurs internes acceptées telles quelles (insensible à la casse) dans
 *  "Rôles responsables". */
const ALL_ROLES: Role[] = [
  "cto",
  "sponsor",
  "lever",
  "finance",
  "hr",
  "ops",
  "program_sponsor",
  "program_owner",
  "comex_member",
  "strategic_lead",
  "axis_sponsor",
  "chantier_owner",
  "chantier_contributor",
  "projet_contributor",
];

const norm = (s: string) => normalizeHeaderKey(s);

function resolveSynonym<T extends string>(raw: string, table: Record<T, string[]>): T | undefined {
  const n = norm(raw);
  for (const key of Object.keys(table) as T[]) {
    if (norm(key) === n || table[key].some((label) => norm(label) === n)) return key;
  }
  return undefined;
}

// ---------- Messages (codes i18n) ----------

/** Gabarits FRANÇAIS de chaque message (fallback de `strategicImport.msg.<code>` côté UI). */
export const STRATEGIC_IMPORT_MESSAGES = {
  sheetMissing: "Feuille « {sheet} » absente du classeur — aucune ligne de ce type importée",
  sheetAlias: "Feuille « {found} » lue comme « {sheet} » (ancien nom)",
  noDataSheet:
    "Aucune feuille reconnue dans ce classeur (attendu : Axes, Chantiers, Projets, Indicateurs) — utilisez le modèle",
  missingColumns: "Colonne(s) obligatoire(s) absente(s) : {columns} — feuille ignorée",
  unknownColumns: "Colonne(s) non reconnue(s), ignorée(s) : {columns}",
  projectSponsorIgnored:
    'Colonne "Sponsor" des projets ignorée : le sponsor de projet n\'existe plus (le projet a un responsable projet et des contributeurs)',
  required: '"{column}" est obligatoire',
  tooLong: '"{column}" dépasse {max} caractères ({length})',
  duplicateCode: 'Code "{code}" en doublon dans le fichier (déjà utilisé ligne {line})',
  unknownStage: 'Étape de maturité "{value}" inconnue (attendu : {expected})',
  axesNotFound: "Axe(s) introuvable(s) (ni dans la feuille Axes, ni en base) : {codes}",
  axisNotFound: 'Axe "{code}" introuvable (ni dans la feuille Axes, ni en base)',
  notNumber: '"{column}" doit être un nombre (valeur lue : "{value}")',
  negative: '"{column}" doit être positif ou nul (valeur lue : {value})',
  outOfRange: '"{column}" doit être compris entre {min} et {max} (valeur lue : {value})',
  notPositive: '"{column}" doit être un nombre strictement positif',
  depNotFound: "Dépendance(s) introuvable(s) : {codes}",
  depBadType: 'Type de dépendance "{value}" inconnu pour "{code}" (attendu : FS, SS, FF, SF)',
  depSelf: 'Un chantier ne peut pas dépendre de lui-même ("{code}")',
  depCycle: "Dépendances circulaires entre chantiers : {cycle}",
  depDropped: 'Dépendance vers "{code}" retirée : ce chantier est en erreur',
  chantierNotFound: 'Chantier "{code}" introuvable (ni dans la feuille Chantiers, ni en base)',
  chantierAxisUnknown: 'Impossible de déterminer l\'axe du chantier "{code}"',
  requiredDate: '"{column}" est obligatoire (date JJ/MM/AAAA ou AAAA-MM-JJ)',
  invalidDate:
    '"{column}" doit être une date valide (JJ/MM/AAAA ou AAAA-MM-JJ) — valeur lue : "{value}"',
  startAfterEnd: '"{startColumn}" ({start}) est postérieure à "{endColumn}" ({end})',
  projectNotInFile: 'Projet "{code}" introuvable dans la feuille Projets de ce même fichier',
  projectNotFound: 'Projet "{code}" introuvable (ni dans la feuille Projets, ni en base)',
  indicatorParentMissing:
    '"Code Axe" ou "Code Chantier" est obligatoire (exactement l\'un des deux)',
  indicatorParentBoth:
    '"Code Axe" et "Code Chantier" sont tous les deux renseignés — un indicateur ne peut être rattaché qu\'à l\'un des deux',
  unknownValue: '{column} "{value}" inconnu(e) (attendu : {expected})',
  rolesRequired: '"Rôles responsables" est obligatoire (au moins un rôle)',
  responsibleRequired:
    '"Responsables saisie" est obligatoire (au moins une personne ; à défaut "Rôles responsables")',
  unknownRole: 'Rôle "{value}" inconnu (attendu : {expected})',
  baselineNotNumber:
    '"Valeur initiale" non numérique ("{value}") : aucune mesure de référence créée',
  baselineIgnored:
    '"Valeur initiale" ({value}) ignorée : l\'indicateur « {name} » a déjà un historique de mesures (référence actuelle : {current})',
  personNotLinked:
    "« {name} » ne correspond à aucun compte : conservé en texte, sans effet sur la visibilité ni sur les validations ({count} référence(s))",
  personAmbiguous:
    "« {name} » correspond à plusieurs comptes ({usernames}) : non rattaché — indiquez l'identifiant exact",
  // Feuille ETP — même règle que l'écran et l'import Effectifs (lib/staffingLineValidation.ts).
  staffingFteAboveTeam:
    "{fte} ETP sur cette ligne, au-delà de l'effectif de l'équipe {team} dans la base ETP ({dispo} ETP) — vérifiez la saisie",
  staffingUnknownTeam: 'Équipe "{value}" absente de la base ETP (attendu : {expected})',
  staffingNoTeams: "aucune équipe dans la base ETP",
  staffingTeamLeftBase:
    'Équipe "{value}" absente de la base ETP — ligne existante mise à jour quand même',
  staffingDatesMissing: "Ligne ETP existante sans date de début ou de fin — dates à compléter",
  staffingOutsideProject: 'Dates hors de la période du projet "{code}" ({start} → {end})',
  staffingUnknownLineId:
    'ID ligne "{id}" inconnu dans ce programme — ligne rapprochée sans identifiant',
  staffingDuplicateLineId:
    'ID ligne "{id}" présent plusieurs fois dans la feuille (lignes {rows}) — videz la cellule "ID ligne" des lignes copiées',
  staffingDuplicateRow:
    "Ligne ETP en doublon (même chantier, projet, équipe et dates que la ligne {line})",
  notClearable:
    '"{column}" ne peut pas être effacé : le tiret « - » n\'est accepté que dans une colonne facultative (laissez la cellule vide pour conserver la valeur)',
  staffingDuplicateExisting:
    'Nouvelle ligne ETP identique à une ligne existante (même chantier, projet, équipe et dates — ID ligne "{id}") : modifiez la ligne existante plutôt que d\'en créer une copie',
} as const;

export type StrategicImportMessageCode = keyof typeof STRATEGIC_IMPORT_MESSAGES;
export type StrategicImportMessageVars = Record<string, string | number>;

/** Remplace les `{var}` d'un gabarit — même convention `{n}` que le reste de l'app. */
export function formatStrategicImportMessage(
  template: string,
  vars?: StrategicImportMessageVars
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    vars && key in vars ? String(vars[key]) : match
  );
}

// ---------- Types publics ----------

export type StrategicImportSheet =
  "Classeur" | "Axes" | "Chantiers" | "Projets" | "Livrables" | "Indicateurs" | "ETP";

export type StrategicImportError = {
  sheet: StrategicImportSheet;
  /** Numéro de ligne Excel (1 = ligne d'en-têtes : message de niveau feuille). */
  rowNumber: number;
  code: StrategicImportMessageCode;
  vars?: StrategicImportMessageVars;
  /** Message rendu en français (fallback d'affichage). */
  reason: string;
};

type SheetKey = "axes" | "chantiers" | "actions" | "livrables" | "indicateurs" | "etp";

export type StrategicImportRawSheets = {
  axes: Record<string, unknown>[];
  chantiers: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  livrables: Record<string, unknown>[];
  indicateurs: Record<string, unknown>[];
  etp: Record<string, unknown>[];
  /** Métadonnées de lecture (renseignées par `parseStrategicImportWorkbook`, absentes quand les
   *  lignes sont construites à la main) : en-têtes réels de chaque feuille, feuilles absentes,
   *  feuilles lues sous un ancien nom. */
  headers?: Partial<Record<SheetKey, string[]>>;
  missingSheets?: SheetKey[];
  aliasedSheets?: Partial<Record<SheetKey, string>>;
};

/** Référence d'import conservée sur l'entité (non déclarée dans `types/index.ts` : champ technique
 *  propre à l'import, ignoré par le reste de l'app). */
export type StrategicImportRef = { importCode?: string };

export type StrategicImportExistingData = {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  actions: ChantierAction[];
  indicators: Indicator[];
  /** Facultatif : sans les mesures, aucune baseline n'est ajoutée à un indicateur EXISTANT. */
  measurements?: IndicatorMeasurement[];
  /** Facultatif : sans le staffing existant, chaque ligne ETP est une création. */
  staffing?: ChantierStaffing[];
};

export type StrategicImportWrites = {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  actions: ChantierAction[];
  indicators: Indicator[];
  measurements: IndicatorMeasurement[];
  staffing: ChantierStaffing[];
};

/** Alias historique : `toCreate` a toujours cette forme. */
export type StrategicImportToCreate = StrategicImportWrites;

export type StrategicImportPerson = {
  /** Clé normalisée (casse/accents/espaces) — sert à `applyPeopleMapping`. */
  key: string;
  /** Texte tel que saisi (première occurrence). */
  name: string;
  /** Nombre de cellules qui le référencent. */
  references: number;
  kind: "proposable" | "ambiguous" | "not_a_person";
  /** Proposition de compte (kind "proposable" uniquement). */
  username?: string;
  /** Rôle Plan Stratégique proposé pour le compte, déduit de la (des) colonne(s) où la personne
   *  apparaît — la plus haute dans la hiérarchie : "Sponsor d'axe" → `axis_sponsor`, "Sponsor de
   *  chantier" → `chantier_owner`, "Responsable projet" → `chantier_contributor`, "Contributeurs"
   *  → `projet_contributor`. Absent (ex. responsable de saisie d'indicateur seulement) = au choix
   *  de l'appelant. */
  suggestedRole?: Role;
  firstName?: string;
  lastName?: string;
  /** Identifiant dérivé déjà pris (compte existant ou autre personne du fichier) : `username`
   *  a été suffixé. */
  collisionWith?: string;
};

export type StrategicImportPreview = {
  toCreate: StrategicImportWrites;
  toUpdate: StrategicImportWrites;
  unchanged: {
    axes: number;
    chantiers: number;
    actions: number;
    indicators: number;
    staffing: number;
  };
  errors: StrategicImportError[];
  warnings: StrategicImportError[];
  /** Personnes référencées NON rapprochées d'un compte existant. */
  people: StrategicImportPerson[];
};

export type StrategicImportOptions = {
  /** Comptes de l'entreprise ciblée (rapprochement des colonnes « personne »). */
  users?: { username: string; name: string }[];
  /** Horloge injectable (tests). */
  now?: Date;
  /** Équipes de la base ETP de l'entreprise (feuille ETP : la "Fonction" doit en faire partie).
   *  Absent = référentiel indisponible, équipe non contrôlée. */
  knownDepartments?: string[];
  /** Effectif disponible par équipe dans la base ETP (même notion que le taux de staffing) : une
   *  ligne ETP qui le dépasse est importée avec un avertissement. Absent = pas de contrôle. */
  teamAvailableFte?: Record<string, number>;
};

// ---------- Utilitaires ----------

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  // Cellule date dans une colonne texte : date locale "AAAA-MM-JJ" (jamais `toISOString`, qui
  // renvoyait la veille à 22:00Z pour une date saisie en Europe/Paris).
  if (v instanceof Date) {
    const d = parseCellDate(v);
    return d?.ok ? d.value : "";
  }
  return String(v).trim();
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => isBlankCell(v));
}

/** Valeur lue d'une cellule facultative contenant le seul tiret « - » : le champ est EFFACÉ à la
 *  mise à jour (règle commune aux imports, `lib/excelCells.ts`). Lot 5 : auparavant seul
 *  « Précision » (ETP) suivait la règle ; ailleurs « - » était enregistré tel quel. */
const CLEAR: Readonly<{ kind: "clear" }> = Object.freeze({ kind: "clear" });
type Clear = typeof CLEAR;

function isClear(v: unknown): v is Clear {
  return v === CLEAR;
}

/** Champs renseignés d'un objet de lecture (ni vides, ni `CLEAR`). */
type Defined<T> = { [K in keyof T]?: Exclude<T[K], Clear> };

/** Noms des champs à effacer (`CLEAR`) d'un objet de lecture. */
function clearedKeys(o: Record<string, unknown>): string[] {
  return Object.keys(o).filter((k) => o[k] === CLEAR);
}

/** Copie de `o` sans les champs `keys` (fusion d'une mise à jour qui efface des champs). */
function withoutCleared<T extends object>(o: T, keys: readonly string[]): T {
  if (keys.length === 0) return o;
  const copy = { ...(o as Record<string, unknown>) };
  for (const k of keys) delete copy[k];
  return copy as T;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date locale "AAAA-MM-JJ" (jamais `toISOString`, décalage UTC). */
function localIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

let idSeq = 0;
function makeId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}-${Math.random().toString(36).slice(2, 6)}`;
}

const MONTHS_PER_PERIOD: Record<IndicatorFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
};

/** Période de la mesure de référence importée : la période qui PRÉCÈDE la période courante
 *  (mois/trimestre/semestre/année précédent) — la période courante reste libre pour la première
 *  saisie réelle (évite la collision de période signalée par l'audit). */
export function baselinePeriod(frequency: IndicatorFrequency, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - MONTHS_PER_PERIOD[frequency], 1);
  return currentPeriod(frequency, d);
}

/** Sérialisation stable (clés triées, `undefined` ignorés) pour comparer existant et fichier. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const obj = v as Record<string, unknown>;
    return `{${Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

function sameIgnoring(a: object, b: object, ignored: string[]): boolean {
  const strip = (o: object) => {
    const copy = { ...(o as Record<string, unknown>) };
    for (const k of ignored) delete copy[k];
    return copy;
  };
  return stableStringify(strip(a)) === stableStringify(strip(b));
}

function importCodeOf(e: object): string | undefined {
  const code = (e as StrategicImportRef).importCode;
  return typeof code === "string" && code.trim() !== "" ? code : undefined;
}

/** Rapproche une ligne du fichier d'une entité existante : par Code (importCode ou id), sinon par
 *  nom dans le même parent (entités sans importCode uniquement). Chaque entité existante n'est
 *  rapprochée qu'une fois (`used`). */
function matchExisting<T extends { id: string; name: string }>(
  list: T[],
  used: Set<string>,
  code: string | undefined,
  name: string,
  inParent: (e: T) => boolean
): { entity: T; by: "code" | "id" | "name" } | undefined {
  if (code) {
    const c = code.toLowerCase();
    const byCode = list.find((e) => !used.has(e.id) && importCodeOf(e)?.toLowerCase() === c);
    if (byCode) return { entity: byCode, by: "code" };
    const byId = list.find((e) => !used.has(e.id) && e.id.toLowerCase() === c);
    if (byId) return { entity: byId, by: "id" };
  }
  const n = norm(name);
  const byName = list.find(
    (e) => !used.has(e.id) && !importCodeOf(e) && inParent(e) && norm(e.name) === n
  );
  return byName ? { entity: byName, by: "name" } : undefined;
}

/** Résolution d'une clé étrangère vers l'existant : importCode, id, puis nom (insensible). */
function findExistingByRef<T extends { id: string; name: string }>(
  list: T[],
  raw: string
): T | undefined {
  const lower = raw.toLowerCase();
  return (
    list.find((e) => importCodeOf(e)?.toLowerCase() === lower) ??
    list.find((e) => e.id.toLowerCase() === lower) ??
    list.find((e) => norm(e.name) === norm(raw))
  );
}

function resolveStage(raw: string, stages: MaturityStageConfig[]): string | undefined {
  const n = norm(raw);
  return stages.find((s) => norm(s.id) === n || norm(s.label) === n)?.id;
}

function stageLabels(stages: MaturityStageConfig[]): string {
  return stages.length > 0 ? stages.map((s) => s.label).join(", ") : "—";
}

// ---------- Personnes ----------

/** Découpe une cellule multi-personnes ("a; b, c") en valeurs non vides, sans doublon. */
export function splitPersonList(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[;,]/)
        .map((v) => v.trim())
        .filter(Boolean)
    )
  );
}

/** Clé de rapprochement d'une personne (casse, accents, espaces). */
export function normalizePersonKey(value: string): string {
  return norm(value);
}

/** Mots qui désignent une équipe/instance, jamais une personne. */
const TEAM_WORDS = new Set(
  [
    "equipe",
    "team",
    "direction",
    "service",
    "comite",
    "cellule",
    "departement",
    "dept",
    "pole",
    "groupe",
    "squad",
    "dsi",
    "drh",
    "daf",
    "dg",
    "codir",
    "comex",
    "rh",
    "pmo",
    "collectif",
    "filiale",
    "division",
    "agence",
    "ressources",
    "humaines",
    "programme",
    "projet",
    "tous",
    "unite",
    "bu",
  ].map(norm)
);

const isLetter = (ch: string) => ch.toLowerCase() !== ch.toUpperCase();

/** Mot de nom propre : commence par une lettre, puis lettres / trait d'union / apostrophe. */
function isNameToken(tok: string): boolean {
  const chars = Array.from(tok);
  return isLetter(chars[0] ?? "") && chars.every((ch) => isLetter(ch) || "'’-".includes(ch));
}

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Proposition de compte pour un texte libre : uniquement pour une valeur de type "Prénom Nom"
 * (2 à 4 mots, lettres/traits d'union/apostrophes uniquement, aucun mot d'équipe : "Direction
 * Financière", "Équipe Data", "DG"… ne sont jamais proposés). Dernier mot = nom de famille.
 */
export function proposeAccountForName(
  raw: string
): { firstName: string; lastName: string; username: string } | undefined {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return undefined;
  if (!tokens.every(isNameToken)) return undefined;
  if (tokens.some((tok) => TEAM_WORDS.has(norm(tok)))) return undefined;
  const lastName = tokens[tokens.length - 1];
  const firstName = tokens.slice(0, -1).join(" ");
  const first = slug(firstName);
  const last = slug(lastName);
  if (!first || !last) return undefined;
  return { firstName, lastName, username: `${first}.${last}` };
}

/** Rang hiérarchique des rôles proposés à la création de compte (plus haut = plus fort). */
const SUGGESTED_ROLE_RANK: Partial<Record<Role, number>> = {
  projet_contributor: 1,
  chantier_contributor: 2,
  chantier_owner: 3,
  axis_sponsor: 4,
};

type PersonResolver = {
  /** Renvoie le username rapproché, ou le texte d'origine (et le mémorise comme non rapproché,
   *  avec le rôle correspondant à la colonne — voir `StrategicImportPerson.suggestedRole`). */
  resolve: (raw: string, sheet: StrategicImportSheet, rowNumber: number, role?: Role) => string;
  finish: (warn: WarnFn) => StrategicImportPerson[];
};

type WarnFn = (
  sheet: StrategicImportSheet,
  rowNumber: number,
  code: StrategicImportMessageCode,
  vars?: StrategicImportMessageVars
) => void;

function createPersonResolver(
  users: { username: string; name: string }[],
  companyId: string
): PersonResolver {
  const unmatched = new Map<
    string,
    {
      name: string;
      references: number;
      sheet: StrategicImportSheet;
      rowNumber: number;
      homonyms?: string[];
      role?: Role;
    }
  >();
  const companySuffix = companyId ? `.${companyId.toLowerCase()}` : "";

  const match = (raw: string): { username?: string; homonyms?: string[] } => {
    const n = norm(raw);
    const byUsername = users.find((u) => norm(u.username) === n);
    if (byUsername) return { username: byUsername.username };
    if (n.includes("@")) {
      const local = n.split("@")[0];
      const byMail = users.find(
        (u) => norm(u.username) === local || `${norm(u.username)}${companySuffix}` === local
      );
      if (byMail) return { username: byMail.username };
      return {};
    }
    const byName = users.filter((u) => norm(u.name) === n);
    if (byName.length === 1) return { username: byName[0].username };
    if (byName.length > 1) return { homonyms: byName.map((u) => u.username) };
    // "Nom Prénom" inversé.
    const reversed = n.split(" ").reverse().join(" ");
    const byReversed = users.filter((u) => norm(u.name) === reversed);
    if (byReversed.length === 1) return { username: byReversed[0].username };
    return {};
  };

  return {
    resolve(raw, sheet, rowNumber, role) {
      const { username, homonyms } = match(raw);
      if (username) return username;
      const key = norm(raw);
      const entry = unmatched.get(key);
      if (entry) {
        entry.references += 1;
        if (role && (SUGGESTED_ROLE_RANK[role] ?? 0) > (SUGGESTED_ROLE_RANK[entry.role!] ?? 0)) {
          entry.role = role;
        }
      } else {
        unmatched.set(key, { name: raw, references: 1, sheet, rowNumber, homonyms, role });
      }
      return raw;
    },
    finish(warn) {
      const taken = new Set(users.map((u) => norm(u.username)));
      const people: StrategicImportPerson[] = [];
      for (const [key, entry] of Array.from(unmatched.entries())) {
        if (entry.homonyms) {
          warn(entry.sheet, entry.rowNumber, "personAmbiguous", {
            name: entry.name,
            usernames: entry.homonyms.join(", "),
          });
          people.push({ key, name: entry.name, references: entry.references, kind: "ambiguous" });
          continue;
        }
        warn(entry.sheet, entry.rowNumber, "personNotLinked", {
          name: entry.name,
          count: entry.references,
        });
        const proposal = proposeAccountForName(entry.name);
        if (!proposal) {
          people.push({
            key,
            name: entry.name,
            references: entry.references,
            kind: "not_a_person",
          });
          continue;
        }
        let username = proposal.username;
        let collisionWith: string | undefined;
        if (taken.has(username)) {
          collisionWith = username;
          let i = 2;
          while (taken.has(`${proposal.username}${i}`)) i += 1;
          username = `${proposal.username}${i}`;
        }
        taken.add(username);
        people.push({
          key,
          name: entry.name,
          references: entry.references,
          kind: "proposable",
          username,
          firstName: proposal.firstName,
          lastName: proposal.lastName,
          ...(entry.role ? { suggestedRole: entry.role } : {}),
          ...(collisionWith ? { collisionWith } : {}),
        });
      }
      return people;
    },
  };
}

/** Réécrit les personnes (sponsor d'axe, sponsor de chantier, responsable/contributeurs projet,
 *  responsables de saisie) des entités avec les usernames des comptes créés
 *  (`mapping` : clé `normalizePersonKey(texte)` → username). Pur, renvoie une copie. */
export function applyPeopleMapping(
  writes: StrategicImportWrites,
  mapping: Map<string, string>
): StrategicImportWrites {
  if (mapping.size === 0) return writes;
  const map = (v: string | undefined) => (v ? (mapping.get(norm(v)) ?? v) : v);
  const mapList = (list: string[]) =>
    Array.from(new Set(list.map((v) => mapping.get(norm(v)) ?? v)));
  return {
    ...writes,
    axes: writes.axes.map((a) => (a.owner ? { ...a, owner: map(a.owner) } : a)),
    chantiers: writes.chantiers.map((c) => (c.pilote ? { ...c, pilote: map(c.pilote) } : c)),
    actions: writes.actions.map((a) =>
      a.owner || a.sponsor || a.contributors?.length
        ? {
            ...a,
            ...(a.owner ? { owner: map(a.owner) } : {}),
            ...(a.sponsor ? { sponsor: map(a.sponsor) } : {}),
            ...(a.contributors?.length ? { contributors: mapList(a.contributors) } : {}),
          }
        : a
    ),
    indicators: writes.indicators.map((i) =>
      i.additionalAuthorizedUserIds?.length
        ? { ...i, additionalAuthorizedUserIds: mapList(i.additionalAuthorizedUserIds) }
        : i
    ),
  };
}

/** Créations + mises à jour à écrire (ordre parent → enfant). */
export function combineStrategicImportWrites(
  preview: StrategicImportPreview
): StrategicImportWrites {
  const c = preview.toCreate;
  const u = preview.toUpdate;
  return {
    axes: [...c.axes, ...u.axes],
    chantiers: [...c.chantiers, ...u.chantiers],
    actions: [...c.actions, ...u.actions],
    indicators: [...c.indicators, ...u.indicators],
    measurements: [...c.measurements, ...u.measurements],
    staffing: [...c.staffing, ...u.staffing],
  };
}

export function countStrategicImportWrites(w: StrategicImportWrites): number {
  return (
    w.axes.length +
    w.chantiers.length +
    w.actions.length +
    w.indicators.length +
    w.measurements.length +
    w.staffing.length
  );
}

// ---------- Spécification des feuilles ----------

type SheetSpec = {
  label: StrategicImportSheet;
  headers: readonly string[];
  /** En-tête ancien/variante -> en-tête canonique. */
  aliases: Record<string, string>;
  /** En-têtes connus mais non canoniques (compatibilité). */
  extra?: string[];
  required: string[];
  /** Au moins une de ces colonnes doit exister. */
  requiredOneOf?: string[];
};

const SHEET_SPECS: Record<SheetKey, SheetSpec> = {
  axes: {
    label: "Axes",
    headers: STRATEGIC_AXIS_IMPORT_HEADERS,
    aliases: { Owner: "Sponsor d'axe", Sponsor: "Sponsor d'axe", Responsable: "Sponsor d'axe" },
    required: ["Code", "Nom"],
  },
  chantiers: {
    label: "Chantiers",
    headers: STRATEGIC_CHANTIER_IMPORT_HEADERS,
    aliases: {
      "Code Axe": "Codes Axes (séparés par ;)",
      "Codes Axes": "Codes Axes (séparés par ;)",
      Dépendances: "Dépendances (Code:type, séparées par ;)",
      Pilote: "Sponsor de chantier",
      Owner: "Sponsor de chantier",
      Sponsor: "Sponsor de chantier",
    },
    required: ["Code", "Codes Axes (séparés par ;)", "Nom"],
  },
  actions: {
    label: "Projets",
    headers: STRATEGIC_ACTION_IMPORT_HEADERS,
    aliases: {
      "Poids dans le chantier": "Poids dans le chantier (%)",
      Contributeurs: "Contributeurs (séparés par ;)",
      Contributeur: "Contributeurs (séparés par ;)",
      Owner: "Responsable projet",
      Responsable: "Responsable projet",
    },
    // Ancienne colonne "Sponsor" : connue (pas d'avertissement « colonne inconnue ») mais ignorée
    // (avertissement dédié `projectSponsorIgnored`).
    extra: ["Sponsor"],
    required: ["Code", "Code Chantier", "Nom", "Date début", "Date fin"],
  },
  livrables: {
    label: "Livrables",
    headers: STRATEGIC_DELIVERABLE_IMPORT_HEADERS,
    aliases: { "Code Action": "Code Projet" },
    extra: ["Début", "Fin"],
    required: ["Code Projet", "Label"],
  },
  indicateurs: {
    label: "Indicateurs",
    headers: STRATEGIC_INDICATOR_IMPORT_HEADERS,
    aliases: {
      "Rôles responsables": "Rôles responsables (séparés par ;)",
      "Responsable saisie": "Responsables saisie (séparés par ;)",
      "Responsables saisie": "Responsables saisie (séparés par ;)",
      "Responsable de saisie": "Responsables saisie (séparés par ;)",
      "Responsables de saisie": "Responsables saisie (séparés par ;)",
    },
    // "Rôles responsables" n'est plus obligatoire : au moins une personne OU un rôle par ligne.
    required: ["Nom", "Type", "Fréquence", "Objectif"],
    requiredOneOf: ["Code Axe", "Code Chantier"],
  },
  etp: {
    label: "ETP",
    headers: STRATEGIC_STAFFING_IMPORT_HEADERS,
    aliases: {
      "Code Action": "Code Projet",
      "Fonction (équipe)": "Fonction (équipe, base ETP)",
      Fonction: "Fonction (équipe, base ETP)",
    },
    required: ["Code Chantier", "Fonction (équipe, base ETP)", "Nombre d'ETP"],
  },
};

type PreparedRow = { row: Record<string, unknown>; rowNumber: number };

/** Ligne de la feuille ETP lue (avant rapprochement et règle commune de staffing). */
type StaffingSheetRow = StaffingMatchRow & {
  actionCode: string;
  /** Cellule « Code Projet » : vide = rattachement conservé (mise à jour), « - » = retiré. */
  actionCell: ReturnType<typeof readOptionalTextCell>["kind"];
  /** Texte brut du nombre d'ETP (messages). */
  fteRaw: string;
  fte: number | undefined;
  noteCell: ReturnType<typeof readOptionalTextCell>;
};

/** Canonicalise les en-têtes d'une feuille (casse/accents/alias), signale une fois par feuille les
 *  colonnes inconnues (avertissement) et obligatoires manquantes (erreur, feuille ignorée). */
function prepareSheet(
  key: SheetKey,
  sheets: StrategicImportRawSheets,
  err: WarnFn,
  warn: WarnFn
): PreparedRow[] {
  const spec = SHEET_SPECS[key];
  const rawRows = sheets[key];
  if (rawRows.length === 0) return [];
  const known = [...spec.headers, ...Object.keys(spec.aliases), ...(spec.extra ?? [])];
  const knownByNorm = new Map(known.map((h) => [norm(h), h]));

  const headers =
    sheets.headers?.[key] ??
    Array.from(new Set(rawRows.flatMap((r) => Object.keys(r).filter((k) => k !== "__rowNum__"))));
  const present = new Set<string>();
  const unknown: string[] = [];
  for (const h of headers) {
    if (!h || h.startsWith("__EMPTY") || h.trim() === "") continue;
    const k = knownByNorm.get(norm(h));
    if (!k) unknown.push(h);
    else present.add(spec.aliases[k] ?? k);
  }
  if (unknown.length > 0) warn(spec.label, 1, "unknownColumns", { columns: unknown.join(", ") });
  const missing = spec.required.filter((h) => !present.has(h));
  if (spec.requiredOneOf && !spec.requiredOneOf.some((h) => present.has(h))) {
    missing.push(spec.requiredOneOf.join(" / "));
  }
  if (missing.length > 0) {
    err(spec.label, 1, "missingColumns", { columns: missing.join(", ") });
    return [];
  }

  return rawRows.map((raw, i) => {
    const rowNumber = excelRowNumber(raw, i);
    const { row } = canonicalizeRowKeys(raw, known);
    for (const [alias, canonical] of Object.entries(spec.aliases)) {
      if (alias in row) {
        if (isBlankCell(row[canonical])) row[canonical] = row[alias];
        delete row[alias];
      }
    }
    return { row, rowNumber };
  });
}

// ---------- Validation / aperçu ----------

/**
 * Valide les feuilles ENSEMBLE et produit l'aperçu (créations / mises à jour / inchangés, erreurs
 * et avertissements) sans rien écrire — voir le doc-comment de tête pour les règles.
 *
 * `importedBy` : username de l'admin, reporté dans `reportedBy` des mesures de référence (repli
 * "import-excel").
 */
export function validateStrategicImportRows(
  sheets: StrategicImportRawSheets,
  existingData: StrategicImportExistingData,
  companyId: string | null | undefined,
  programId: string | null | undefined,
  maturityStages: MaturityStageConfig[],
  importedBy?: string | null,
  options: StrategicImportOptions = {}
): StrategicImportPreview {
  const errors: StrategicImportError[] = [];
  const warnings: StrategicImportError[] = [];
  const push =
    (list: StrategicImportError[]): WarnFn =>
    (sheet, rowNumber, code, vars) =>
      list.push({
        sheet,
        rowNumber,
        code,
        ...(vars ? { vars } : {}),
        reason: formatStrategicImportMessage(STRATEGIC_IMPORT_MESSAGES[code], vars),
      });
  const err = push(errors);
  const warn = push(warnings);

  const resolvedCompanyId = companyId ?? "";
  const resolvedProgramId = programId ?? "";
  const resolvedReportedBy =
    importedBy && importedBy.trim() !== "" ? importedBy.trim() : "import-excel";
  const now = options.now ?? new Date();
  const today = localIsoDate(now);
  const people = createPersonResolver(options.users ?? [], resolvedCompanyId);

  // Existant restreint au programme ciblé (les appelants passent déjà des listes filtrées).
  const inProgram = (e: { programId?: string }) =>
    !resolvedProgramId || !e.programId || e.programId === resolvedProgramId;
  const exAxes = existingData.axes.filter(inProgram);
  const exChantiers = existingData.chantiers.filter(inProgram);
  const exChantierIds = new Set(exChantiers.map((c) => c.id));
  const exActions = existingData.actions.filter(
    (a) => exChantierIds.has(a.chantierId) || existingData.chantiers.length === 0
  );
  const exIndicators = existingData.indicators.filter(inProgram);
  const exMeasurements = existingData.measurements;
  const exStaffing = (existingData.staffing ?? []).filter(inProgram);

  // ---------- Feuilles absentes ----------
  const allKeys: SheetKey[] = ["axes", "chantiers", "actions", "livrables", "indicateurs", "etp"];
  if (sheets.missingSheets) {
    const mainKeys: SheetKey[] = ["axes", "chantiers", "actions", "indicateurs"];
    if (allKeys.every((k) => sheets.missingSheets!.includes(k))) {
      err("Classeur", 1, "noDataSheet");
    } else {
      for (const k of mainKeys) {
        if (sheets.missingSheets.includes(k)) {
          err(SHEET_SPECS[k].label, 1, "sheetMissing", { sheet: SHEET_SPECS[k].label });
        }
      }
    }
  }
  for (const [k, found] of Object.entries(sheets.aliasedSheets ?? {})) {
    const label = SHEET_SPECS[k as SheetKey].label;
    warn(label, 1, "sheetAlias", { found: found as string, sheet: label });
  }

  const prepared = Object.fromEntries(
    allKeys.map((k) => [k, prepareSheet(k, sheets, err, warn)])
  ) as Record<SheetKey, PreparedRow[]>;

  // ---------- Petits validateurs de cellule (poussent l'erreur, renvoient null) ----------
  const text = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    row: Record<string, unknown>,
    column: string,
    { required = false, max = STRATEGIC_IMPORT_MAX_NAME_LENGTH } = {}
  ): string | null => {
    const value = str(row[column]);
    if (!value) {
      if (required) {
        err(sheet, rowNumber, "required", { column });
        return null;
      }
      return "";
    }
    // Codes, noms et autres colonnes non effaçables : le tiret est refusé (jamais un nom « - »).
    if (isClearMarker(value)) {
      err(sheet, rowNumber, "notClearable", { column });
      return null;
    }
    if (value.length > max) {
      err(sheet, rowNumber, "tooLong", { column, max, length: value.length });
      return null;
    }
    return value;
  };

  /** Texte FACULTATIF effaçable : "" si vide (conservé), `CLEAR` si tiret, sinon la valeur. */
  const optText = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    row: Record<string, unknown>,
    column: string,
    { max = STRATEGIC_IMPORT_MAX_NAME_LENGTH } = {}
  ): string | Clear | null => {
    if (isClearMarker(row[column])) return CLEAR;
    return text(sheet, rowNumber, row, column, { max });
  };

  const optNumber = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    row: Record<string, unknown>,
    column: string,
    { min, max }: { min?: number; max?: number } = {}
  ): number | Clear | undefined | null => {
    // Nombre facultatif : tiret = valeur effacée.
    if (isClearMarker(row[column])) return CLEAR;
    const parsed = parseCellNumber(row[column]);
    if (parsed === undefined) return undefined;
    if (!parsed.ok) {
      err(sheet, rowNumber, "notNumber", { column, value: parsed.raw });
      return null;
    }
    if (min !== undefined && max !== undefined && (parsed.value < min || parsed.value > max)) {
      err(sheet, rowNumber, "outOfRange", { column, min, max, value: parsed.value });
      return null;
    }
    if (min !== undefined && parsed.value < min) {
      err(sheet, rowNumber, "negative", { column, value: parsed.value });
      return null;
    }
    return parsed.value;
  };

  const optDate = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    row: Record<string, unknown>,
    column: string,
    required = false
  ): string | undefined | null => {
    // Date obligatoire (ou non effaçable) : le tiret est refusé — voir `optClearableDate`.
    if (isClearMarker(row[column])) {
      err(sheet, rowNumber, "notClearable", { column });
      return null;
    }
    const parsed = parseCellDate(row[column]);
    if (parsed === undefined) {
      if (required) {
        err(sheet, rowNumber, "requiredDate", { column });
        return null;
      }
      return undefined;
    }
    if (!parsed.ok) {
      err(sheet, rowNumber, "invalidDate", { column, value: parsed.raw });
      return null;
    }
    return parsed.value;
  };

  const checkOrder = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    start: string | undefined,
    end: string | undefined,
    startColumn: string,
    endColumn: string
  ): boolean => {
    if (start && end && start > end) {
      err(sheet, rowNumber, "startAfterEnd", { startColumn, start, endColumn, end });
      return false;
    }
    return true;
  };

  const stageOf = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    row: Record<string, unknown>
  ): string | undefined | null => {
    const raw = str(row["Étape de maturité"]);
    if (!raw) return undefined;
    // L'étape est toujours renseignée en base (vide = 1re étape à la création) : pas d'effacement.
    if (isClearMarker(raw)) {
      err(sheet, rowNumber, "notClearable", { column: "Étape de maturité" });
      return null;
    }
    const stage = resolveStage(raw, maturityStages);
    if (stage === undefined) {
      err(sheet, rowNumber, "unknownStage", { value: raw, expected: stageLabels(maturityStages) });
      return null;
    }
    return stage;
  };

  const person = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    row: Record<string, unknown>,
    column: string,
    role?: Role
  ): string | Clear | undefined | null => {
    const value = optText(sheet, rowNumber, row, column);
    if (value === null || isClear(value)) return value;
    return value ? people.resolve(value, sheet, rowNumber, role) : undefined;
  };

  /** Liste de personnes séparées par ";" ou "," — chacune rapprochée comme `person` (non
   *  rapprochée = conservée en texte + avertissement `personNotLinked`/`personAmbiguous`).
   *  Dédoublonnée ; `undefined` si la cellule est vide, `null` si elle est en erreur. */
  const personList = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    row: Record<string, unknown>,
    column: string,
    role?: Role
  ): string[] | Clear | undefined | null => {
    const value = optText(sheet, rowNumber, row, column, { max: STRATEGIC_IMPORT_MAX_TEXT_LENGTH });
    if (value === null || isClear(value)) return value;
    if (!value) return undefined;
    const resolved = splitPersonList(value).map((v) => people.resolve(v, sheet, rowNumber, role));
    return resolved.length > 0 ? Array.from(new Set(resolved)) : undefined;
  };

  const dupCheck = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    seen: Map<string, number>,
    code: string
  ): boolean => {
    const lower = code.toLowerCase();
    if (seen.has(lower)) {
      err(sheet, rowNumber, "duplicateCode", { code, line: seen.get(lower)! });
      return false;
    }
    return true;
  };

  /** Ne garde que les champs renseignés (upsert non destructif) — les champs à effacer (`CLEAR`,
   *  tiret « - ») sont exclus ici et retirés à la fusion par `withoutCleared`. */
  const defined = <T extends Record<string, unknown>>(o: T): Defined<T> =>
    Object.fromEntries(
      Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== CLEAR)
    ) as Defined<T>;

  // ---------- Feuille "Axes" ----------
  const axesToCreate: StrategicAxis[] = [];
  const axesToUpdate: StrategicAxis[] = [];
  let axesUnchanged = 0;
  const axisIdByCode = new Map<string, string>();
  const axisCodeSeen = new Map<string, number>();
  const usedAxes = new Set<string>();

  for (const { row, rowNumber } of prepared.axes) {
    if (isRowEmpty(row)) continue;
    const sheet = "Axes";
    const code = text(sheet, rowNumber, row, "Code", { required: true });
    if (code === null) continue;
    if (!dupCheck(sheet, rowNumber, axisCodeSeen, code)) continue;
    const name = text(sheet, rowNumber, row, "Nom", { required: true });
    if (name === null) continue;
    const description = optText(sheet, rowNumber, row, "Description", {
      max: STRATEGIC_IMPORT_MAX_TEXT_LENGTH,
    });
    if (description === null) continue;
    const color = optText(sheet, rowNumber, row, "Couleur");
    if (color === null) continue;
    const stage = stageOf(sheet, rowNumber, row);
    if (stage === null) continue;
    const owner = person(sheet, rowNumber, row, "Sponsor d'axe", "axis_sponsor");
    if (owner === null) continue;

    const read = { name, description, owner, color, stage };
    const fields = defined(read);
    const match = matchExisting(exAxes, usedAxes, code, name, () => true);
    if (match) {
      usedAxes.add(match.entity.id);
      const merged: StrategicAxis & StrategicImportRef = withoutCleared(
        {
          ...match.entity,
          ...fields,
          ...(match.by === "id" ? {} : { importCode: code }),
        },
        clearedKeys(read)
      );
      if (sameIgnoring(merged, match.entity, ["lastUpdate"])) axesUnchanged += 1;
      else axesToUpdate.push({ ...merged, lastUpdate: today });
      axisIdByCode.set(code.toLowerCase(), match.entity.id);
    } else {
      const axis: StrategicAxis & StrategicImportRef = {
        id: makeId("AX"),
        companyId: resolvedCompanyId,
        programId: resolvedProgramId,
        stage: maturityStages[0]?.id ?? "",
        ...fields,
        name,
        importCode: code,
        createdAt: today,
        lastUpdate: today,
      };
      axesToCreate.push(axis);
      axisIdByCode.set(code.toLowerCase(), axis.id);
    }
    axisCodeSeen.set(code.toLowerCase(), rowNumber);
  }

  const resolveAxisCode = (raw: string): string | undefined =>
    axisIdByCode.get(raw.toLowerCase()) ?? findExistingByRef(exAxes, raw)?.id;

  // ---------- Feuille "Chantiers" (passe 1) ----------
  type ParsedChantier = {
    rowNumber: number;
    code: string;
    id: string;
    depsRaw: string;
    fields: Partial<Chantier>;
    /** Champs facultatifs effacés par un tiret « - ». */
    cleared: string[];
    axisIds: string[];
    name: string;
    existing?: Chantier;
    matchedBy?: "code" | "id" | "name";
  };
  const parsedChantiers: ParsedChantier[] = [];
  const chantierIdByCode = new Map<string, string>();
  const chantierCodeSeen = new Map<string, number>();
  const usedChantiers = new Set<string>();

  for (const { row, rowNumber } of prepared.chantiers) {
    if (isRowEmpty(row)) continue;
    const sheet = "Chantiers";
    const code = text(sheet, rowNumber, row, "Code", { required: true });
    if (code === null) continue;
    if (!dupCheck(sheet, rowNumber, chantierCodeSeen, code)) continue;

    const axisCodesRaw = str(row["Codes Axes (séparés par ;)"]);
    const axisCodes = axisCodesRaw
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    if (axisCodes.length === 0) {
      err(sheet, rowNumber, "required", { column: "Codes Axes (séparés par ;)" });
      continue;
    }
    const axisIds: string[] = [];
    const unresolved: string[] = [];
    for (const c of axisCodes) {
      const id = resolveAxisCode(c);
      if (!id) unresolved.push(c);
      else if (!axisIds.includes(id)) axisIds.push(id);
    }
    if (unresolved.length > 0) {
      err(sheet, rowNumber, "axesNotFound", { codes: unresolved.join(", ") });
      continue;
    }

    const name = text(sheet, rowNumber, row, "Nom", { required: true });
    if (name === null) continue;
    const description = optText(sheet, rowNumber, row, "Description", {
      max: STRATEGIC_IMPORT_MAX_TEXT_LENGTH,
    });
    if (description === null) continue;
    const stage = stageOf(sheet, rowNumber, row);
    if (stage === null) continue;
    const allocatedBudget = optNumber(sheet, rowNumber, row, "Budget alloué", { min: 0 });
    if (allocatedBudget === null) continue;
    const consumedBudget = optNumber(sheet, rowNumber, row, "Budget consommé", { min: 0 });
    if (consumedBudget === null) continue;
    const consumedFte = optNumber(sheet, rowNumber, row, "ETP consommés", { min: 0 });
    if (consumedFte === null) continue;
    const pilote = person(sheet, rowNumber, row, "Sponsor de chantier", "chantier_owner");
    if (pilote === null) continue;

    const match = matchExisting(exChantiers, usedChantiers, code, name, (c) =>
      (c.axisIds ?? []).some((id) => axisIds.includes(id))
    );
    if (match) usedChantiers.add(match.entity.id);
    const id = match?.entity.id ?? makeId("CH");
    const read = {
      name,
      description,
      pilote,
      stage,
      allocatedBudget,
      consumedBudget,
      consumedFte,
    };
    parsedChantiers.push({
      rowNumber,
      code,
      id,
      depsRaw: str(row["Dépendances (Code:type, séparées par ;)"]),
      fields: defined(read) as Partial<Chantier>,
      cleared: clearedKeys(read),
      axisIds,
      name,
      existing: match?.entity,
      matchedBy: match?.by,
    });
    chantierIdByCode.set(code.toLowerCase(), id);
    chantierCodeSeen.set(code.toLowerCase(), rowNumber);
  }

  const resolveChantierCode = (raw: string): string | undefined =>
    chantierIdByCode.get(raw.toLowerCase()) ?? findExistingByRef(exChantiers, raw)?.id;

  // ---------- Feuille "Chantiers" (passe 2 : dépendances, auto-dépendances, cycles) ----------
  const excludedChantiers = new Set<string>(); // ids des lignes en erreur
  const depsById = new Map<string, ChantierDependency[] | undefined>(); // undefined = inchangé
  for (const p of parsedChantiers) {
    if (!p.depsRaw) {
      depsById.set(p.id, undefined);
      continue;
    }
    // Tiret : dépendances (visibles) retirées.
    if (isClearMarker(p.depsRaw)) {
      depsById.set(p.id, []);
      continue;
    }
    const dependencies: ChantierDependency[] = [];
    const unresolved: string[] = [];
    let failed = false;
    for (const entry of p.depsRaw
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const sep = entry.indexOf(":");
      const codeRaw = (sep >= 0 ? entry.slice(0, sep) : entry).trim();
      const typeRaw = (sep >= 0 ? entry.slice(sep + 1) : "").trim();
      if (!codeRaw) continue;
      let type: ChantierDependencyType = "FS";
      if (typeRaw) {
        const upper = typeRaw.toUpperCase() as ChantierDependencyType;
        if (!DEPENDENCY_TYPES.includes(upper)) {
          err("Chantiers", p.rowNumber, "depBadType", { value: typeRaw, code: codeRaw });
          failed = true;
          break;
        }
        type = upper;
      }
      const targetId = resolveChantierCode(codeRaw);
      if (!targetId) {
        unresolved.push(codeRaw);
        continue;
      }
      if (targetId === p.id) {
        err("Chantiers", p.rowNumber, "depSelf", { code: codeRaw });
        failed = true;
        break;
      }
      if (!dependencies.some((d) => d.targetId === targetId)) dependencies.push({ targetId, type });
    }
    if (!failed && unresolved.length > 0) {
      err("Chantiers", p.rowNumber, "depNotFound", { codes: unresolved.join(", ") });
      failed = true;
    }
    if (failed) excludedChantiers.add(p.id);
    else depsById.set(p.id, dependencies);
  }

  // Détection de cycles (Tarjan) sur le graphe final : lignes du fichier + chantiers existants.
  {
    const graph = new Map<string, string[]>();
    for (const c of exChantiers)
      graph.set(
        c.id,
        (c.dependencies ?? []).map((d) => d.targetId)
      );
    for (const p of parsedChantiers) {
      if (excludedChantiers.has(p.id)) {
        graph.set(p.id, []);
        continue;
      }
      const deps = depsById.get(p.id) ?? p.existing?.dependencies ?? [];
      graph.set(
        p.id,
        deps.map((d) => d.targetId)
      );
    }
    const labelOf = (id: string) =>
      parsedChantiers.find((p) => p.id === id)?.code ??
      exChantiers.find((c) => c.id === id)?.name ??
      id;
    let index = 0;
    const idx = new Map<string, number>();
    const low = new Map<string, number>();
    const stack: string[] = [];
    const onStack = new Set<string>();
    const sccs: string[][] = [];
    const strong = (v: string) => {
      idx.set(v, index);
      low.set(v, index);
      index += 1;
      stack.push(v);
      onStack.add(v);
      for (const w of graph.get(v) ?? []) {
        if (!graph.has(w)) continue;
        if (!idx.has(w)) {
          strong(w);
          low.set(v, Math.min(low.get(v)!, low.get(w)!));
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      }
      if (low.get(v) === idx.get(v)) {
        const scc: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          scc.push(w);
        } while (w !== v);
        if (scc.length > 1) sccs.push(scc);
      }
    };
    for (const v of Array.from(graph.keys())) if (!idx.has(v)) strong(v);
    for (const scc of sccs) {
      const cycle = scc.map(labelOf).join(" → ");
      for (const p of parsedChantiers) {
        if (scc.includes(p.id) && !excludedChantiers.has(p.id)) {
          err("Chantiers", p.rowNumber, "depCycle", { cycle });
          excludedChantiers.add(p.id);
        }
      }
    }
  }

  // Lignes exclues : ne sont plus résolvables par leur Code du fichier (repli sur l'existant).
  for (const p of parsedChantiers) {
    if (excludedChantiers.has(p.id)) chantierIdByCode.delete(p.code.toLowerCase());
  }
  const newExcludedIds = new Set(
    parsedChantiers.filter((p) => excludedChantiers.has(p.id) && !p.existing).map((p) => p.id)
  );

  const chantiersToCreate: Chantier[] = [];
  const chantiersToUpdate: Chantier[] = [];
  let chantiersUnchanged = 0;
  const chantierAxesById = new Map<string, string[]>();
  for (const c of exChantiers) chantierAxesById.set(c.id, c.axisIds ?? []);
  const visibleChantierIds = new Set([
    ...existingData.chantiers.map((c) => c.id),
    ...parsedChantiers.map((p) => p.id),
  ]);

  for (const p of parsedChantiers) {
    if (excludedChantiers.has(p.id)) continue;
    let deps = depsById.get(p.id);
    if (deps) {
      const kept = deps.filter((d) => !newExcludedIds.has(d.targetId));
      for (const d of deps) {
        if (newExcludedIds.has(d.targetId)) {
          const target = parsedChantiers.find((x) => x.id === d.targetId);
          warn("Chantiers", p.rowNumber, "depDropped", { code: target?.code ?? d.targetId });
        }
      }
      deps = kept;
    }
    if (p.existing) {
      const existingDeps = p.existing.dependencies ?? [];
      // Dépendances vers un chantier que l'utilisateur ne voit pas (absent des données
      // transmises) : jamais exportées, donc conservées telles quelles (lot 5) — ordre d'origine
      // gardé quand la partie visible n'a pas changé (aucune mise à jour fantôme).
      const hidden = existingDeps.filter((d) => !visibleChantierIds.has(d.targetId));
      if (deps && hidden.length > 0) {
        const visibleExisting = existingDeps.filter((d) => visibleChantierIds.has(d.targetId));
        deps =
          stableStringify(visibleExisting) === stableStringify(deps)
            ? existingDeps
            : [...deps, ...hidden];
      }
      const merged: Chantier & StrategicImportRef = withoutCleared(
        {
          ...p.existing,
          ...p.fields,
          axisIds: p.axisIds,
          ...(deps ? { dependencies: deps } : {}),
          ...(p.matchedBy === "id" ? {} : { importCode: p.code }),
        },
        p.cleared
      );
      if (sameIgnoring(merged, p.existing, ["lastUpdate"])) chantiersUnchanged += 1;
      else chantiersToUpdate.push({ ...merged, lastUpdate: today });
    } else {
      const chantier: Chantier & StrategicImportRef = {
        id: p.id,
        companyId: resolvedCompanyId,
        programId: resolvedProgramId,
        stage: maturityStages[0]?.id ?? "",
        ...p.fields,
        axisIds: p.axisIds,
        name: p.name,
        dependencies: deps ?? [],
        importCode: p.code,
        createdAt: today,
        lastUpdate: today,
      };
      chantiersToCreate.push(chantier);
    }
    chantierAxesById.set(p.id, p.axisIds);
  }

  // ---------- Feuille "Projets" ----------
  type ParsedAction = {
    rowNumber: number;
    code: string;
    action: ChantierAction;
    existing?: ChantierAction;
  };
  const parsedActions: ParsedAction[] = [];
  const actionIdByCode = new Map<string, string>();
  const actionCodeSeen = new Map<string, number>();
  const usedActions = new Set<string>();
  // Ancienne colonne "Sponsor" : tolérée mais IGNORÉE — un seul avertissement pour la feuille (1re
  // ligne renseignée) ; `ChantierAction.sponsor` existant n'est jamais modifié par l'import.
  let projectSponsorSeenAt: number | undefined;

  for (const { row, rowNumber } of prepared.actions) {
    if (isRowEmpty(row)) continue;
    const sheet = "Projets";
    if (projectSponsorSeenAt === undefined && !isBlankCell(row["Sponsor"])) {
      projectSponsorSeenAt = rowNumber;
    }
    const code = text(sheet, rowNumber, row, "Code", { required: true });
    if (code === null) continue;
    if (!dupCheck(sheet, rowNumber, actionCodeSeen, code)) continue;
    const chantierCode = text(sheet, rowNumber, row, "Code Chantier", { required: true });
    if (chantierCode === null) continue;
    const chantierId = resolveChantierCode(chantierCode);
    if (!chantierId) {
      err(sheet, rowNumber, "chantierNotFound", { code: chantierCode });
      continue;
    }
    const name = text(sheet, rowNumber, row, "Nom", { required: true });
    if (name === null) continue;
    const description = optText(sheet, rowNumber, row, "Description", {
      max: STRATEGIC_IMPORT_MAX_TEXT_LENGTH,
    });
    if (description === null) continue;
    const start = optDate(sheet, rowNumber, row, "Date début", true);
    if (!start) continue;
    const end = optDate(sheet, rowNumber, row, "Date fin", true);
    if (!end) continue;
    if (!checkOrder(sheet, rowNumber, start, end, "Date début", "Date fin")) continue;
    const status = stageOf(sheet, rowNumber, row);
    if (status === null) continue;
    const budget = optNumber(sheet, rowNumber, row, "Budget", { min: 0 });
    if (budget === null) continue;
    const consumedBudget = optNumber(sheet, rowNumber, row, "Budget consommé", { min: 0 });
    if (consumedBudget === null) continue;
    const chantierWeightPct = optNumber(sheet, rowNumber, row, "Poids dans le chantier (%)", {
      min: 0,
      max: 100,
    });
    if (chantierWeightPct === null) continue;
    const owner = person(sheet, rowNumber, row, "Responsable projet", "chantier_contributor");
    if (owner === null) continue;
    const contributors = personList(
      sheet,
      rowNumber,
      row,
      "Contributeurs (séparés par ;)",
      "projet_contributor"
    );
    if (contributors === null) continue;

    const read = {
      name,
      description,
      owner,
      contributors,
      start,
      end,
      status,
      budget,
      consumedBudget,
      chantierWeightPct,
    };
    const fields = defined(read) as Partial<ChantierAction>;
    const match = matchExisting(
      exActions,
      usedActions,
      code,
      name,
      (a) => a.chantierId === chantierId
    );
    let action: ChantierAction & StrategicImportRef;
    if (match) {
      usedActions.add(match.entity.id);
      action = withoutCleared(
        {
          ...match.entity,
          ...fields,
          chantierId,
          ...(match.by === "id" ? {} : { importCode: code }),
        },
        clearedKeys(read)
      );
    } else {
      action = {
        id: makeId("CA"),
        companyId: resolvedCompanyId,
        status: maturityStages[0]?.id ?? "",
        ...fields,
        chantierId,
        name,
        start,
        end,
        importCode: code,
      };
    }
    parsedActions.push({ rowNumber, code, action, existing: match?.entity });
    actionIdByCode.set(code.toLowerCase(), action.id);
    actionCodeSeen.set(code.toLowerCase(), rowNumber);
  }

  if (projectSponsorSeenAt !== undefined) {
    warn("Projets", projectSponsorSeenAt, "projectSponsorIgnored");
  }

  const resolveActionCode = (raw: string): string | undefined =>
    actionIdByCode.get(raw.toLowerCase()) ?? findExistingByRef(exActions, raw)?.id;

  // ---------- Feuille "Livrables" (embarqués dans un projet de CE fichier ; fusion par libellé) ----------
  const deliverablesByActionCode = new Map<
    string,
    { label: string; dueDate?: string; dueCleared?: boolean }[]
  >();
  for (const { row, rowNumber } of prepared.livrables) {
    if (isRowEmpty(row)) continue;
    const sheet = "Livrables";
    const actionCode = text(sheet, rowNumber, row, "Code Projet", { required: true });
    if (actionCode === null) continue;
    const lower = actionCode.toLowerCase();
    if (!actionIdByCode.has(lower)) {
      err(sheet, rowNumber, "projectNotInFile", { code: actionCode });
      continue;
    }
    const label = text(sheet, rowNumber, row, "Label", { required: true });
    if (label === null) continue;
    const dueColumn = !isBlankCell(row["Échéance"]) ? "Échéance" : "Fin";
    // Échéance facultative : tiret = échéance effacée.
    const dueCleared = isClearMarker(row[dueColumn]);
    const dueDate = dueCleared ? undefined : optDate(sheet, rowNumber, row, dueColumn);
    if (dueDate === null) continue;
    const list = deliverablesByActionCode.get(lower) ?? [];
    list.push({ label, ...(dueDate ? { dueDate } : {}), ...(dueCleared ? { dueCleared } : {}) });
    deliverablesByActionCode.set(lower, list);
  }

  const actionsToCreate: ChantierAction[] = [];
  const actionsToUpdate: ChantierAction[] = [];
  let actionsUnchanged = 0;
  for (const p of parsedActions) {
    const fileDeliverables = deliverablesByActionCode.get(p.code.toLowerCase()) ?? [];
    let action = p.action;
    if (fileDeliverables.length > 0) {
      const current: Deliverable[] = [...(action.deliverables ?? [])];
      const usedDeliverables = new Set<string>();
      for (const d of fileDeliverables) {
        const i = current.findIndex(
          (e) => !usedDeliverables.has(e.id) && norm(e.label) === norm(d.label)
        );
        if (i >= 0) {
          usedDeliverables.add(current[i].id);
          if (d.dueDate && d.dueDate !== current[i].dueDate) {
            current[i] = { ...current[i], dueDate: d.dueDate };
          } else if (d.dueCleared && current[i].dueDate !== undefined) {
            current[i] = withoutCleared(current[i], ["dueDate"]);
          }
        } else {
          const created: Deliverable = {
            id: makeId("DL"),
            label: d.label,
            phases: [],
            status: "todo",
            ...(d.dueDate ? { dueDate: d.dueDate } : {}),
          };
          usedDeliverables.add(created.id);
          current.push(created);
        }
      }
      action = { ...action, deliverables: current };
    }
    if (p.existing) {
      if (sameIgnoring(action, p.existing, [])) actionsUnchanged += 1;
      else actionsToUpdate.push(action);
    } else {
      actionsToCreate.push(action);
    }
  }

  // ---------- Feuille "Indicateurs" ----------
  const indicatorsToCreate: Indicator[] = [];
  const indicatorsToUpdate: Indicator[] = [];
  let indicatorsUnchanged = 0;
  const measurementsToCreate: IndicatorMeasurement[] = [];
  const indicatorCodeSeen = new Map<string, number>();
  const usedIndicators = new Set<string>();

  for (const { row, rowNumber } of prepared.indicateurs) {
    if (isRowEmpty(row)) continue;
    const sheet = "Indicateurs";
    const code = text(sheet, rowNumber, row, "Code");
    if (code === null) continue;
    if (code && !dupCheck(sheet, rowNumber, indicatorCodeSeen, code)) continue;

    const axisCodeRaw = str(row["Code Axe"]);
    const chantierCodeRaw = str(row["Code Chantier"]);
    if (!axisCodeRaw && !chantierCodeRaw) {
      err(sheet, rowNumber, "indicatorParentMissing");
      continue;
    }
    if (axisCodeRaw && chantierCodeRaw) {
      err(sheet, rowNumber, "indicatorParentBoth");
      continue;
    }
    let axisId: string | undefined;
    let chantierId: string | undefined;
    if (chantierCodeRaw) {
      chantierId = resolveChantierCode(chantierCodeRaw);
      if (!chantierId) {
        err(sheet, rowNumber, "chantierNotFound", { code: chantierCodeRaw });
        continue;
      }
      axisId = chantierAxesById.get(chantierId)?.[0];
      if (!axisId) {
        err(sheet, rowNumber, "chantierAxisUnknown", { code: chantierCodeRaw });
        continue;
      }
    } else {
      axisId = resolveAxisCode(axisCodeRaw);
      if (!axisId) {
        err(sheet, rowNumber, "axisNotFound", { code: axisCodeRaw });
        continue;
      }
    }

    const name = text(sheet, rowNumber, row, "Nom", { required: true });
    if (name === null) continue;

    const kindRaw = str(row["Type"]);
    const kind = kindRaw ? resolveSynonym(kindRaw, KIND_SYNONYMS) : undefined;
    if (!kind) {
      if (!kindRaw) err(sheet, rowNumber, "required", { column: "Type" });
      else
        err(sheet, rowNumber, "unknownValue", {
          column: "Type",
          value: kindRaw,
          expected: Object.values(KIND_LABEL).join(", "),
        });
      continue;
    }
    const frequencyRaw = str(row["Fréquence"]);
    const frequency = frequencyRaw ? resolveSynonym(frequencyRaw, FREQUENCY_SYNONYMS) : undefined;
    if (!frequency) {
      if (!frequencyRaw) err(sheet, rowNumber, "required", { column: "Fréquence" });
      else
        err(sheet, rowNumber, "unknownValue", {
          column: "Fréquence",
          value: frequencyRaw,
          expected: Object.values(FREQUENCY_LABEL).join(", "),
        });
      continue;
    }
    const objective = text(sheet, rowNumber, row, "Objectif", {
      required: true,
      max: STRATEGIC_IMPORT_MAX_TEXT_LENGTH,
    });
    if (objective === null) continue;

    const responsibleUsers = personList(
      sheet,
      rowNumber,
      row,
      "Responsables saisie (séparés par ;)"
    );
    if (responsibleUsers === null) continue;
    const rolesRaw = str(row["Rôles responsables (séparés par ;)"]);
    // Tiret : rôles responsables retirés (il faut alors au moins une personne nommée).
    const rolesCleared = isClearMarker(rolesRaw);
    const roleTokens = (rolesCleared ? "" : rolesRaw)
      .split(";")
      .map((r) => r.trim())
      .filter(Boolean);
    const responsibleRoles: Role[] = [];
    let invalidRole: string | undefined;
    for (const token of roleTokens) {
      const role = ALL_ROLES.find((r) => r.toLowerCase() === token.toLowerCase());
      if (!role) {
        invalidRole = token;
        break;
      }
      if (!responsibleRoles.includes(role)) responsibleRoles.push(role);
    }
    if (invalidRole) {
      err(sheet, rowNumber, "unknownRole", { value: invalidRole, expected: ALL_ROLES.join(", ") });
      continue;
    }

    // Valeur cible présente mais illisible = erreur (jamais ignorée silencieusement).
    const objectiveValue = optNumber(sheet, rowNumber, row, "Valeur cible");
    if (objectiveValue === null) continue;
    const directionRaw = str(row["Sens"]);
    let direction: IndicatorDirection | Clear | undefined;
    if (isClearMarker(directionRaw)) direction = CLEAR;
    else if (directionRaw) {
      direction = resolveSynonym(directionRaw, DIRECTION_SYNONYMS);
      if (!direction) {
        err(sheet, rowNumber, "unknownValue", {
          column: "Sens",
          value: directionRaw,
          expected: Object.values(DIRECTION_LABEL).join(", "),
        });
        continue;
      }
    }
    const unit = optText(sheet, rowNumber, row, "Unité");
    if (unit === null) continue;

    // Valeur initiale illisible = avertissement (pas de mesure), jamais une erreur de ligne. Un
    // tiret vaut une cellule vide : la mesure de référence n'est pas un champ effaçable.
    const baselineParsed = isClearMarker(row["Valeur initiale"])
      ? undefined
      : parseCellNumber(row["Valeur initiale"]);
    let baselineValue: number | undefined;
    if (baselineParsed && !baselineParsed.ok) {
      warn(sheet, rowNumber, "baselineNotNumber", { value: baselineParsed.raw });
    } else if (baselineParsed?.ok) {
      baselineValue = baselineParsed.value;
    }

    const match = matchExisting(
      exIndicators,
      usedIndicators,
      code || undefined,
      name,
      (e) => e.axisId === axisId && (e.chantierId ?? undefined) === chantierId
    );
    const usersCleared = isClear(responsibleUsers);
    const fileUsers = Array.isArray(responsibleUsers) ? responsibleUsers : undefined;
    // Au moins une personne nommée OU un rôle (legacy) — dans le fichier ou déjà sur l'existant
    // (sauf si le fichier l'efface par un tiret).
    const hasResponsible =
      (fileUsers?.length ?? 0) > 0 ||
      responsibleRoles.length > 0 ||
      (!usersCleared && (match?.entity.additionalAuthorizedUserIds?.length ?? 0) > 0) ||
      (!rolesCleared && (match?.entity.responsibleRoles?.length ?? 0) > 0);
    if (!hasResponsible) {
      err(sheet, rowNumber, "responsibleRequired");
      continue;
    }

    const read = { name, kind, frequency, objective, objectiveValue, direction, unit };
    const fields = defined(read);
    const cleared = [
      ...clearedKeys(read),
      ...(usersCleared ? ["additionalAuthorizedUserIds"] : []),
    ];
    const targetValue = isClear(objectiveValue) ? undefined : objectiveValue;
    const directionValue = isClear(direction) ? undefined : direction;
    const unitValue = isClear(unit) ? "" : unit;
    const newBaseline = (indicatorId: string): IndicatorMeasurement | undefined =>
      baselineValue === undefined
        ? undefined
        : {
            id: makeId("IM"),
            companyId: resolvedCompanyId,
            indicatorId,
            period: baselinePeriod(frequency, now),
            value: baselineValue,
            reportedBy: resolvedReportedBy,
            reportedAt: now.toISOString(),
          };

    if (match) {
      usedIndicators.add(match.entity.id);
      const existing = match.entity;
      // Un indicateur de chantier garde son axe s'il reste l'un des axes du chantier.
      const keepAxis =
        chantierId && (chantierAxesById.get(chantierId) ?? []).includes(existing.axisId);
      let merged: Indicator & StrategicImportRef = withoutCleared(
        {
          ...existing,
          ...fields,
          axisId: keepAxis ? existing.axisId : axisId,
          ...(chantierId ? { chantierId } : {}),
          // Cellule vide = valeur existante conservée (upsert non destructif) ; tiret = effacée.
          responsibleRoles:
            responsibleRoles.length > 0
              ? responsibleRoles
              : rolesCleared
                ? []
                : existing.responsibleRoles,
          ...(fileUsers ? { additionalAuthorizedUserIds: fileUsers } : {}),
          ...(match.by === "id" ? {} : { importCode: code || undefined }),
        },
        cleared
      );
      if (!chantierId && merged.chantierId) {
        const { chantierId: _drop, ...rest } = merged;
        void _drop;
        merged = rest;
      }
      let measurement: IndicatorMeasurement | undefined;
      if (exMeasurements) {
        const history = exMeasurements.filter((m) => m.indicatorId === existing.id);
        if (history.length === 0) {
          measurement = newBaseline(existing.id);
        } else if (baselineValue !== undefined) {
          const current = baselineMeasurement(existing.id, history)?.value;
          if (current !== baselineValue) {
            warn(sheet, rowNumber, "baselineIgnored", {
              value: baselineValue,
              name,
              current: current ?? "—",
            });
          }
        }
        const targetChanged =
          merged.objectiveValue !== existing.objectiveValue ||
          merged.direction !== existing.direction ||
          merged.kind !== existing.kind;
        if (targetChanged || measurement) {
          merged = {
            ...merged,
            status: computeIndicatorStatus(merged, [
              ...history,
              ...(measurement ? [measurement] : []),
            ]),
          };
        }
      }
      if (measurement) measurementsToCreate.push(measurement);
      if (sameIgnoring(merged, existing, ["lastUpdate"])) indicatorsUnchanged += 1;
      else indicatorsToUpdate.push({ ...merged, lastUpdate: today });
    } else {
      const id = makeId("IND");
      const measurement = newBaseline(id);
      const base: Indicator & StrategicImportRef = {
        id,
        companyId: resolvedCompanyId,
        programId: resolvedProgramId,
        axisId,
        ...(chantierId ? { chantierId } : {}),
        name,
        kind,
        frequency,
        objective,
        ...(targetValue !== undefined
          ? { objectiveValue: targetValue, direction: directionValue ?? "up" }
          : directionValue
            ? { direction: directionValue }
            : {}),
        ...(unitValue ? { unit: unitValue } : {}),
        responsibleRoles,
        ...(fileUsers ? { additionalAuthorizedUserIds: fileUsers } : {}),
        status: "on_track",
        ...(code ? { importCode: code } : {}),
        createdAt: today,
        lastUpdate: today,
      };
      // Statut calculé à partir de la mesure de référence (baseline sous la cible = à risque).
      const indicator = {
        ...base,
        status: computeIndicatorStatus(base, measurement ? [measurement] : []),
      };
      indicatorsToCreate.push(indicator);
      if (measurement) measurementsToCreate.push(measurement);
    }
    if (code) indicatorCodeSeen.set(code.toLowerCase(), rowNumber);
  }

  // ---------- Feuille "ETP" (staffing) ----------
  // Même règle que l'écran et l'import Effectifs (`checkStaffingLine`, lib/staffingLineValidation.ts)
  // et même rapprochement : "ID ligne", puis chantier + projet + équipe + dates, puis sans les
  // dates si la correspondance est unique (voir `matchStaffingRows`).
  const staffingToCreate: ChantierStaffing[] = [];
  const staffingToUpdate: ChantierStaffing[] = [];
  let staffingUnchanged = 0;
  const etpRows: StaffingSheetRow[] = [];

  for (const { row, rowNumber } of prepared.etp) {
    if (isRowEmpty(row)) continue;
    // Ligne de commentaire (exemples du modèle, "# " devant le code chantier) : ignorée.
    if (str(row["Code Chantier"]).startsWith("#")) continue;
    const sheet = "ETP";
    const chantierCode = text(sheet, rowNumber, row, "Code Chantier", { required: true });
    if (chantierCode === null) continue;
    const chantierId = resolveChantierCode(chantierCode);
    if (!chantierId) {
      err(sheet, rowNumber, "chantierNotFound", { code: chantierCode });
      continue;
    }
    // "Code Projet" : vide = rattachement conservé, "-" = retiré (lot 5 — auparavant une cellule
    // vidée retirait le rattachement et "-" était lu comme un code introuvable). Pour le
    // rapprochement sans "ID ligne", vide et "-" valent « sans projet ».
    const actionCell = readOptionalTextCell(row["Code Projet"]);
    const actionCode = actionCell.kind === "set" ? actionCell.value : "";
    let actionId: string | undefined;
    if (actionCode) {
      actionId = resolveActionCode(actionCode);
      if (!actionId) {
        err(sheet, rowNumber, "projectNotFound", { code: actionCode });
        continue;
      }
    }
    const fn = text(sheet, rowNumber, row, "Fonction (équipe, base ETP)", { required: true });
    if (fn === null) continue;
    const fteParsed = parseCellNumber(row["Nombre d'ETP"]);
    if (fteParsed && !fteParsed.ok) {
      err(sheet, rowNumber, "notNumber", { column: "Nombre d'ETP", value: fteParsed.raw });
      continue;
    }
    // "Précision" : vide = conservée, "-" = effacée (règle commune, lib/excelCells.ts).
    const noteCell = readOptionalTextCell(row["Précision"]);
    if (noteCell.kind === "set" && noteCell.value.length > STRATEGIC_IMPORT_MAX_TEXT_LENGTH) {
      err(sheet, rowNumber, "tooLong", {
        column: "Précision",
        max: STRATEGIC_IMPORT_MAX_TEXT_LENGTH,
        length: noteCell.value.length,
      });
      continue;
    }
    const startDate = optDate(sheet, rowNumber, row, "Date début");
    if (startDate === null) continue;
    const endDate = optDate(sheet, rowNumber, row, "Date fin");
    if (endDate === null) continue;
    etpRows.push({
      rowNumber,
      chantierId,
      actionId,
      actionCode,
      actionCell: actionCell.kind,
      fn,
      fteRaw: str(row["Nombre d'ETP"]),
      fte: fteParsed?.ok ? fteParsed.value : undefined,
      noteCell,
      startDate,
      endDate,
      lineId: str(row["ID ligne"]),
    });
  }

  const etpMatch = matchStaffingRows(etpRows, exStaffing);
  const duplicatedEtp = new Set<number>();
  etpMatch.duplicateIds.forEach((rowNumbers, id) => {
    for (const n of rowNumbers) {
      duplicatedEtp.add(n);
      err("ETP", n, "staffingDuplicateLineId", { id, rows: rowNumbers.join(", ") });
    }
  });
  for (const u of etpMatch.unknownIds)
    warn("ETP", u.rowNumber, "staffingUnknownLineId", { id: u.id });
  const firstEtpRowByKey = new Map<string, number>();
  const duplicatedFirstEtpRows = new Map<number, number>();
  const etpCreations = new Map<number, ChantierStaffing>();
  const etpCreationKeys = new Map<number, string>();
  const etpFinalById = new Map<string, ChantierStaffing>();
  const actionOf = (id: string) =>
    parsedActions.find((p) => p.action.id === id)?.action ?? exActions.find((a) => a.id === id);
  for (const r of etpRows) {
    if (duplicatedEtp.has(r.rowNumber)) continue;
    const sheet = "ETP";
    const { rowNumber, matched } = r;
    // Cellule de date vide sur une mise à jour = date existante conservée.
    const startDate = r.startDate ?? matched?.startDate;
    const endDate = r.endDate ?? matched?.endDate;
    const legacyUndated = matched !== undefined && (!startDate || !endDate);
    // "Code Projet" vide sur une mise à jour = rattachement existant conservé ("-" le retire).
    const actionId = r.actionCell === "keep" && matched?.actionId ? matched.actionId : r.actionId;
    const action = actionId ? actionOf(actionId) : undefined;
    if (r.actionCell === "keep" && action && action.chantierId !== r.chantierId) {
      // Chantier changé dans le fichier : le projet conservé n'appartient plus au chantier.
      err(sheet, rowNumber, "projectNotFound", { code: importCodeOf(action) ?? action.name });
      continue;
    }
    const check = checkStaffingLine(
      { team: r.fn, fte: r.fte, startDate, endDate },
      {
        knownTeams: options.knownDepartments,
        currentTeam: matched?.function,
        projectRange: action ? { start: action.start, end: action.end } : null,
        teamAvailableFte: options.teamAvailableFte,
      }
    );
    let rowFailed = false;
    for (const code of Object.values(check.errors) as StaffingLineError[]) {
      // Ligne historique sans date : mise à jour acceptée, dates à compléter.
      if ((code === "startRequired" || code === "endRequired") && legacyUndated) continue;
      rowFailed = true;
      const known = options.knownDepartments ?? [];
      switch (code) {
        case "teamRequired":
          err(sheet, rowNumber, "required", { column: "Fonction (équipe, base ETP)" });
          break;
        case "teamUnknown":
          err(sheet, rowNumber, "staffingUnknownTeam", {
            value: r.fn,
            expected:
              known.length > 0 ? known.join(", ") : STRATEGIC_IMPORT_MESSAGES.staffingNoTeams,
          });
          break;
        case "fteRequired":
          err(sheet, rowNumber, "required", { column: "Nombre d'ETP" });
          break;
        case "fteInvalid":
          err(sheet, rowNumber, "notNumber", { column: "Nombre d'ETP", value: r.fteRaw });
          break;
        case "fteNotPositive":
          err(sheet, rowNumber, "notPositive", { column: "Nombre d'ETP" });
          break;
        case "startRequired":
        case "endRequired":
          err(sheet, rowNumber, "requiredDate", {
            column: code === "startRequired" ? "Date début" : "Date fin",
          });
          break;
        case "endBeforeStart":
          checkOrder(sheet, rowNumber, startDate, endDate, "Date début", "Date fin");
          break;
        default:
          // startInvalid / endInvalid : impossibles ici (dates déjà lues par `optDate`).
          err(sheet, rowNumber, "invalidDate", {
            column: code === "startInvalid" ? "Date début" : "Date fin",
            value: (code === "startInvalid" ? startDate : endDate) ?? "",
          });
      }
    }
    if (rowFailed) continue;
    if (legacyUndated) warn(sheet, rowNumber, "staffingDatesMissing");
    if (check.warnings.includes("teamLeftBase"))
      warn(sheet, rowNumber, "staffingTeamLeftBase", { value: r.fn });
    if (check.warnings.includes("fteAboveTeam") && check.fte !== null)
      warn(sheet, rowNumber, "staffingFteAboveTeam", {
        fte: formatStaffingFte(check.fte),
        team: check.team,
        dispo: formatStaffingFte(check.teamAvailableFte ?? 0),
      });
    if (check.warnings.includes("outsideProject") && action)
      warn(sheet, rowNumber, "staffingOutsideProject", {
        code: r.actionCode || (importCodeOf(action) ?? action.name),
        start: action.start ?? "",
        end: action.end ?? "",
      });

    const note =
      r.noteCell.kind === "set"
        ? r.noteCell.value
        : r.noteCell.kind === "keep"
          ? matched?.note
          : undefined;
    const fields = {
      chantierId: r.chantierId,
      function: check.team,
      fte: check.fte as number,
      ...(note ? { note } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
      ...(actionId ? { actionId } : {}),
    };
    if (matched) {
      // Champs facultatifs retirés quand la fusion les efface ("-" en Précision ou Code Projet).
      const merged: ChantierStaffing = { ...matched, ...fields };
      if (!note) delete merged.note;
      if (!actionId) delete merged.actionId;
      etpFinalById.set(matched.id, merged);
      if (sameIgnoring(merged, matched, [])) staffingUnchanged += 1;
      else staffingToUpdate.push(merged);
      continue;
    }
    const key = staffingBusinessKey(r.chantierId, check.team, startDate, endDate, actionId);
    const first = firstEtpRowByKey.get(key);
    if (first !== undefined) {
      err(sheet, rowNumber, "staffingDuplicateRow", { line: first });
      duplicatedFirstEtpRows.set(first, rowNumber);
      continue;
    }
    firstEtpRowByKey.set(key, rowNumber);
    etpCreationKeys.set(rowNumber, key);
    etpCreations.set(rowNumber, {
      id: makeId("ST"),
      companyId: resolvedCompanyId,
      programId: resolvedProgramId,
      ...fields,
      createdAt: today,
    });
  }
  // Une création en doublon invalide aussi la 1re occurrence (on ne sait pas laquelle est juste).
  duplicatedFirstEtpRows.forEach((dup, first) =>
    err("ETP", first, "staffingDuplicateRow", { line: dup })
  );
  // Création reprenant exactement la clé d'une ligne existante (lot 5 — ligne copiée dont l'« ID
  // ligne » a été vidé) : erreur, comme un doublon interne au fichier. Comparée à l'état APRÈS les
  // mises à jour du fichier (une ligne existante dont les dates changent libère son ancienne clé).
  const existingEtpByKey = new Map<string, ChantierStaffing>();
  for (const s of exStaffing) {
    const f = etpFinalById.get(s.id) ?? s;
    existingEtpByKey.set(
      staffingBusinessKey(f.chantierId, f.function, f.startDate, f.endDate, f.actionId),
      f
    );
  }
  const etpCopiesOfExisting = new Set<number>();
  etpCreationKeys.forEach((key, rowNumber) => {
    const existing = existingEtpByKey.get(key);
    if (!existing) return;
    etpCopiesOfExisting.add(rowNumber);
    err("ETP", rowNumber, "staffingDuplicateExisting", { id: existing.id });
  });
  etpCreations.forEach((entry, rowNumber) => {
    if (!duplicatedFirstEtpRows.has(rowNumber) && !etpCopiesOfExisting.has(rowNumber))
      staffingToCreate.push(entry);
  });

  const peopleList = people.finish(warn);

  return {
    toCreate: {
      axes: axesToCreate,
      chantiers: chantiersToCreate,
      actions: actionsToCreate,
      indicators: indicatorsToCreate,
      measurements: measurementsToCreate,
      staffing: staffingToCreate,
    },
    toUpdate: {
      axes: axesToUpdate,
      chantiers: chantiersToUpdate,
      actions: actionsToUpdate,
      indicators: indicatorsToUpdate,
      measurements: [],
      staffing: staffingToUpdate,
    },
    unchanged: {
      axes: axesUnchanged,
      chantiers: chantiersUnchanged,
      actions: actionsUnchanged,
      indicators: indicatorsUnchanged,
      staffing: staffingUnchanged,
    },
    errors,
    warnings,
    people: peopleList,
  };
}

// ---------- Lecture du classeur ----------

export const STRATEGIC_IMPORT_SHEET_NAMES = {
  guide: "Lisez-moi",
  axes: "Axes",
  chantiers: "Chantiers",
  // Clé interne `actions` (type `ChantierAction`) — feuille affichée "Projets".
  actions: "Projets",
  livrables: "Livrables",
  indicateurs: "Indicateurs",
  etp: "ETP",
} as const;

/** Anciens noms de feuille acceptés. */
const SHEET_ALIASES: Partial<Record<SheetKey, string[]>> = {
  actions: ["Actions"],
  livrables: ["Deliverables"],
};

/** Lit un classeur (feuille "Lisez-moi" ignorée) : lignes par feuille + en-têtes réels + feuilles
 *  absentes/renommées — point d'entrée partagé par `StrategicImportButton` et les tests. */
export function parseStrategicImportWorkbook(
  workbook: WorkBook,
  XLSX: XlsxModule
): StrategicImportRawSheets {
  const find = (name: string) => workbook.SheetNames.find((n) => norm(n) === norm(name));
  const result: StrategicImportRawSheets = {
    axes: [],
    chantiers: [],
    actions: [],
    livrables: [],
    indicateurs: [],
    etp: [],
    headers: {},
    missingSheets: [],
    aliasedSheets: {},
  };
  for (const key of Object.keys(SHEET_SPECS) as SheetKey[]) {
    let sheetName = find(STRATEGIC_IMPORT_SHEET_NAMES[key]);
    if (!sheetName) {
      for (const alias of SHEET_ALIASES[key] ?? []) {
        sheetName = find(alias);
        if (sheetName) {
          result.aliasedSheets![key] = sheetName;
          break;
        }
      }
    }
    if (!sheetName) {
      result.missingSheets!.push(key);
      continue;
    }
    const ws = workbook.Sheets[sheetName];
    const headerRow = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" })[0] ?? [];
    result.headers![key] = headerRow.map((h) => str(h)).filter(Boolean);
    result[key] = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    rescalePercentCells(key, ws, headerRow, result[key], XLSX);
  }
  return result;
}

/** Colonnes en points de pourcentage (0 à 100) — en-tête canonique et alias. */
const PERCENT_COLUMNS: Partial<Record<SheetKey, string[]>> = {
  actions: ["Poids dans le chantier (%)", "Poids dans le chantier"],
};

/**
 * Cellule au FORMAT POURCENTAGE d'Excel dans une colonne en points de % : Excel stocke « 40 % »
 * sous la forme 0,4 — lue telle quelle, elle devenait un poids de 0,4 % (audit lot 4). La valeur
 * est ramenée en points (× 100, arrondie pour effacer le bruit binaire : 0,07 × 100 = 7,000…01).
 * Le format est connu grâce à `cellNF` (`XLSX_READ_OPTIONS`) ; un CSV n'a pas de format (« 40% »
 * y est du texte, déjà lu 40 par `parseCellNumber`). Les bornes 0–100 restent contrôlées par la
 * validation (hors bornes = erreur de ligne, jamais ramené en silence).
 */
function rescalePercentCells(
  key: SheetKey,
  ws: WorkBook["Sheets"][string],
  headerRow: unknown[],
  rows: Record<string, unknown>[],
  XLSX: XlsxModule
): void {
  const wanted = PERCENT_COLUMNS[key];
  if (!wanted || !ws["!ref"]) return;
  const range = XLSX.utils.decode_range(ws["!ref"]);
  const wantedNorm = new Set(wanted.map(norm));
  headerRow.forEach((h, i) => {
    const header = str(h);
    if (!header || !wantedNorm.has(norm(header))) return;
    const c = range.s.c + i;
    for (const row of rows) {
      const r = (row as { __rowNum__?: number }).__rowNum__;
      if (typeof r !== "number") continue;
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as
        { t?: string; v?: unknown; z?: unknown } | undefined;
      if (!cell || cell.t !== "n" || typeof cell.v !== "number") continue;
      if (!isPercentFormat(cell.z)) continue;
      row[header] = Math.round(cell.v * 100 * 1e9) / 1e9;
    }
  });
}

// ---------- Modèle & export ----------

export const STRATEGIC_IMPORT_GUIDE_ROWS: string[][] = [
  ["Guide d'import — Plan Stratégique BeTrack"],
  [""],
  ["1. Ordre des feuilles"],
  ["Axes -> Chantiers -> Projets -> Livrables (facultative) -> Indicateurs -> ETP (facultative)."],
  [
    "Onglet \"Équipes\" (référence) : équipes de la base ETP de l'entreprise et leur effectif disponible en ETP. Il est ignoré à l'import.",
  ],
  [""],
  ['2. Clé de liaison "Code"'],
  [
    'Chaque feuille référence la précédente par un "Code". Ce Code est conservé dans BeTrack : réimporter le même fichier met à jour les lignes existantes au lieu de les dupliquer.',
  ],
  [
    '  - "Code" (Axes) est repris par "Codes Axes (séparés par ;)" (Chantiers) — un chantier peut avoir plusieurs axes.',
  ],
  ['  - "Code" (Chantiers) est repris par "Code Chantier" (Projets, Indicateurs, ETP).'],
  ['  - "Code" (Projets) est repris par "Code Projet" (Livrables, ETP).'],
  [
    '  - Livrables : une seule date, "Échéance" (date à laquelle le livrable doit être fait). Un ancien fichier avec "Début"/"Fin" reste accepté : "Fin" = échéance, "Début" ignoré.',
  ],
  [
    '  - "Indicateurs" se rattache à UN axe OU UN chantier : renseignez "Code Axe" OU "Code Chantier", jamais les deux. Leur "Code" est facultatif.',
  ],
  [
    '  - Dépendances : "CH1:FS;CH2:SS" (types FS, SS, FF, SF ; FS si omis). Un chantier ne peut dépendre de lui-même, et les cycles sont refusés.',
  ],
  [""],
  ["3. Obligatoire vs facultatif"],
  ['Obligatoires : "Code"/"Nom" de chaque feuille, dates de Projets (début <= fin).'],
  [
    'Facultatifs : Description, "Sponsor d\'axe", "Sponsor de chantier", "Responsable projet", budgets (>= 0), poids (0 à 100), "Étape de maturité" (vide = 1re étape du programme), "Valeur initiale" des Indicateurs (mesure de référence datée de la période précédente), feuilles Livrables et ETP.',
  ],
  [
    'Sponsor d\'axe / Sponsor de chantier / Responsable projet / Contributeurs : saisissez l\'identifiant BeTrack, l\'e-mail ou le « Prénom Nom » d\'un compte existant. Un nom inconnu est conservé en texte, signalé en avertissement et proposé à la création de compte (avec le rôle correspondant à sa colonne). Les anciens en-têtes "Owner"/"Pilote" restent acceptés ; l\'ancienne colonne "Sponsor" des projets est ignorée.',
  ],
  [
    'Projets : "Contributeurs" (facultatif) = plusieurs personnes séparées par ; ou ,. Indicateurs : "Responsables saisie" = personne(s) nommée(s) autorisée(s) à saisir les valeurs (au moins une, ou à défaut un rôle dans "Rôles responsables", ancien mode).',
  ],
  ["Longueurs maximales : 200 caractères pour un nom, 5000 pour une description."],
  [""],
  ["4. Mise à jour d'un plan existant"],
  [
    "Exportez le plan (bouton « Exporter le plan »), modifiez le fichier puis réimportez-le : l'aperçu indique ce qui sera créé, mis à jour ou inchangé. Une cellule vide ne remplace jamais une valeur existante.",
  ],
  [
    'Effacer une valeur : saisissez un tiret « - » seul dans la cellule. Accepté dans toutes les colonnes facultatives (Description, Couleur, sponsors, "Responsable projet", "Contributeurs", budgets, "ETP consommés", poids, "Dépendances", "Échéance" des Livrables, "Valeur cible", "Sens", "Unité", "Responsables saisie", "Rôles responsables", "Code Projet" et "Précision" de la feuille ETP). Refusé (erreur) dans une colonne obligatoire, dans un "Code" et dans "Étape de maturité".',
  ],
  [
    "Dépendances vers un chantier que vous ne voyez pas : elles ne figurent pas dans l'export et sont conservées telles quelles au ré-import.",
  ],
  [
    `Feuille ETP : une ligne = une équipe de la base ETP ("Fonction") sur un chantier ou un projet ; "Nombre d'ETP" > 0 (au-delà de l'effectif disponible de l'équipe, simple avertissement) ; "Date début" et "Date fin" obligatoires (fin >= début). "ID ligne" (rempli par l'export) identifie la ligne : ne le modifiez pas, laissez-le vide pour une nouvelle ligne (une copie exacte d'une ligne existante est refusée). "Précision" ou "Code Projet" vide = valeur conservée ; un tiret "-" efface la précision ou retire le rattachement au projet.`,
  ],
  [STAFFING_TEAMS_RULE],
  [
    'Feuille ETP du modèle : les exemples reprennent les équipes réelles de la base ETP mais sont commentés ("#" devant le code chantier) — une ligne commençant par "#" est ignorée à l\'import ; retirez le "#" pour importer un exemple.',
  ],
  [
    "Poids dans le chantier (%) : saisissez 40 ou 40 % (une cellule au format pourcentage d'Excel est bien lue 40) ; une valeur hors de 0 à 100 est refusée.",
  ],
  [
    "Dates : les exports écrivent de vraies dates Excel (JJ/MM/AAAA) ; JJ/MM/AAAA ou AAAA-MM-JJ sont acceptés à l'import.",
  ],
  [""],
  ["5. Workflow conseillé (pré-remplissage par IA)"],
  [
    'Collez le contenu de vos slides/documents de plan stratégique dans un assistant IA et demandez-lui de remplir CE modèle exact : mêmes onglets, mêmes en-têtes, en gardant les "Code" cohérents entre les feuilles. Relisez, supprimez les lignes d\'exemple, puis importez.',
  ],
  [""],
  ["6. En cas d'erreur"],
  [
    "L'aperçu avant import liste chaque anomalie (feuille + numéro de ligne + raison). Tant que le fichier contient une erreur, l'import est impossible : corrigez le fichier puis réimportez-le. Les avertissements n'empêchent pas l'import.",
  ],
];

export const STRATEGIC_AXIS_EXAMPLE_ROWS = [
  [
    "AX1",
    "Renforcer la robustesse opérationnelle",
    "Fiabiliser les processus critiques et réduire les incidents majeurs.",
    "Isabelle Roy",
    "#320300",
    "Planifié",
  ],
  [
    "AX2",
    "Accélérer la transformation digitale",
    "Digitaliser les parcours clients et collaborateurs prioritaires.",
    "Karim Haddad",
    "#1F5673",
    "Défini",
  ],
  [
    "AX3",
    "Développer l'excellence client",
    "Améliorer la satisfaction et la fidélisation sur les segments clés.",
    "Sophie Marchand",
    "#2E7D32",
    "Validé",
  ],
];

export const STRATEGIC_CHANTIER_EXAMPLE_ROWS = [
  [
    "CH1",
    "AX1",
    "Industrialiser le pilotage de la donnée",
    "Fiabiliser la collecte et la restitution des indicateurs de production.",
    "Marc Dubois",
    "Planifié",
    150000,
    42000,
    2.5,
    "",
  ],
  [
    "CH2",
    "AX2",
    "Digitaliser le parcours collaborateur",
    "Déployer un portail RH self-service pour les demandes courantes.",
    "Claire Fontaine",
    "Défini",
    90000,
    0,
    1,
    "CH1:FS",
  ],
  [
    "CH3",
    "AX1;AX3",
    "Renforcer la cybersécurité des systèmes critiques",
    "Sécuriser les accès et les flux des applications sensibles.",
    "Nicolas Petit",
    "Validé",
    220000,
    55000,
    "",
    "",
  ],
];

export const STRATEGIC_ACTION_EXAMPLE_ROWS = [
  [
    "ACT1",
    "CH1",
    "Cartographier les flux de données existants",
    "État des lieux des sources et flux de données actuels.",
    "Marc Dubois",
    "2026-01-15",
    "2026-03-31",
    "Planifié",
    30000,
    8000,
    50,
    "Claire Fontaine; Nicolas Petit",
  ],
  [
    "ACT2",
    "CH2",
    "Déployer le portail RH self-service",
    "Mise en production du portail pour congés et attestations.",
    "Claire Fontaine",
    "2026-02-01",
    "2026-06-30",
    // Étape laissée VIDE à dessein — repli sur la 1re étape du programme.
    "",
    45000,
    0,
    60,
    "",
  ],
  [
    "ACT3",
    "CH1",
    "Automatiser le reporting de production",
    "Mise en place de tableaux de bord automatisés pour le suivi de production.",
    "Marc Dubois",
    "2026-04-01",
    "2026-09-30",
    "Défini",
    20000,
    "",
    50,
    "",
  ],
];

export const STRATEGIC_DELIVERABLE_EXAMPLE_ROWS = [
  ["ACT1", "Cartographie validée en comité de pilotage", "2026-03-31"],
  ["ACT2", "Portail RH ouvert en pilote sur un périmètre restreint", "2026-05-31"],
];

export const STRATEGIC_INDICATOR_EXAMPLE_ROWS = [
  [
    "KPI1",
    "AX1",
    "",
    "Taux de disponibilité des systèmes critiques",
    "Quantitatif",
    "Trimestrielle",
    "99,5% de disponibilité en régime de croisière",
    99.5,
    96.8,
    "Plus haut vaut mieux",
    "%",
    "",
    "Isabelle Roy",
  ],
  [
    "KPI2",
    "",
    "CH1",
    "Taux d'automatisation du reporting de production",
    "Quantitatif",
    "Trimestrielle",
    "80% des rapports de production automatisés",
    80,
    25,
    "Plus haut vaut mieux",
    "%",
    "",
    "Marc Dubois",
  ],
  [
    // Indicateur qualitatif : "Valeur cible"/"Sens"/"Valeur initiale" vides.
    "KPI3",
    "AX2",
    "",
    "Indice de maturité digitale (baromètre interne)",
    "Qualitatif",
    "Semestrielle",
    'Passer au niveau "avancé" du baromètre interne',
    "",
    "",
    "",
    "",
    "",
    "Karim Haddad",
  ],
];

/** Ligne de commentaire de la feuille ETP (1re cellule commençant par "#", ignorée à l'import). */
const etpComment = (text: string) => [text, "", "", "", "", "", ""];

/**
 * Lignes d'exemple de la feuille ETP du modèle (lot 5, comme le modèle Effectifs) : construites
 * avec les VRAIES équipes de la base ETP de l'entreprise, mais COMMENTÉES ("# " devant le code
 * chantier) — ignorées à l'import tant que l'utilisateur ne retire pas le "#". Auparavant des
 * équipes fictives (« Data & Analytics »…) faisaient échouer l'import du modèle. Base ETP vide =
 * une ligne explicative.
 */
export function buildStrategicStaffingExampleRows(
  knownDepartments: readonly string[]
): (string | number)[][] {
  const teams = Array.from(new Set(knownDepartments.filter((n) => n.trim() !== "")));
  const rows: (string | number)[][] = [
    etpComment(
      "# Les lignes commençant par # sont ignorées. Retirez le # d'un exemple pour l'importer."
    ),
  ];
  if (teams.length === 0) {
    rows.push(etpComment(`# ${STAFFING_TEAMS_EMPTY_TEXT}.`));
    return rows;
  }
  const team = (i: number) => teams[i % teams.length];
  rows.push(
    ["# CH1", "ACT1", team(0), 2.5, "Squad dédiée à la cartographie", "2026-01-15", "2026-03-31"],
    ["# CH2", "", team(1), 1, "Cheffe de projet à mi-temps", "2026-02-01", "2026-12-31"],
    ["# CH3", "", team(2), 1.5, "", "2026-01-01", "2026-06-30"]
  );
  return rows;
}

type SheetRows = Record<SheetKey, unknown[][]>;

/** Colonnes date des feuilles : écrites en VRAIES cellules date Excel (JJ/MM/AAAA), relues
 *  exactement par l'import (`readXlsxWorkbook`). */
const DATE_HEADERS = ["Date début", "Date fin", "Échéance"] as const;

/** Équipes de la base ETP (noms + effectif disponible) — feuille de référence "Équipes". */
export type StrategicTeamsReference = {
  knownDepartments: readonly string[];
  fteByTeam: Readonly<Record<string, number>>;
};

/** Compose un classeur au format d'import (feuille "Lisez-moi" + 6 feuilles + feuille de
 *  référence "Équipes", à côté de la feuille ETP — ignorée à l'import). */
function buildWorkbook(
  rows: SheetRows,
  XLSX: XlsxModule,
  teams: StrategicTeamsReference
): WorkBook {
  const wb = XLSX.utils.book_new();
  const guideSheet = XLSX.utils.aoa_to_sheet(STRATEGIC_IMPORT_GUIDE_ROWS);
  guideSheet["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, STRATEGIC_IMPORT_SHEET_NAMES.guide);
  for (const key of Object.keys(SHEET_SPECS) as SheetKey[]) {
    const headers = SHEET_SPECS[key].headers;
    const sheet = XLSX.utils.aoa_to_sheet([[...headers], ...rows[key]]);
    applyExcelDateColumns(XLSX, sheet, DATE_HEADERS);
    sheet["!cols"] = headers.map((h) => ({ wch: Math.max(14, Math.min(48, h.length + 2)) }));
    XLSX.utils.book_append_sheet(wb, sheet, STRATEGIC_IMPORT_SHEET_NAMES[key]);
  }
  appendStaffingTeamsSheet(XLSX, wb, teams.knownDepartments, teams.fteByTeam);
  return wb;
}

/** Modèle vierge avec lignes d'exemple (+ feuille "Équipes" de la base ETP de l'entreprise). */
export function buildStrategicImportTemplateWorkbook(
  XLSX: XlsxModule,
  teams: StrategicTeamsReference
): WorkBook {
  return buildWorkbook(
    {
      axes: STRATEGIC_AXIS_EXAMPLE_ROWS,
      chantiers: STRATEGIC_CHANTIER_EXAMPLE_ROWS,
      actions: STRATEGIC_ACTION_EXAMPLE_ROWS,
      livrables: STRATEGIC_DELIVERABLE_EXAMPLE_ROWS,
      indicateurs: STRATEGIC_INDICATOR_EXAMPLE_ROWS,
      etp: buildStrategicStaffingExampleRows(teams.knownDepartments),
    },
    XLSX,
    teams
  );
}

/**
 * Export du plan courant AU FORMAT D'IMPORT : Code = `importCode` (ou `id` BeTrack à défaut),
 * étapes par libellé, personnes par identifiant (username stocké), mesure de référence = 1re
 * mesure numérique. Réimporter ce fichier sans modification = 0 création, 0 mise à jour.
 */
export function buildStrategicPlanExportWorkbook(
  data: StrategicImportExistingData,
  stages: MaturityStageConfig[],
  XLSX: XlsxModule,
  /** Équipes de la base ETP — feuille de référence "Équipes", ignorée à l'import. */
  teams: StrategicTeamsReference
): WorkBook {
  const codeOf = (e: { id: string }) => importCodeOf(e) ?? e.id;
  const axisCode = new Map(data.axes.map((a) => [a.id, codeOf(a)]));
  const chantierCode = new Map(data.chantiers.map((c) => [c.id, codeOf(c)]));
  const actionCode = new Map(data.actions.map((a) => [a.id, codeOf(a)]));
  // Étape inconnue du référentiel → vide (= conservée à l'import), jamais une erreur.
  const stageLabel = (id: string | undefined) =>
    (id && stages.find((s) => s.id === id)?.label) || "";
  const num = (v: number | undefined) => (v === undefined ? "" : v);
  const measurements = data.measurements ?? [];

  return buildWorkbook(
    {
      axes: data.axes.map((a) => [
        codeOf(a),
        a.name,
        a.description ?? "",
        a.owner ?? "",
        a.color ?? "",
        stageLabel(a.stage),
      ]),
      chantiers: data.chantiers.map((c) => [
        codeOf(c),
        (c.axisIds ?? []).map((id) => axisCode.get(id) ?? id).join(";"),
        c.name,
        c.description ?? "",
        c.pilote ?? "",
        stageLabel(c.stage),
        num(c.allocatedBudget),
        num(c.consumedBudget),
        num(c.consumedFte),
        // Dépendance vers un chantier non visible par l'utilisateur qui exporte : non exportée
        // (jamais son id Firestore) — le ré-import la conserve telle quelle en base (lot 5).
        (c.dependencies ?? [])
          .filter((d) => chantierCode.has(d.targetId))
          .map((d) => `${chantierCode.get(d.targetId)}:${d.type}`)
          .join(";"),
      ]),
      actions: data.actions.map((a) => [
        codeOf(a),
        chantierCode.get(a.chantierId) ?? a.chantierId,
        a.name,
        a.description ?? "",
        a.owner ?? "",
        a.start ?? "",
        a.end ?? "",
        stageLabel(a.status),
        num(a.budget),
        num(a.consumedBudget),
        num(a.chantierWeightPct),
        (a.contributors ?? []).join(";"),
      ]),
      livrables: data.actions.flatMap((a) =>
        (a.deliverables ?? []).map((d) => [codeOf(a), d.label, d.dueDate ?? ""])
      ),
      indicateurs: data.indicators.map((i) => [
        codeOf(i),
        i.chantierId ? "" : (axisCode.get(i.axisId) ?? i.axisId),
        i.chantierId ? (chantierCode.get(i.chantierId) ?? i.chantierId) : "",
        i.name,
        KIND_LABEL[i.kind] ?? i.kind,
        FREQUENCY_LABEL[i.frequency] ?? i.frequency,
        i.objective,
        num(i.objectiveValue),
        num(baselineMeasurement(i.id, measurements)?.value),
        i.direction ? DIRECTION_LABEL[i.direction] : "",
        i.unit ?? "",
        (i.responsibleRoles ?? []).join(";"),
        (i.additionalAuthorizedUserIds ?? []).join(";"),
      ]),
      etp: (data.staffing ?? []).map((s) => [
        chantierCode.get(s.chantierId) ?? s.chantierId,
        s.actionId ? (actionCode.get(s.actionId) ?? s.actionId) : "",
        s.function,
        s.fte,
        s.note ?? "",
        s.startDate ?? "",
        s.endDate ?? "",
        s.id,
      ]),
    },
    XLSX,
    teams
  );
}
