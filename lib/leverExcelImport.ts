import {
  DEFAULT_LIFECYCLE_STAGES,
  resolveStatusLabel,
  STATUS_LABEL,
  STATUS_SHORT_LABEL,
} from "@/lib/status-config";
import type {
  ActionImpact,
  ActionStatus,
  BeTrackData,
  DependencyType,
  Lever,
  LeverAction,
  LeverDependency,
  LeverStatus,
  LifecycleStage,
  RecognitionMode,
  SavingType,
  Workstream,
} from "@/types";

const WORKSTREAM_PALETTE = ["#C8102E", "#7B6B58", "#4A4A4A", "#8A9A5B", "#5B7A9A", "#9A7A5B"];

/** Slug stable et lisible à partir d'un nom de workstream (utilisé comme id lors d'une
 *  auto-création — voir plus bas). */
function slugifyWorkstreamName(name: string): string {
  return (
    "WS-" +
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
  );
}

/**
 * Import Excel des leviers + plan d'action + lignes d'impact, utilisé par `LeverImportButton` sur
 * la page Leviers. Complète `lib/leverExcel.ts` (export) — voir ce fichier pour le mapping inverse
 * (Lever -> ligne Excel).
 *
 * Format retenu : 3 feuilles, une ligne par entité (même logique ligne-par-ligne éprouvée par
 * `lib/hierarchyExcel.ts` pour l'arborescence et `lib/hrExcel.ts` pour la base ETP) :
 *  - "Leviers" : une ligne par levier. `Code` est la clé métier (obligatoire, unique) qui sert de
 *    FK aux deux autres feuilles — c'est aussi la clé utilisée pour décider CRÉATION (code inconnu
 *    en base) vs MISE À JOUR (code déjà existant, comportement le plus utile pour un ré-import
 *    itératif — voir `leversLogic.upsertLeverByCode`, déjà utilisé ailleurs dans l'app).
 *  - "Actions" : une ligne par action, rattachée à un levier via `Code Levier`.
 *  - "Impacts" : une ligne par ligne d'impact financier, rattachée à une action via
 *    (`Code Levier`, `Nom de l'action`) — la paire doit matcher exactement une action déclarée
 *    dans la feuille Actions du MÊME fichier (une ligne d'impact ne peut pas référencer une action
 *    déjà en base mais absente du fichier importé : voir note sur le remplacement des actions
 *    ci-dessous).
 *
 * Remplacement des actions d'un levier mis à jour : si le fichier contient au moins une ligne
 * Action pour un `Code Levier` donné, ces actions REMPLACENT intégralement le plan d'action
 * existant de ce levier (les impacts also inclus) — cohérent avec un import qui redéclare l'état
 * complet souhaité. Si le fichier ne contient AUCUNE ligne Action pour ce levier, son plan
 * d'action existant est conservé tel quel (l'import ne touche alors que les champs "en-tête" du
 * levier). Un levier nouvellement créé sans ligne Action associée démarre avec un plan vide.
 *
 * Validation toujours faite sur les 3 feuilles ENSEMBLE avant la moindre écriture (voir
 * `validateLeverImportRows`, sur le modèle de `validateHierarchyImportRows`) : l'aperçu retourné
 * liste les leviers prêts à créer/mettre à jour ET toutes les erreurs ligne par ligne (numéro +
 * raison), la confirmation n'écrit qu'après validation manuelle par l'utilisateur.
 *
 * Limitations connues :
 *  - Le fichier n'a pas de colonne dédiée pour `ActionImpact.label` (pas demandé dans le format) —
 *    il est dérivé automatiquement du nom de l'action + type + nature.
 *  - `Dépendances` référence des ids de levier (`L###`) déjà existants — un levier tout juste créé
 *    dans le MÊME import ne peut pas être ciblé par une dépendance (son id n'est alloué qu'à
 *    l'écriture) ; le type de dépendance est validé, mais pas l'existence de la cible (message
 *    d'erreur à l'utilisation, pas de blocage de l'import).
 */

// ---------- En-têtes (utilisés par le bouton "Template Excel" et par l'export potentiel) ----------

