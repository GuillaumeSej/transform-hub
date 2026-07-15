import { doc, getDoc, onSnapshot, setDoc, writeBatch, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Department, Employee, WorkforceMovement } from "@/types";

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
const SCHEMA_VERSION = "1";

const employeesDoc = () => doc(db, "leverMeta", "workforceEmployees");
const movementsDoc = () => doc(db, "leverMeta", "workforceMovements");
const summaryDoc = () => doc(db, "leverMeta", "workforceSummary");
const metaDoc = () => doc(db, "meta", "workforce");

export type WorkforceMeta = {
  totalFTE: number;
  massSalary: number; // €M
  budgetSalary: number; // €M
  departments: Department[];
};

/** Firestore refuse `undefined` (champs optionnels comme toDepartment/comment) — on les retire
 * du payload avant écriture (JSON round-trip : suffisant pour ces objets purs). */
function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function subscribeEmployees(cb: (employees: Employee[]) => void): Unsubscribe {
  return onSnapshot(employeesDoc(), (snap) => {
    cb((snap.data()?.list as Employee[]) ?? []);
  });
}

export function subscribeMovements(cb: (movements: WorkforceMovement[]) => void): Unsubscribe {
  return onSnapshot(movementsDoc(), (snap) => {
    cb((snap.data()?.list as WorkforceMovement[]) ?? []);
  });
}

export function subscribeWorkforceMeta(cb: (meta: WorkforceMeta | null) => void): Unsubscribe {
  return onSnapshot(summaryDoc(), (snap) => {
    cb(snap.exists() ? (snap.data() as WorkforceMeta) : null);
  });
}

/** Persiste la liste complète des employés (mise à jour optimiste côté hook : la liste à jour
 * est déjà en mémoire, l'écriture du doc entier est la plus simple et la plus sûre ici). */
export async function saveEmployees(employees: Employee[]): Promise<void> {
  await setDoc(employeesDoc(), { list: stripUndefined(employees) });
}

export async function saveMovements(movements: WorkforceMovement[]): Promise<void> {
  await setDoc(movementsDoc(), { list: stripUndefined(movements) });
}

export async function saveWorkforceMeta(meta: WorkforceMeta): Promise<void> {
  await setDoc(summaryDoc(), stripUndefined(meta));
}

export type WorkforceSeed = {
  employees: Employee[];
  movements: WorkforceMovement[];
  meta: WorkforceMeta;
};

/** Réécrit tout le périmètre workforce — premier démarrage ou "réinitialiser la démo". */
export async function forceReseedWorkforce(seed: WorkforceSeed): Promise<void> {
  const batch = writeBatch(db);
  batch.set(employeesDoc(), { list: stripUndefined(seed.employees) });
  batch.set(movementsDoc(), { list: stripUndefined(seed.movements) });
  batch.set(summaryDoc(), stripUndefined(seed.meta));
  batch.set(metaDoc(), { schemaVersion: SCHEMA_VERSION });
  await batch.commit();
}

/** Amorce Firestore avec le seed mockData si jamais initialisé pour ce schéma — idempotent. */
export async function ensureWorkforceSeeded(seed: WorkforceSeed): Promise<void> {
  const meta = await getDoc(metaDoc());
  if (meta.exists() && meta.data().schemaVersion === SCHEMA_VERSION) return;
  await forceReseedWorkforce(seed);
}
