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
  normalizeHeaderKey,
  parseCellDate,
  parseCellNumber,
} from "@/lib/excelParse";
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
 *
 * Ré-import (UPSERT) : chaque ligne est rapprochée d'une entité existante du programme, d'abord par
 * son `Code` (champ `importCode` stocké à la création, ou `id` BeTrack — c'est ce que produit
 * l'export), à défaut par NOM au sein du même parent (programme / axe / chantier) pour une entité
 * sans `importCode` (créée à la main ou par un import antérieur). Entité trouvée → mise à jour
 * (seulement si un champ change réellement), sinon création. Une cellule VIDE ne remplace jamais une
 * valeur existante (upsert non destructif). Réimporter le même fichier = 0 création, 0 mise à jour.
 * L'export (`buildStrategicPlanExportWorkbook`) produit le même format : aller-retour = 0 changement.
 *
 * Personnes (Owner d'axe, Pilote de chantier, Owner/Sponsor de projet) : la visibilité
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

export const STRATEGIC_AXIS_IMPORT_HEADERS = [
  "Code",
  "Nom",
  "Description",
  "Owner",
  "Couleur",
  "Étape de maturité",
] as const;

export const STRATEGIC_CHANTIER_IMPORT_HEADERS = [
  "Code",
  "Codes Axes (séparés par ;)",
  "Nom",
  "Description",
  "Pilote",
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
  "Owner",
  "Sponsor",
  "Date début",
  "Date fin",
  "Étape de maturité",
  "Budget",
  "Budget consommé",
  "Poids dans le chantier (%)",
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
  "Rôles responsables (séparés par ;)",
] as const;

export const STRATEGIC_STAFFING_IMPORT_HEADERS = [
  "Code Chantier",
  "Code Projet",
  "Fonction (équipe, base ETP)",
  "Nombre d'ETP",
  "Précision",
  "Date début",
  "Date fin",
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
  "strategic_lead",
  "axis_sponsor",
  "chantier_owner",
  "chantier_contributor",
  "internal_comm",
  "budget_control",
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
  unknownRole: 'Rôle "{value}" inconnu (attendu : {expected})',
  baselineNotNumber:
    '"Valeur initiale" non numérique ("{value}") : aucune mesure de référence créée',
  baselineIgnored:
    '"Valeur initiale" ({value}) ignorée : l\'indicateur « {name} » a déjà un historique de mesures (référence actuelle : {current})',
  personNotLinked:
    "« {name} » ne correspond à aucun compte : conservé en texte, sans effet sur la visibilité ni sur les validations ({count} référence(s))",
  personAmbiguous:
    "« {name} » correspond à plusieurs comptes ({usernames}) : non rattaché — indiquez l'identifiant exact",
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
  /** Comptes de l'entreprise ciblée (rapprochement Owner/Pilote/Sponsor). */
  users?: { username: string; name: string }[];
  /** Horloge injectable (tests). */
  now?: Date;
};

// ---------- Utilitaires ----------

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : v.toISOString();
  return String(v).trim();
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => isBlankCell(v));
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

type PersonResolver = {
  /** Renvoie le username rapproché, ou le texte d'origine (et le mémorise comme non rapproché). */
  resolve: (raw: string, sheet: StrategicImportSheet, rowNumber: number) => string;
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
    resolve(raw, sheet, rowNumber) {
      const { username, homonyms } = match(raw);
      if (username) return username;
      const key = norm(raw);
      const entry = unmatched.get(key);
      if (entry) entry.references += 1;
      else unmatched.set(key, { name: raw, references: 1, sheet, rowNumber, homonyms });
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
          ...(collisionWith ? { collisionWith } : {}),
        });
      }
      return people;
    },
  };
}

/** Réécrit Owner/Pilote/Sponsor des entités avec les usernames des comptes créés
 *  (`mapping` : clé `normalizePersonKey(texte)` → username). Pur, renvoie une copie. */
