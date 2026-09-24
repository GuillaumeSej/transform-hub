import {
  DEFAULT_LIFECYCLE_STAGES,
  resolveStatusLabel,
  STATUS_LABEL,
  STATUS_LEVEL,
  STATUS_SHORT_LABEL,
} from "@/lib/status-config";
import { getImpactNatures } from "@/lib/impactConfig";
import {
  canonicalizeRowKeys,
  excelRowNumber,
  isBlankCell,
  normalizeHeaderKey,
  parseCellDate,
  parseCellNumber,
} from "@/lib/excelParse";
import { canDecideImpactRealized, coerceImpactStatus } from "@/lib/impactStatus";
import { leverImpactsOf } from "@/lib/engine";
import { leverImportPatch, normalizeLeverCode } from "@/lib/leversLogic";
import type {
  ActionImpact,
  ActionStatus,
  AuthUser,
  BeTrackData,
  DependencyType,
  Lever,
  LeverAction,
  LeverDependency,
  LeverStatus,
  LifecycleStage,
  SavingType,
  Workstream,
} from "@/types";

const WORKSTREAM_PALETTE = ["#C8102E", "#7B6B58", "#4A4A4A", "#8A9A5B", "#5B7A9A", "#9A7A5B"];

/** Slug stable et lisible à partir d'un nom de workstream (utilisé comme id lors d'une
 *  auto-création — voir plus bas). */
function slugifyWorkstreamName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return "WS-" + (slug || "CHANTIER");
}

/**
 * Import Excel des leviers + plan d'action + lignes d'impact, utilisé par `LeverImportButton` sur
 * la page Leviers. Complète `lib/leverExcel.ts` (export) — voir ce fichier pour le mapping inverse
 * (Lever -> ligne Excel).
 *
 * Format retenu : 3 feuilles, une ligne par entité :
 *  - "Leviers" : une ligne par levier. `Code` est la clé métier (obligatoire, unique, comparée sans
 *    tenir compte de la casse ni des espaces de bord — même règle à l'écriture, voir
 *    `leversLogic.upsertLeverByCode`) qui décide CRÉATION vs MISE À JOUR.
 *  - "Actions" : une ligne par action, rattachée à un levier via `Code Levier`.
 *  - "Impacts" : une ligne par impact financier, rattachée à un levier via `Code Levier` (et, en
 *    option, à une action via `Nom de l'action`, qui ne sert plus qu'au libellé dérivé : les
 *    impacts sont portés par le LEVIER, voir `Lever.impacts`).
 *
 * Mise à jour partielle (audit B1) : pour un levier EXISTANT, seules les colonnes PRÉSENTES dans la
 * feuille sont appliquées — un fichier réduit à "Code" + "Statut" ne remet plus à zéro les autres
 * champs. Une cellule numérique vide conserve la valeur existante ; une cellule texte vide efface
 * le champ (sauf "Programme", qui conserve le programme actuel — M10). Les colonnes obligatoires
 * pour une CRÉATION (Nom, Chantier, Statut, Compte P&L, dates) sont vérifiées ligne par ligne.
 * Colonnes inconnues = avertissement ; colonne clé absente (Code…) = erreur.
 *
 * Plans d'action : feuille "Actions" présente = le fichier fait foi pour les leviers qu'il cite
 * (feuille Leviers, ou lignes Actions/Impacts d'un levier existant absent de la feuille Leviers —
 * M8). Les actions existantes de même nom (insensible à la casse) sont FUSIONNÉES (id, poids,
 * avancement déclaré conservés) ; celles absentes du fichier sont supprimées (signalé dans
 * l'aperçu). Feuille absente = plans d'action conservés.
 *
 * Impacts (M5/M6) : un levier ayant au moins une ligne Impacts voit ses impacts remplacés par ceux
 * du fichier, mais chaque ligne est d'abord rapprochée d'un impact existant (type + libellé + date,
 * puis type + libellé) pour en conserver l'id, les commentaires et la validation finance ; les
 * impacts existants non rapprochés sont listés dans l'aperçu (suppression). Un impact importé
 * « Réalisé » passe en attente de validation finance, sauf s'il l'était déjà (approuvé) ou si
 * l'importateur a un profil finance (même règle que `lib/impactStatus.ts::realizedTogglePatch`).
 *
 * Ré-import sans changement (M2) : un levier existant strictement identique au fichier est
 * compté « inchangé » et n'est ni écrit ni audité.
 *
 * Messages : chaque erreur/avertissement porte un `code` + `vars` (traduits par
 * `LeverImportButton` via les clés `shared.leverImport.msg.<code>`) et un `reason` en français.
 *
 * Limitations connues :
 *  - `Dépendances` référence des ids ou Codes de leviers ; un levier créé PLUS LOIN dans le même
 *    fichier ne peut pas être ciblé (son id n'est alloué qu'à l'écriture).
 */

// ---------- En-têtes (utilisés par le bouton "Template Excel" et par l'export) ----------

export const LEVER_IMPORT_HEADERS = [
  "Code",
  "Type de levier",
  "Nom du levier",
  // Ex-"Workstream" : libellé visible aligné sur la terminologie de l'app ("Chantier"). L'import
  // accepte toujours l'ancienne colonne "Workstream" (anciens templates/exports), cf. plus bas.
  "Chantier",
  "Programme",
  "Owner",
  "Owner (initiales)",
  "Sponsor",
  "Sponsor (initiales)",
  "Géographie",
  "Pays",
  "Entité",
  "Fonction",
  "Centre de coût",
  "Compte P&L impacté",
  "Date de départ",
  "Date de fin estimée",
  "Statut",
  "Progression (%)",
  "Impact estimé brut (€M)",
  "Impact estimé net (€M)",
  "Impact estimé (ETP)",
  "Population impactée",
  "CAPEX (€M)",
  "OPEX one-off (€M)",
  "OPEX récurrent (€M/an)",
  "Dépendances (ID:type, séparées par ;)",
  "Description",
] as const;

/** Colonnes reconnues mais ignorées à l'import : alias historique ("Workstream") et colonnes
 *  calculées écrites par l'export (`lib/leverExcel.ts`) — un export ré-importé tel quel ne doit
 *  pas déclencher d'avertissement « colonne inconnue ». */
const LEVER_EXTRA_KNOWN_HEADERS = [
  "Workstream",
  "Risque",
  "Réalisé à date (€M)",
  "Réalisé à date (ETP)",
  "Gains one-off (€M)",
  "Réactualisé (net)",
  "Planifié initial",
  "Créé le",
  "Dernière mise à jour",
] as const;

export const ACTION_IMPORT_HEADERS = [
  "Code Levier",
  "Nom de l'action",
  "Owner",
  "Date début",
  "Date fin",
  "Statut",
] as const;

export const IMPACT_IMPORT_HEADERS = [
  "Code Levier",
  "Nom de l'action",
  // Libellé de la ligne d'impact : clé de rapprochement avec les impacts existants (M5). Vide =
  // libellé dérivé (action + type + nature) pour une nouvelle ligne, libellé actuel conservé sinon.
  "Libellé",
  "Type",
  "Nature",
  "Montant (€M)",
  "ETP",
  "Type de gain",
  "Date CAPEX",
  "Date gain",
  "Poste de coût",
  "Centre de coût",
  "Entité P&L",
  "Commentaire",
  // Colonnes ajoutées (impacts portés par le LEVIER — "Nom de l'action" peut alors rester vide) :
  "Mode", // Gain annuel | Gain one-off
  "Nature de l'impact", // libellé d'une nature paramétrée (matières premières, main-d'œuvre...)
  "Technologie",
  "Sens", // Type = ETP : Recrutement | Départ (Montant = salaire chargé total, ETP = nombre)
  "Statut impact", // Planifié | Réalisé (ponctuel) | En cours (récurrent) — vide = dérivé de la date
] as const;

