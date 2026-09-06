import { doc, getDoc, onSnapshot, setDoc, writeBatch, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import type { Department, Employee, WorkforceDimensionBaseline, WorkforceMovement } from "@/types";

/**
 * Couche Firestore pour le périmètre "workforce" (base ETP + mouvements + méta départements) :
 * comme les leviers, c'est une donnée partagée en temps réel — le RH valide des mouvements que
 * les lever owners doivent voir (et réciproquement, un levier en retard doit alerter le RH).
 *
 * Stockage en TROIS DOCUMENTS sous `leverMeta/` (déjà autorisé par les règles Firestore
 * déployées — les nouvelles collections racine seraient refusées tant que les règles ne sont pas
 * redéployées, ce qui demande un accès Firebase CLI que l'équipe n'a pas toujours sous la main).
 * À ~160 employés / ~50 mouvements, un doc par liste (≈50 Ko) reste très loin de la limite de
 * 1 Mo et divise les lectures par 200 par rapport à une collection.
 */

// Incrémenter force un reseed complet du périmètre workforce (schéma modifié).
// v2 (Août 2026) : migration typologie 4-types → 5-types Gooduelle. Les données seedées
// avant ce bump portent encore Suppression / Redéploiement / Reconversion, qui ne matchent
// plus lib/hrEngine.ts::fteEffect (retour undefined → NaN partout dans le dashboard RH).
// Le bump force ensureWorkforceSeeded à réécrire les 3 documents workforce depuis mockData.ts.
// v3 (Août 2026) : alignement WorkforceMovement.programId sur la collection Firestore
// multi-programmes (`programs`) — ancien "PRG-2026" (id de `ProgramConfig`) remplacé par "p1"
// (id de `TEST_PROGRAM`). Redistribution des dates mouvements sur 2026-2028 pour peupler le
// sélecteur FY et éviter des sous-catégories vides. Voir data/mockData.ts::nextYearMonth.
// v4 (Août 2026) : ajout du dispositif social (PSE/RC/RCC/PDV/Autre) et alignement des
// workstream IDs des mouvements sur le référentiel réel des initiatives (WS-PROC, WS-OPS…).
// v5 (Août 2026) : ajout des baselines ETP pays/workstream dans WorkforceMeta pour alimenter
// les vues actuel/cible/atterrissage sans extrapoler depuis l'échantillon d'employés détaillés.
// v6 (Août 2026) : statut mouvement migré vers Réalisé/Planifié/À faire/Abandonné. Les anciens
// "En cours" sont reseedés en "À faire" et quelques abandons sont conservés hors prévisions.
const SCHEMA_VERSION = "6";

/** Documents `leverMeta/{companyId}__{workforceEmployees|workforceMovements|workforceSummary}` —
 * partitionnés par entreprise (voir firestore.rules, section `match /leverMeta/{docId}`, et
 * scripts/migrate-lever-meta-tenant-split.js pour la migration depuis les anciens documents
 * mutualisés qui mélangeaient les effectifs/mouvements de TOUTES les entreprises). */
const employeesDoc = (companyId: string) =>
  doc(db, "leverMeta", `${companyId}__workforceEmployees`);
const movementsDoc = (companyId: string) =>
  doc(db, "leverMeta", `${companyId}__workforceMovements`);
const summaryDoc = (companyId: string) => doc(db, "leverMeta", `${companyId}__workforceSummary`);
const metaDoc = () => doc(db, "meta", "workforce");

export type WorkforceMeta = {
  totalFTE: number;
  massSalary: number; // €M
  budgetSalary: number; // €M
  departments: Department[];
  countryBaselines: WorkforceDimensionBaseline[];
  workstreamBaselines: WorkforceDimensionBaseline[];
};

/** Firestore refuse `undefined` (champs optionnels comme toDepartment/comment) — on les retire
 * du payload avant écriture (JSON round-trip : suffisant pour ces objets purs). */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** `companyId` null/undefined = admin global : plus d'équivalent "toutes entreprises confondues"
 *  pour un document désormais partitionné par entreprise (voir firestore.rules) — l'appelant
 *  reçoit une liste vide plutôt qu'une erreur ou une fuite de données entre entreprises. Un admin
 *  global qui veut un total multi-entreprises doit itérer sur la liste des entreprises et agréger
 *  côté client (voir app/(app)/admin/data/page.tsx). */
export function subscribeEmployees(
  cb: (employees: Employee[]) => void,
  companyId?: string | null
): Unsubscribe {
  if (!companyId) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    employeesDoc(companyId),
    (snap) => {
      cb((snap.data()?.list as Employee[]) ?? []);
    },
    onListenerError("workforceEmployees")
  );
}