export function applyPeopleMapping(
  writes: StrategicImportWrites,
  mapping: Map<string, string>
): StrategicImportWrites {
  if (mapping.size === 0) return writes;
  const map = (v: string | undefined) => (v ? (mapping.get(norm(v)) ?? v) : v);
  return {
    ...writes,
    axes: writes.axes.map((a) => (a.owner ? { ...a, owner: map(a.owner) } : a)),
    chantiers: writes.chantiers.map((c) => (c.pilote ? { ...c, pilote: map(c.pilote) } : c)),
    actions: writes.actions.map((a) =>
      a.owner || a.sponsor
        ? {
            ...a,
            ...(a.owner ? { owner: map(a.owner) } : {}),
            ...(a.sponsor ? { sponsor: map(a.sponsor) } : {}),
          }
        : a
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
    aliases: {},
    required: ["Code", "Nom"],
  },
  chantiers: {
    label: "Chantiers",
    headers: STRATEGIC_CHANTIER_IMPORT_HEADERS,
    aliases: {
      "Code Axe": "Codes Axes (séparés par ;)",
      "Codes Axes": "Codes Axes (séparés par ;)",
      Dépendances: "Dépendances (Code:type, séparées par ;)",
    },
    required: ["Code", "Codes Axes (séparés par ;)", "Nom"],
  },
  actions: {
    label: "Projets",
    headers: STRATEGIC_ACTION_IMPORT_HEADERS,
    aliases: { "Poids dans le chantier": "Poids dans le chantier (%)" },
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
    aliases: { "Rôles responsables": "Rôles responsables (séparés par ;)" },
    required: ["Nom", "Type", "Fréquence", "Objectif", "Rôles responsables (séparés par ;)"],
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
    if (value.length > max) {
      err(sheet, rowNumber, "tooLong", { column, max, length: value.length });
      return null;
    }
    return value;
  };

  const optNumber = (
    sheet: StrategicImportSheet,
    rowNumber: number,
    row: Record<string, unknown>,
    column: string,
    { min, max }: { min?: number; max?: number } = {}
  ): number | undefined | null => {
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
    column: string
  ): string | undefined | null => {
    const value = text(sheet, rowNumber, row, column);
    if (value === null) return null;
    return value ? people.resolve(value, sheet, rowNumber) : undefined;
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

  /** Ne garde que les champs renseignés (upsert non destructif). */
  const defined = <T extends Record<string, unknown>>(o: T): Partial<T> =>
    Object.fromEntries(
      Object.entries(o).filter(([, v]) => v !== undefined && v !== "")
    ) as Partial<T>;

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
    const description = text(sheet, rowNumber, row, "Description", {
      max: STRATEGIC_IMPORT_MAX_TEXT_LENGTH,
    });
    if (description === null) continue;
    const color = text(sheet, rowNumber, row, "Couleur");
    if (color === null) continue;
    const stage = stageOf(sheet, rowNumber, row);
    if (stage === null) continue;
    const owner = person(sheet, rowNumber, row, "Owner");
    if (owner === null) continue;

    const fields = defined({ name, description, owner, color, stage });
    const match = matchExisting(exAxes, usedAxes, code, name, () => true);
    if (match) {
      usedAxes.add(match.entity.id);
      const merged: StrategicAxis & StrategicImportRef = {
        ...match.entity,
        ...fields,
        ...(match.by === "id" ? {} : { importCode: code }),
      };
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
    const description = text(sheet, rowNumber, row, "Description", {
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
    const pilote = person(sheet, rowNumber, row, "Pilote");
    if (pilote === null) continue;

    const match = matchExisting(exChantiers, usedChantiers, code, name, (c) =>
      (c.axisIds ?? []).some((id) => axisIds.includes(id))
    );
    if (match) usedChantiers.add(match.entity.id);
    const id = match?.entity.id ?? makeId("CH");
    parsedChantiers.push({
      rowNumber,
      code,
      id,
      depsRaw: str(row["Dépendances (Code:type, séparées par ;)"]),
      fields: defined({
        name,
        description,
        pilote,
        stage,
        allocatedBudget,
        consumedBudget,
        consumedFte,
      }) as Partial<Chantier>,
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
      const merged: Chantier & StrategicImportRef = {
        ...p.existing,
        ...p.fields,
        axisIds: p.axisIds,
        ...(deps ? { dependencies: deps } : {}),
        ...(p.matchedBy === "id" ? {} : { importCode: p.code }),
      };
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

  for (const { row, rowNumber } of prepared.actions) {
    if (isRowEmpty(row)) continue;
    const sheet = "Projets";
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
    const description = text(sheet, rowNumber, row, "Description", {
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
    const owner = person(sheet, rowNumber, row, "Owner");
    if (owner === null) continue;
    const sponsor = person(sheet, rowNumber, row, "Sponsor");
    if (sponsor === null) continue;

    const fields = defined({
      name,
      description,
      owner,
      sponsor,
      start,
      end,
      status,
      budget,
      consumedBudget,
      chantierWeightPct,
    }) as Partial<ChantierAction>;
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
      action = {
        ...match.entity,
        ...fields,
        chantierId,
        ...(match.by === "id" ? {} : { importCode: code }),
      };
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

  const resolveActionCode = (raw: string): string | undefined =>
    actionIdByCode.get(raw.toLowerCase()) ?? findExistingByRef(exActions, raw)?.id;

  // ---------- Feuille "Livrables" (embarqués dans un projet de CE fichier ; fusion par libellé) ----------
  const deliverablesByActionCode = new Map<string, { label: string; dueDate?: string }[]>();
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
    const dueDate = optDate(sheet, rowNumber, row, dueColumn);
    if (dueDate === null) continue;
    const list = deliverablesByActionCode.get(lower) ?? [];
    list.push({ label, ...(dueDate ? { dueDate } : {}) });
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

    const roleTokens = str(row["Rôles responsables (séparés par ;)"])
      .split(";")
      .map((r) => r.trim())
      .filter(Boolean);
    if (roleTokens.length === 0) {
      err(sheet, rowNumber, "rolesRequired");
      continue;
    }
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
    let direction: IndicatorDirection | undefined;
    if (directionRaw) {
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
    const unit = text(sheet, rowNumber, row, "Unité");
    if (unit === null) continue;

    // Valeur initiale illisible = avertissement (pas de mesure), jamais une erreur de ligne.
    const baselineParsed = parseCellNumber(row["Valeur initiale"]);
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

    const fields = defined({ name, kind, frequency, objective, objectiveValue, direction, unit });
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
      let merged: Indicator & StrategicImportRef = {
        ...existing,
        ...fields,
        axisId: keepAxis ? existing.axisId : axisId,
        ...(chantierId ? { chantierId } : {}),
        responsibleRoles,
        ...(match.by === "id" ? {} : { importCode: code || undefined }),
      };
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
        ...(objectiveValue !== undefined
          ? { objectiveValue, direction: direction ?? "up" }
          : direction
            ? { direction }
            : {}),
        ...(unit ? { unit } : {}),
        responsibleRoles,
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

  // ---------- Feuille "ETP" (upsert sur chantier + projet + fonction) ----------
  const staffingToCreate: ChantierStaffing[] = [];
  const staffingToUpdate: ChantierStaffing[] = [];
  let staffingUnchanged = 0;
  const usedStaffing = new Set<string>();

  for (const { row, rowNumber } of prepared.etp) {
    if (isRowEmpty(row)) continue;
    const sheet = "ETP";
    const chantierCode = text(sheet, rowNumber, row, "Code Chantier", { required: true });
    if (chantierCode === null) continue;
    const chantierId = resolveChantierCode(chantierCode);
    if (!chantierId) {
      err(sheet, rowNumber, "chantierNotFound", { code: chantierCode });
      continue;
    }
    const actionCode = str(row["Code Projet"]);
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
    if (!fteParsed || !fteParsed.ok || fteParsed.value <= 0) {
      err(sheet, rowNumber, "notPositive", { column: "Nombre d'ETP" });
      continue;
    }
    const note = text(sheet, rowNumber, row, "Précision", {
      max: STRATEGIC_IMPORT_MAX_TEXT_LENGTH,
    });
    if (note === null) continue;
    const startDate = optDate(sheet, rowNumber, row, "Date début");
    if (startDate === null) continue;
    const endDate = optDate(sheet, rowNumber, row, "Date fin");
    if (endDate === null) continue;
    if (!checkOrder(sheet, rowNumber, startDate, endDate, "Date début", "Date fin")) continue;

    const fields = defined({ fte: fteParsed.value, note, startDate, endDate });
    const existing = exStaffing.find(
      (s) =>
        !usedStaffing.has(s.id) &&
        s.chantierId === chantierId &&
        (s.actionId ?? undefined) === actionId &&
        norm(s.function) === norm(fn)
    );
    if (existing) {
      usedStaffing.add(existing.id);
      const merged: ChantierStaffing = { ...existing, ...fields };
      if (sameIgnoring(merged, existing, [])) staffingUnchanged += 1;
      else staffingToUpdate.push(merged);
    } else {
      staffingToCreate.push({
        id: makeId("ST"),
        companyId: resolvedCompanyId,
        programId: resolvedProgramId,
        chantierId,
        function: fn,
        fte: fteParsed.value,
        ...(note ? { note } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(actionId ? { actionId } : {}),
        createdAt: today,
      });
    }
  }

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
  }
  return result;
}

// ---------- Modèle & export ----------

export const STRATEGIC_IMPORT_GUIDE_ROWS: string[][] = [
  ["Guide d'import — Plan Stratégique BeTrack"],
  [""],
  ["1. Ordre des feuilles"],
  ["Axes -> Chantiers -> Projets -> Livrables (facultative) -> Indicateurs -> ETP (facultative)."],
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
    'Facultatifs : Description/Pilote/Owner/Sponsor, budgets (>= 0), poids (0 à 100), "Étape de maturité" (vide = 1re étape du programme), "Valeur initiale" des Indicateurs (mesure de référence datée de la période précédente), feuilles Livrables et ETP.',
  ],
  [
    "Owner/Pilote/Sponsor : saisissez l'identifiant BeTrack, l'e-mail ou le « Prénom Nom » d'un compte existant. Un nom inconnu est conservé en texte et proposé à la création de compte.",
  ],
  ["Longueurs maximales : 200 caractères pour un nom, 5000 pour une description."],
  [""],
  ["4. Mise à jour d'un plan existant"],
  [
    "Exportez le plan (bouton « Exporter le plan »), modifiez le fichier puis réimportez-le : l'aperçu indique ce qui sera créé, mis à jour ou inchangé. Une cellule vide ne remplace jamais une valeur existante.",
  ],
  [""],
  ["5. Workflow conseillé (pré-remplissage par IA)"],
  [
    'Collez le contenu de vos slides/documents de plan stratégique dans un assistant IA et demandez-lui de remplir CE modèle exact : mêmes onglets, mêmes en-têtes, en gardant les "Code" cohérents entre les feuilles. Relisez, supprimez les lignes d\'exemple, puis importez.',
  ],
  [""],
  ["6. En cas d'erreur"],
  [
    "Une ligne en erreur n'invalide qu'elle-même : l'aperçu avant import liste chaque anomalie (feuille + numéro de ligne + raison). Corrigez et réimportez.",
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
    "Isabelle Roy",
    "2026-01-15",
    "2026-03-31",
    "Planifié",
    30000,
    8000,
    50,
  ],
  [
    "ACT2",
    "CH2",
    "Déployer le portail RH self-service",
    "Mise en production du portail pour congés et attestations.",
    "Claire Fontaine",
    "Karim Haddad",
    "2026-02-01",
    "2026-06-30",
    // Étape laissée VIDE à dessein — repli sur la 1re étape du programme.
    "",
    45000,
    0,
    60,
  ],
  [
    "ACT3",
    "CH1",
    "Automatiser le reporting de production",
    "Mise en place de tableaux de bord automatisés pour le suivi de production.",
    "Marc Dubois",
    "Isabelle Roy",
    "2026-04-01",
    "2026-09-30",
    "Défini",
    20000,
    "",
    50,
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
    "cto;strategic_lead",
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
    "chantier_owner;strategic_lead",
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
    "strategic_lead",
  ],
];

export const STRATEGIC_STAFFING_EXAMPLE_ROWS = [
  [
    "CH1",
    "ACT1",
    "Data & Analytics",
    2.5,
    "Squad data dédiée à la cartographie",
    "2026-01-15",
    "2026-03-31",
  ],
  ["CH2", "", "Ressources Humaines", 1, "Cheffe de projet RH à mi-temps", "2026-02-01", ""],
  ["CH3", "", "Cybersécurité", 1.5, "", "", ""],
];

type SheetRows = Record<SheetKey, unknown[][]>;

/** Compose un classeur au format d'import (feuille "Lisez-moi" + 6 feuilles). */
function buildWorkbook(rows: SheetRows, XLSX: XlsxModule): WorkBook {
  const wb = XLSX.utils.book_new();
  const guideSheet = XLSX.utils.aoa_to_sheet(STRATEGIC_IMPORT_GUIDE_ROWS);
  guideSheet["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, guideSheet, STRATEGIC_IMPORT_SHEET_NAMES.guide);
  for (const key of Object.keys(SHEET_SPECS) as SheetKey[]) {
    const headers = SHEET_SPECS[key].headers;
    const sheet = XLSX.utils.aoa_to_sheet([[...headers], ...rows[key]]);
    sheet["!cols"] = headers.map((h) => ({ wch: Math.max(14, Math.min(48, h.length + 2)) }));
    XLSX.utils.book_append_sheet(wb, sheet, STRATEGIC_IMPORT_SHEET_NAMES[key]);
  }
  return wb;
}

/** Modèle vierge avec lignes d'exemple. */
export function buildStrategicImportTemplateWorkbook(XLSX: XlsxModule): WorkBook {
  return buildWorkbook(
    {
      axes: STRATEGIC_AXIS_EXAMPLE_ROWS,
      chantiers: STRATEGIC_CHANTIER_EXAMPLE_ROWS,
      actions: STRATEGIC_ACTION_EXAMPLE_ROWS,
      livrables: STRATEGIC_DELIVERABLE_EXAMPLE_ROWS,
      indicateurs: STRATEGIC_INDICATOR_EXAMPLE_ROWS,
      etp: STRATEGIC_STAFFING_EXAMPLE_ROWS,
    },
    XLSX
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
  XLSX: XlsxModule
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
        (c.dependencies ?? [])
          .map((d) => `${chantierCode.get(d.targetId) ?? d.targetId}:${d.type}`)
          .join(";"),
      ]),
      actions: data.actions.map((a) => [
        codeOf(a),
        chantierCode.get(a.chantierId) ?? a.chantierId,
        a.name,
        a.description ?? "",
        a.owner ?? "",
        a.sponsor ?? "",
        a.start ?? "",
        a.end ?? "",
        stageLabel(a.status),
        num(a.budget),
        num(a.consumedBudget),
        num(a.chantierWeightPct),
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
      ]),
      etp: (data.staffing ?? []).map((s) => [
        chantierCode.get(s.chantierId) ?? s.chantierId,
        s.actionId ? (actionCode.get(s.actionId) ?? s.actionId) : "",
        s.function,
        s.fte,
        s.note ?? "",
        s.startDate ?? "",
        s.endDate ?? "",
      ]),
    },
    XLSX
  );
}