type LeverHeader = (typeof LEVER_IMPORT_HEADERS)[number];
type ActionHeader = (typeof ACTION_IMPORT_HEADERS)[number];
type ImpactHeader = (typeof IMPACT_IMPORT_HEADERS)[number];

/** Lignes d'exemple du « Modèle Excel » (3 feuilles), construites PAR NOM DE COLONNE puis remises
 *  dans l'ordre des en-têtes : une colonne ajoutée ou retirée des `*_IMPORT_HEADERS` ne décale
 *  plus les valeurs d'exemple. `programName` pré-remplit la colonne "Programme" avec le programme
 *  courant ; `pnlAccountName` le compte P&L (premier compte de l'entreprise, M15 — "GA" codé en dur
 *  était rejeté dès qu'une arborescence financière remplace les comptes génériques). Le modèle doit
 *  rester importable tel quel sans erreur (voir le test associé), et son code d'exemple ne doit
 *  correspondre à aucun vrai levier. */
export function leverImportTemplateRows(
  programName = "",
  /** Chantier existant à utiliser dans l'exemple (sinon un nom fictif, auto-créé à l'import). */
  workstreamName = "Achats & Supply Chain",
  pnlAccountName = "GA"
): {
  leviers: (string | number)[][];
  actions: (string | number)[][];
  impacts: (string | number)[][];
} {
  const toRow = <H extends readonly string[]>(
    headers: H,
    values: Partial<Record<H[number], string | number>>
  ) => headers.map((h) => values[h as H[number]] ?? "");
  const example = "Exemple — à remplacer ou supprimer avant import";
  const code = "EXEMPLE-001";
  return {
    leviers: [
      toRow(LEVER_IMPORT_HEADERS, {
        Code: code,
        "Type de levier": "Sourcing & Achats",
        "Nom du levier": "Optimisation achats indirects",
        Chantier: workstreamName,
        Programme: programName,
        Owner: "Marc Dubois",
        "Owner (initiales)": "MD",
        Sponsor: "Isabelle Roy",
        "Sponsor (initiales)": "IR",
        Géographie: "Europe",
        Pays: "France",
        Entité: "Acme France SAS",
        Fonction: "Procurement",
        "Centre de coût": "CC-PROC-001",
        "Compte P&L impacté": pnlAccountName,
        "Date de départ": "2026-01-15",
        "Date de fin estimée": "2026-12-31",
        Statut: "Identifié",
        "Progression (%)": 40,
        "Impact estimé brut (€M)": 2.5,
        "Impact estimé net (€M)": 2.1,
        "Impact estimé (ETP)": -1,
        "CAPEX (€M)": 0.3,
        "OPEX one-off (€M)": 0.4,
        "OPEX récurrent (€M/an)": 0.1,
        Description: example,
      }),
    ],
    actions: [
      toRow(ACTION_IMPORT_HEADERS, {
        "Code Levier": code,
        "Nom de l'action": "Renégocier contrats fournisseurs classe A",
        Owner: "Marc Dubois",
        "Date début": "2026-01-15",
        "Date fin": "2026-04-30",
        Statut: "En cours",
      }),
    ],
    impacts: [
      toRow(IMPACT_IMPORT_HEADERS, {
        "Code Levier": code,
        "Nom de l'action": "Renégocier contrats fournisseurs classe A",
        Type: "Gain",
        "Montant (€M)": 1.2,
        "Type de gain": "Réduction de coût",
        "Date gain": "01/07/2026",
        Commentaire: example,
      }),
    ],
  };
}

// ---------- Messages (code + variables, traduits côté UI) ----------

/** Gabarits français des messages d'import — la clé i18n est `shared.leverImport.msg.<code>`
 *  (dictionnaires fr/en/de/es), ce gabarit sert de repli. */
export const LEVER_IMPORT_MESSAGES = {
  noLeversSheet:
    "Onglet « Leviers » introuvable : le classeur doit contenir un onglet « Leviers » (téléchargez le modèle Excel).",
  csvNotSupported:
    "Format CSV non pris en charge : l'import des leviers nécessite un classeur Excel (.xlsx) contenant les onglets Leviers, Actions et Impacts.",
  missingColumns: "Colonne(s) obligatoire(s) absente(s) de l'onglet : {columns}.",
  missingColumnsForNew:
    "Nouveau levier « {code} » : colonne(s) {columns} absente(s) du fichier (obligatoire(s) pour une création).",
  missingColumnsForNewAction:
    "Nouvelle action « {name} » : colonne(s) {columns} absente(s) du fichier (obligatoire(s) pour une création).",
  required: '"{field}" est obligatoire',
  duplicateCode: 'Code "{code}" en doublon dans le fichier (déjà utilisé ligne {row})',
  unknownStatus: 'Statut "{value}" inconnu (attendu : {expected})',
  statusNewLever:
    "Un nouveau levier ne peut être importé qu'au stade « {idea} » (ou abandonné) : le stade « {target} » nécessite une validation. Importez-le au stade « {idea} », puis demandez la validation depuis sa fiche.",
  statusGated:
    "Changement de statut « {current} » → « {target} » refusé : le stade « {target} » nécessite une validation (demande depuis la fiche du levier). Remettez le statut actuel dans le fichier pour importer les autres modifications.",
  statusBackward:
    "Changement de statut « {current} » → « {target} » refusé : un import ne peut ni sauter d'étape ni revenir en arrière dans le cycle de vie. Remettez le statut actuel dans le fichier pour importer les autres modifications.",
  unknownPnl: 'Compte P&L "{value}" introuvable (attendu : {expected})',
  requiredDate: '"{field}" obligatoire et doit être une date valide (JJ/MM/AAAA ou AAAA-MM-JJ)',
  invalidDate:
    '"{field}" invalide : "{value}" n\'est pas une date valide (JJ/MM/AAAA ou AAAA-MM-JJ)',
  invalidNumber: '"{field}" doit être un nombre (valeur lue : "{value}")',
  unknownProgram: 'Programme "{value}" introuvable (attendu : {expected})',
  noProgram:
    "\"Programme\" est obligatoire, mais aucun programme n'existe pour cette entreprise — créez-en un dans Admin > Entreprises > Programmes avant d'importer des leviers",
  programRequired:
    '"Programme" est obligatoire dès que l\'entreprise a plusieurs programmes (attendu : {expected})',
  noActiveCompany:
    "Aucune entreprise active : sélectionnez une entreprise avant de créer des leviers par import.",
  invalidDependency:
    'Dépendance "{value}" invalide (format attendu ID:type, type parmi {expected})',
  leverNotFound: 'Levier "{code}" introuvable (ni dans la feuille Leviers, ni en base)',
  leverRowRejected:
    'Ligne ignorée : le levier "{code}" est en erreur dans la feuille Leviers (corrigez-le d\'abord)',
  duplicateAction:
    'Action "{name}" en doublon pour le levier "{code}" (déjà déclarée ligne {row}, les noms sont comparés sans tenir compte de la casse)',
  actionNotFound: 'Action "{name}" introuvable pour le levier "{code}"',
  unknownImpactType: 'Type "{value}" inconnu (attendu : {expected})',
  unknownNature: 'Nature "{value}" inconnue (attendu : {expected})',
  unknownSavingType: 'Type de gain "{value}" inconnu (attendu : {expected})',
  unknownCostAccount: 'Poste de coût "{value}" introuvable (attendu : {expected})',
  unknownMode: 'Mode "{value}" inconnu (attendu : Gain annuel, Gain one-off)',
  unknownDirection: 'Sens "{value}" inconnu (attendu : Recrutement, Départ)',
  unknownImpactStatus: 'Statut impact "{value}" inconnu (attendu : Planifié, Réalisé, En cours)',
  // Avertissements (n'empêchent pas l'import)
  unknownColumns: "Colonne(s) non reconnue(s), ignorée(s) : {columns}",
  unknownImpactNature:
    'Nature de l\'impact "{value}" inconnue : valeur ignorée (attendu : {expected})',
  unknownPopulation:
    'Population impactée "{value}" introuvable parmi les chantiers : valeur ignorée',
  formulaNoValue:
    "Cellule {cell} : formule sans valeur calculée (classeur non recalculé) — ouvrez et enregistrez le fichier dans Excel avant l'import.",
} as const;

