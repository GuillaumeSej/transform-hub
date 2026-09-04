import type {
  Chantier,
  ChantierAction,
  ChantierDependency,
  ChantierDependencyType,
  Deliverable,
  DeliverablePhase,
  Indicator,
  IndicatorDirection,
  IndicatorFrequency,
  IndicatorKind,
  MaturityStageConfig,
  Role,
  StrategicAxis,
} from "@/types";

/**
 * Import Excel d'un plan stratégique complet (Axes → Chantiers → Actions → Livrables →
 * Indicateurs), utilisé par `StrategicImportButton` — voir plan round 4, section "Import Excel du
 * Plan Stratégique". Mirror délibéré de `lib/leverExcelImport.ts` (même technique `xlsx`, même
 * idiome `validate*Rows` -> aperçu + erreurs ligne par ligne, même `downloadTemplate` via
 * `aoa_to_sheet`/`book_append_sheet`) — quelques différences de fond documentées ci-dessous.
 *
 * Format retenu : 5 feuilles, une ligne par entité :
 *  - "Axes" : une ligne par axe. `Code` est une clé de LIAISON propre au fichier importé (pas un
 *    champ persistant de `StrategicAxis` — contrairement au `Code` des leviers, qui EST le champ
 *    métier stocké) : elle ne sert qu'à ce que les feuilles suivantes puissent référencer la bonne
 *    ligne. Elle n'apparaît nulle part dans l'entité créée.
 *  - "Chantiers" : une ligne par chantier, rattachée à un axe via `Code Axe`. `Code` (propre à
 *    cette feuille) sert de clé de liaison pour "Actions" et pour la colonne "Dépendances" de
 *    cette même feuille.
 *  - "Actions" : une ligne par action, rattachée à un chantier via `Code Chantier`. `Code` sert de
 *    clé de liaison pour "Livrables".
 *  - "Livrables" (optionnelle) : une ligne par livrable, rattachée à une action via `Code Action`.
 *    Simplifiée à UNE phase par ligne (`Début`/`Fin`) plutôt que d'exposer la liste `phases[]` —
 *    largement suffisant pour un import initial, une phase supplémentaire se rajoute ensuite à la
 *    main sur la fiche chantier. Un livrable n'est jamais un `toCreate` séparé : il est embarqué
 *    dans `ChantierAction.deliverables` de l'action résolue.
 *  - "Indicateurs" : une ligne par indicateur, rattachée à un axe (`Code Axe`) OU un chantier
 *    (`Code Chantier`) — exactement l'un des deux, jamais les deux, jamais ni l'un ni l'autre
 *    (même optionnalité que `Indicator.chantierId`). Quand seul `Code Chantier` est renseigné,
 *    `axisId` est dérivé automatiquement de l'axe du chantier résolu.
 *
 * Allocation d'id en deux passes (une seule passe mémoire, AUCUN aller-retour Firestore) : au
 * contraire des leviers (id métier `L###` nécessitant l'existant en base pour décider
 * création/mise à jour), `newId(prefix)` des entités stratégiques est purement une allocation
 * côté client (`${prefix}-${Date.now().toString(36)}-${random}`, voir
 * `lib/hooks/useStrategicData.ts:129-131` — non réutilisé ici tel quel, mais même esprit avec
 * `makeId` ci-dessous). On peut donc allouer un id réel à CHAQUE ligne Axe/Chantier/Action dès sa
 * lecture, construire une map `Code (du fichier) -> id réel` par type d'entité, puis résoudre
 * TOUTES les colonnes de clé étrangère (Code Axe, Code Chantier, Code Action, et la colonne
 * Dépendances) contre ces maps — y compris des références à des lignes créées dans le MÊME
 * fichier. C'est le cas d'usage réel : un axe et tous ses chantiers arrivent ensemble dans
 * l'import initial qui amorce un nouveau plan.
 *
 * Résolution de repli sur l'existant : en plus de la map "même fichier", chaque FK est aussi
 * résolue contre les entités déjà en base (`existingData`, par `id` ou par `name`, insensible à la
 * casse) — utile pour un import complémentaire qui ajoute des chantiers à un axe déjà créé, sans
 * avoir à réimporter la feuille Axes à chaque fois.
 *
 * Pas de mode "mise à jour" en v1 : l'import sert à démarrer un plan, pas à corriger un plan
 * existant en place — toute ligne valide devient une CRÉATION (id fraîchement alloué), même si son
 * `Nom` coïncide avec une entité déjà en base. Hors scope explicite du round 4, à revoir plus tard
 * si le besoin se confirme.
 *
 * Validation toujours faite sur les 5 feuilles ENSEMBLE avant la moindre écriture (voir
 * `validateStrategicImportRows`) : l'aperçu retourné liste les entités prêtes à créer PAR TYPE et
 * TOUTES les erreurs ligne par ligne (feuille + numéro + raison) ; l'écriture Firestore n'a lieu
 * qu'après confirmation manuelle, dans le composant appelant (cette librairie reste pure, aucun
 * import de `lib/firestore/*`).
 */

