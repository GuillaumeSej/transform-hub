import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
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

const leversCol = () => collection(db, "levers");
/** Ancienne collection sous-leviers, plus alimentée — supprimée à chaque reseed pour ne laisser
 * traîner aucune donnée orpheline d'un ancien schéma. */
const subLeversCol = () => collection(db, "subLevers");

/** Documents `leverMeta/{companyId}__{comments|auditLog}` — partitionnés par entreprise (voir
 * firestore.rules, section `match /leverMeta/{docId}`, et scripts/migrate-lever-meta-tenant-split.js
 * pour la migration depuis les anciens documents mutualisés `leverMeta/comments` /
 * `leverMeta/auditLog`, qui mélangeaient les données de TOUTES les entreprises). */
const commentsDoc = (companyId: string) => doc(db, "leverMeta", `${companyId}__comments`);
const auditDoc = (companyId: string) => doc(db, "leverMeta", `${companyId}__auditLog`);

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

/** Subscribe to levers, optionally filtered by companyId. `companyId` null/undefined = admin
 *  global, requête non filtrée (voir `byCompany`). Sinon, filtre CÔTÉ SERVEUR via `where` — pas
 *  seulement en mémoire côté client : nécessaire pour que `firestore.rules` puisse restreindre la
 *  lecture aux leviers de l'entreprise de l'appelant (Firestore refuse un `list`/`onSnapshot` non
 *  filtré dès que la règle dépend de `resource.data.companyId`, voir firestore.rules). Le filtre
 *  client `byCompany` ci-dessus est conservé en aval par défense en profondeur (et pour les
 *  leviers orphelins sans companyId, qu'un filtre `where` égalité ne peut pas exclure autrement
 *  qu'en les excluant déjà du résultat serveur). */
export function subscribeLevers(
  cb: (levers: Lever[]) => void,
  companyId?: string | null
): Unsubscribe {
  const scopedQuery = companyId
    ? query(leversCol(), where("companyId", "==", companyId))
    : leversCol();
  return onSnapshot(
    scopedQuery,
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

/** `companyId` null/undefined = admin global : le document partitionné par entreprise n'a plus
 *  d'équivalent "toutes entreprises confondues" (voir firestore.rules) — l'appelant reçoit un
 *  objet vide et n'a rien à s'abonner (pas d'erreur, pas de fuite entre entreprises). En pratique
 *  seul `admin_entreprise` (companyId toujours renseigné) atteint ce code (voir lib/nav-config.ts,
 *  "admin-data"/"admin-history" absents du nav "admin" global). */
export function subscribeComments(
  cb: (comments: Record<string, Comment[]>) => void,
  companyId?: string | null
): Unsubscribe {
  if (!companyId) {
    cb({});
    return () => {};
  }
  return onSnapshot(
    commentsDoc(companyId),
    (snap) => {
      cb((snap.data() as Record<string, Comment[]>) ?? {});
    },
    onListenerError("comments")
  );
}

export function subscribeAuditLog(
  cb: (audit: AuditEntry[]) => void,
  companyId?: string | null
): Unsubscribe {
  if (!companyId) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    auditDoc(companyId),
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

export async function saveComments(
  companyId: string | null | undefined,
  comments: Record<string, Comment[]>
): Promise<void> {
  if (!companyId) {
    console.warn("[betrack] saveComments ignoré : pas de companyId (admin global).");
    return;
  }
  await setDoc(commentsDoc(companyId), comments);
}

export async function saveAuditLog(
  companyId: string | null | undefined,
  entries: AuditEntry[]
): Promise<void> {
  if (!companyId) {
    console.warn("[betrack] saveAuditLog ignoré : pas de companyId (admin global).");
    return;
  }
  await setDoc(auditDoc(companyId), { entries });
}

type LeversSeed = {
  levers: Lever[];
  comments: Record<string, Comment[]>;
  audit: AuditEntry[];
};

/** Purge TOUS les leviers (et sous-leviers résiduels d'un ancien schéma) de TOUTES les
 * entreprises et réécrit le seed fourni. Utilitaire explicite (dev/ops — reset complet d'un
 * environnement, jamais un reset "démo" ciblé : voir `lib/companyResetLogic.ts` +
 * `lib/firestore/companyReset.ts` pour le reset scopé à UNE entreprise) — plus AUCUN call site
 * automatique ne doit l'invoquer (voir lib/hooks/useStorage.ts : l'ancien
 * `ensureLeversSeeded`, qui déclenchait cette purge globale comme simple effet de bord d'un
 * chargement de page dès que `SCHEMA_VERSION` changeait, a été supprimé — c'était le bug le
 * plus sévère de cette famille : n'importe quelle entreprise chargeant une page la première
 * après un bump de schéma faisait effacer les leviers de TOUTES les entreprises). `companyId`
 * détermine sous quel document partitionné (`leverMeta/{companyId}__comments`/`__auditLog`) le
 * seed de commentaires/audit est écrit — sans companyId (admin global), ces deux documents ne
 * sont pas écrits (pas de partition valide), seuls les leviers le sont. */
export async function forceReseedLevers(
  seed: LeversSeed,
  companyId?: string | null
): Promise<void> {
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
  if (companyId) {
    batch.set(commentsDoc(companyId), seed.comments);
    batch.set(auditDoc(companyId), { entries: seed.audit });
  } else {
    console.warn(
      "[betrack] forceReseedLevers : comments/auditLog non réécrits (pas de companyId)."
    );
  }
  await batch.commit();
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
