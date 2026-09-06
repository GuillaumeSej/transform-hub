import { collection, doc, getDoc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AuditEntry, Comment, Lever } from "@/types";
import {
  planCompanyScopedReset,
  STRATEGIC_COLLECTIONS,
  type CompanyResetPlan,
  type StrategicCollection,
} from "@/lib/companyResetLogic";

/**
 * I/O Firestore pour le reset "scopé entreprise" du hub `/admin/companies/detail` (onglet Base de
 * données). Fichier séparé de `lib/firestore/levers.ts` (qui reste focalisé sur le CRUD
 * temps réel) pour ne pas l'alourdir davantage. Voir `lib/companyResetLogic.ts` pour la logique
 * pure de planification (ce qui est/n'est pas supprimé) et le commentaire sur la limite de
 * scoping des documents partagés `comments`/`audit`.
 */

const leversCol = () => collection(db, "levers");
/** Ancienne collection sous-leviers, plus alimentée — nettoyée par précaution si des documents
 * orphelins d'un ancien schéma subsistent pour cette entreprise. */
const subLeversCol = () => collection(db, "subLevers");
const hierarchyNodesCol = () => collection(db, "hierarchyNodes");

/** Documents `leverMeta/{companyId}__{comments|auditLog}` — désormais partitionnés PAR
 * ENTREPRISE (voir firestore.rules, lib/firestore/levers.ts, et
 * scripts/migrate-lever-meta-tenant-split.js pour la migration depuis les anciens documents
 * mutualisés `leverMeta/comments`/`leverMeta/auditLog`). Un reset scopé entreprise ne lit/écrit
 * donc plus QUE le document de SON entreprise — il n'y a structurellement plus moyen de toucher
 * aux données d'une autre entreprise, contrairement à l'ancien filtrage "par id de levier" à
 * l'intérieur d'un document unique partagé. */
const commentsDoc = (companyId: string) => doc(db, "leverMeta", `${companyId}__comments`);
const auditDoc = (companyId: string) => doc(db, "leverMeta", `${companyId}__auditLog`);

/** Lit les documents `leverMeta/{companyId}__comments` et `leverMeta/{companyId}__auditLog` de
 * CETTE SEULE entreprise (deux lectures de doc, pas de scan de collection : plus la peine de
 * filtrer parmi les données d'autres entreprises, elles ne sont plus dans les mêmes documents). */
async function readCompanyLeverMeta(companyId: string): Promise<{
  comments: Record<string, Comment[]>;
  audit: AuditEntry[];
}> {
  const [commentsSnap, auditSnap] = await Promise.all([
    getDoc(commentsDoc(companyId)),
    getDoc(auditDoc(companyId)),
  ]);
  const comments = (commentsSnap.data() as Record<string, Comment[]>) ?? {};
  const audit = (auditSnap.data()?.entries as AuditEntry[]) ?? [];
  return { comments, audit };
}

/** Calcule le plan de suppression pour une entreprise à partir de l'état Firestore courant, sans
 * rien écrire — utilisé par l'UI pour afficher précisément ce qui sera supprimé dans la modale de
 * confirmation avant que l'utilisateur ne confirme. */
export async function planCompanyReset(companyId: string): Promise<CompanyResetPlan> {
  const [leverSnap, { comments, audit }] = await Promise.all([
    getDocs(query(leversCol(), where("companyId", "==", companyId))),
    readCompanyLeverMeta(companyId),
  ]);
  const levers = leverSnap.docs.map((d) => d.data() as Lever);

  return planCompanyScopedReset(levers, comments, audit, companyId);
}

/** Exécute le reset scopé entreprise : supprime UNIQUEMENT les levers/hierarchyNodes tagués
 * `companyId` (et les sous-leviers résiduels d'un ancien schéma qui porteraient ce companyId), et
 * réécrit le document PARTITIONNÉ `leverMeta/{companyId}__comments`/`__auditLog` de cette seule
 * entreprise en retirant les entrées liées à ses propres ids de levier (voir
 * planCompanyScopedReset — les entrées non attribuables à un lever connu, ex. mouvements RH, sont
 * conservées telles quelles). Le document `leverMeta/{autreCompanyId}__*` d'une autre entreprise
 * n'est ni lu ni écrit : ce n'est plus un filtrage "au mieux" à l'intérieur d'un document partagé,
 * mais une impossibilité structurelle d'atteindre les données d'une autre entreprise. */
export async function resetCompanyData(companyId: string): Promise<CompanyResetPlan> {
  const [leverSnap, legacySubLeverSnap, hierarchyNodesSnap, ...strategicSnaps] = await Promise.all([
    getDocs(query(leversCol(), where("companyId", "==", companyId))),
    getDocs(query(subLeversCol(), where("companyId", "==", companyId))),
    getDocs(query(hierarchyNodesCol(), where("companyId", "==", companyId))),
    // Collections du Plan Stratégique — toutes taguées `companyId` sans exception, donc purgées
    // par simple requête scopée (voir STRATEGIC_COLLECTIONS).
    ...STRATEGIC_COLLECTIONS.map((name) =>
      getDocs(query(collection(db, name), where("companyId", "==", companyId)))
    ),
  ]);

  const { comments, audit } = await readCompanyLeverMeta(companyId);

  const levers = leverSnap.docs.map((d) => d.data() as Lever);
  const plan = planCompanyScopedReset(levers, comments, audit, companyId);

  const batch = writeBatch(db);
  leverSnap.docs.forEach((d) => batch.delete(d.ref));
  legacySubLeverSnap.docs.forEach((d) => batch.delete(d.ref));
  hierarchyNodesSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.set(commentsDoc(companyId), plan.remainingComments);
  batch.set(auditDoc(companyId), { entries: plan.remainingAudit });
  await batch.commit();

  // Les collections stratégiques sont purgées dans des lots SÉPARÉS et découpés : les mesures
  // d'indicateurs sont la seule collection de ce périmètre à croître avec le temps (une par
  // indicateur et par période) et peuvent à elles seules dépasser la limite de 500 écritures d'un
  // writeBatch Firestore — les agréger au lot principal ferait échouer tout le reset.
  const strategicRemoved = {} as Record<StrategicCollection, number>;
  for (let i = 0; i < STRATEGIC_COLLECTIONS.length; i++) {
    const name = STRATEGIC_COLLECTIONS[i];
    const docs = strategicSnaps[i].docs;
    strategicRemoved[name] = docs.length;
    const CHUNK = 500;
    for (let start = 0; start < docs.length; start += CHUNK) {
      const chunkBatch = writeBatch(db);
      docs.slice(start, start + CHUNK).forEach((d) => chunkBatch.delete(d.ref));
      await chunkBatch.commit();
    }
  }

  return { ...plan, strategicRemoved };
}
