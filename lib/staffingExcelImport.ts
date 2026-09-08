import type { Chantier, ChantierAction, ChantierStaffing } from "@/types";

/**
 * Import Excel des lignes de staffing (`ChantierStaffing`) d'un programme — utilisé par
 * `StaffingImportButton`, mirror structurel de `lib/strategicExcelImport.ts` (même idiome
 * `validate*Rows` -> aperçu + erreurs ligne par ligne, même conventions de parsing/dates, aucun
 * appel Firestore dans ce fichier — l'écriture reste à la charge de l'appelant, voir plus bas).
 *
 * Format retenu : UNE feuille, une ligne par entrée de staffing — colonnes Chantier / Fonction /
 * ETP / Date début / Date fin / Levier (optionnel) / Note (optionnel). `Chantier` et `Levier` sont
 * résolus par NOM exact (insensible à la casse) contre les listes passées par l'appelant
 * (`chantiers`/`chantierActions`, déjà scopées au programme actif) — contrairement à
 * `lib/strategicExcelImport.ts`, il n'y a pas de colonne "Code" : le staffing s'importe dans un
 * plan déjà construit (axes/chantiers/leviers déjà créés), une clé technique séparée n'apporterait
 * rien.
 *
 * **Upsert, pas création systématique** (décision actée avec le PO, voir le plan round 7,
 * section « Effectifs ») : `saveChantierStaffing` (lib/firestore/chantierStaffing.ts) fait déjà un
 * upsert par id (`setDoc` sur `entry.id`), donc pas de nouvelle fonction Firestore nécessaire — la
 * seule question est QUEL id écrire. On calcule une clé métier par ligne
 * (`chantierId + fonction + dateDébut + dateFin + levier optionnel`) et on la compare :
 *  - aux entrées DÉJÀ EN BASE (`existingStaffing`, passées par l'appelant) ;
 *  - aux lignes DÉJÀ TRAITÉES plus haut dans CE MÊME fichier (deux lignes qui décrivent la même
 *    période/fonction/levier dans le fichier importé doivent fusionner sur UNE entrée, pas se
 *    dupliquer entre elles).
 * Une clé qui matche réutilise l'id (et le `createdAt`) de l'entrée trouvée — l'entrée résultante
 * est une MISE À JOUR ; sinon un nouvel id est alloué — c'est une CRÉATION. Plus simple et plus sûr
 * qu'un couple suppression+recréation (pas de fenêtre où la ligne n'existe plus).
 */

// ---------- En-têtes (utilisés par le bouton "Modèle Excel") ----------

export const STAFFING_IMPORT_SHEET_NAME = "ETP";

export const STAFFING_IMPORT_HEADERS = [
  "Chantier",
  "Fonction",
  "ETP",
  "Date début",
  "Date fin",
  "Levier",
  "Note",
] as const;

// Round 13 : la colonne "Fonction" doit désormais matcher le nom EXACT d'une équipe de la base ETP
// entreprise (`Employee.department`, `/hr/etp`) — plus une union fermée à 9 valeurs. Les libellés
// d'exemple ci-dessous sont volontairement génériques (pas garantis d'exister dans une base ETP
// réelle) : la note "à remplacer avant import" le précise explicitement sur la 1re ligne.
export const STAFFING_IMPORT_EXAMPLE_ROWS: (string | number)[][] = [
  [
    "Refonte du parcours achats",
    "Support (IT/Finance/HR)",
    1,
    "2026-01-01",
    "2026-06-30",
    "",
    'Exemple — remplacer "Fonction" par le nom exact d\'une équipe de votre base ETP (/hr/etp)',
  ],
  [
    "Refonte du parcours achats",
    "Support (IT/Finance/HR)",
    0.5,
    "2026-01-01",
    "",
    "Cartographier le processus actuel",
    "",
  ],
];

// ---------- Référentiel équipe (round 13 : base ETP entreprise, plus de 9 valeurs figées) --------

