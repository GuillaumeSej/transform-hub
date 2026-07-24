import { collection, doc, getDocs, query, where, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AuditEntry, Comment, Lever, SubLever } from "@/types";
import { planCompanyScopedReset, type CompanyResetPlan } from "@/lib/companyResetLogic";

/**
 * I/O Firestore pour le reset "scopé entreprise" du hub `/admin/companies/detail` (onglet Base de
 * données). Fichier séparé de `lib/firestore/levers.ts` (qui reste focalisé sur le CRUD
 * temps réel) pour ne pas l'alourdir davantage. Voir `lib/companyResetLogic.ts` pour la logique
 * pure de planification (ce qui est/n'est pas supprimé) et le commentaire sur la limite de
 * scoping des documents partagés `comments`/`audit`.
 */

const leversCol = () => collection(db, "levers");
const subLeversCol = () => collection(db, "subLevers");
const hierarchyNodesCol = () => collection(db, "hierarchyNodes");
const commentsDoc = () => doc(db, "leverMeta", "comments");
const auditDoc = () => doc(db, "leverMeta", "auditLog");

/** Lit les deux documents partagés `leverMeta/comments` et `leverMeta/auditLog` en une seule
 * requête de collection (évite deux lectures de doc séparées). */
async function readLeverMetaShared(): Promise<{
  comments: Record<string, Comment[]>;
  audit: AuditEntry[];
}> {
  const snap = await getDocs(collection(db, "leverMeta"));
  const comments =
    (snap.docs.find((d) => d.id === "comments")?.data() as Record<string, Comment[]>) ?? {};
  const audit = (snap.docs.find((d) => d.id === "auditLog")?.data()?.entries as AuditEntry[]) ?? [];
  return { comments, audit };
}

/** Calcule le plan de suppression pour une entreprise à partir de l'état Firestore courant, sans
 * rien écrire — utilisé par l'UI pour afficher précisément ce qui sera supprimé dans la modale de
 * confirmation avant que l'utilisateur ne confirme. */
export async function planCompanyReset(companyId: string): Promise<CompanyResetPlan> {
  const [leverSnap, subLeverSnap, { comments, audit }] = await Promise.all([
    getDocs(leversCol()),
    getDocs(subLeversCol()),
    readLeverMetaShared(),
  ]);
  const levers = leverSnap.docs.map((d) => d.data() as Lever);
  const subLevers = subLeverSnap.docs.map((d) => d.data() as SubLever);

  return planCompanyScopedReset(levers, subLevers, comments, audit, companyId);
}

/** Exécute le reset scopé entreprise : supprime UNIQUEMENT les levers/subLevers/hierarchyNodes
 * tagués `companyId`, et ne retire des documents partagés `comments`/`auditLog` que les entrées
 * liées aux ids de levers/subLevers de cette entreprise (voir planCompanyScopedReset — les
 * entrées non attribuables, ex. mouvements RH, sont conservées telles quelles). N'écrit jamais sur
 * les documents d'une autre entreprise. */
export async function resetCompanyData(companyId: string): Promise<CompanyResetPlan> {
  const [leverSnap, subLeverSnap, hierarchyNodesSnap] = await Promise.all([
    getDocs(query(leversCol(), where("companyId", "==", companyId))),
    getDocs(query(subLeversCol(), where("companyId", "==", companyId))),
    getDocs(query(hierarchyNodesCol(), where("companyId", "==", companyId))),
  ]);

  // Les subLevers rattachés par leverId à un lever de l'entreprise mais sans companyId propre
  // (données historiques) doivent aussi être capturés — on relit tous les subLevers pour les
  // recouper avec les ids de levers qu'on vient de trouver (même heuristique que
  // filterAuditByCompany / planCompanyScopedReset).
  const allSubLeversSnap = await getDocs(subLeversCol());
  const leverIds = new Set(leverSnap.docs.map((d) => d.id));
  const scopedSubLeverDocs = allSubLeversSnap.docs.filter((d) => {
    if (subLeverSnap.docs.some((s) => s.id === d.id)) return true;
    const data = d.data() as SubLever;
    return leverIds.has(data.leverId);
  });

  const { comments, audit } = await readLeverMetaShared();

  const levers = leverSnap.docs.map((d) => d.data() as Lever);
  const subLevers = scopedSubLeverDocs.map((d) => d.data() as SubLever);
  const plan = planCompanyScopedReset(levers, subLevers, comments, audit, companyId);

  const batch = writeBatch(db);
  leverSnap.docs.forEach((d) => batch.delete(d.ref));
  scopedSubLeverDocs.forEach((d) => batch.delete(d.ref));
  hierarchyNodesSnap.docs.forEach((d) => batch.delete(d.ref));
  batch.set(commentsDoc(), plan.remainingComments);
  batch.set(auditDoc(), { entries: plan.remainingAudit });
  await batch.commit();

  return plan;
}
