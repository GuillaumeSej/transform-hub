import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import type { AuditEntry, Comment, Lever, LeverDependency } from "@/types";

/**
 * Couche Firestore pour le périmètre "leviers" (levers, commentaires, journal d'audit) : c'est la
 * donnée que plusieurs personnes doivent voir à jour en même temps. Les autres périmètres ont
 * leur propre couche : workforce.ts (base ETP), alerts.ts, programConfig.ts (program +
 * workstreams), admin.ts (companies/programs/users).
 *
 * Multi-tenancy : chaque lever porte un champ optionnel `companyId`. Les subscribers filtrent par
 * companyId pour n'exposer que les données de l'entreprise courante. Un admin (companyId null)
 * voit tout.
 */

// Incrémenter force un reseed complet de la BDD (schéma de données modifié).
// v7 : suppression du modèle sous-levier (fusionné dans Lever.actions via
// lib/mockActionMigration.ts) — changement de forme assumé consciemment, reseed complet.
// v8 : enrichissement des impacts migrés (capexDeploymentDate, gainDate, savingType,
// recognition — voir lib/mockActionMigration.ts) — le seed existant ne les porte pas, reseed complet.
// v9 : ajout de Lever.hierarchyLeafId (rattachement des 18 leviers de démo à l'arborescence
// financière DEMO_HIERARCHY_NODES — voir data/mockData.ts) — le seed existant ne le porte pas,
// reseed complet.
const SCHEMA_VERSION = "9";

const leversCol = () => collection(db, "levers");
/** Ancienne collection sous-leviers, plus alimentée — supprimée à chaque reseed pour ne laisser
 * traîner aucune donnée orpheline d'un ancien schéma. */
const subLeversCol = () => collection(db, "subLevers");
const metaDoc = () => doc(db, "meta", "levers");
const commentsDoc = () => doc(db, "leverMeta", "comments");
const auditDoc = () => doc(db, "leverMeta", "auditLog");

/** Normalise les dépendances lues depuis Firestore : les documents écrits avant l'introduction
 * des types de dépendance stockent des ids bruts (`string[]`) — on les convertit en
 * `{ targetId, type: "FS" }` à la lecture, sans bump du schéma (un bump forcerait un reseed qui
 * écraserait les données saisies par l'équipe). */
function normalizeDependencies(deps: unknown): LeverDependency[] {
  if (!Array.isArray(deps)) return [];
  return deps
    .map((d): LeverDependency | null => {
      if (typeof d === "string") return { targetId: d, type: "FS" };
      if (d && typeof d === "object" && typeof (d as LeverDependency).targetId === "string") {
        const type = (d as LeverDependency).type;
        return {
          targetId: (d as LeverDependency).targetId,
          type: type === "SS" || type === "FF" || type === "SF" ? type : "FS",
        };
      }
      return null;
    })
    .filter((d): d is LeverDependency => d !== null);
}

/** Filtre les items par companyId — `companyId` null/undefined = admin global (voit tout, aucun
 * filtrage). Pour un `companyId` donné, ne garde QUE les items explicitement tagués à cette
 * entreprise : un item sans `companyId` (orphelin — ancienne donnée jamais migrée, voir
 * `migrateCompanyIds`) n'est plus considéré visible pour toutes les entreprises. `createLever`
 * (lib/leversLogic.ts) renseigne toujours `companyId` à la création via le formulaire, donc une
 * entreprise fraîchement créée ne doit voir aucun levier tant qu'elle n'en a pas créé elle-même —
 * un leak-through ici ferait apparaître les orphelins (ou pire, les leviers d'une autre entreprise
 * mal taguée) chez tout le monde. */
export function byCompany<T extends { companyId?: string | null }>(
  items: T[],
  companyId?: string | null
): T[] {
  if (!companyId) return items;
  return items.filter((item) => item.companyId === companyId);
}

/** Subscribe to levers, optionally filtered by companyId. */
export function subscribeLevers(
  cb: (levers: Lever[]) => void,
  companyId?: string | null
): Unsubscribe {
  return onSnapshot(
    leversCol(),
    (snap) => {
      const all = snap.docs.map((d) => {
        const lever = d.data() as Lever;
        return { ...lever, dependencies: normalizeDependencies(lever.dependencies) };
      });
      cb(byCompany(all, companyId));
    },
    onListenerError("levers")
  );
}

export function subscribeComments(cb: (comments: Record<string, Comment[]>) => void): Unsubscribe {
  return onSnapshot(
    commentsDoc(),
    (snap) => {
      cb((snap.data() as Record<string, Comment[]>) ?? {});
    },
    onListenerError("comments")
  );
}

export function subscribeAuditLog(cb: (audit: AuditEntry[]) => void): Unsubscribe {
  return onSnapshot(
    auditDoc(),
    (snap) => {
      cb((snap.data()?.entries as AuditEntry[]) ?? []);
    },
    onListenerError("auditLog")
  );
}