/** Résout la cellule "Fonction" contre la liste des équipes RÉELLES de la base ETP entreprise
 *  (`Employee.department`, passée par l'appelant — voir `validateStaffingImportRows`), insensible
 *  à la casse/aux espaces. Remplace l'ancienne résolution contre `StaffingFunction` (union fermée à
 *  9 valeurs, retirée de `types/index.ts`) : la liste d'équipes n'est plus figée dans ce fichier,
 *  elle vient de la base ETP de l'entreprise important le fichier. Renvoie le nom CANONIQUE tel que
 *  stocké dans la base ETP (pas la casse saisie dans le fichier) pour que les agrégats par équipe
 *  ne se fragmentent jamais sur une différence de casse. */
function resolveFunction(raw: string, knownDepartments: string[]): string | undefined {
  const lower = raw.trim().toLowerCase();
  return knownDepartments.find((d) => d.toLowerCase() === lower);
}

function functionNamesForError(knownDepartments: string[]): string {
  return knownDepartments.length > 0
    ? knownDepartments.join(", ")
    : "aucune équipe dans la base ETP";
}

// ---------- Parsing utilitaire (mêmes conventions que lib/strategicExcelImport.ts) ----------

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function isRowEmpty(row: Record<string, unknown>): boolean {
  return Object.values(row).every((v) => str(v) === "");
}

/** Tolérant à la virgule décimale (saisie française), comme `parseFte` de
 *  `ChantierStaffingEditor.tsx` — dupliqué ici pour la même raison d'autonomie que les autres
 *  helpers de ce fichier. `undefined` = invalide (vide compris, ou ≤ 0) : un ETP doit être
 *  strictement positif. */