export type LeverImportMessageCode = keyof typeof LEVER_IMPORT_MESSAGES;
export type LeverImportMessageVars = Record<string, string | number>;

/** Remplace les `{var}` d'un gabarit. */
export function formatLeverImportMessage(template: string, vars: LeverImportMessageVars = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// ---------- Portes de validation ----------

/** Statuts protégés par une porte de validation (porteur → sponsor OU CTO) — même liste que la
 *  garde de `lib/leversLogic.ts::updateLever`, seul `approveLeverGate` peut y faire entrer un
 *  levier. */
const GATED_IMPORT_STATUSES: readonly LeverStatus[] = ["qualified", "validated", "in_progress"];

/** Variante codée de `importStatusTransitionError` (message traduisible). */
export function importStatusTransitionIssue(
  current: LeverStatus | undefined,
  target: LeverStatus,
  labelOf: (status: LeverStatus) => string
): { code: LeverImportMessageCode; vars: LeverImportMessageVars } | null {
  if (current === target) return null;
  if (target === "cancelled") return null;
  if (current === undefined) {
    if (target === "idea") return null;
    return { code: "statusNewLever", vars: { idea: labelOf("idea"), target: labelOf(target) } };
  }
  if (current === "cancelled" && target === "idea") return null;
  if (current === "in_progress" && target === "delivered") return null;
  return {
    code: GATED_IMPORT_STATUSES.includes(target) ? "statusGated" : "statusBackward",
    vars: { current: labelOf(current), target: labelOf(target) },
  };
}

/** Un import ne doit pas contourner les portes de validation : renvoie le motif de rejet de la
 *  ligne, ou `null` si la transition est permise. Permis : statut inchangé ; nouveau levier
 *  « Identifié » ou abandonné ; abandon d'un levier existant ; réactivation d'un abandonné en
 *  « Identifié » ; Exécuté → Réalisé (seule transition libre du cycle, voir `updateLever`). */
export function importStatusTransitionError(
  current: LeverStatus | undefined,
  target: LeverStatus,
  labelOf: (status: LeverStatus) => string
): string | null {
  const issue = importStatusTransitionIssue(current, target, labelOf);
  return issue ? formatLeverImportMessage(LEVER_IMPORT_MESSAGES[issue.code], issue.vars) : null;
}

// ---------- Libellés humains <-> valeurs internes ----------

export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminé",
  delayed: "En retard",
};

const IMPACT_TYPE_LABEL: Record<ActionImpact["type"], string> = {
  cost: "Coût",
  saving: "Gain",
  fte: "ETP",
};

const IMPACT_NATURE_LABEL: Record<ActionImpact["nature"], string> = {
  capex: "CAPEX",
  opex_rec: "OPEX récurrent",
  oneoff: "One-off",
};

export const SAVING_TYPE_LABEL: Record<SavingType, string> = {
  cost_reduction: "Réduction de coût",
  revenue_increase: "Augmentation du CA",
  working_capital: "Impact BFR",
};

const DEPENDENCY_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

/** Clé de comparaison des valeurs énumérées : insensible à la casse, aux accents et aux espaces. */
const nk = (s: string) => normalizeHeaderKey(s);

function labelMap<T extends string>(
  map: Record<T, string>,
  aliases: Record<string, T> = {}
): Map<string, T> {
  const m = new Map<string, T>();
  (Object.keys(map) as T[]).forEach((key) => {
    m.set(nk(map[key]), key);
    m.set(nk(key), key);
  });
  Object.entries(aliases).forEach(([alias, key]) => m.set(nk(alias), key));
  return m;
}

const ACTION_STATUS_BY_LABEL = labelMap(ACTION_STATUS_LABEL, {
  "a faire": "todo",
  terminée: "done",
  fait: "done",
  faite: "done",
  "en cours d'exécution": "in_progress",
  retard: "delayed",
});
const IMPACT_TYPE_BY_LABEL = labelMap(IMPACT_TYPE_LABEL, {
  cout: "cost",
  coûts: "cost",
  gains: "saving",
  fte: "fte",
});
const IMPACT_NATURE_BY_LABEL = labelMap(IMPACT_NATURE_LABEL, {
  "opex recurrent": "opex_rec",
  "opex récurrent (€m/an)": "opex_rec",
  "one off": "oneoff",
  oneoff: "oneoff",
  "opex one-off": "oneoff",
  "opex one off": "oneoff",
  ponctuel: "oneoff",
});
const SAVING_TYPE_BY_LABEL = labelMap(SAVING_TYPE_LABEL, {
  "reduction de cout": "cost_reduction",
  "augmentation ca": "revenue_increase",
  bfr: "working_capital",
});
const GAIN_MODE_BY_LABEL = new Map<string, "annual" | "oneoff">(
  (
    [
      ["gain annuel", "annual"],
      ["annuel", "annual"],
      ["récurrent", "annual"],
      ["annual", "annual"],
      ["gain one-off", "oneoff"],
      ["one-off", "oneoff"],
      ["one off", "oneoff"],
      ["oneoff", "oneoff"],
      ["ponctuel", "oneoff"],
    ] as const
  ).map(([k, v]) => [nk(k), v])
);
const FTE_DIRECTION_BY_LABEL = new Map<string, "hire" | "departure">(
  (
    [
      ["recrutement", "hire"],
      ["embauche", "hire"],
      ["hire", "hire"],
      ["départ", "departure"],
      ["réduction", "departure"],
      ["departure", "departure"],
    ] as const
  ).map(([k, v]) => [nk(k), v])
);
const IMPACT_STATUS_BY_LABEL = new Map<string, "planned" | "done" | "ongoing">(
  (
    [
      ["planifié", "planned"],
      ["planned", "planned"],
      ["réalisé", "done"],
      ["done", "done"],
      ["en cours", "ongoing"],
      ["ongoing", "ongoing"],
    ] as const
  ).map(([k, v]) => [nk(k), v])
);

const ALL_STATUSES = Object.keys(STATUS_LABEL) as LeverStatus[];

/**
 * Libellés "Statut" acceptés à l'import (comparés sans casse ni accents) : libellés longs
 * historiques (`STATUS_LABEL`), courts (`STATUS_SHORT_LABEL`), référentiel par défaut
 * (`DEFAULT_LIFECYCLE_STAGES`) et, si fourni, le cycle de vie personnalisé du programme. Les
 * anciens libellés préfixés par le niveau ("M3 · Validé") sont résolus par leur niveau (M1…M5).
 */
function buildStatusByLabel(lifecycleStages?: LifecycleStage[]): Map<string, LeverStatus> {
  const m = new Map<string, LeverStatus>();
  ALL_STATUSES.forEach((status) => {
    m.set(nk(STATUS_LABEL[status]), status);
    m.set(nk(STATUS_SHORT_LABEL[status]), status);
    m.set(nk(resolveStatusLabel(status, DEFAULT_LIFECYCLE_STAGES)), status);
    if (lifecycleStages) m.set(nk(resolveStatusLabel(status, lifecycleStages)), status);
  });
  return m;
}

function parseLeverStatus(raw: string, byLabel: Map<string, LeverStatus>): LeverStatus | undefined {
  const direct = byLabel.get(nk(raw));
  if (direct) return direct;
  const level = /^m\s*([1-5])(?![0-9])/i.exec(raw.trim());
  if (level) {
    return ALL_STATUSES.find((s) => STATUS_LEVEL[s] === `M${level[1]}`);
  }
  return undefined;
}

