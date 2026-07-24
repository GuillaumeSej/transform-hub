import type { AuditEntry, Comment, Lever, SubLever } from "@/types";

/**
 * Logique PURE de planification du reset "scopé entreprise" du tableau de bord admin (voir
 * `lib/firestore/companyReset.ts` pour la partie I/O Firestore qui s'appuie dessus, et
 * `components/admin/CompanyDatabasePanel.tsx` pour l'UI/la modale de confirmation).
 *
 * Contrairement au reset global (`forceReseedLevers`, qui purge TOUTES les entreprises), ce plan
 * ne doit affecter QUE les documents explicitement tagués `companyId` pour l'entreprise ciblée :
 * - levers / subLevers : ceux dont `companyId === companyId` (les leviers sans companyId sont des
 *   données historiques/partagées, volontairement épargnés — un reset scopé ne doit jamais purger
 *   des données qui pourraient appartenir à une autre entreprise ou n'être taguées à personne).
 * - comments / audit : stockés dans DEUX documents globaux uniques (pas de collection par
 *   entreprise, voir lib/firestore/levers.ts). On ne peut les scoper qu'via les ids de
 *   lever/subLever qu'on vient de déterminer comme appartenant à l'entreprise (même technique que
 *   `filterAuditByCompany`) : on retire les entrées de commentaires dont la clé est un de ces ids,
 *   et les entrées d'audit dont l'entité matche un id de lever/subLever de l'entreprise. Les
 *   entrées non liées à un lever/subLever connu (mouvements RH, employés — pas encore
 *   multi-tenant) sont TOUJOURS conservées : elles ne peuvent pas être attribuées de façon fiable
 *   à une entreprise, donc les supprimer risquerait de perdre des données d'une autre entreprise.
 */
export type CompanyResetPlan = {
  leverIds: string[];
  subLeverIds: string[];
  /** Doc `leverMeta/comments` après suppression des entrées de l'entreprise. */
  remainingComments: Record<string, Comment[]>;
  /** Entrées d'audit après suppression de celles de l'entreprise. */
  remainingAudit: AuditEntry[];
  removedCommentKeys: string[];
  removedAuditCount: number;
};

export function planCompanyScopedReset(
  levers: Lever[],
  subLevers: SubLever[],
  comments: Record<string, Comment[]>,
  audit: AuditEntry[],
  companyId: string
): CompanyResetPlan {
  const companyLevers = levers.filter((l) => l.companyId === companyId);
  const leverIds = companyLevers.map((l) => l.id);
  const leverIdSet = new Set(leverIds);

  // Un sous-levier est de l'entreprise s'il porte lui-même le companyId, OU s'il rattache à un
  // levier de l'entreprise (même heuristique que `byCompany`/`filterAuditByCompany`).
  const companySubLevers = subLevers.filter(
    (s) => s.companyId === companyId || leverIdSet.has(s.leverId)
  );
  const subLeverIds = companySubLevers.map((s) => s.id);

  const scopedIds = new Set([...leverIds, ...subLeverIds]);

  const removedCommentKeys = Object.keys(comments).filter((key) => scopedIds.has(key));
  const remainingComments = Object.fromEntries(
    Object.entries(comments).filter(([key]) => !scopedIds.has(key))
  );

  const remainingAudit = audit.filter((entry) => !scopedIds.has(entry.entity));
  const removedAuditCount = audit.length - remainingAudit.length;

  return {
    leverIds,
    subLeverIds,
    remainingComments,
    remainingAudit,
    removedCommentKeys,
    removedAuditCount,
  };
}