function parseFteCell(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const parsed = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Identique à `parseFlexibleDate` de `lib/strategicExcelImport.ts` (dupliquée, même motif) —
 *  accepte une date Excel native, une date sérielle Excel, une chaîne ISO ou JJ/MM/AAAA. Retourne
 *  "" si vide ou non interprétable : contrairement aux dates de `lib/strategicExcelImport.ts`
 *  (obligatoires), les dates de staffing sont OPTIONNELLES (voir `ChantierStaffing.startDate`),
 *  donc une cellule vide n'est jamais une erreur ici.
 */
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

let idSeq = 0;
/** Id alloué pour de vrai (comme `makeId` de `lib/strategicExcelImport.ts`), pas un id de session
 *  jetable : c'est cet id qui sera écrit tel quel par `saveChantierStaffing`, via l'appelant.
 *  Compteur de séquence par appel pour garantir l'unicité même si plusieurs lignes du même fichier
 *  sont traitées dans la même milliseconde. Même préfixe "ST" que `newStaffingId()` de
 *  `ChantierStaffingEditor.tsx`. */
function makeStaffingId(): string {
  idSeq += 1;
  return `ST-${Date.now().toString(36)}-${idSeq}-${Math.random().toString(36).slice(2, 6)}`;
}

function resolveChantier(raw: string, chantiers: Chantier[]): Chantier | undefined {
  const lower = raw.trim().toLowerCase();
  return chantiers.find((c) => c.name.toLowerCase() === lower);
}

function resolveAction(
  raw: string,
  chantierId: string,
  chantierActions: ChantierAction[]
): ChantierAction | undefined {
  const lower = raw.trim().toLowerCase();
  return chantierActions.find((a) => a.chantierId === chantierId && a.name.toLowerCase() === lower);
}

/** Clé métier d'upsert — voir doc-comment en tête de fichier. Chaîne simple (jointure par "|") :
 *  aucun des composants ne peut contenir "|" (noms de fonction/dates ISO/ids), pas besoin d'un
 *  échappement plus robuste. */
function staffingMatchKey(
  chantierId: string,
  fn: string,
  startDate: string,
  endDate: string,
  actionId: string | undefined
): string {
  return [chantierId, fn, startDate, endDate, actionId ?? ""].join("|");
}

// ---------- Types publics ----------

export type StaffingImportError = { rowNumber: number; reason: string };

export type StaffingImportRow = {
  rowNumber: number;
  entry: ChantierStaffing;
  /** true = une entrée existante (même clé métier) a été trouvée, `entry.id` la réutilise —
   *  false = nouvelle entrée, `entry.id` est fraîchement alloué. */
  isUpdate: boolean;
};

export type StaffingImportPreview = {
  rows: StaffingImportRow[];
  errors: StaffingImportError[];
};

/**
 * Valide les lignes brutes de la feuille "ETP" et produit un aperçu (lignes prêtes à écrire,
 * classées création/mise à jour, + erreurs ligne par ligne) sans rien écrire — voir doc-comment en
 * tête de fichier pour le format complet et la logique d'upsert.
 */
export function validateStaffingImportRows(
  rawRows: Record<string, unknown>[],
  companyId: string | null | undefined,
  programId: string | null | undefined,
  chantiers: Chantier[],
  chantierActions: ChantierAction[],
  existingStaffing: ChantierStaffing[],
  /** Noms d'équipe réels de la base ETP entreprise (round 13) — la colonne "Fonction" doit
   *  matcher l'un de ces noms, voir `resolveFunction` ci-dessus. */
  knownDepartments: string[]
): StaffingImportPreview {
  const errors: StaffingImportError[] = [];
  const rows: StaffingImportRow[] = [];
  const resolvedCompanyId = companyId ?? "";
  const resolvedProgramId = programId ?? "";

  const existingByKey = new Map<string, ChantierStaffing>();
  for (const entry of existingStaffing) {
    existingByKey.set(
      staffingMatchKey(
        entry.chantierId,
        entry.function,
        entry.startDate ?? "",
        entry.endDate ?? "",
        entry.actionId
      ),
      entry
    );
  }
  // Deux lignes du MÊME fichier qui partagent la même clé doivent fusionner sur une seule entrée
  // (la 2e met à jour ce que la 1re vient de créer/matcher), pas se dupliquer entre elles.
  const seenInBatch = new Map<string, ChantierStaffing>();

  rawRows.forEach((row, i) => {
    const rowNumber = i + 2; // ligne 1 = en-têtes
    if (isRowEmpty(row)) return;

    const chantierRaw = str(row["Chantier"]);
    if (!chantierRaw) {
      errors.push({ rowNumber, reason: `"Chantier" est obligatoire` });
      return;
    }
    const chantier = resolveChantier(chantierRaw, chantiers);
    if (!chantier) {
      errors.push({ rowNumber, reason: `Chantier "${chantierRaw}" introuvable` });
      return;
    }

    const functionRaw = str(row["Fonction"]);
    const fn = functionRaw ? resolveFunction(functionRaw, knownDepartments) : undefined;
    if (!fn) {
      errors.push({
        rowNumber,
        reason: `Fonction "${functionRaw}" inconnue (attendu : ${functionNamesForError(knownDepartments)})`,
      });
      return;
    }

    const fte = parseFteCell(row["ETP"]);
    if (fte === undefined) {
      errors.push({ rowNumber, reason: `"ETP" doit être un nombre strictement positif` });
      return;
    }

    const startDate = parseFlexibleDate(row["Date début"]);
    const endDate = parseFlexibleDate(row["Date fin"]);

    const actionRaw = str(row["Levier"]);
    let actionId: string | undefined;
    if (actionRaw) {
      const action = resolveAction(actionRaw, chantier.id, chantierActions);
      if (!action) {
        errors.push({
          rowNumber,
          reason: `Levier "${actionRaw}" introuvable sur le chantier "${chantier.name}"`,
        });
        return;
      }
      actionId = action.id;
    }

    const note = str(row["Note"]);

    const key = staffingMatchKey(chantier.id, fn, startDate, endDate, actionId);
    const matched = seenInBatch.get(key) ?? existingByKey.get(key);

    const entry: ChantierStaffing = {
      id: matched?.id ?? makeStaffingId(),
      companyId: resolvedCompanyId,
      programId: resolvedProgramId,
      axisId: chantier.axisId,
      chantierId: chantier.id,
      function: fn,
      fte,
      ...(note !== "" ? { note } : {}),
      ...(startDate !== "" ? { startDate } : {}),
      ...(endDate !== "" ? { endDate } : {}),
      ...(actionId ? { actionId } : {}),
      createdAt: matched?.createdAt ?? nowDate(),
    };

    rows.push({ rowNumber, entry, isUpdate: matched !== undefined });
    seenInBatch.set(key, entry);
  });

  return { rows, errors };
}