/** Libellés à afficher dans le message d'erreur : ceux réellement visibles à l'écran. */
function activeStatusLabels(lifecycleStages?: LifecycleStage[]): string[] {
  return ALL_STATUSES.map((status) =>
    resolveStatusLabel(status, lifecycleStages ?? DEFAULT_LIFECYCLE_STAGES)
  );
}

// ---------- Parsing utilitaire ----------

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (v instanceof Date) {
    const d = parseCellDate(v);
    return d && d.ok ? d.value : "";
  }
  return String(v).trim();
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => isBlankCell(v));
}

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Ids générés uniquement pour la durée de l'import. */
function makeActionId(seq: number): string {
  return `ACX-${Date.now()}-${seq}`;
}
function makeImpactId(seq: number): string {
  return `IMPX-${Date.now()}-${seq}`;
}

function resolvePnlAccount(
  pnlAccounts: BeTrackData["pnlAccounts"],
  raw: string
): BeTrackData["pnlAccounts"][number] | undefined {
  const key = nk(raw);
  return pnlAccounts.find((p) => nk(p.id) === key || nk(p.name) === key);
}

function stripLeverMeta(l: Lever): LeverImportRow {
  const { id: _id, createdAt: _c, lastUpdate: _u, ...rest } = l;
  void _id;
  void _c;
  void _u;
  return rest;
}

/** Ensemble des en-têtes (canoniques) réellement présents dans une feuille. */
function presentHeaders(rows: Record<string, unknown>[]): Set<string> {
  const s = new Set<string>();
  rows.forEach((r) => Object.keys(r).forEach((k) => s.add(k)));
  return s;
}

type CanonSheet = {
  rows: { row: Record<string, unknown>; rowNumber: number }[];
  headers: Set<string>;
  unknown: string[];
};

function canonicalizeSheet(
  rows: Record<string, unknown>[],
  expected: readonly string[]
): CanonSheet {
  const unknown = new Set<string>();
  const out = rows.map((raw, i) => {
    const { row, unknown: u } = canonicalizeRowKeys(raw, expected);
    u.forEach((k) => unknown.add(k));
    return { row, rowNumber: excelRowNumber(raw, i) };
  });
  return {
    rows: out,
    headers: presentHeaders(out.map((r) => r.row)),
    unknown: Array.from(unknown),
  };
}

// ---------- Types publics ----------

export type LeverImportSheet = "Leviers" | "Actions" | "Impacts";

export type LeverImportError = {
  sheet: LeverImportSheet;
  /** Numéro de ligne Excel (1 = en-têtes, 0 = onglet entier). */
  rowNumber: number;
  /** Message en français (repli / tests). */
  reason: string;
  code: LeverImportMessageCode;
  vars?: LeverImportMessageVars;
};

export type LeverImportWarning = LeverImportError;

/** Levier prêt à créer/mettre à jour — même forme que `leversLogic.createLever`/`upsertLeverByCode`
 *  attendent déjà (plan d'action et impacts compris). */
export type LeverImportRow = Omit<Lever, "id" | "createdAt" | "lastUpdate">;

export type LeverImportPreview = {
  toUpsert: LeverImportRow[];
  errors: LeverImportError[];
  /** Anomalies non bloquantes (colonnes inconnues, valeurs ignorées…). */
  warnings: LeverImportWarning[];
  createCount: number;
  updateCount: number;
  /** Leviers existants strictement identiques au fichier (ni écrits, ni audités — M2). */
  unchangedCount: number;
  unchangedCodes: string[];
  /** Leviers existants dont des actions vont être SUPPRIMÉES (présentes en base, absentes de la
   *  feuille Actions du fichier). */
  actionsRemoved: { code: string; count: number }[];
  /** Leviers existants dont des lignes d'impact vont être SUPPRIMÉES (M5). */
  impactsRemoved: { code: string; labels: string[] }[];
  /** false = le fichier n'a pas de feuille "Actions" : aucun plan d'action n'est modifié. */
  actionsSheetPresent: boolean;
  /** Chantiers référencés par la feuille "Leviers" mais absents de l'entreprise — auto-créés (id
   *  unique, jamais un id existant : M13), à persister par l'appelant AVANT les leviers. */
  toCreateWorkstreams: Workstream[];
};

export type LeverImportRawSheets = {
  leviers: Record<string, unknown>[];
  /** `null` = feuille ABSENTE du fichier : les plans d'action des leviers existants sont conservés.
   *  Tableau (même vide) = feuille présente, le fichier fait foi pour les actions. */
  actions: Record<string, unknown>[] | null;
  impacts: Record<string, unknown>[] | null;
};

export type LeverImportOptions = {
  /** Utilisateur qui importe : décide du statut de validation finance des impacts « Réalisé ». */
  importer?: Pick<AuthUser, "name" | "profiles"> | null;
};

const LEVER_REQUIRED_FOR_NEW: LeverHeader[] = [
  "Nom du levier",
  "Chantier",
  "Statut",
  "Compte P&L impacté",
  "Date de départ",
  "Date de fin estimée",
];

const NUMERIC_LEVER_FIELDS: [LeverHeader, keyof LeverImportRow][] = [
  ["Impact estimé brut (€M)", "grossSavings"],
  ["Impact estimé net (€M)", "netSavings"],
  ["OPEX one-off (€M)", "opexOneOff"],
  ["OPEX récurrent (€M/an)", "opexRec"],
  ["CAPEX (€M)", "capex"],
  ["Impact estimé (ETP)", "fteImpact"],
];

const TEXT_LEVER_FIELDS: [LeverHeader, keyof LeverImportRow][] = [
  ["Type de levier", "type"],
  ["Owner", "owner"],
  ["Owner (initiales)", "ownerInit"],
  ["Sponsor", "sponsor"],
  ["Sponsor (initiales)", "sponsorInit"],
  ["Géographie", "geography"],
  ["Pays", "country"],
  ["Entité", "entity"],
  ["Fonction", "function"],
  ["Centre de coût", "costCenter"],
];

/** Longueur max d'une cellule Excel : une description plus longue est tronquée à l'export. */
const EXCEL_CELL_MAX = 32767;

/**
 * Valide les 3 feuilles ensemble et produit un aperçu (leviers prêts à créer/mettre à jour, avec
 * leur plan d'action et leurs impacts + erreurs/avertissements ligne par ligne) sans rien écrire.
 */
