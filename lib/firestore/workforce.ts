import { doc, onSnapshot, setDoc, writeBatch, type Unsubscribe } from "firebase/firestore";
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

/** Documents `leverMeta/{companyId}__{workforceEmployees|workforceMovements|workforceSummary}` —
 * partitionnés par entreprise (voir firestore.rules, section `match /leverMeta/{docId}`, et
 * scripts/migrate-lever-meta-tenant-split.js pour la migration depuis les anciens documents
 * mutualisés qui mélangeaient les effectifs/mouvements de TOUTES les entreprises). */
const employeesDoc = (companyId: string) =>
  doc(db, "leverMeta", `${companyId}__workforceEmployees`);
const movementsDoc = (companyId: string) =>
  doc(db, "leverMeta", `${companyId}__workforceMovements`);
const summaryDoc = (companyId: string) => doc(db, "leverMeta", `${companyId}__workforceSummary`);

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

/** Réécrit tout le périmètre workforce pour une entreprise donnée — utilitaire explicite (ex.
 *  "réinitialiser la démo" côté admin), JAMAIS appelé automatiquement au chargement d'une page :
 *  voir lib/hooks/useStorage.ts, qui n'appelle plus aucune variante "ensure*Seeded" implicite
 *  depuis la suppression de ce mécanisme (une entreprise démarre avec un périmètre workforce
 *  vide, peuplé uniquement par de la vraie saisie/import). Sans `companyId` (admin global),
 *  aucun document partitionné valide n'existe : le reseed est ignoré (rien n'est écrit) plutôt
 *  que d'écrire sous un id de document invalide. */
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
  await batch.commit();
}