/** Filtre le journal d'audit pour un admin d'entreprise : ne garde que les entrées dont l'entité
 * (un id de levier, ou l'id de levier parent pour un commentaire) appartient EXPLICITEMENT à
 * `companyId` — un levier orphelin (sans companyId) n'est plus considéré comme appartenant à
 * `companyId` (voir `byCompany` ci-dessus, même durcissement). Les entrées sans lien avec un levier
 * connu (ex. mouvements RH, employés — pas encore multi-tenant) restent visibles telles quelles, ce
 * périmètre n'étant pas encore taggué par entreprise. `companyId` null = aucun filtrage
 * (super-admin). */
export function filterAuditByCompany(
  audit: AuditEntry[],
  levers: Lever[],
  companyId: string | null
): AuditEntry[] {
  if (!companyId) return audit;
  const leverIds = new Set(levers.filter((l) => l.companyId === companyId).map((l) => l.id));
  return audit.filter((entry) => {
    const entity = entry.entity;
    const isLeverEntity = /^L\d+$/i.test(entity);
    if (!isLeverEntity) return true;
    return leverIds.has(entity);
  });
}

export async function saveLever(lever: Lever): Promise<void> {
  await setDoc(doc(leversCol(), lever.id), lever);
}

/** Création/mise à jour en masse (import Excel — voir lib/leverExcelImport.ts) : un seul
 *  writeBatch, jusqu'à 500 écritures par lot Firestore, sur le même modèle que
 *  `saveHierarchyNodesBatch` (lib/firestore/admin.ts). Round-trip JSON avant écriture pour purger
 *  les clés `undefined` (rejetées par Firestore), comme le fait déjà `forceReseedLevers`. */
export async function saveLeversBatch(levers: Lever[]): Promise<void> {
  if (levers.length === 0) return;
  const col = leversCol();
  const CHUNK = 500;
  for (let i = 0; i < levers.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const lever of levers.slice(i, i + CHUNK)) {
      batch.set(doc(col, lever.id), JSON.parse(JSON.stringify(lever)));
    }
    await batch.commit();
  }
}

export async function saveComments(comments: Record<string, Comment[]>): Promise<void> {
  await setDoc(commentsDoc(), comments);
}

export async function saveAuditLog(entries: AuditEntry[]): Promise<void> {
  await setDoc(auditDoc(), { entries });
}

type LeversSeed = {
  levers: Lever[];
  comments: Record<string, Comment[]>;
  audit: AuditEntry[];
};

/** Purge les leviers (et les sous-leviers résiduels d'un ancien schéma) existants et réécrit le
 * seed fourni — utilisé au premier démarrage (schéma jamais initialisé) et par le bouton
 * "réinitialiser la démo". */
export async function forceReseedLevers(seed: LeversSeed): Promise<void> {
  const [existingLevers, existingSubLevers] = await Promise.all([
    getDocs(leversCol()),
    getDocs(subLeversCol()),
  ]);

  const batch = writeBatch(db);
  existingLevers.forEach((d) => batch.delete(d.ref));
  existingSubLevers.forEach((d) => batch.delete(d.ref));
  // Le SDK Firestore rejette toute valeur `undefined` (contrairement à `null`) — le seed mock
  // construit certains champs optionnels (deliveredDate, costCenter, entity…) via `a ?? b` où `b`
  // peut lui-même valoir `undefined`, ce qui laisse la clé présente avec une valeur `undefined`.
  // round-trip JSON pour purger ces clés avant écriture, plutôt que de traquer chaque site d'origine.
  seed.levers.forEach((l) => batch.set(doc(leversCol(), l.id), JSON.parse(JSON.stringify(l))));
  batch.set(commentsDoc(), seed.comments);
  batch.set(auditDoc(), { entries: seed.audit });
  batch.set(metaDoc(), { schemaVersion: SCHEMA_VERSION });
  await batch.commit();
}

/** Amorce Firestore avec le seed mockData si la BDD n'a jamais été initialisée pour ce schéma
 * (démarrage à vide ou schéma changé) — idempotent, ne touche à rien si déjà initialisé. */
export async function ensureLeversSeeded(seed: LeversSeed): Promise<void> {
  const meta = await getDoc(metaDoc());
  if (meta.exists() && meta.data().schemaVersion === SCHEMA_VERSION) return;
  await forceReseedLevers(seed);
}

const MIGRATION_COMPANY_ID_KEY = "betrack_company_migration_v1";

/** One-time migration: attach existing levers to a company when they have no companyId. */
export async function migrateCompanyIds(targetCompanyId: string): Promise<void> {
  if (typeof window !== "undefined" && localStorage.getItem(MIGRATION_COMPANY_ID_KEY)) return;
  const leverSnap = await getDocs(leversCol());
  const batch = writeBatch(db);
  let count = 0;
  leverSnap.docs.forEach((d) => {
    const data = d.data() as Lever;
    if (!data.companyId) {
      batch.update(d.ref, { companyId: targetCompanyId });
      count++;
    }
  });
  if (count > 0) {
    await batch.commit();
    console.log(
      `[betrack] migration: ${count} document(s) rattaché(s) à l'entreprise ${targetCompanyId}`
    );
  }
  if (typeof window !== "undefined") localStorage.setItem(MIGRATION_COMPANY_ID_KEY, "done");
}