// ---------- En-têtes (utilisés par le bouton "Template Excel") ----------

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
  "Code Axe",
  "Nom",
  "Description",
  "Étape de maturité",
  "Dépendances (Code:type, séparées par ;)",
] as const;

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
] as const;

export const STRATEGIC_DELIVERABLE_IMPORT_HEADERS = [
  "Code Action",
  "Label",
  "Début",
  "Fin",
] as const;

export const STRATEGIC_INDICATOR_IMPORT_HEADERS = [
  "Code Axe",
  "Code Chantier",
  "Nom",
  "Type",
  "Fréquence",
  "Objectif",
  "Valeur cible",
  "Sens",
  "Unité",
  "Rôles responsables (séparés par ;)",
] as const;

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

const DEPENDENCY_TYPES: ChantierDependencyType[] = ["FS", "SS", "FF", "SF"];

/** Union fermée `Role` (types/index.ts) — les 14 valeurs internes sont acceptées TELLES QUELLES
 *  dans la colonne "Rôles responsables" (pas de table de libellés dédiée à dupliquer ici, voir le
 *  doc-comment de `RESPONSIBLE_ROLES` dans `components/admin/IndicatorsEditor.tsx` : chaque écran
 *  choisit déjà son propre sous-ensemble/libellé, il n'y a pas de référentiel partagé). Un import
 *  Excel s'adresse à un profil suffisamment technique pour taper `cto;chantier_owner`. */
const ALL_ROLES: Role[] = [
  "admin",
  "admin_entreprise",
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

function reverseLabelMap<T extends string>(map: Record<T, string>): Map<string, T> {
  const m = new Map<string, T>();
  (Object.keys(map) as T[]).forEach((key) => m.set(map[key].toLowerCase(), key));
  return m;
}

const KIND_BY_LABEL = reverseLabelMap(KIND_LABEL);
const FREQUENCY_BY_LABEL = reverseLabelMap(FREQUENCY_LABEL);
const DIRECTION_BY_LABEL = reverseLabelMap(DIRECTION_LABEL);

/** Accepte le libellé humain ("Quantitatif") ou la valeur brute ("quantitative") — même tolérance
 *  que `buildStatusByLabel` côté leviers, pour ne jamais bloquer un fichier qui reprend le
 *  vocabulaire interne plutôt que l'affichage écran. */
function resolveEnum<T extends string>(
  raw: string,
  byLabel: Map<string, T>,
  validValues: readonly T[]
): T | undefined {
  const lower = raw.toLowerCase();
  const byLabelMatch = byLabel.get(lower);
  if (byLabelMatch) return byLabelMatch;
  return validValues.find((v) => v.toLowerCase() === lower);
}

// ---------- Parsing utilitaire (mêmes conventions que lib/leverExcelImport.ts) ----------

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function numOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => str(v) === "");
}

/** Identique à `parseFlexibleDate` de `lib/leverExcelImport.ts` (dupliquée plutôt qu'importée :
 *  chaque fichier d'import reste autonome, même convention que `lib/hrExcel.ts`/
 *  `lib/hierarchyExcel.ts`). Accepte une date Excel native, une date sérielle Excel, une chaîne
 *  ISO (AAAA-MM-JJ) ou une chaîne française JJ/MM/AAAA. Retourne "" si non interprétable. */