export const LEVER_IMPORT_HEADERS = [
  "Code",
  "Type de levier",
  "Nom du levier",
  "Workstream",
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

export const ACTION_IMPORT_HEADERS = [
  "Code Levier",
  "Nom de l'action",
  "Owner",
  "Date début",
  "Date fin",
  "Statut",
  "Coût (€K)",
] as const;

export const IMPACT_IMPORT_HEADERS = [
  "Code Levier",
  "Nom de l'action",
  "Type",
  "Nature",
  "Montant (€M)",
  "ETP",
  "Type de gain",
  "Date CAPEX",
  "Date gain",
  "Reconnaissance",
  "Poste de coût",
  "Centre de coût",
  "Entité P&L",
  "Commentaire",
] as const;

// ---------- Libellés humains <-> valeurs internes ----------

const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Terminé",
  delayed: "En retard",
};

const IMPACT_TYPE_LABEL: Record<ActionImpact["type"], string> = {
  cost: "Coût",
  saving: "Gain",
};

const IMPACT_NATURE_LABEL: Record<ActionImpact["nature"], string> = {
  capex: "CAPEX",
  opex_rec: "OPEX récurrent",
  oneoff: "One-off",
};

const SAVING_TYPE_LABEL: Record<SavingType, string> = {
  cost_reduction: "Réduction de coût",
  revenue_increase: "Augmentation du CA",
  working_capital: "Impact BFR",
};

const RECOGNITION_LABEL: Record<RecognitionMode, string> = {
  smoothing: "Lissé",
  one_shot: "One-shot",
};

const DEPENDENCY_TYPES: DependencyType[] = ["FS", "SS", "FF", "SF"];

function reverseLabelMap<T extends string>(map: Record<T, string>): Map<string, T> {
  const m = new Map<string, T>();
  (Object.keys(map) as T[]).forEach((key) => m.set(map[key].toLowerCase(), key));
  return m;
}

const ALL_STATUSES = Object.keys(STATUS_LABEL) as LeverStatus[];

/**
 * Libellés "Statut" acceptés à l'import. Le cycle de vie des leviers est configurable par
 * entreprise (`LifecycleStage[]`, éditable dans /admin/lifecycle et résolu via
 * `resolveStatusLabel`/`useLifecycleLabels`) : c'est CE référentiel — pas le seul `STATUS_LABEL`
 * statique — qui est réellement affiché à l'écran (Kanban, dropdown de statut du formulaire,
 * stepper du détail levier). `STATUS_LABEL` (libellés longs) reste néanmoins toujours accepté en
 * plus, pour rester compatible avec le template Excel et d'anciens fichiers déjà en circulation.
 * Sans config entreprise (`lifecycleStages` absent), le référentiel par défaut
 * (`DEFAULT_LIFECYCLE_STAGES`, libellés courts) est celui réellement affiché par défaut — voir
 * `lib/hooks/useLifecycleLabels.ts` — donc toujours inclus lui aussi, pour qu'un import ne
 * casse jamais simplement parce que l'utilisateur a tapé ce qu'il voit à l'écran plutôt que le
 * libellé historique. `STATUS_SHORT_LABEL` est ajouté pour la même raison (badges Kanban).
 */
function buildStatusByLabel(lifecycleStages?: LifecycleStage[]): Map<string, LeverStatus> {
  const m = new Map<string, LeverStatus>();
  ALL_STATUSES.forEach((status) => {
    m.set(STATUS_LABEL[status].toLowerCase(), status);
    m.set(STATUS_SHORT_LABEL[status].toLowerCase(), status);
    m.set(resolveStatusLabel(status, DEFAULT_LIFECYCLE_STAGES).toLowerCase(), status);
    if (lifecycleStages) {
      m.set(resolveStatusLabel(status, lifecycleStages).toLowerCase(), status);
    }
  });
  return m;
}

/** Libellés à afficher dans le message d'erreur : ceux réellement visibles à l'écran pour le
 *  cycle de vie actif (entreprise cible si connu, sinon référentiel par défaut) — plus utiles à
 *  l'utilisateur qu'un vocabulaire Excel historique qu'il ne voit jamais dans l'app. */