export function validateLeverImportRows(
  sheets: LeverImportRawSheets,
  data: Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">,
  companyId: string | null | undefined,
  /** Programmes Performance de l'entreprise, pour résoudre la colonne "Programme" (nom ou id).
   *  Un Programme inconnu est une erreur de ligne (pas d'auto-création). */
  programs: { id: string; name: string }[] = [],
  /** Cycle de vie ACTIF du programme : ses libellés sont acceptés en plus des libellés par défaut. */
  lifecycleStages?: LifecycleStage[],
  /** Programme sélectionné : cible par défaut des NOUVEAUX leviers sans colonne "Programme". */
  defaultProgramId?: string | null,
  options: LeverImportOptions = {}
): LeverImportPreview {
  const errors: LeverImportError[] = [];
  const warnings: LeverImportWarning[] = [];
  const STATUS_BY_LABEL = buildStatusByLabel(lifecycleStages);
  const labelOf = (st: LeverStatus) => resolveStatusLabel(st, lifecycleStages);

  const issue = (
    list: LeverImportError[],
    sheet: LeverImportSheet,
    rowNumber: number,
    code: LeverImportMessageCode,
    vars: LeverImportMessageVars = {}
  ) =>
    list.push({
      sheet,
      rowNumber,
      code,
      vars,
      reason: formatLeverImportMessage(LEVER_IMPORT_MESSAGES[code], vars),
    });
  const err = (
    s: LeverImportSheet,
    r: number,
    c: LeverImportMessageCode,
    v?: LeverImportMessageVars
  ) => issue(errors, s, r, c, v);
  const warn = (
    s: LeverImportSheet,
    r: number,
    c: LeverImportMessageCode,
    v?: LeverImportMessageVars
  ) => issue(warnings, s, r, c, v);

  /** Nombre optionnel : `undefined` si vide, `null` (+ erreur) si illisible. */
  const readNumber = (
    sheet: LeverImportSheet,
    rowNumber: number,
    field: string,
    v: unknown
  ): number | undefined | null => {
    const p = parseCellNumber(v);
    if (!p) return undefined;
    if (!p.ok) {
      err(sheet, rowNumber, "invalidNumber", { field, value: p.raw });
      return null;
    }
    return p.value;
  };
  /** Date optionnelle : `undefined` si vide, `null` (+ erreur) si illisible. */
  const readDate = (
    sheet: LeverImportSheet,
    rowNumber: number,
    field: string,
    v: unknown
  ): string | undefined | null => {
    const p = parseCellDate(v);
    if (!p) return undefined;
    if (!p.ok) {
      err(sheet, rowNumber, "invalidDate", { field, value: p.raw });
      return null;
    }
    return p.value;
  };

  const existingByCode = new Map(data.levers.map((l) => [normalizeLeverCode(l.code), l]));
  const codeByLeverId = new Map(data.levers.map((l) => [l.id, l]));

  // ---------- Feuille "Leviers" ----------
  const leverSheet = canonicalizeSheet(sheets.leviers, [
    ...LEVER_IMPORT_HEADERS,
    ...LEVER_EXTRA_KNOWN_HEADERS,
  ]);
  const hasL = (h: string) => leverSheet.headers.has(h);
  const leverDataRows = leverSheet.rows.filter((r) => !isRowEmpty(r.row));
  if (leverSheet.unknown.length > 0) {
    warn("Leviers", 1, "unknownColumns", { columns: leverSheet.unknown.join(", ") });
  }
  const leverSheetUsable = !(leverDataRows.length > 0 && !hasL("Code"));
  if (!leverSheetUsable) err("Leviers", 1, "missingColumns", { columns: "Code" });

  type ParsedLever = { rowNumber: number; code: string; values: LeverImportRow };
  const parsedLevers: ParsedLever[] = [];
  const codeFirstSeenAtRow = new Map<string, number>();
  /** Codes dont la ligne Leviers est en erreur : leurs lignes Actions/Impacts sont ignorées. */
  const rejectedCodes = new Set<string>();
  const newWorkstreamsByName = new Map<string, Workstream>();
  const usedWorkstreamIds = new Set(data.workstreams.map((w) => w.id.toLowerCase()));
  const allWorkstreams = () => [...data.workstreams, ...Array.from(newWorkstreamsByName.values())];
  const findWorkstream = (raw: string) => {
    const key = nk(raw);
    return allWorkstreams().find((w) => nk(w.id) === key || nk(w.name) === key);
  };

  (leverSheetUsable ? leverDataRows : []).forEach(({ row, rowNumber }) => {
    const errorsBefore = errors.length;
    const code = str(row["Code"]);
    if (!code) {
      err("Leviers", rowNumber, "required", { field: "Code" });
      return;
    }
    const lowerCode = normalizeLeverCode(code);
    if (codeFirstSeenAtRow.has(lowerCode)) {
      err("Leviers", rowNumber, "duplicateCode", { code, row: codeFirstSeenAtRow.get(lowerCode)! });
      return;
    }
    codeFirstSeenAtRow.set(lowerCode, rowNumber);
    const reject = () => {
      rejectedCodes.add(lowerCode);
    };

    const existing = existingByCode.get(lowerCode);
    const wsHeader = hasL("Chantier") || hasL("Workstream");
    if (!existing) {
      const missing = LEVER_REQUIRED_FOR_NEW.filter((h) =>
        h === "Chantier" ? !wsHeader : !hasL(h)
      );
      if (missing.length > 0) {
        err("Leviers", rowNumber, "missingColumnsForNew", { code, columns: missing.join(", ") });
        return reject();
      }
      if (!companyId) {
        err("Leviers", rowNumber, "noActiveCompany");
        return reject();
      }
    }

    const values: LeverImportRow = existing
      ? stripLeverMeta(existing)
      : {
          code,
          type: "",
          name: "",
          ws: "",
          programId: "",
          owner: "",
          ownerInit: "",
          sponsor: "",
          sponsorInit: "",
          geography: "",
          country: "",
          entity: "",
          function: "",
          costCenter: "",
          pnlMap: "",
          start: "",
          end: "",
          status: "idea",
          progress: 0,
          risk: "low", // recalculé à l'affichage (engine.computeLeverRisk) — valeur de repli
          grossSavings: 0,
          netSavings: 0,
          opexOneOff: 0,
          opexRec: 0,
          capex: 0,
          fteImpact: 0,
          popImpacted: "",
          companyId: companyId ?? null,
          dependencies: [],
          description: "",
          actions: [],
        };

    if (hasL("Nom du levier")) {
      const name = str(row["Nom du levier"]);
      if (!name) {
        err("Leviers", rowNumber, "required", { field: "Nom du levier" });
        return reject();
      }
      values.name = name;
    }

    if (wsHeader) {
      const wsRaw = str(row["Chantier"]) || str(row["Workstream"]);
      if (!wsRaw) {
        err("Leviers", rowNumber, "required", { field: "Chantier" });
        return reject();
      }
      let ws = findWorkstream(wsRaw);
      if (!ws) {
        // Chantier inconnu : auto-créé avec un id UNIQUE (jamais celui d'un chantier existant, qui
        // serait sinon écrasé par l'upsert par id de la config programme — M13).
        const baseId = slugifyWorkstreamName(wsRaw);
        let id = baseId;
        for (let n = 2; usedWorkstreamIds.has(id.toLowerCase()); n++) id = `${baseId}-${n}`;
        usedWorkstreamIds.add(id.toLowerCase());
        ws = {
          id,
          name: wsRaw,
          sponsor: str(row["Sponsor"]) || "À définir",
          color: WORKSTREAM_PALETTE[newWorkstreamsByName.size % WORKSTREAM_PALETTE.length],
          target: 0,
        };
        newWorkstreamsByName.set(nk(wsRaw), ws);
      }
      values.ws = ws.id;
    }

    if (hasL("Statut")) {
      const statusRaw = str(row["Statut"]);
      const status = statusRaw ? parseLeverStatus(statusRaw, STATUS_BY_LABEL) : undefined;
      if (!status) {
        err("Leviers", rowNumber, "unknownStatus", {
          value: statusRaw,
          expected: activeStatusLabels(lifecycleStages).join(", "),
        });
        return reject();
      }
      const transition = importStatusTransitionIssue(existing?.status, status, labelOf);
      if (transition) {
        err("Leviers", rowNumber, transition.code, transition.vars);
        return reject();
      }
      values.status = status;
    }

    if (hasL("Compte P&L impacté")) {
      const pnlRaw = str(row["Compte P&L impacté"]);
      const pnl = resolvePnlAccount(data.pnlAccounts, pnlRaw);
      if (!pnl) {
        err("Leviers", rowNumber, "unknownPnl", {
          value: pnlRaw,
          expected: data.pnlAccounts.map((p) => p.name || p.id).join(", "),
        });
        return reject();
      }
      values.pnlMap = pnl.id;
    }

    for (const [header, key] of [
      ["Date de départ", "start"],
      ["Date de fin estimée", "end"],
    ] as const) {
      if (!hasL(header)) continue;
      const d = readDate("Leviers", rowNumber, header, row[header]);
      if (d === null) return reject();
      if (d === undefined) {
        err("Leviers", rowNumber, "requiredDate", { field: header });
        return reject();
      }
      values[key] = d;
    }

    // Programme : cellule renseignée = résolue ; vide/absente = programme actuel du levier existant
    // (M10), sinon programme sélectionné / unique programme pour un nouveau levier.
    const programRaw = hasL("Programme") ? str(row["Programme"]) : "";
    if (programRaw) {
      const program = programs.find(
        (p) => nk(p.id) === nk(programRaw) || nk(p.name) === nk(programRaw)
      );
      if (!program) {
        err("Leviers", rowNumber, programs.length ? "unknownProgram" : "noProgram", {
          value: programRaw,
          expected: programs.map((p) => p.name).join(", "),
        });
        return reject();
      }
      values.programId = program.id;
    } else if (existing?.programId) {
      values.programId = existing.programId;
    } else if (defaultProgramId && programs.some((p) => p.id === defaultProgramId)) {
      values.programId = defaultProgramId;
    } else if (programs.length === 1) {
      values.programId = programs[0].id;
    } else {
      err("Leviers", rowNumber, programs.length === 0 ? "noProgram" : "programRequired", {
        expected: programs.map((p) => p.name).join(", "),
      });
      return reject();
    }

    for (const [header, key] of TEXT_LEVER_FIELDS) {
      if (hasL(header)) (values as Record<string, unknown>)[key] = str(row[header]);
    }
    if (hasL("Description")) {
      const description = str(row["Description"]);
      // Description tronquée par l'export (limite de cellule Excel) : on garde la version complète.
      const truncatedExport =
        description.length === EXCEL_CELL_MAX &&
        (existing?.description ?? "").startsWith(description);
      if (!truncatedExport) values.description = description;
    }

    if (hasL("Progression (%)")) {
      const n = readNumber("Leviers", rowNumber, "Progression (%)", row["Progression (%)"]);
      if (n === null) return reject();
      if (n !== undefined) values.progress = clamp(n, 0, 100);
    }
    for (const [header, key] of NUMERIC_LEVER_FIELDS) {
      if (!hasL(header)) continue;
      const n = readNumber("Leviers", rowNumber, header, row[header]);
      if (n === null) return reject();
      if (n !== undefined) (values as Record<string, unknown>)[key] = n;
    }

    if (hasL("Population impactée")) {
      const popRaw = str(row["Population impactée"]);
      if (!popRaw) values.popImpacted = "";
      else {
        const pop = findWorkstream(popRaw);
        if (pop) values.popImpacted = pop.id;
        else warn("Leviers", rowNumber, "unknownPopulation", { value: popRaw });
      }
    }

    const depHeader = "Dépendances (ID:type, séparées par ;)";
    if (hasL(depHeader)) {
      const deps: LeverDependency[] = [];
      let depError = false;
      str(row[depHeader])
        .split(";")
        .map((e) => e.trim())
        .filter(Boolean)
        .forEach((entry) => {
          const [targetRaw, typeRaw] = entry.split(":").map((s) => s.trim());
          const type = (typeRaw ? typeRaw.toUpperCase() : "FS") as DependencyType;
          if (!targetRaw || !DEPENDENCY_TYPES.includes(type)) {
            err("Leviers", rowNumber, "invalidDependency", {
              value: entry,
              expected: DEPENDENCY_TYPES.join(", "),
            });
            depError = true;
            return;
          }
          // Cible désignée par Code (ou id) : résolue vers l'id d'un levier existant.
          const target =
            existingByCode.get(normalizeLeverCode(targetRaw)) ?? codeByLeverId.get(targetRaw);
          deps.push({ targetId: target?.id ?? targetRaw, type });
        });
      if (depError) return reject();
      values.dependencies = deps;
    }

    // M12 : un levier existant garde son entreprise ; un nouveau prend l'entreprise active.
    values.companyId = existing ? existing.companyId : (companyId ?? null);
    values.risk = existing?.risk ?? "low";

    if (errors.length > errorsBefore) return reject();
    parsedLevers.push({ rowNumber, code: existing?.code ?? code, values });
  });

  const parsedByCode = new Map(parsedLevers.map((p) => [normalizeLeverCode(p.code), p]));
  /** Levier cible d'une ligne Actions/Impacts : du fichier ou existant (M8). */
  const resolveTargetLever = (
    sheet: LeverImportSheet,
    rowNumber: number,
    codeRaw: string
  ): string | null => {
    const key = normalizeLeverCode(codeRaw);
    if (rejectedCodes.has(key)) {
      err(sheet, rowNumber, "leverRowRejected", { code: codeRaw });
      return null;
    }
    if (!parsedByCode.has(key) && !existingByCode.has(key)) {
      err(sheet, rowNumber, "leverNotFound", { code: codeRaw });
      return null;
    }
    return key;
  };

  // ---------- Feuille "Actions" ----------
  const actionsByLeverCode = new Map<string, { rowNumber: number; action: LeverAction }[]>();
  let actionSeq = 0;
  if (sheets.actions !== null) {
    const actionSheet = canonicalizeSheet(sheets.actions, ACTION_IMPORT_HEADERS);
    const hasA = (h: ActionHeader) => actionSheet.headers.has(h);
    const rows = actionSheet.rows.filter((r) => !isRowEmpty(r.row));
    if (actionSheet.unknown.length > 0) {
      warn("Actions", 1, "unknownColumns", { columns: actionSheet.unknown.join(", ") });
    }
    const missingKeys = (["Code Levier", "Nom de l'action"] as const).filter((h) => !hasA(h));
    if (rows.length > 0 && missingKeys.length > 0) {
      err("Actions", 1, "missingColumns", { columns: missingKeys.join(", ") });
    } else {
      rows.forEach(({ row, rowNumber }) => {
        const leverCodeRaw = str(row["Code Levier"]);
        if (!leverCodeRaw) {
          err("Actions", rowNumber, "required", { field: "Code Levier" });
          return;
        }
        const key = resolveTargetLever("Actions", rowNumber, leverCodeRaw);
        if (!key) return;

        const name = str(row["Nom de l'action"]);
        if (!name) {
          err("Actions", rowNumber, "required", { field: "Nom de l'action" });
          return;
        }
        const list = actionsByLeverCode.get(key) ?? [];
        const dup = list.find((a) => nk(a.action.name) === nk(name));
        if (dup) {
          err("Actions", rowNumber, "duplicateAction", {
            name,
            code: leverCodeRaw,
            row: dup.rowNumber,
          });
          return;
        }

        const prev = (existingByCode.get(key)?.actions ?? []).find((a) => nk(a.name) === nk(name));
        if (!prev) {
          const missing = (["Statut", "Date début", "Date fin"] as const).filter((h) => !hasA(h));
          if (missing.length > 0) {
            err("Actions", rowNumber, "missingColumnsForNewAction", {
              name,
              columns: missing.join(", "),
            });
            return;
          }
        }

        let status: ActionStatus | undefined = prev?.status;
        if (hasA("Statut")) {
          const statusRaw = str(row["Statut"]);
          status = ACTION_STATUS_BY_LABEL.get(nk(statusRaw));
          if (!status) {
            err("Actions", rowNumber, "unknownStatus", {
              value: statusRaw,
              expected: Object.values(ACTION_STATUS_LABEL).join(", "),
            });
            return;
          }
        }
        const dates: { start?: string; end?: string } = { start: prev?.start, end: prev?.end };
        for (const [header, key2] of [
          ["Date début", "start"],
          ["Date fin", "end"],
        ] as const) {
          if (!hasA(header)) continue;
          const d = readDate("Actions", rowNumber, header, row[header]);
          if (d === null) return;
          if (d === undefined) {
            err("Actions", rowNumber, "requiredDate", { field: header });
            return;
          }
          dates[key2] = d;
        }
        const owner = hasA("Owner") ? str(row["Owner"]) || undefined : prev?.owner;

        let action: LeverAction;
        if (prev) {
          action = { ...prev, name, owner, start: dates.start!, end: dates.end!, status: status! };
          if (action.status !== "done") delete action.deliveredDate;
        } else {
          actionSeq += 1;
          action = {
            id: makeActionId(actionSeq),
            name,
            owner,
            start: dates.start!,
            end: dates.end!,
            status: status!,
          };
        }
        list.push({ rowNumber, action });
        actionsByLeverCode.set(key, list);
      });
    }
  }

  /** Plan d'action FINAL d'un levier (celui qui sera écrit). */
  const finalActionsOf = (key: string): LeverAction[] => {
    const existing = existingByCode.get(key);
    if (sheets.actions === null) return existing?.actions ?? [];
    return (actionsByLeverCode.get(key) ?? []).map((a) => a.action);
  };

  // ---------- Feuille "Impacts" ----------
  type ParsedImpact = {
    rowNumber: number;
    /** Champs lus pour les colonnes présentes (clé présente = colonne présente). */
    fields: Partial<ActionImpact>;
    explicitLabel?: string;
    derivedLabel: string;
    comment: string;
  };
  const impactsByLeverCode = new Map<string, ParsedImpact[]>();
  let impactHeaders = new Set<string>();
  const natures = getImpactNatures(undefined);

  if (sheets.impacts !== null) {
    const impactSheet = canonicalizeSheet(sheets.impacts, IMPACT_IMPORT_HEADERS);
    impactHeaders = impactSheet.headers;
    const hasI = (h: ImpactHeader) => impactSheet.headers.has(h);
    const rows = impactSheet.rows.filter((r) => !isRowEmpty(r.row));
    if (impactSheet.unknown.length > 0) {
      warn("Impacts", 1, "unknownColumns", { columns: impactSheet.unknown.join(", ") });
    }
    const missingKeys = (["Code Levier", "Type", "Montant (€M)"] as const).filter((h) => !hasI(h));
    if (rows.length > 0 && missingKeys.length > 0) {
      err("Impacts", 1, "missingColumns", { columns: missingKeys.join(", ") });
    } else {
      rows.forEach(({ row, rowNumber }) => {
        const leverCodeRaw = str(row["Code Levier"]);
        if (!leverCodeRaw) {
          err("Impacts", rowNumber, "required", { field: "Code Levier" });
          return;
        }
        const key = resolveTargetLever("Impacts", rowNumber, leverCodeRaw);
        if (!key) return;

        const actionNameRaw = hasI("Nom de l'action") ? str(row["Nom de l'action"]) : "";
        const matchedAction = actionNameRaw
          ? finalActionsOf(key).find((a) => nk(a.name) === nk(actionNameRaw))
          : undefined;
        if (actionNameRaw && !matchedAction) {
          err("Impacts", rowNumber, "actionNotFound", { name: actionNameRaw, code: leverCodeRaw });
          return;
        }

        const fields: Partial<ActionImpact> = {};
        const typeRaw = str(row["Type"]);
        const type = IMPACT_TYPE_BY_LABEL.get(nk(typeRaw));
        if (!type) {
          err("Impacts", rowNumber, "unknownImpactType", {
            value: typeRaw,
            expected: Object.values(IMPACT_TYPE_LABEL).join(", "),
          });
          return;
        }
        fields.type = type;

        if (hasI("Nature")) {
          const natureRaw = str(row["Nature"]);
          const nature = natureRaw ? IMPACT_NATURE_BY_LABEL.get(nk(natureRaw)) : undefined;
          // Obligatoire pour type="Coût" (classement CAPEX/OPEX) ; validée si renseignée sinon.
          if ((type === "cost" || natureRaw) && !nature) {
            err("Impacts", rowNumber, "unknownNature", {
              value: natureRaw,
              expected: Object.values(IMPACT_NATURE_LABEL).join(", "),
            });
            return;
          }
          if (nature) fields.nature = nature;
        } else if (type === "cost") {
          err("Impacts", rowNumber, "required", { field: "Nature" });
          return;
        }

        const amount = readNumber("Impacts", rowNumber, "Montant (€M)", row["Montant (€M)"]);
        if (amount === null) return;
        if (amount === undefined) {
          err("Impacts", rowNumber, "invalidNumber", { field: "Montant (€M)", value: "" });
          return;
        }
        fields.amount = amount;

        if (hasI("ETP")) {
          const fte = readNumber("Impacts", rowNumber, "ETP", row["ETP"]);
          if (fte === null) return;
          fields.fteCount = fte;
        }

        if (hasI("Type de gain")) {
          const raw = str(row["Type de gain"]);
          const st = raw ? SAVING_TYPE_BY_LABEL.get(nk(raw)) : undefined;
          if (raw && !st) {
            err("Impacts", rowNumber, "unknownSavingType", {
              value: raw,
              expected: Object.values(SAVING_TYPE_LABEL).join(", "),
            });
            return;
          }
          fields.savingType = st;
        }

        for (const [header, key2] of [
          ["Date CAPEX", "capexDeploymentDate"],
          ["Date gain", "gainDate"],
        ] as const) {
          if (!hasI(header)) continue;
          const d = readDate("Impacts", rowNumber, header, row[header]);
          if (d === null) return;
          fields[key2] = d;
        }

        if (hasI("Poste de coût")) {
          const raw = str(row["Poste de coût"]);
          if (raw) {
            const pnl = resolvePnlAccount(data.pnlAccounts, raw);
            if (!pnl) {
              err("Impacts", rowNumber, "unknownCostAccount", {
                value: raw,
                expected: data.pnlAccounts.map((p) => p.name || p.id).join(", "),
              });
              return;
            }
            fields.pnlMap = pnl.id;
          } else fields.pnlMap = undefined;
        }
        if (hasI("Centre de coût")) fields.costCenter = str(row["Centre de coût"]) || undefined;
        if (hasI("Entité P&L")) fields.entity = str(row["Entité P&L"]) || undefined;
        if (hasI("Technologie")) fields.technology = str(row["Technologie"]) || undefined;

        if (hasI("Mode")) {
          const raw = str(row["Mode"]);
          const mode = raw ? GAIN_MODE_BY_LABEL.get(nk(raw)) : undefined;
          if (raw && !mode) {
            err("Impacts", rowNumber, "unknownMode", { value: raw });
            return;
          }
          fields.gainRecurrence = mode;
        }
        if (hasI("Sens")) {
          const raw = str(row["Sens"]);
          const dir = raw ? FTE_DIRECTION_BY_LABEL.get(nk(raw)) : undefined;
          if (raw && !dir) {
            err("Impacts", rowNumber, "unknownDirection", { value: raw });
            return;
          }
          fields.fteDirection = dir;
        }
        if (hasI("Statut impact")) {
          const raw = str(row["Statut impact"]);
          const st = raw ? IMPACT_STATUS_BY_LABEL.get(nk(raw)) : undefined;
          if (raw && !st) {
            err("Impacts", rowNumber, "unknownImpactStatus", { value: raw });
            return;
          }
          fields.status = st;
        }
        if (hasI("Nature de l'impact")) {
          const raw = str(row["Nature de l'impact"]);
          if (raw) {
            const nat = natures.find((n) => nk(n.label) === nk(raw) || n.id === raw);
            if (nat) fields.natureId = nat.id;
            else
              warn("Impacts", rowNumber, "unknownImpactNature", {
                value: raw,
                expected: natures.map((n) => n.label).join(", "),
              });
          } else fields.natureId = undefined;
        }

        const natureForLabel = fields.nature ?? "oneoff";
        const derivedLabel = `${matchedAction ? `${matchedAction.name} — ` : ""}${IMPACT_TYPE_LABEL[type]} (${IMPACT_NATURE_LABEL[natureForLabel]})`;
        const explicitLabel = hasI("Libellé") ? str(row["Libellé"]) || undefined : undefined;
        const comment = hasI("Commentaire") ? str(row["Commentaire"]) : "";

        const list = impactsByLeverCode.get(key) ?? [];
        list.push({ rowNumber, fields, explicitLabel, derivedLabel, comment });
        impactsByLeverCode.set(key, list);
      });
    }
  }

  // ---------- Rapprochement des impacts (M5) + validation finance (M6) ----------
  let impactSeq = 0;
  const importer = options.importer ?? null;
  const impactDateKey = (i: Partial<ActionImpact>) => i.gainDate ?? i.capexDeploymentDate ?? "";

  const buildImpacts = (
    key: string,
    parsed: ParsedImpact[],
    existingImpacts: ActionImpact[]
  ): { impacts: ActionImpact[]; removed: ActionImpact[] } => {
    const unmatched = [...existingImpacts];
    const take = (pred: (e: ActionImpact) => boolean) => {
      const idx = unmatched.findIndex(pred);
      return idx === -1 ? undefined : unmatched.splice(idx, 1)[0];
    };
    const labelFor = (p: ParsedImpact) => p.explicitLabel ?? p.derivedLabel;
    // 1er passage : type + libellé + date ; 2e : type + libellé ; 3e (sans colonne Libellé) :
    // type + date + montant — l'ordre du fichier est conservé.
    const matches = new Map<ParsedImpact, ActionImpact>();
    for (const p of parsed) {
      const m = take(
        (e) =>
          e.type === p.fields.type &&
          nk(e.label) === nk(labelFor(p)) &&
          impactDateKey(e) === impactDateKey(p.fields)
      );
      if (m) matches.set(p, m);
    }
    for (const p of parsed) {
      if (matches.has(p)) continue;
      const m = take((e) => e.type === p.fields.type && nk(e.label) === nk(labelFor(p)));
      if (m) matches.set(p, m);
    }
    if (!impactHeaders.has("Libellé")) {
      for (const p of parsed) {
        if (matches.has(p)) continue;
        const m = take(
          (e) =>
            e.type === p.fields.type &&
            impactDateKey(e) === impactDateKey(p.fields) &&
            Math.abs(e.amount - (p.fields.amount ?? NaN)) < 1e-9
        );
        if (m) matches.set(p, m);
      }
    }

    const impacts = parsed.map((p) => {
      const prev = matches.get(p);
      let imp: ActionImpact;
      if (prev) {
        imp = { ...prev, ...p.fields, id: prev.id, label: p.explicitLabel ?? prev.label };
        if (!("nature" in p.fields)) imp.nature = prev.nature;
      } else {
        impactSeq += 1;
        imp = {
          id: makeImpactId(impactSeq),
          label: labelFor(p),
          nature: "oneoff",
          ...p.fields,
        } as ActionImpact;
      }
      // Champs propres à un type : nettoyés quand le type ne s'y prête pas. Les valeurs par défaut
      // écrites par l'export (« Gain annuel », « Départ ») ne transforment pas un champ absent en
      // modification (ré-import idempotent).
      if (imp.type !== "saving") delete imp.gainRecurrence;
      else if (prev && prev.gainRecurrence === undefined && imp.gainRecurrence === "annual") {
        delete imp.gainRecurrence;
      }
      if (imp.type !== "fte") delete imp.fteDirection;
      else if (prev && prev.fteDirection === undefined && imp.fteDirection === "departure") {
        delete imp.fteDirection;
      } else imp.fteDirection = imp.fteDirection ?? "departure";

      // Commentaire : ajouté seulement s'il n'existe pas déjà (ré-import idempotent).
      if (p.comment && !(imp.comments ?? []).some((c) => c.text === p.comment)) {
        imp.comments = [
          ...(imp.comments ?? []),
          { user: importer?.name || "Import Excel", ts: nowDate(), text: p.comment },
        ];
      }

      // Validation finance (M6) — même règle que realizedTogglePatch.
      if ("status" in p.fields) {
        const st = imp.status ? coerceImpactStatus(imp, imp.status) : undefined;
        if (st) imp.status = st;
        else delete imp.status;
        if (st === "done" || st === "ongoing") {
          const prevRealized =
            !!prev &&
            (prev.status === "done" || prev.status === "ongoing") &&
            prev.realizedApproval?.status !== "rejected";
          if (!prevRealized) {
            const now = new Date().toISOString();
            imp.realizedApproval = canDecideImpactRealized(importer)
              ? { status: "approved", decidedBy: importer?.name, decidedAt: now }
              : { status: "pending", requestedBy: importer?.name, requestedAt: now };
          }
        } else if (st === "planned") {
          delete imp.realizedApproval;
        }
      }
      for (const k of Object.keys(imp) as (keyof ActionImpact)[]) {
        if (imp[k] === undefined) delete imp[k];
      }
      return imp;
    });
    void key;
    return { impacts, removed: unmatched };
  };

  // ---------- Assemblage final ----------
  const toUpsert: LeverImportRow[] = [];
  const actionsRemoved: LeverImportPreview["actionsRemoved"] = [];
  const impactsRemoved: LeverImportPreview["impactsRemoved"] = [];
  const unchangedCodes: string[] = [];
  let createCount = 0;
  let updateCount = 0;

  // Leviers traités : ceux de la feuille Leviers, puis les leviers existants cités uniquement dans
  // les feuilles Actions/Impacts (M8 — avant, ces lignes étaient ignorées en silence).
  const orderedKeys: string[] = parsedLevers.map((p) => normalizeLeverCode(p.code));
  for (const key of Array.from(actionsByLeverCode.keys()).concat(
    Array.from(impactsByLeverCode.keys())
  )) {
    if (!orderedKeys.includes(key) && existingByCode.has(key)) orderedKeys.push(key);
  }

  for (const key of orderedKeys) {
    const existing = existingByCode.get(key);
    const parsed = parsedByCode.get(key);
    const values: LeverImportRow = parsed ? { ...parsed.values } : stripLeverMeta(existing!);

    const actions = finalActionsOf(key);
    if (sheets.actions !== null && existing) {
      const kept = new Set(actions.map((a) => a.id));
      const removed = (existing.actions ?? []).filter((a) => !kept.has(a.id));
      if (removed.length > 0) actionsRemoved.push({ code: existing.code, count: removed.length });
    }
    values.actions = actions;

    const impactRows = impactsByLeverCode.get(key);
    if (impactRows && impactRows.length > 0) {
      const { impacts, removed } = buildImpacts(
        key,
        impactRows,
        existing ? leverImpactsOf(existing) : []
      );
      values.impacts = impacts;
      if (removed.length > 0) {
        impactsRemoved.push({ code: existing!.code, labels: removed.map((r) => r.label) });
      }
    }

    if (existing) {
      // Champs dérivés : l'avancement suit le plan d'action ; les montants suivent les impacts
      // (ou le plan figé) — les valeurs du fichier ne s'appliquent donc pas dans ces cas.
      if ((values.actions ?? []).length > 0) values.progress = existing.progress;
      const hasImpacts = (values.impacts ?? []).length > 0;
      if (hasImpacts || existing.lockedPlan) {
        values.grossSavings = existing.grossSavings;
        values.netSavings = existing.netSavings;
        values.opexOneOff = existing.opexOneOff;
        values.opexRec = existing.opexRec;
        values.capex = existing.capex;
      }
      if (hasImpacts) values.fteImpact = existing.fteImpact;

      if (Object.keys(leverImportPatch(existing, values)).length === 0) {
        unchangedCodes.push(existing.code);
        continue;
      }
      updateCount++;
    } else {
      createCount++;
    }
    toUpsert.push(values);
  }

  return {
    toUpsert,
    errors,
    warnings,
    createCount,
    updateCount,
    unchangedCount: unchangedCodes.length,
    unchangedCodes,
    actionsRemoved,
    impactsRemoved,
    actionsSheetPresent: sheets.actions !== null,
    toCreateWorkstreams: Array.from(newWorkstreamsByName.values()),
  };
}