function parseFlexibleDate(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    const ms = Date.UTC(1899, 11, 30) + v * 86400000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (fr) {
    const [, d, m, y] = fr;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Ids alloués pour de vrai (contrairement à `makeActionId`/`makeImpactId` côté leviers, qui
 *  génèrent des ids "de session" jetables) : ce sont ces ids qui seront écrits tels quels en base
 *  par l'appelant, via les `save*` existants. Compteur de séquence par préfixe pour garantir
 *  l'unicité même si plusieurs lignes sont traitées dans la même milliseconde. */
let idSeq = 0;
function makeId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${idSeq}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Résout une étape de maturité par id ou par libellé (insensible à la casse) — même référentiel
 *  pour Axes/Chantiers/Actions (voir `MaturityStageConfig`, configurable par programme). */
function resolveStage(raw: string, stages: MaturityStageConfig[]): string | undefined {
  const lower = raw.toLowerCase();
  const stage = stages.find((s) => s.id.toLowerCase() === lower || s.label.toLowerCase() === lower);
  return stage?.id;
}

function stageNamesForError(stages: MaturityStageConfig[]): string {
  return stages.length > 0
    ? stages.map((s) => s.label).join(", ")
    : "aucune étape configurée pour ce programme — créez-en dans Admin > Programmes";
}

function parseDependencies(raw: string, resolveTargetCode: (code: string) => string | undefined) {
  if (!raw) return { dependencies: [] as ChantierDependency[], unresolved: [] as string[] };
  const dependencies: ChantierDependency[] = [];
  const unresolved: string[] = [];
  raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [codeRaw, typeRaw] = entry.split(":").map((s) => s.trim());
      if (!codeRaw) return;
      const targetId = resolveTargetCode(codeRaw);
      if (!targetId) {
        unresolved.push(codeRaw);
        return;
      }
      const type: ChantierDependencyType = DEPENDENCY_TYPES.includes(
        typeRaw as ChantierDependencyType
      )
        ? (typeRaw as ChantierDependencyType)
        : "FS";
      dependencies.push({ targetId, type });
    });
  return { dependencies, unresolved };
}

// ---------- Types publics ----------

export type StrategicImportSheet = "Axes" | "Chantiers" | "Actions" | "Livrables" | "Indicateurs";

export type StrategicImportError = {
  sheet: StrategicImportSheet;
  rowNumber: number;
  reason: string;
};

export type StrategicImportRawSheets = {
  axes: Record<string, unknown>[];
  chantiers: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  livrables: Record<string, unknown>[];
  indicateurs: Record<string, unknown>[];
};

export type StrategicImportExistingData = {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  actions: ChantierAction[];
  indicators: Indicator[];
};

export type StrategicImportToCreate = {
  axes: StrategicAxis[];
  chantiers: Chantier[];
  actions: ChantierAction[];
  indicators: Indicator[];
};

export type StrategicImportPreview = {
  toCreate: StrategicImportToCreate;
  errors: StrategicImportError[];
};

/** Trouve une entité déjà en base par `id` ou `name`, insensible à la casse — repli utilisé quand
 *  un Code du fichier ne correspond à aucune ligne du même import (voir doc-comment en tête de
 *  fichier, "Résolution de repli sur l'existant"). */
function findExistingByCodeOrName<T extends { id: string; name: string }>(
  list: T[],
  raw: string
): T | undefined {
  const lower = raw.toLowerCase();
  return list.find((e) => e.id.toLowerCase() === lower || e.name.toLowerCase() === lower);
}

/**
 * Valide les 5 feuilles ENSEMBLE et produit un aperçu (entités prêtes à créer par type + erreurs
 * ligne par ligne) sans rien écrire — voir doc-comment en tête de fichier pour le format complet
 * et la stratégie de résolution des clés étrangères.
 */