export function subscribeMovements(
  cb: (movements: WorkforceMovement[]) => void,
  companyId?: string | null
): Unsubscribe {
  if (!companyId) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    movementsDoc(companyId),
    (snap) => {
      cb((snap.data()?.list as WorkforceMovement[]) ?? []);
    },
    onListenerError("workforceMovements")
  );
}

export function subscribeWorkforceMeta(
  cb: (meta: WorkforceMeta | null) => void,
  companyId?: string | null
): Unsubscribe {
  if (!companyId) {
    cb(null);
    return () => {};
  }
  return onSnapshot(
    summaryDoc(companyId),
    (snap) => {
      cb(snap.exists() ? (snap.data() as WorkforceMeta) : null);
    },
    onListenerError("workforceSummary")
  );
}

/** Persiste la liste complète des employés (mise à jour optimiste côté hook : la liste à jour
 * est déjà en mémoire, l'écriture du doc entier est la plus simple et la plus sûre ici). */
export async function saveEmployees(
  companyId: string | null | undefined,
  employees: Employee[]
): Promise<void> {
  if (!companyId) {
    console.warn("[betrack] saveEmployees ignoré : pas de companyId (admin global).");
    return;
  }
  await setDoc(employeesDoc(companyId), { list: stripUndefined(employees) });
}

export async function saveMovements(
  companyId: string | null | undefined,
  movements: WorkforceMovement[]
): Promise<void> {
  if (!companyId) {
    console.warn("[betrack] saveMovements ignoré : pas de companyId (admin global).");
    return;
  }
  await setDoc(movementsDoc(companyId), { list: stripUndefined(movements) });
}

export async function saveWorkforceMeta(
  companyId: string | null | undefined,
  meta: WorkforceMeta
): Promise<void> {
  if (!companyId) {
    console.warn("[betrack] saveWorkforceMeta ignoré : pas de companyId (admin global).");
    return;
  }
  await setDoc(summaryDoc(companyId), stripUndefined(meta));
}

export type WorkforceSeed = {
  employees: Employee[];
  movements: WorkforceMovement[];
  meta: WorkforceMeta;
};

/** Réécrit tout le périmètre workforce — premier démarrage ou "réinitialiser la démo". Sans
 *  `companyId` (admin global), aucun document partitionné valide n'existe : le reseed est ignoré
 *  (rien n'est écrit) plutôt que d'écrire sous un id de document invalide. */
export async function forceReseedWorkforce(
  seed: WorkforceSeed,
  companyId?: string | null
): Promise<void> {
  if (!companyId) {
    console.warn("[betrack] forceReseedWorkforce ignoré : pas de companyId (admin global).");
    return;
  }
  const batch = writeBatch(db);
  batch.set(employeesDoc(companyId), { list: stripUndefined(seed.employees) });
  batch.set(movementsDoc(companyId), { list: stripUndefined(seed.movements) });
  batch.set(summaryDoc(companyId), stripUndefined(seed.meta));
  batch.set(metaDoc(), { schemaVersion: SCHEMA_VERSION });
  await batch.commit();
}

/** Amorce Firestore avec le seed mockData si jamais initialisé pour ce schéma — idempotent. */
export async function ensureWorkforceSeeded(
  seed: WorkforceSeed,
  companyId?: string | null
): Promise<void> {
  const meta = await getDoc(metaDoc());
  if (meta.exists() && meta.data().schemaVersion === SCHEMA_VERSION) return;
  await forceReseedWorkforce(seed, companyId);
}