function activeStatusLabels(lifecycleStages?: LifecycleStage[]): string[] {
  return ALL_STATUSES.map((status) =>
    resolveStatusLabel(status, lifecycleStages ?? DEFAULT_LIFECYCLE_STAGES)
  );
}

const ACTION_STATUS_BY_LABEL = reverseLabelMap(ACTION_STATUS_LABEL);
const IMPACT_TYPE_BY_LABEL = reverseLabelMap(IMPACT_TYPE_LABEL);
const IMPACT_NATURE_BY_LABEL = reverseLabelMap(IMPACT_NATURE_LABEL);
const SAVING_TYPE_BY_LABEL = reverseLabelMap(SAVING_TYPE_LABEL);
const RECOGNITION_BY_LABEL = reverseLabelMap(RECOGNITION_LABEL);

// ---------- Parsing utilitaire (mêmes conventions que lib/hrExcel.ts) ----------

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function numOr(v: unknown, fallback: number): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function numOrUndefined(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => str(v) === "");
}

/** Accepte une date Excel native, une date sérielle Excel (nombre de jours depuis 1899-12-30), une
 *  chaîne ISO (`AAAA-MM-JJ`, déjà utilisée partout ailleurs dans l'app) ou une chaîne au format
 *  français `JJ/MM/AAAA` (demandé pour les feuilles Actions/Impacts). Retourne "" si non
 *  interprétable. */
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

function parseDependencies(raw: string): LeverDependency[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [targetIdRaw, typeRaw] = entry.split(":").map((s) => s.trim());
      const type: DependencyType = DEPENDENCY_TYPES.includes(typeRaw as DependencyType)
        ? (typeRaw as DependencyType)
        : "FS";
      return { targetId: targetIdRaw ?? "", type };
    })
    .filter((d) => d.targetId);
}

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Ids générés uniquement pour la durée de l'import — jamais réutilisés ni affichés tels quels à
 *  l'utilisateur, sur le modèle de `makeNodeId` dans lib/hierarchyExcel.ts. */
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
  const lower = raw.toLowerCase();
  return pnlAccounts.find((p) => p.id.toLowerCase() === lower || p.name.toLowerCase() === lower);
}

// ---------- Types publics ----------

export type LeverImportSheet = "Leviers" | "Actions" | "Impacts";

export type LeverImportError = {
  sheet: LeverImportSheet;
  rowNumber: number;
  reason: string;
};

/** Levier prêt à créer/mettre à jour — même forme que `leversLogic.createLever`/`upsertLeverByCode`
 *  attendent déjà, `actions` inclus (plan d'action complet, impacts compris). */
export type LeverImportRow = Omit<Lever, "id" | "createdAt" | "lastUpdate">;

export type LeverImportPreview = {
  toUpsert: LeverImportRow[];
  errors: LeverImportError[];
  createCount: number;
  updateCount: number;
  /** Workstreams référencés par la feuille "Leviers" mais absents de `data.workstreams` — aucune
   *  UI de gestion des workstreams n'existe aujourd'hui dans l'app (voir lib/firestore/
   *  programConfig.ts, doc-comment "aucune mutation dans l'UI aujourd'hui"), donc un import de
   *  leviers pour une entreprise flambant neuve ne pourrait jamais aboutir si on exigeait un
   *  workstream préexistant. Auto-créés ici (une couleur de palette leur est assignée en tournant)
   *  plutôt que de bloquer l'import — à persister par l'appelant (LeverImportButton) AVANT
   *  d'écrire les leviers eux-mêmes. Dédupliqués par nom (insensible à la casse). */
  toCreateWorkstreams: Workstream[];
};

export type LeverImportRawSheets = {
  leviers: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  impacts: Record<string, unknown>[];
};

/**
 * Valide les 3 feuilles ensemble et produit un aperçu (leviers prêts à créer/mettre à jour, avec
 * leur plan d'action complet déjà attaché + erreurs ligne par ligne) sans rien écrire — mêmes
 * conventions que `validateHierarchyImportRows`/`parseEmployeeRow` (aperçu avant confirmation).
 */