export function validateStrategicImportRows(
  sheets: StrategicImportRawSheets,
  existingData: StrategicImportExistingData,
  companyId: string | null | undefined,
  programId: string | null | undefined,
  maturityStages: MaturityStageConfig[]
): StrategicImportPreview {
  const errors: StrategicImportError[] = [];
  const resolvedCompanyId = companyId ?? "";
  const resolvedProgramId = programId ?? "";

  // ---------- Feuille "Axes" ----------
  const axesToCreate: StrategicAxis[] = [];
  const axisIdByCode = new Map<string, string>(); // Code (fichier, minuscule) -> id réel alloué
  const axisCodeFirstSeenAtRow = new Map<string, number>();

  sheets.axes.forEach((row, i) => {
    const rowNumber = i + 2; // ligne 1 = en-têtes
    if (isRowEmpty(row)) return;

    const code = str(row["Code"]);
    if (!code) {
      errors.push({ sheet: "Axes", rowNumber, reason: `"Code" est obligatoire` });
      return;
    }
    const lowerCode = code.toLowerCase();
    if (axisCodeFirstSeenAtRow.has(lowerCode)) {
      errors.push({
        sheet: "Axes",
        rowNumber,
        reason: `Code "${code}" en doublon dans le fichier (déjà utilisé ligne ${axisCodeFirstSeenAtRow.get(lowerCode)})`,
      });
      return;
    }

    const name = str(row["Nom"]);
    if (!name) {
      errors.push({ sheet: "Axes", rowNumber, reason: `"Nom" est obligatoire` });
      return;
    }

    const stageRaw = str(row["Étape de maturité"]);
    const stage = stageRaw ? resolveStage(stageRaw, maturityStages) : undefined;
    if (!stage) {
      errors.push({
        sheet: "Axes",
        rowNumber,
        reason: `Étape de maturité "${stageRaw}" inconnue (attendu : ${stageNamesForError(maturityStages)})`,
      });
      return;
    }

    const id = makeId("AX");
    const axis: StrategicAxis = {
      id,
      companyId: resolvedCompanyId,
      programId: resolvedProgramId,
      name,
      stage,
      ...(str(row["Description"]) ? { description: str(row["Description"]) } : {}),
      ...(str(row["Owner"]) ? { owner: str(row["Owner"]) } : {}),
      ...(str(row["Couleur"]) ? { color: str(row["Couleur"]) } : {}),
      createdAt: nowDate(),
      lastUpdate: nowDate(),
    };
    axesToCreate.push(axis);
    axisIdByCode.set(lowerCode, id);
    axisCodeFirstSeenAtRow.set(lowerCode, rowNumber);
  });

  const resolveAxisCode = (raw: string): string | undefined =>
    axisIdByCode.get(raw.toLowerCase()) ?? findExistingByCodeOrName(existingData.axes, raw)?.id;

  // ---------- Feuille "Chantiers" (passe 1 : champs simples + allocation d'id) ----------
  type ParsedChantier = {
    rowNumber: number;
    code: string;
    depsRaw: string;
    chantier: Chantier;
  };
  const parsedChantiers: ParsedChantier[] = [];
  const chantierIdByCode = new Map<string, string>();
  const chantierAxisById = new Map<string, string>(); // id réel -> axisId (pour les indicateurs)
  const chantierCodeFirstSeenAtRow = new Map<string, number>();

  sheets.chantiers.forEach((row, i) => {
    const rowNumber = i + 2;
    if (isRowEmpty(row)) return;

    const code = str(row["Code"]);
    if (!code) {
      errors.push({ sheet: "Chantiers", rowNumber, reason: `"Code" est obligatoire` });
      return;
    }
    const lowerCode = code.toLowerCase();
    if (chantierCodeFirstSeenAtRow.has(lowerCode)) {
      errors.push({
        sheet: "Chantiers",
        rowNumber,
        reason: `Code "${code}" en doublon dans le fichier (déjà utilisé ligne ${chantierCodeFirstSeenAtRow.get(lowerCode)})`,
      });
      return;
    }

    const axisCodeRaw = str(row["Code Axe"]);
    if (!axisCodeRaw) {
      errors.push({ sheet: "Chantiers", rowNumber, reason: `"Code Axe" est obligatoire` });
      return;
    }
    const axisId = resolveAxisCode(axisCodeRaw);
    if (!axisId) {
      errors.push({
        sheet: "Chantiers",
        rowNumber,
        reason: `Axe "${axisCodeRaw}" introuvable (ni dans la feuille Axes, ni en base)`,
      });
      return;
    }

    const name = str(row["Nom"]);
    if (!name) {
      errors.push({ sheet: "Chantiers", rowNumber, reason: `"Nom" est obligatoire` });
      return;
    }

    const stageRaw = str(row["Étape de maturité"]);
    const stage = stageRaw ? resolveStage(stageRaw, maturityStages) : undefined;
    if (!stage) {
      errors.push({
        sheet: "Chantiers",
        rowNumber,
        reason: `Étape de maturité "${stageRaw}" inconnue (attendu : ${stageNamesForError(maturityStages)})`,
      });
      return;
    }

    const id = makeId("CH");
    const chantier: Chantier = {
      id,
      companyId: resolvedCompanyId,
      programId: resolvedProgramId,
      axisId,
      name,
      stage,
      dependencies: [], // résolu en passe 2, une fois tous les Code de chantiers connus
      ...(str(row["Description"]) ? { description: str(row["Description"]) } : {}),
      createdAt: nowDate(),
      lastUpdate: nowDate(),
    };

    parsedChantiers.push({
      rowNumber,
      code,
      depsRaw: str(row["Dépendances (Code:type, séparées par ;)"]),
      chantier,
    });
    chantierIdByCode.set(lowerCode, id);
    chantierAxisById.set(id, axisId);
    chantierCodeFirstSeenAtRow.set(lowerCode, rowNumber);
  });

  const resolveChantierCode = (raw: string): string | undefined =>
    chantierIdByCode.get(raw.toLowerCase()) ??
    findExistingByCodeOrName(existingData.chantiers, raw)?.id;

  // ---------- Feuille "Chantiers" (passe 2 : dépendances, tous les Code sont maintenant connus) ----------
  const chantiersToCreate: Chantier[] = [];
  for (const p of parsedChantiers) {
    const { dependencies, unresolved } = parseDependencies(p.depsRaw, (code) =>
      resolveChantierCode(code)
    );
    if (unresolved.length > 0) {
      errors.push({
        sheet: "Chantiers",
        rowNumber: p.rowNumber,
        reason: `Dépendance(s) introuvable(s) : ${unresolved.join(", ")}`,
      });
      continue;
    }
    chantiersToCreate.push({ ...p.chantier, dependencies });
  }

  // ---------- Feuille "Actions" ----------
  type ParsedAction = { rowNumber: number; code: string; action: ChantierAction };
  const parsedActions: ParsedAction[] = [];
  const actionIdByCode = new Map<string, string>();
  const actionCodeFirstSeenAtRow = new Map<string, number>();

  sheets.actions.forEach((row, i) => {
    const rowNumber = i + 2;
    if (isRowEmpty(row)) return;

    const code = str(row["Code"]);
    if (!code) {
      errors.push({ sheet: "Actions", rowNumber, reason: `"Code" est obligatoire` });
      return;
    }
    const lowerCode = code.toLowerCase();
    if (actionCodeFirstSeenAtRow.has(lowerCode)) {
      errors.push({
        sheet: "Actions",
        rowNumber,
        reason: `Code "${code}" en doublon dans le fichier (déjà utilisé ligne ${actionCodeFirstSeenAtRow.get(lowerCode)})`,
      });
      return;
    }

    const chantierCodeRaw = str(row["Code Chantier"]);
    if (!chantierCodeRaw) {
      errors.push({ sheet: "Actions", rowNumber, reason: `"Code Chantier" est obligatoire` });
      return;
    }
    const chantierId = resolveChantierCode(chantierCodeRaw);
    if (!chantierId) {
      errors.push({
        sheet: "Actions",
        rowNumber,
        reason: `Chantier "${chantierCodeRaw}" introuvable (ni dans la feuille Chantiers, ni en base)`,
      });
      return;
    }

    const name = str(row["Nom"]);
    if (!name) {
      errors.push({ sheet: "Actions", rowNumber, reason: `"Nom" est obligatoire` });
      return;
    }

    const start = parseFlexibleDate(row["Date début"]);
    if (!start) {
      errors.push({
        sheet: "Actions",
        rowNumber,
        reason: `"Date début" obligatoire et doit être une date valide (JJ/MM/AAAA ou AAAA-MM-JJ)`,
      });
      return;
    }
    const end = parseFlexibleDate(row["Date fin"]);
    if (!end) {
      errors.push({
        sheet: "Actions",
        rowNumber,
        reason: `"Date fin" obligatoire et doit être une date valide (JJ/MM/AAAA ou AAAA-MM-JJ)`,
      });
      return;
    }

    const stageRaw = str(row["Étape de maturité"]);
    const status = stageRaw ? resolveStage(stageRaw, maturityStages) : undefined;
    if (!status) {
      errors.push({
        sheet: "Actions",
        rowNumber,
        reason: `Étape de maturité "${stageRaw}" inconnue (attendu : ${stageNamesForError(maturityStages)})`,
      });
      return;
    }

    const id = makeId("CA");
    const action: ChantierAction = {
      id,
      companyId: resolvedCompanyId,
      chantierId,
      name,
      start,
      end,
      status,
      ...(str(row["Description"]) ? { description: str(row["Description"]) } : {}),
      ...(str(row["Owner"]) ? { owner: str(row["Owner"]) } : {}),
      ...(str(row["Sponsor"]) ? { sponsor: str(row["Sponsor"]) } : {}),
    };

    parsedActions.push({ rowNumber, code, action });
    actionIdByCode.set(lowerCode, id);
    actionCodeFirstSeenAtRow.set(lowerCode, rowNumber);
  });

  // ---------- Feuille "Livrables" (optionnelle — embarquée dans l'action résolue, jamais un
  // toCreate séparé : une erreur sur une ligne Livrable n'invalide QUE ce livrable, jamais
  // l'action parente). Contrairement aux autres feuilles, la FK ne se replie PAS sur
  // `existingData.actions` : un livrable ne peut être rattaché qu'à une action CRÉÉE PAR CE MÊME
  // IMPORT (`toCreate.actions`), puisqu'il n'existe aucun chemin d'écriture pour greffer un
  // livrable sur une action déjà en base sans la recharger entièrement (hors scope v1, la
  // librairie reste pure et n'appelle jamais Firestore). ----------
  const deliverablesByActionCode = new Map<string, Deliverable[]>();

  sheets.livrables.forEach((row, i) => {
    const rowNumber = i + 2;
    if (isRowEmpty(row)) return;

    const actionCodeRaw = str(row["Code Action"]);
    if (!actionCodeRaw) {
      errors.push({ sheet: "Livrables", rowNumber, reason: `"Code Action" est obligatoire` });
      return;
    }
    const lowerActionCode = actionCodeRaw.toLowerCase();
    if (!actionIdByCode.has(lowerActionCode)) {
      errors.push({
        sheet: "Livrables",
        rowNumber,
        reason: `Action "${actionCodeRaw}" introuvable dans la feuille Actions de ce même fichier`,
      });
      return;
    }

    const label = str(row["Label"]);
    if (!label) {
      errors.push({ sheet: "Livrables", rowNumber, reason: `"Label" est obligatoire` });
      return;
    }

    const startRaw = str(row["Début"]);
    const endRaw = str(row["Fin"]);
    const phases: DeliverablePhase[] = [];
    if (startRaw || endRaw) {
      const start = parseFlexibleDate(startRaw);
      const end = parseFlexibleDate(endRaw);
      if (!start || !end) {
        errors.push({
          sheet: "Livrables",
          rowNumber,
          reason: `"Début"/"Fin" doivent être toutes les deux renseignées et valides (JJ/MM/AAAA ou AAAA-MM-JJ), ou toutes les deux vides`,
        });
        return;
      }
      phases.push({ id: makeId("DLP"), start, end });
    }

    const deliverable: Deliverable = { id: makeId("DL"), label, phases };
    const list = deliverablesByActionCode.get(lowerActionCode) ?? [];
    list.push(deliverable);
    deliverablesByActionCode.set(lowerActionCode, list);
  });

  const actionsToCreate: ChantierAction[] = parsedActions.map((p) => {
    const deliverables = deliverablesByActionCode.get(p.code.toLowerCase());
    return deliverables && deliverables.length > 0 ? { ...p.action, deliverables } : p.action;
  });

  // ---------- Feuille "Indicateurs" ----------
  const indicatorsToCreate: Indicator[] = [];

  sheets.indicateurs.forEach((row, i) => {
    const rowNumber = i + 2;
    if (isRowEmpty(row)) return;

    const axisCodeRaw = str(row["Code Axe"]);
    const chantierCodeRaw = str(row["Code Chantier"]);
    if (!axisCodeRaw && !chantierCodeRaw) {
      errors.push({
        sheet: "Indicateurs",
        rowNumber,
        reason: `"Code Axe" ou "Code Chantier" est obligatoire (exactement l'un des deux)`,
      });
      return;
    }
    if (axisCodeRaw && chantierCodeRaw) {
      errors.push({
        sheet: "Indicateurs",
        rowNumber,
        reason: `"Code Axe" et "Code Chantier" sont tous les deux renseignés — un indicateur ne peut être rattaché qu'à l'un des deux`,
      });
      return;
    }

    let axisId: string | undefined;
    let chantierId: string | undefined;
    if (chantierCodeRaw) {
      chantierId = resolveChantierCode(chantierCodeRaw);
      if (!chantierId) {
        errors.push({
          sheet: "Indicateurs",
          rowNumber,
          reason: `Chantier "${chantierCodeRaw}" introuvable (ni dans la feuille Chantiers, ni en base)`,
        });
        return;
      }
      axisId =
        chantierAxisById.get(chantierId) ??
        existingData.chantiers.find((c) => c.id === chantierId)?.axisId;
      if (!axisId) {
        errors.push({
          sheet: "Indicateurs",
          rowNumber,
          reason: `Impossible de déterminer l'axe du chantier "${chantierCodeRaw}"`,
        });
        return;
      }
    } else {
      axisId = resolveAxisCode(axisCodeRaw);
      if (!axisId) {
        errors.push({
          sheet: "Indicateurs",
          rowNumber,
          reason: `Axe "${axisCodeRaw}" introuvable (ni dans la feuille Axes, ni en base)`,
        });
        return;
      }
    }

    const name = str(row["Nom"]);
    if (!name) {
      errors.push({ sheet: "Indicateurs", rowNumber, reason: `"Nom" est obligatoire` });
      return;
    }

    const kindRaw = str(row["Type"]);
    const kind = resolveEnum(kindRaw, KIND_BY_LABEL, ["quantitative", "qualitative"]);
    if (!kind) {
      errors.push({
        sheet: "Indicateurs",
        rowNumber,
        reason: `Type "${kindRaw}" inconnu (attendu : ${Object.values(KIND_LABEL).join(", ")})`,
      });
      return;
    }

    const frequencyRaw = str(row["Fréquence"]);
    const frequency = resolveEnum(frequencyRaw, FREQUENCY_BY_LABEL, [
      "monthly",
      "quarterly",
      "semiannual",
      "annual",
    ]);
    if (!frequency) {
      errors.push({
        sheet: "Indicateurs",
        rowNumber,
        reason: `Fréquence "${frequencyRaw}" inconnue (attendu : ${Object.values(FREQUENCY_LABEL).join(", ")})`,
      });
      return;
    }

    const objective = str(row["Objectif"]);
    if (!objective) {
      errors.push({ sheet: "Indicateurs", rowNumber, reason: `"Objectif" est obligatoire` });
      return;
    }

    const rolesRaw = str(row["Rôles responsables (séparés par ;)"]);
    const roleTokens = rolesRaw
      .split(";")
      .map((r) => r.trim())
      .filter(Boolean);
    if (roleTokens.length === 0) {
      errors.push({
        sheet: "Indicateurs",
        rowNumber,
        reason: `"Rôles responsables" est obligatoire (au moins un rôle)`,
      });
      return;
    }
    const responsibleRoles: Role[] = [];
    let invalidRole: string | undefined;
    for (const token of roleTokens) {
      const role = ALL_ROLES.find((r) => r.toLowerCase() === token.toLowerCase());
      if (!role) {
        invalidRole = token;
        break;
      }
      responsibleRoles.push(role);
    }
    if (invalidRole) {
      errors.push({
        sheet: "Indicateurs",
        rowNumber,
        reason: `Rôle "${invalidRole}" inconnu (attendu : ${ALL_ROLES.join(", ")})`,
      });
      return;
    }

    const objectiveValue = numOrUndefined(row["Valeur cible"]);
    let direction: IndicatorDirection | undefined;
    if (objectiveValue !== undefined) {
      const directionRaw = str(row["Sens"]);
      direction = directionRaw
        ? resolveEnum(directionRaw, DIRECTION_BY_LABEL, ["up", "down"])
        : "up";
      if (!direction) {
        errors.push({
          sheet: "Indicateurs",
          rowNumber,
          reason: `Sens "${directionRaw}" inconnu (attendu : ${Object.values(DIRECTION_LABEL).join(", ")})`,
        });
        return;
      }
    }

    const indicator: Indicator = {
      id: makeId("IND"),
      companyId: resolvedCompanyId,
      programId: resolvedProgramId,
      axisId,
      ...(chantierId ? { chantierId } : {}),
      name,
      kind,
      frequency,
      objective,
      ...(objectiveValue !== undefined ? { objectiveValue, direction } : {}),
      ...(str(row["Unité"]) ? { unit: str(row["Unité"]) } : {}),
      responsibleRoles,
      // Un indicateur neuf n'a aucune mesure : "on_track" par construction, même convention que
      // `useStrategicData.createIndicator`.
      status: "on_track",
      createdAt: nowDate(),
      lastUpdate: nowDate(),
    };
    indicatorsToCreate.push(indicator);
  });

  return {
    toCreate: {
      axes: axesToCreate,
      chantiers: chantiersToCreate,
      actions: actionsToCreate,
      indicators: indicatorsToCreate,
    },
    errors,
  };
}

