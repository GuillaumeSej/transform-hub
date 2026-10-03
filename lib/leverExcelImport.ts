import { todayISO } from "@/lib/dateUtils";
import {
  DEFAULT_LIFECYCLE_STAGES,
  gateCrossedBy,
  resolveStatusLabel,
  STATUS_LABEL,
  STATUS_LEVEL,
  STATUS_ORDER,
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
import { coerceImpactStatus } from "@/lib/impactStatus";
import { CHARTER_CATEGORICAL } from "@/lib/charterColors";
import {
  displayedReforecastSnapshot,
  leverImpactsOf,
  leverProgressPct,
  leverReforecastNetValue,
} from "@/lib/engine";
import { leverImportPatch, normalizeLeverCode } from "@/lib/leversLogic";
import type {
  ActionImpact,
  ActionStatus,
  AuthUser,
  BeTrackData,
  DependencyType,
  ImpactNatureDef,
  Lever,
  LeverAction,
  LeverDependency,
  LeverStatus,
  LifecycleStage,
  SavingType,
  Workstream,
} from "@/types";

/** Teintes des workstreams auto-créés par l'import — palette catégorielle de la charte (l'ancienne
 *  palette contenait du vert olive et du bleu acier hors charte). */
const WORKSTREAM_PALETTE = CHARTER_CATEGORICAL;

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
 * champs. Les colonnes obligatoires pour une CRÉATION (Nom, Chantier, Statut, Compte P&L, dates)
 * sont vérifiées ligne par ligne. Colonnes inconnues = avertissement ; colonne clé absente
 * (Code…) = erreur.
 *
 * Cellule vide (audit lot 4, point 7 — même règle que le plan stratégique et la base ETP) : une
 * cellule VIDE CONSERVE la valeur existante (texte, nombre, date ou liste optionnels, sur les trois
 * feuilles) ; un tiret « - » (`CLEAR_CELL_TOKENS`) EFFACE le champ. Les colonnes obligatoires ne
 * peuvent être ni vides ni effacées : un tiret dans une colonne obligatoire ou un identifiant
 * (Code, Nom du levier, Chantier, Statut, Compte P&L, dates, Programme ; Code Levier, Nom de
 * l'action, Statut, dates, ID action ; Code Levier, Type, Montant, Nature d'un coût) est une
 * ERREUR BLOQUANTE `notClearable` (décision PO du 03/10), contrôlée AVANT toute résolution — un
 * « - » n'est jamais lu comme un nom de chantier à créer ni enregistré comme nom. « Libellé »
 * d'impact (facultatif) : « - » revient au libellé calculé. Règle rappelée dans l'onglet « Aide »
 * du modèle et dans l'aperçu.
 *
 * Colonnes calculées (audit lot 4, points 1-2) : « Progression (%) » est TOUJOURS calculée (plan
 * d'action, `leverProgressPct`) et ignorée à l'import ; les montants (brut, net, CAPEX, OPEX) d'un
 * levier porteur d'impacts ou au plan figé / réactualisé, et ses ETP s'il porte des impacts, sont
 * calculés et conservés. Une valeur du fichier qui diffère de la valeur calculée (celle écrite par
 * l'export) est signalée dans l'aperçu (« modification ignorée ») au lieu d'être ignorée en silence.
 *
 * Contrôles de grandeur (point 5) : montant négatif là où il n'a pas de sens (brut, CAPEX, OPEX,
 * montant d'impact, population, nombre d'ETP d'un impact ETP) = erreur ; valeur hors d'échelle
 * (`LARGE_AMOUNT_M` M€, `LARGE_FTE` ETP…) = avertissement à confirmer explicitement dans l'aperçu
 * (`needsConfirmation`). Cellule au format pourcentage : lue telle qu'affichée (40 %, voir
 * `convertExcelPercentCells`) ; une valeur ramenée à une borne est signalée.
 *
 * Plans d'action : feuille "Actions" présente = le fichier fait foi pour les leviers qu'il cite
 * (feuille Leviers, ou lignes Actions/Impacts d'un levier existant absent de la feuille Leviers —
 * M8). Chaque ligne est rapprochée d'une action existante par sa colonne technique « ID action »
 * (écrite par l'export : permet de renommer une action sans la perdre), à défaut par son nom
 * (insensible à la casse) ; l'action rapprochée est FUSIONNÉE (id, poids, avancement déclaré
 * conservés) ; celles absentes du fichier sont supprimées (signalé dans l'aperçu). Deux actions
 * de même nom dans un levier sont refusées (point 3). Feuille absente = plans d'action conservés.
 *
 * Impacts (M5/M6) : un levier ayant au moins une ligne Impacts voit ses impacts remplacés par ceux
 * du fichier, mais chaque ligne est d'abord rapprochée d'un impact existant (type + libellé + date,
 * puis type + libellé) pour en conserver l'id, les commentaires et la validation finance ; les
 * impacts existants non rapprochés sont listés dans l'aperçu (suppression). Un impact importé
 * « Réalisé » passe TOUJOURS en attente de validation finance (demandeur = importateur, même s'il
 * est finance ou admin), sauf s'il l'était déjà (même règle que
 * `lib/impactStatus.ts::realizedTogglePatch`).
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

/** En-tête de la colonne informative « impact BFR » de l'export (lib/leverExcel.ts) — ignorée à
 *  l'import (les impacts BFR vivent dans la feuille Impacts). */
export const WORKING_CAPITAL_EXPORT_HEADER = "Impact BFR — trésorerie, hors économies (€M)";

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
  // Colonne CALCULÉE (plan d'action) : écrite par l'export, ignorée à l'import (point 1).
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
  // Ancienne colonne d'export (doublon de « Impact estimé net (€M) », retirée) : encore acceptée
  // sans avertissement pour les fichiers exportés avant ce changement.
  "Réactualisé (net)",
  "Planifié initial",
  WORKING_CAPITAL_EXPORT_HEADER,
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
  // Colonne TECHNIQUE écrite par l'export (id de l'action) : clé de rapprochement prioritaire au
  // ré-import (renommer une action la conserve). Vide pour une nouvelle action.
  "ID action",
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
        // « Progression (%) » laissée vide : colonne calculée depuis le plan d'action.
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

/** Cellule qui EFFACE un champ (une cellule vide le conserve) — voir l'en-tête du module. */
export const CLEAR_CELL_TOKENS = ["-", "–", "—"] as const;

/** Seuils d'avertissement « valeur hors d'échelle » (à confirmer dans l'aperçu) : un montant au-delà
 *  de 1 000 M€ est presque toujours une saisie en € ou k€ dans une colonne en M€. */
export const LARGE_AMOUNT_M = 1000;
export const LARGE_FTE = 10000;
export const LARGE_POPULATION = 1000000;

/** Lignes de l'onglet « Aide » du modèle Excel (règles de remplissage). */
export function leverImportHelpRows(): string[][] {
  return [
    ["Règle", "Détail"],
    [
      "Cellule vide",
      "Conserve la valeur actuelle du levier, de l'action ou de l'impact (rien n'est effacé).",
    ],
    [
      "Tiret « - »",
      "Efface le champ (texte, date ou nombre optionnel). « Libellé » d'impact : revient au libellé calculé.",
    ],
    [
      "Colonnes obligatoires",
      "Code, Nom du levier, Chantier, Statut, Compte P&L impacté, dates (création) ; Code Levier + Nom de l'action (Actions) ; Code Levier + Type + Montant (Impacts).",
    ],
    [
      "Tiret refusé",
      "Dans une colonne obligatoire ou un identifiant (Code, Code Levier, ID action, Programme, Nature d'un coût…), le tiret « - » ne peut pas effacer la valeur : erreur bloquante, rien n'est importé. Laissez la cellule vide pour conserver la valeur.",
    ],
    [
      "Colonnes calculées",
      "« Progression (%) » suit le plan d'action ; montants et ETP d'un levier porteur d'impacts (ou au plan figé) suivent ses impacts : une modification de ces colonnes est ignorée et signalée.",
    ],
    [
      "Unités",
      `Montants en millions d'euros (M€) ; au-delà de ${LARGE_AMOUNT_M} M€ ou ${LARGE_FTE} ETP, l'import demande une confirmation. Montants d'impact, brut, CAPEX et OPEX jamais négatifs.`,
    ],
    ["Pourcentages", "Une cellule au format % (40 %) est lue telle qu'affichée (40)."],
    [
      "ID action",
      "Colonne technique écrite par l'export : ne pas modifier ; laisser vide pour une nouvelle action. Deux actions d'un même levier ne peuvent pas porter le même nom.",
    ],
    [
      "Type de gain « Impact BFR »",
      "Impact de trésorerie (besoin en fonds de roulement) : visible sur la fiche levier, jamais compté dans les économies.",
    ],
  ];
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
    "Un nouveau levier ne peut être importé qu'au statut « {idea} » (ou abandonné) : le statut « {target} » nécessite une validation. Importez-le au statut « {idea} », puis demandez la validation depuis sa fiche.",
  statusGated:
    "Changement de statut « {current} » → « {target} » refusé : le statut « {target} » nécessite une validation (demande depuis la fiche du levier). Remettez le statut actuel dans le fichier pour importer les autres modifications.",
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
  duplicateActionId:
    'Identifiant d\'action "{id}" en doublon pour le levier "{code}" (déjà utilisé ligne {row})',
  negativeNotAllowed: '"{field}" ne peut pas être négatif (valeur lue : {value})',
  actionNotFound: 'Action "{name}" introuvable pour le levier "{code}"',
  unknownImpactType: 'Type "{value}" inconnu (attendu : {expected})',
  unknownNature: 'Nature "{value}" inconnue (attendu : {expected})',
  unknownSavingType: 'Type de gain "{value}" inconnu (attendu : {expected})',
  unknownCostAccount: 'Poste de coût "{value}" introuvable (attendu : {expected})',
  unknownMode: 'Mode "{value}" inconnu (attendu : Gain annuel, Gain one-off)',
  unknownDirection: 'Sens "{value}" inconnu (attendu : Recrutement, Départ)',
  unknownImpactStatus: 'Statut impact "{value}" inconnu (attendu : Planifié, Réalisé, En cours)',
  // Tiret « - » dans une colonne obligatoire ou un identifiant (décision PO du 03/10) — même
  // modèle que les autres imports (`EXCEL_NOT_CLEARABLE_MESSAGE`, variable `{field}`).
  notClearable:
    '"{field}" est une colonne obligatoire (ou un identifiant) : le tiret « - » ne peut pas l\'effacer — laissez la cellule vide pour conserver la valeur',
  // Avertissements (n'empêchent pas l'import)
  unknownColumns: "Colonne(s) non reconnue(s), ignorée(s) : {columns}",
  unknownImpactNature:
    'Nature de l\'impact "{value}" inconnue : valeur ignorée (attendu : {expected})',
  unknownPopulation:
    'Population impactée "{value}" introuvable parmi les chantiers : valeur ignorée',
  formulaNoValue:
    "Cellule {cell} : formule sans valeur calculée (classeur non recalculé) — ouvrez et enregistrez le fichier dans Excel avant l'import.",
  computedFromActions:
    '"{field}" : valeur calculée depuis le plan d\'action ({computed}) — modification ignorée (fichier : {value})',
  computedFromImpacts:
    '"{field}" : valeur calculée depuis les impacts du levier ({computed}) — modification ignorée (fichier : {value})',
  computedFromPlan:
    '"{field}" : valeur calculée depuis le plan figé / la réactualisation ({computed}) — modification ignorée (fichier : {value})',
  valueClamped: '"{field}" : {value} hors bornes, ramené à {bound}',
  largeValue:
    '"{field}" = {value} {unit} : valeur inhabituellement élevée (au-delà de {threshold}) — vérifiez l\'unité avant de confirmer',
} as const;

export type LeverImportMessageCode = keyof typeof LEVER_IMPORT_MESSAGES;
export type LeverImportMessageVars = Record<string, string | number>;

/** Remplace les `{var}` d'un gabarit. */
export function formatLeverImportMessage(template: string, vars: LeverImportMessageVars = {}) {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

// ---------- Portes de validation ----------

/** Variante codée de `importStatusTransitionError` (message traduisible). Portes effectives =
 *  étapes « validation requise » du référentiel du programme (`gateCrossedBy` /
 *  `gatedStatusesFor`, lib/status-config.ts — même règle que `updateLever` et le stepper de la
 *  fiche levier) ; sans référentiel fourni, les 3 portes historiques. */
export function importStatusTransitionIssue(
  current: LeverStatus | undefined,
  target: LeverStatus,
  labelOf: (status: LeverStatus) => string,
  lifecycleStages?: LifecycleStage[]
): { code: LeverImportMessageCode; vars: LeverImportMessageVars } | null {
  if (current === target) return null;
  if (target === "cancelled") return null;
  if (current === undefined) {
    if (target === "idea") return null;
    return { code: "statusNewLever", vars: { idea: labelOf("idea"), target: labelOf(target) } };
  }
  if (current === "cancelled" && target === "idea") return null;
  const vars = { current: labelOf(current), target: labelOf(target) };
  if (gateCrossedBy(current, target, lifecycleStages)) return { code: "statusGated", vars };
  // Régression dans le cycle (`STATUS_ORDER` place l'abandon hors cycle), ou passage direct d'un
  // levier abandonné à « Réalisé » (interdit aussi par `updateLever`).
  if (
    (current !== "cancelled" && STATUS_ORDER[target] < STATUS_ORDER[current]) ||
    (current === "cancelled" && target === "delivered")
  ) {
    return { code: "statusBackward", vars };
  }
  return null;
}

/** Un import ne doit pas contourner les portes de validation : renvoie le motif de rejet de la
 *  ligne, ou `null` si la transition est permise. Permis : statut inchangé ; nouveau levier
 *  « Identifié » ou abandonné ; abandon d'un levier existant ; réactivation d'un abandonné en
 *  « Identifié » ; toute progression qui ne franchit aucune porte effective du programme (ex.
 *  Exécuté → Réalisé ; ou Identifié → Validé quand l'admin n'exige pas de validation à cette
 *  étape). Jamais de retour en arrière. */
export function importStatusTransitionError(
  current: LeverStatus | undefined,
  target: LeverStatus,
  labelOf: (status: LeverStatus) => string,
  lifecycleStages?: LifecycleStage[]
): string | null {
  const issue = importStatusTransitionIssue(current, target, labelOf, lifecycleStages);
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
  // Libellé explicite (point 4) : impact de trésorerie, jamais compté dans les économies
  // (`isWorkingCapitalImpact`). L'ancien libellé « Impact BFR » reste accepté à l'import.
  working_capital: "Impact BFR (trésorerie, hors économies)",
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
  "impact bfr": "working_capital",
  "impact bfr (tresorerie)": "working_capital",
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

/** Lecture d'une cellule optionnelle selon la règle « vide = on conserve ; « - » efface ». */
type CellText = { kind: "blank" } | { kind: "clear" } | { kind: "value"; value: string };
function readTextCell(v: unknown): CellText {
  const s = str(v);
  if (!s) return { kind: "blank" };
  if ((CLEAR_CELL_TOKENS as readonly string[]).includes(s)) return { kind: "clear" };
  return { kind: "value", value: s };
}

/** Cellule « - » (efface le champ). */
function isClearCell(v: unknown): boolean {
  return readTextCell(v).kind === "clear";
}

/** Égalité à l'arrondi près (valeurs écrites par l'export puis relues). */
function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => isBlankCell(v));
}

/** Date métier du jour : LOCALE (`todayISO`), jamais `toISOString()` (UTC, veille avant 2h à Paris). */
function nowDate(): string {
  return todayISO();
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
  /** Avertissement à CONFIRMER explicitement avant l'import (valeur hors d'échelle — point 5). */
  needsConfirmation?: boolean;
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
  /** Au moins un avertissement doit être confirmé (`needsConfirmation`) avant l'import. */
  needsConfirmation: boolean;
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
  importer?: (Pick<AuthUser, "name" | "profiles"> & Partial<Pick<AuthUser, "username">>) | null;
  /** Natures d'impact de l'entreprise (`Company.impactNatures`, voir lib/impactConfig.ts) : la
   *  colonne « Nature de l'impact » est résolue contre elles (libellé ou id). Absent ou vide =
   *  natures par défaut (lot 5 : auparavant toujours les natures par défaut, si bien que les
   *  natures personnalisées de l'entreprise étaient signalées « inconnues »). */
  impactNatures?: ImpactNatureDef[];
};

const LEVER_REQUIRED_FOR_NEW: LeverHeader[] = [
  "Nom du levier",
  "Chantier",
  "Statut",
  "Compte P&L impacté",
  "Date de départ",
  "Date de fin estimée",
];

/** Colonnes numériques du levier : clé, négatif autorisé, unité (seuil « hors d'échelle »). */
const NUMERIC_LEVER_FIELDS: {
  header: LeverHeader;
  key: "grossSavings" | "netSavings" | "opexOneOff" | "opexRec" | "capex" | "fteImpact";
  allowNegative: boolean;
  unit: "M€" | "ETP";
}[] = [
  { header: "Impact estimé brut (€M)", key: "grossSavings", allowNegative: false, unit: "M€" },
  // Net = brut − OPEX récurrent : peut être négatif.
  { header: "Impact estimé net (€M)", key: "netSavings", allowNegative: true, unit: "M€" },
  { header: "OPEX one-off (€M)", key: "opexOneOff", allowNegative: false, unit: "M€" },
  { header: "OPEX récurrent (€M/an)", key: "opexRec", allowNegative: false, unit: "M€" },
  { header: "CAPEX (€M)", key: "capex", allowNegative: false, unit: "M€" },
  // ETP signés (+recrutements / −départs).
  { header: "Impact estimé (ETP)", key: "fteImpact", allowNegative: true, unit: "ETP" },
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
  /** Avertissement à confirmer explicitement dans l'aperçu (valeur hors d'échelle). */
  const warnToConfirm = (
    s: LeverImportSheet,
    r: number,
    c: LeverImportMessageCode,
    v?: LeverImportMessageVars
  ) => {
    issue(warnings, s, r, c, v);
    warnings[warnings.length - 1].needsConfirmation = true;
  };

  /** Nombre optionnel : `undefined` si vide, `null` (+ erreur) si illisible. Contrôles de grandeur
   *  (point 5) : négatif refusé sauf `allowNegative` ; au-delà de `large` (en valeur absolue),
   *  avertissement à confirmer. */
  const readNumber = (
    sheet: LeverImportSheet,
    rowNumber: number,
    field: string,
    v: unknown,
    bounds: { allowNegative?: boolean; large?: number; unit?: string } = { allowNegative: true }
  ): number | undefined | null => {
    const p = parseCellNumber(v);
    if (!p) return undefined;
    if (!p.ok) {
      err(sheet, rowNumber, "invalidNumber", { field, value: p.raw });
      return null;
    }
    if (!bounds.allowNegative && p.value < 0) {
      err(sheet, rowNumber, "negativeNotAllowed", { field, value: p.value });
      return null;
    }
    if (bounds.large !== undefined && Math.abs(p.value) > bounds.large) {
      warnToConfirm(sheet, rowNumber, "largeValue", {
        field,
        value: p.value,
        unit: bounds.unit ?? "",
        threshold: `${bounds.large} ${bounds.unit ?? ""}`.trim(),
      });
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

  /** Colonne OBLIGATOIRE ou identifiant : le tiret « - » ne peut pas l'effacer — erreur bloquante
   *  `notClearable`, contrôlée AVANT toute résolution de la valeur (décision PO du 03/10). */
  const dashRefused = (
    sheet: LeverImportSheet,
    rowNumber: number,
    field: string,
    v: unknown
  ): boolean => {
    if (!isClearCell(v)) return false;
    err(sheet, rowNumber, "notClearable", { field });
    return true;
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

  type ParsedLever = {
    rowNumber: number;
    code: string;
    values: LeverImportRow;
    /** Valeurs lues dans les colonnes CALCULÉES (progression, montants, ETP) — comparées à la valeur
     *  calculée à l'assemblage pour signaler une modification ignorée (point 2). */
    computedInFile: Partial<Record<LeverHeader, number>>;
  };
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
    if (dashRefused("Leviers", rowNumber, "Code", row["Code"])) return;
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
          companyId: companyId ?? null,
          dependencies: [],
          description: "",
          actions: [],
        };

    if (hasL("Nom du levier")) {
      if (dashRefused("Leviers", rowNumber, "Nom du levier", row["Nom du levier"])) return reject();
      const name = str(row["Nom du levier"]);
      if (!name) {
        err("Leviers", rowNumber, "required", { field: "Nom du levier" });
        return reject();
      }
      values.name = name;
    }

    if (wsHeader) {
      const wsRaw = str(row["Chantier"]) || str(row["Workstream"]);
      // « - » refusé AVANT `findWorkstream` : il n'est jamais lu comme un chantier inconnu à créer.
      if (dashRefused("Leviers", rowNumber, "Chantier", wsRaw)) return reject();
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
      if (dashRefused("Leviers", rowNumber, "Statut", row["Statut"])) return reject();
      const statusRaw = str(row["Statut"]);
      const status = statusRaw ? parseLeverStatus(statusRaw, STATUS_BY_LABEL) : undefined;
      if (!status) {
        err("Leviers", rowNumber, "unknownStatus", {
          value: statusRaw,
          expected: activeStatusLabels(lifecycleStages).join(", "),
        });
        return reject();
      }
      const transition = importStatusTransitionIssue(
        existing?.status,
        status,
        labelOf,
        lifecycleStages
      );
      if (transition) {
        err("Leviers", rowNumber, transition.code, transition.vars);
        return reject();
      }
      values.status = status;
    }

    if (hasL("Compte P&L impacté")) {
      if (dashRefused("Leviers", rowNumber, "Compte P&L impacté", row["Compte P&L impacté"]))
        return reject();
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
      if (dashRefused("Leviers", rowNumber, header, row[header])) return reject();
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
    // Rattachement obligatoire : le tiret ne retire pas le programme.
    if (dashRefused("Leviers", rowNumber, "Programme", programRaw)) return reject();
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

    // Champs texte optionnels : vide = valeur conservée, « - » = effacée (point 7).
    for (const [header, key] of TEXT_LEVER_FIELDS) {
      if (!hasL(header)) continue;
      const cell = readTextCell(row[header]);
      if (cell.kind === "blank") continue;
      (values as Record<string, unknown>)[key] = cell.kind === "clear" ? "" : cell.value;
    }
    if (hasL("Description")) {
      const cell = readTextCell(row["Description"]);
      if (cell.kind === "clear") values.description = "";
      else if (cell.kind === "value") {
        const description = cell.value;
        // Description tronquée par l'export (limite de cellule Excel) : on garde la version complète.
        const truncatedExport =
          description.length === EXCEL_CELL_MAX &&
          (existing?.description ?? "").startsWith(description);
        if (!truncatedExport) values.description = description;
      }
    }

    const computedInFile: ParsedLever["computedInFile"] = {};
    if (hasL("Progression (%)") && !isClearCell(row["Progression (%)"])) {
      // Colonne CALCULÉE (plan d'action) : jamais appliquée (point 1) ; lue pour signaler une
      // modification ignorée. Bornes 0-100 : une valeur hors bornes est signalée.
      const n = readNumber("Leviers", rowNumber, "Progression (%)", row["Progression (%)"]);
      if (n === null) return reject();
      if (n !== undefined) {
        const bounded = clamp(n, 0, 100);
        if (bounded !== n) {
          warn("Leviers", rowNumber, "valueClamped", {
            field: "Progression (%)",
            value: n,
            bound: bounded,
          });
        }
        computedInFile["Progression (%)"] = bounded;
      }
    }
    for (const { header, key, allowNegative, unit } of NUMERIC_LEVER_FIELDS) {
      if (!hasL(header)) continue;
      // « - » sur un montant : remis à 0 (champ numérique obligatoire du levier).
      if (isClearCell(row[header])) {
        values[key] = 0;
        continue;
      }
      const n = readNumber("Leviers", rowNumber, header, row[header], {
        allowNegative,
        large: unit === "ETP" ? LARGE_FTE : LARGE_AMOUNT_M,
        unit,
      });
      if (n === null) return reject();
      if (n !== undefined) {
        values[key] = n;
        computedInFile[header] = n;
      }
    }

    if (hasL("Population impactée")) {
      // Nombre de personnes (décision 2026-09-28) ; vide = conservé, « - » = non renseigné.
      if (isClearCell(row["Population impactée"])) values.popImpacted = undefined;
      else {
        const n = readNumber(
          "Leviers",
          rowNumber,
          "Population impactée",
          row["Population impactée"],
          { allowNegative: false, large: LARGE_POPULATION }
        );
        if (n === null) return reject();
        if (n !== undefined) values.popImpacted = Math.round(n);
      }
    }

    const depHeader = "Dépendances (ID:type, séparées par ;)";
    const depCell = hasL(depHeader) ? readTextCell(row[depHeader]) : { kind: "blank" as const };
    if (depCell.kind === "clear") values.dependencies = [];
    if (depCell.kind === "value") {
      const deps: LeverDependency[] = [];
      let depError = false;
      depCell.value
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
    parsedLevers.push({ rowNumber, code: existing?.code ?? code, values, computedInFile });
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
  /** Actions existantes déjà rapprochées, par levier : une action n'est fusionnée qu'une fois. */
  const matchedActionIds = new Map<string, Map<string, number>>();
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
        if (dashRefused("Actions", rowNumber, "Code Levier", row["Code Levier"])) return;
        const leverCodeRaw = str(row["Code Levier"]);
        if (!leverCodeRaw) {
          err("Actions", rowNumber, "required", { field: "Code Levier" });
          return;
        }
        const key = resolveTargetLever("Actions", rowNumber, leverCodeRaw);
        if (!key) return;

        if (dashRefused("Actions", rowNumber, "Nom de l'action", row["Nom de l'action"])) return;
        const name = str(row["Nom de l'action"]);
        if (!name) {
          err("Actions", rowNumber, "required", { field: "Nom de l'action" });
          return;
        }
        const list = actionsByLeverCode.get(key) ?? [];
        // Deux actions de même nom dans un levier : refusé (point 3) — le rapprochement par nom et
        // la feuille Impacts (« Nom de l'action ») ne sauraient pas les distinguer.
        const dup = list.find((a) => nk(a.action.name) === nk(name));
        if (dup) {
          err("Actions", rowNumber, "duplicateAction", {
            name,
            code: leverCodeRaw,
            row: dup.rowNumber,
          });
          return;
        }

        // Rapprochement : colonne technique « ID action » (export) en priorité, sinon le nom ; une
        // action existante n'est rapprochée qu'une fois.
        const existingActions = existingByCode.get(key)?.actions ?? [];
        const used = matchedActionIds.get(key) ?? new Map<string, number>();
        if (hasA("ID action") && dashRefused("Actions", rowNumber, "ID action", row["ID action"]))
          return;
        const idRaw = hasA("ID action") ? str(row["ID action"]) : "";
        if (idRaw && used.has(idRaw)) {
          err("Actions", rowNumber, "duplicateActionId", {
            id: idRaw,
            code: leverCodeRaw,
            row: used.get(idRaw)!,
          });
          return;
        }
        const prev =
          (idRaw ? existingActions.find((a) => a.id === idRaw) : undefined) ??
          existingActions.find((a) => !used.has(a.id) && nk(a.name) === nk(name));
        if (prev) {
          used.set(prev.id, rowNumber);
          matchedActionIds.set(key, used);
        }
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
          if (dashRefused("Actions", rowNumber, "Statut", row["Statut"])) return;
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
          if (dashRefused("Actions", rowNumber, header, row[header])) return;
          const d = readDate("Actions", rowNumber, header, row[header]);
          if (d === null) return;
          if (d === undefined) {
            err("Actions", rowNumber, "requiredDate", { field: header });
            return;
          }
          dates[key2] = d;
        }
        // Owner : vide = conservé, « - » = effacé (point 7).
        const ownerCell = hasA("Owner") ? readTextCell(row["Owner"]) : { kind: "blank" as const };
        const owner =
          ownerCell.kind === "value"
            ? ownerCell.value
            : ownerCell.kind === "clear"
              ? undefined
              : prev?.owner;

        let action: LeverAction;
        if (prev) {
          action = { ...prev, name, owner, start: dates.start!, end: dates.end!, status: status! };
          if (action.owner === undefined) delete action.owner;
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
    /** « - » dans « Libellé » : l'impact reprend son libellé calculé (`derivedLabel`). */
    labelCleared?: boolean;
    derivedLabel: string;
    comment: string;
  };
  const impactsByLeverCode = new Map<string, ParsedImpact[]>();
  let impactHeaders = new Set<string>();
  const natures = getImpactNatures({ impactNatures: options.impactNatures });

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
        if (dashRefused("Impacts", rowNumber, "Code Levier", row["Code Levier"])) return;
        const leverCodeRaw = str(row["Code Levier"]);
        if (!leverCodeRaw) {
          err("Impacts", rowNumber, "required", { field: "Code Levier" });
          return;
        }
        const key = resolveTargetLever("Impacts", rowNumber, leverCodeRaw);
        if (!key) return;

        // Rattachement FACULTATIF (libellé dérivé seulement) : « - » = sans action.
        const actionNameCell = hasI("Nom de l'action")
          ? readTextCell(row["Nom de l'action"])
          : { kind: "blank" as const };
        const actionNameRaw = actionNameCell.kind === "value" ? actionNameCell.value : "";
        const matchedAction = actionNameRaw
          ? finalActionsOf(key).find((a) => nk(a.name) === nk(actionNameRaw))
          : undefined;
        if (actionNameRaw && !matchedAction) {
          err("Impacts", rowNumber, "actionNotFound", { name: actionNameRaw, code: leverCodeRaw });
          return;
        }

        const fields: Partial<ActionImpact> = {};
        if (dashRefused("Impacts", rowNumber, "Type", row["Type"])) return;
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
          // Obligatoire pour un coût (tiret refusé) ; sans objet sinon (tiret = rien à lire).
          if (type === "cost" && dashRefused("Impacts", rowNumber, "Nature", row["Nature"])) return;
          const natureRaw = isClearCell(row["Nature"]) ? "" : str(row["Nature"]);
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

        // Montant : toujours positif (le type donne le sens) ; hors d'échelle = à confirmer.
        if (dashRefused("Impacts", rowNumber, "Montant (€M)", row["Montant (€M)"])) return;
        const amount = readNumber("Impacts", rowNumber, "Montant (€M)", row["Montant (€M)"], {
          allowNegative: false,
          large: LARGE_AMOUNT_M,
          unit: "M€",
        });
        if (amount === null) return;
        if (amount === undefined) {
          err("Impacts", rowNumber, "invalidNumber", { field: "Montant (€M)", value: "" });
          return;
        }
        fields.amount = amount;

        // Colonnes optionnelles : vide = valeur conservée (impact rapproché), « - » = effacée
        // (point 7) ; seule une colonne renseignée ou effacée pose une clé dans `fields`.
        const optional = (header: ImpactHeader): CellText =>
          hasI(header) ? readTextCell(row[header]) : { kind: "blank" };

        const fteCell = optional("ETP");
        if (fteCell.kind === "clear") fields.fteCount = undefined;
        else if (fteCell.kind === "value") {
          // Nombre d'ETP d'un impact ETP : positif (le sens vient de la colonne « Sens »).
          const fte = readNumber("Impacts", rowNumber, "ETP", row["ETP"], {
            allowNegative: type !== "fte",
            large: LARGE_FTE,
            unit: "ETP",
          });
          if (fte === null) return;
          fields.fteCount = fte;
        }

        const savingCell = optional("Type de gain");
        if (savingCell.kind === "clear") fields.savingType = undefined;
        else if (savingCell.kind === "value") {
          const st = SAVING_TYPE_BY_LABEL.get(nk(savingCell.value));
          if (!st) {
            err("Impacts", rowNumber, "unknownSavingType", {
              value: savingCell.value,
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
          const cell = optional(header);
          if (cell.kind === "clear") fields[key2] = undefined;
          if (cell.kind !== "value") continue;
          const d = readDate("Impacts", rowNumber, header, row[header]);
          if (d === null) return;
          fields[key2] = d;
        }

        const pnlCell = optional("Poste de coût");
        if (pnlCell.kind === "clear") fields.pnlMap = undefined;
        else if (pnlCell.kind === "value") {
          const pnl = resolvePnlAccount(data.pnlAccounts, pnlCell.value);
          if (!pnl) {
            err("Impacts", rowNumber, "unknownCostAccount", {
              value: pnlCell.value,
              expected: data.pnlAccounts.map((p) => p.name || p.id).join(", "),
            });
            return;
          }
          fields.pnlMap = pnl.id;
        }
        for (const [header, key2] of [
          ["Centre de coût", "costCenter"],
          ["Entité P&L", "entity"],
          ["Technologie", "technology"],
        ] as const) {
          const cell = optional(header);
          if (cell.kind === "clear") fields[key2] = undefined;
          else if (cell.kind === "value") fields[key2] = cell.value;
        }

        const modeCell = optional("Mode");
        if (modeCell.kind === "clear") fields.gainRecurrence = undefined;
        else if (modeCell.kind === "value") {
          const mode = GAIN_MODE_BY_LABEL.get(nk(modeCell.value));
          if (!mode) {
            err("Impacts", rowNumber, "unknownMode", { value: modeCell.value });
            return;
          }
          fields.gainRecurrence = mode;
        }
        const dirCell = optional("Sens");
        if (dirCell.kind === "clear") fields.fteDirection = undefined;
        else if (dirCell.kind === "value") {
          const dir = FTE_DIRECTION_BY_LABEL.get(nk(dirCell.value));
          if (!dir) {
            err("Impacts", rowNumber, "unknownDirection", { value: dirCell.value });
            return;
          }
          fields.fteDirection = dir;
        }
        const statusCell = optional("Statut impact");
        if (statusCell.kind === "clear") fields.status = undefined;
        else if (statusCell.kind === "value") {
          const st = IMPACT_STATUS_BY_LABEL.get(nk(statusCell.value));
          if (!st) {
            err("Impacts", rowNumber, "unknownImpactStatus", { value: statusCell.value });
            return;
          }
          fields.status = st;
        }
        const natureIdCell = optional("Nature de l'impact");
        if (natureIdCell.kind === "clear") fields.natureId = undefined;
        else if (natureIdCell.kind === "value") {
          const raw = natureIdCell.value;
          const nat = natures.find((n) => nk(n.label) === nk(raw) || n.id === raw);
          if (nat) fields.natureId = nat.id;
          else
            warn("Impacts", rowNumber, "unknownImpactNature", {
              value: raw,
              expected: natures.map((n) => n.label).join(", "),
            });
        }

        const natureForLabel = fields.nature ?? "oneoff";
        const derivedLabel = `${matchedAction ? `${matchedAction.name} — ` : ""}${IMPACT_TYPE_LABEL[type]} (${IMPACT_NATURE_LABEL[natureForLabel]})`;
        // « Libellé » facultatif : vide = libellé actuel conservé (dérivé pour une création), « - » =
        // retour au libellé CALCULÉ (jamais un libellé « - »).
        const labelCell = hasI("Libellé")
          ? readTextCell(row["Libellé"])
          : { kind: "blank" as const };
        const explicitLabel = labelCell.kind === "value" ? labelCell.value : undefined;
        const labelCleared = labelCell.kind === "clear";
        // Commentaire : ajouté au fil (jamais effacé par l'import) — un tiret n'ajoute rien.
        const commentCell = hasI("Commentaire")
          ? readTextCell(row["Commentaire"])
          : { kind: "blank" as const };
        const comment = commentCell.kind === "value" ? commentCell.value : "";

        const list = impactsByLeverCode.get(key) ?? [];
        list.push({ rowNumber, fields, explicitLabel, labelCleared, derivedLabel, comment });
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
    // 3e passage aussi pour une ligne dont le libellé est remis au calculé (« - ») : l'impact
    // existant porte encore son ancien libellé.
    if (!impactHeaders.has("Libellé") || parsed.some((p) => p.labelCleared)) {
      for (const p of parsed) {
        if (matches.has(p)) continue;
        if (impactHeaders.has("Libellé") && !p.labelCleared) continue;
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
        const label = p.labelCleared ? p.derivedLabel : (p.explicitLabel ?? prev.label);
        imp = { ...prev, ...p.fields, id: prev.id, label };
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
            // TOUJOURS en attente (même finance/admin) : un AUTRE profil finance du programme,
            // ou un admin, décide — l'importateur est le demandeur.
            imp.realizedApproval = {
              status: "pending",
              requestedBy: importer?.name,
              ...(importer?.username ? { requestedByUsername: importer.username } : {}),
              requestedAt: now,
            };
          }
        } else if (st === "planned" && prev?.status !== "planned") {
          // Validation retirée seulement quand le statut CHANGE (lot 5) : un « Réalisé » refusé
          // par la finance est repassé « Planifié » avec la trace du refus — le ré-importer tel
          // quel ne doit ni effacer cette trace ni produire une mise à jour fantôme.
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

    // Avancement : TOUJOURS calculé depuis le plan d'action (`leverProgressPct`) — la colonne
    // « Progression (%) » n'est jamais appliquée (point 1 : avant, un levier sans action revenait
    // à la valeur exportée, 0 ou 100, au lieu de sa valeur stockée → faux « mis à jour »).
    values.progress = existing?.progress ?? 0;
    const inFile = parsed?.computedInFile ?? {};
    const rowNumber = parsed?.rowNumber ?? 0;
    /** Signale une colonne calculée dont la valeur du fichier diffère de la valeur calculée. */
    const flagIgnored = (
      header: LeverHeader,
      computed: number,
      code: "computedFromActions" | "computedFromImpacts" | "computedFromPlan"
    ) => {
      const value = inFile[header];
      if (value === undefined || sameNumber(value, computed)) return;
      warn("Leviers", rowNumber, code, { field: header, value, computed: round6(computed) });
    };
    // Référence = valeur écrite par l'export (levier existant), ou calculée (nouveau levier).
    flagIgnored(
      "Progression (%)",
      leverProgressPct(existing ?? { actions: values.actions, status: values.status }),
      "computedFromActions"
    );

    if (existing) {
      // Champs dérivés : les montants suivent les impacts (ou le plan figé / le réactualisé) — les
      // valeurs du fichier ne s'appliquent donc pas dans ces cas : l'export écrit le réactualisé
      // affiché (`displayedReforecastSnapshot`), qui diffère alors des champs courants. Une valeur
      // modifiée dans le fichier est signalée (point 2), jamais ignorée en silence.
      const hasImpacts = (values.impacts ?? []).length > 0;
      // Levier abandonné : l'export écrit son net RETENU (0, `leverReforecastNetValue`) — ses
      // montants stockés (base du « Planifié initial ») sont conservés, jamais écrasés par ce 0.
      const isCancelled = existing.status === "cancelled";
      if (hasImpacts || existing.lockedPlan || existing.reforecast || isCancelled) {
        values.grossSavings = existing.grossSavings;
        values.netSavings = existing.netSavings;
        values.opexOneOff = existing.opexOneOff;
        values.opexRec = existing.opexRec;
        values.capex = existing.capex;
        const source = hasImpacts ? "computedFromImpacts" : "computedFromPlan";
        const refo = displayedReforecastSnapshot(existing);
        flagIgnored("Impact estimé brut (€M)", refo.grossSavings, source);
        flagIgnored("Impact estimé net (€M)", leverReforecastNetValue(existing), source);
        flagIgnored("CAPEX (€M)", refo.capex, source);
        flagIgnored("OPEX one-off (€M)", refo.opexOneOff, source);
        flagIgnored("OPEX récurrent (€M/an)", refo.opexRec, source);
      }
      if (hasImpacts) {
        values.fteImpact = existing.fteImpact;
        flagIgnored("Impact estimé (ETP)", existing.fteImpact, "computedFromImpacts");
      }

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
    needsConfirmation: warnings.some((w) => w.needsConfirmation),
    toCreateWorkstreams: Array.from(newWorkstreamsByName.values()),
  };
}

/** Valeur affichée dans un message (bruit flottant retiré). */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