export function validateLeverImportRows(
  sheets: LeverImportRawSheets,
  data: Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">,
  companyId: string | null | undefined,
  /** Programmes existants de l'entreprise, pour résoudre la colonne optionnelle "Programme" (par
   *  nom ou id, insensible à la casse). Contrairement au Workstream, un Programme non trouvé est
   *  une ERREUR de ligne plutôt qu'une auto-création : un Programme porte une ambition/sponsor/
   *  dates propres qu'un import de leviers n'a pas vocation à définir — il doit déjà exister (créé
   *  dans Admin > Entreprises > Programmes). Colonne vide = levier non rattaché (comportement
   *  historique, modifiable ensuite manuellement dans la fiche du levier). */
  programs: { id: string; name: string }[] = [],
  /** Référentiel de cycle de vie ACTIF de l'entreprise cible (voir `subscribeLifecycleConfig` /
   *  `useLifecycleLabels`), quand l'appelant le connaît — ses libellés personnalisés sont alors
   *  acceptés en plus des libellés par défaut. Absent = référentiel par défaut uniquement (déjà
   *  celui réellement affiché pour toute entreprise sans personnalisation, voir
   *  `buildStatusByLabel` ci-dessus). */
  lifecycleStages?: LifecycleStage[]
): LeverImportPreview {
  const errors: LeverImportError[] = [];
  const resolvedCompanyId = companyId ?? null;
  const STATUS_BY_LABEL = buildStatusByLabel(lifecycleStages);

  // ---------- Feuille "Leviers" ----------
  type ParsedLever = { rowNumber: number; code: string; values: LeverImportRow };
  const parsedLevers: ParsedLever[] = [];
  const codeFirstSeenAtRow = new Map<string, number>();
  const newWorkstreamsByName = new Map<string, Workstream>();

  sheets.leviers.forEach((row, i) => {
    const rowNumber = i + 2; // ligne 1 = en-têtes
    if (isRowEmpty(row)) return;

    const code = str(row["Code"]);
    const name = str(row["Nom du levier"]);
    if (!code) {
      errors.push({ sheet: "Leviers", rowNumber, reason: `"Code" est obligatoire` });
      return;
    }
    if (!name) {
      errors.push({ sheet: "Leviers", rowNumber, reason: `"Nom du levier" est obligatoire` });
      return;
    }

    const lowerCode = code.toLowerCase();
    if (codeFirstSeenAtRow.has(lowerCode)) {
      errors.push({
        sheet: "Leviers",
        rowNumber,
        reason: `Code "${code}" en doublon dans le fichier (déjà utilisé ligne ${codeFirstSeenAtRow.get(lowerCode)})`,
      });
      return;
    }

    const wsRaw = str(row["Workstream"]);
    if (!wsRaw) {
      errors.push({ sheet: "Leviers", rowNumber, reason: `"Workstream" est obligatoire` });
      return;
    }
    let ws =
      data.workstreams.find(
        (w) =>
          w.id.toLowerCase() === wsRaw.toLowerCase() || w.name.toLowerCase() === wsRaw.toLowerCase()
      ) ?? newWorkstreamsByName.get(wsRaw.toLowerCase());
    if (!ws) {
      // Aucune UI ne permet aujourd'hui de créer des workstreams pour une entreprise (voir
      // doc-comment de LeverImportPreview.toCreateWorkstreams) — on en crée un à la volée plutôt
      // que de bloquer l'import d'une entreprise qui n'en a pas encore.
      ws = {
        id: slugifyWorkstreamName(wsRaw),
        name: wsRaw,
        sponsor: str(row["Sponsor"]) || "À définir",
        color: WORKSTREAM_PALETTE[newWorkstreamsByName.size % WORKSTREAM_PALETTE.length],
        target: 0,
      };
      newWorkstreamsByName.set(wsRaw.toLowerCase(), ws);
    }

    const statusRaw = str(row["Statut"]);
    const status: LeverStatus | undefined = STATUS_BY_LABEL.get(statusRaw.toLowerCase());
    if (!status) {
      errors.push({
        sheet: "Leviers",
        rowNumber,
        reason: `Statut "${statusRaw}" inconnu (attendu : ${activeStatusLabels(lifecycleStages).join(", ")})`,
      });
      return;
    }

    const pnlRaw = str(row["Compte P&L impacté"]);
    const pnl = resolvePnlAccount(data.pnlAccounts, pnlRaw);
    if (!pnl) {
      errors.push({
        sheet: "Leviers",
        rowNumber,
        reason: `Compte P&L "${pnlRaw}" introuvable (attendu : ${data.pnlAccounts.map((p) => p.id).join(", ")})`,
      });
      return;
    }

    const start = parseFlexibleDate(row["Date de départ"]);
    if (!start) {
      errors.push({
        sheet: "Leviers",
        rowNumber,
        reason: `"Date de départ" obligatoire et doit être une date valide (JJ/MM/AAAA ou AAAA-MM-JJ)`,
      });
      return;
    }
    const end = parseFlexibleDate(row["Date de fin estimée"]);
    if (!end) {
      errors.push({
        sheet: "Leviers",
        rowNumber,
        reason: `"Date de fin estimée" obligatoire et doit être une date valide (JJ/MM/AAAA ou AAAA-MM-JJ)`,
      });
      return;
    }

    const programRaw = str(row["Programme"]);
    let programId: string | undefined;
    if (programRaw) {
      const program = programs.find(
        (p) =>
          p.id.toLowerCase() === programRaw.toLowerCase() ||
          p.name.toLowerCase() === programRaw.toLowerCase()
      );
      if (!program) {
        errors.push({
          sheet: "Leviers",
          rowNumber,
          reason: `Programme "${programRaw}" introuvable (attendu : ${programs.map((p) => p.name).join(", ") || "aucun programme créé pour cette entreprise — créez-le dans Admin > Entreprises > Programmes"})`,
        });
        return;
      }
      programId = program.id;
    }

    const values: LeverImportRow = {
      code,
      type: str(row["Type de levier"]),
      name,
      ws: ws.id,
      programId,
      owner: str(row["Owner"]),
      ownerInit: str(row["Owner (initiales)"]),
      sponsor: str(row["Sponsor"]),
      sponsorInit: str(row["Sponsor (initiales)"]),
      geography: str(row["Géographie"]),
      country: str(row["Pays"]),
      entity: str(row["Entité"]),
      function: str(row["Fonction"]),
      costCenter: str(row["Centre de coût"]),
      pnlMap: pnl.id,
      start,
      end,
      status,
      progress: clamp(numOr(row["Progression (%)"], 0), 0, 100),
      risk: "low", // recalculé automatiquement à l'affichage (engine.computeLeverRisk) — valeur de repli
      grossSavings: numOr(row["Impact estimé brut (€M)"], 0),
      netSavings: numOr(row["Impact estimé net (€M)"], 0),
      opexOneOff: numOr(row["OPEX one-off (€M)"], 0),
      opexRec: numOr(row["OPEX récurrent (€M/an)"], 0),
      capex: numOr(row["CAPEX (€M)"], 0),
      fteImpact: numOr(row["Impact estimé (ETP)"], 0),
      popImpacted: numOr(row["Population impactée"], 0),
      companyId: resolvedCompanyId,
      dependencies: parseDependencies(str(row["Dépendances (ID:type, séparées par ;)"])),
      description: str(row["Description"]),
      actions: [],
    };

    parsedLevers.push({ rowNumber, code, values });
    codeFirstSeenAtRow.set(lowerCode, rowNumber);
  });

  const leverCodesInFile = new Set(parsedLevers.map((p) => p.code.toLowerCase()));
  const existingByCode = new Map(data.levers.map((l) => [l.code.toLowerCase(), l]));

  // ---------- Feuille "Actions" ----------
  type ParsedAction = { rowNumber: number; action: LeverAction };
  const actionsByLeverCode = new Map<string, ParsedAction[]>();
  let actionSeq = 0;

  sheets.actions.forEach((row, i) => {
    const rowNumber = i + 2;
    if (isRowEmpty(row)) return;

    const leverCodeRaw = str(row["Code Levier"]);
    if (!leverCodeRaw) {
      errors.push({ sheet: "Actions", rowNumber, reason: `"Code Levier" est obligatoire` });
      return;
    }
    const lowerLeverCode = leverCodeRaw.toLowerCase();
    if (!leverCodesInFile.has(lowerLeverCode) && !existingByCode.has(lowerLeverCode)) {
      errors.push({
        sheet: "Actions",
        rowNumber,
        reason: `Levier "${leverCodeRaw}" introuvable (ni dans la feuille Leviers, ni en base)`,
      });
      return;
    }

    const name = str(row["Nom de l'action"]);
    if (!name) {
      errors.push({ sheet: "Actions", rowNumber, reason: `"Nom de l'action" est obligatoire` });
      return;
    }

    const statusRaw = str(row["Statut"]);
    const status = ACTION_STATUS_BY_LABEL.get(statusRaw.toLowerCase());
    if (!status) {
      errors.push({
        sheet: "Actions",
        rowNumber,
        reason: `Statut "${statusRaw}" inconnu (attendu : ${Object.values(ACTION_STATUS_LABEL).join(", ")})`,
      });
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

    actionSeq += 1;
    const action: LeverAction = {
      id: makeActionId(actionSeq),
      name,
      owner: str(row["Owner"]) || undefined,
      start,
      end,
      cost: numOr(row["Coût (€K)"], 0),
      status,
      impacts: [],
    };

    const list = actionsByLeverCode.get(lowerLeverCode) ?? [];
    list.push({ rowNumber, action });
    actionsByLeverCode.set(lowerLeverCode, list);
  });

  // ---------- Feuille "Impacts" ----------
  let impactSeq = 0;

  sheets.impacts.forEach((row, i) => {
    const rowNumber = i + 2;
    if (isRowEmpty(row)) return;

    const leverCodeRaw = str(row["Code Levier"]);
    if (!leverCodeRaw) {
      errors.push({ sheet: "Impacts", rowNumber, reason: `"Code Levier" est obligatoire` });
      return;
    }
    const lowerLeverCode = leverCodeRaw.toLowerCase();
    const actionNameRaw = str(row["Nom de l'action"]);
    if (!actionNameRaw) {
      errors.push({ sheet: "Impacts", rowNumber, reason: `"Nom de l'action" est obligatoire` });
      return;
    }

    const actionsForLever = actionsByLeverCode.get(lowerLeverCode) ?? [];
    const matched = actionsForLever.find(
      (a) => a.action.name.toLowerCase() === actionNameRaw.toLowerCase()
    );
    if (!matched) {
      errors.push({
        sheet: "Impacts",
        rowNumber,
        reason: `Action "${actionNameRaw}" introuvable pour le levier "${leverCodeRaw}" (doit être déclarée dans la feuille Actions du même fichier)`,
      });
      return;
    }

    const typeRaw = str(row["Type"]);
    const type = IMPACT_TYPE_BY_LABEL.get(typeRaw.toLowerCase());
    if (!type) {
      errors.push({
        sheet: "Impacts",
        rowNumber,
        reason: `Type "${typeRaw}" inconnu (attendu : ${Object.values(IMPACT_TYPE_LABEL).join(", ")})`,
      });
      return;
    }

    const natureRaw = str(row["Nature"]);
    let nature = natureRaw ? IMPACT_NATURE_BY_LABEL.get(natureRaw.toLowerCase()) : undefined;
    // Obligatoire pour type="Coût" (détermine le classement CAPEX/OPEX). Pour type="Gain", la
    // colonne est ignorée côté métier mais reste validée si renseignée (sinon repli "oneoff" —
    // le champ n'est pas optionnel dans ActionImpact).
    const natureRequired = type === "cost";
    if ((natureRequired || natureRaw) && !nature) {
      errors.push({
        sheet: "Impacts",
        rowNumber,
        reason: `Nature "${natureRaw}" inconnue (attendu : ${Object.values(IMPACT_NATURE_LABEL).join(", ")})`,
      });
      return;
    }
    if (!nature) nature = "oneoff";

    const amount = numOr(row["Montant (€M)"], NaN);
    if (Number.isNaN(amount)) {
      errors.push({ sheet: "Impacts", rowNumber, reason: `"Montant (€M)" doit être un nombre` });
      return;
    }

    const savingTypeRaw = str(row["Type de gain"]);
    let savingType: SavingType | undefined;
    if (savingTypeRaw) {
      savingType = SAVING_TYPE_BY_LABEL.get(savingTypeRaw.toLowerCase());
      if (!savingType) {
        errors.push({
          sheet: "Impacts",
          rowNumber,
          reason: `Type de gain "${savingTypeRaw}" inconnu (attendu : ${Object.values(SAVING_TYPE_LABEL).join(", ")})`,
        });
        return;
      }
    }

    const capexDateRaw = str(row["Date CAPEX"]);
    let capexDeploymentDate: string | undefined;
    if (capexDateRaw) {
      capexDeploymentDate = parseFlexibleDate(capexDateRaw) || undefined;
      if (!capexDeploymentDate) {
        errors.push({
          sheet: "Impacts",
          rowNumber,
          reason: `"Date CAPEX" invalide (attendu JJ/MM/AAAA)`,
        });
        return;
      }
    }

    const gainDateRaw = str(row["Date gain"]);
    let gainDate: string | undefined;
    if (gainDateRaw) {
      gainDate = parseFlexibleDate(gainDateRaw) || undefined;
      if (!gainDate) {
        errors.push({
          sheet: "Impacts",
          rowNumber,
          reason: `"Date gain" invalide (attendu JJ/MM/AAAA)`,
        });
        return;
      }
    }

    const recognitionRaw = str(row["Reconnaissance"]);
    let recognition: RecognitionMode | undefined;
    if (recognitionRaw) {
      recognition = RECOGNITION_BY_LABEL.get(recognitionRaw.toLowerCase());
      if (!recognition) {
        errors.push({
          sheet: "Impacts",
          rowNumber,
          reason: `Reconnaissance "${recognitionRaw}" inconnue (attendu : ${Object.values(RECOGNITION_LABEL).join(", ")})`,
        });
        return;
      }
    }

    const pnlRaw = str(row["Poste de coût"]);
    let pnlMap: string | undefined;
    if (pnlRaw) {
      const pnl = resolvePnlAccount(data.pnlAccounts, pnlRaw);
      if (!pnl) {
        errors.push({
          sheet: "Impacts",
          rowNumber,
          reason: `Poste de coût "${pnlRaw}" introuvable (attendu : ${data.pnlAccounts.map((p) => p.id).join(", ")})`,
        });
        return;
      }
      pnlMap = pnl.id;
    }

    const comment = str(row["Commentaire"]);

    impactSeq += 1;
    const impact: ActionImpact = {
      id: makeImpactId(impactSeq),
      label: `${matched.action.name} — ${IMPACT_TYPE_LABEL[type]} (${IMPACT_NATURE_LABEL[nature]})`,
      type,
      nature,
      amount,
      fteCount: numOrUndefined(row["ETP"]),
      pnlMap,
      costCenter: str(row["Centre de coût"]) || undefined,
      entity: str(row["Entité P&L"]) || undefined,
      savingType,
      capexDeploymentDate,
      gainDate,
      recognition,
      comments: comment ? [{ user: "Import Excel", ts: nowDate(), text: comment }] : undefined,
    };

    matched.action.impacts = [...(matched.action.impacts ?? []), impact];
  });

  // ---------- Assemblage final : chaque levier reçoit son plan d'action ----------
  const toUpsert: LeverImportRow[] = [];
  let createCount = 0;
  let updateCount = 0;

  for (const p of parsedLevers) {
    const lowerCode = p.code.toLowerCase();
    const declaredActions = (actionsByLeverCode.get(lowerCode) ?? []).map((a) => a.action);
    const existing = existingByCode.get(lowerCode);
    const actions = declaredActions.length > 0 ? declaredActions : (existing?.actions ?? []);
    toUpsert.push({ ...p.values, risk: existing?.risk ?? "low", actions });
    if (existing) updateCount++;
    else createCount++;
  }

  return {
    toUpsert,
    errors,
    createCount,
    updateCount,
    toCreateWorkstreams: Array.from(newWorkstreamsByName.values()),
  };
}