// ---------- Template Excel ----------

/** Bouché ici (plutôt que dans le composant bouton) pour rester testable sans DOM — même
 *  organisation que `lib/leverExcelImport.ts`, où seul le composant appelle `XLSX.writeFile`.
 *  Le composant `StrategicImportButton` importe `XLSX` lui-même et compose les feuilles avec ces
 *  en-têtes + exemples, exactement comme `LeverImportButton.downloadTemplate`. */
export const STRATEGIC_IMPORT_SHEET_NAMES = {
  axes: "Axes",
  chantiers: "Chantiers",
  actions: "Actions",
  livrables: "Livrables",
  indicateurs: "Indicateurs",
} as const;

export const STRATEGIC_AXIS_EXAMPLE_ROW = [
  "AX1",
  "Excellence opérationnelle",
  "Exemple — à remplacer ou supprimer avant import",
  "Marie Lefèvre",
  "#320300",
  "Planifié",
];

export const STRATEGIC_CHANTIER_EXAMPLE_ROWS = [
  ["CH1", "AX1", "Refonte du parcours achats", "Exemple", "Planifié", ""],
  ["CH2", "AX1", "Digitalisation des contrats", "Exemple", "Planifié", "CH1:FS"],
];

export const STRATEGIC_ACTION_EXAMPLE_ROW = [
  "ACT1",
  "CH1",
  "Cartographier le processus actuel",
  "Exemple",
  "Marc Dubois",
  "Isabelle Roy",
  "2026-01-15",
  "2026-03-31",
  "Planifié",
];

export const STRATEGIC_DELIVERABLE_EXAMPLE_ROW = [
  "ACT1",
  "Cartographie validée en comité",
  "2026-02-01",
  "2026-03-31",
];

export const STRATEGIC_INDICATOR_EXAMPLE_ROW = [
  "AX1",
  "",
  "Taux d'automatisation du processus achats",
  "Quantitatif",
  "Trimestrielle",
  "80% des demandes d'achat automatisées",
  80,
  "Plus haut vaut mieux",
  "%",
  "chantier_owner;strategic_lead",
];
