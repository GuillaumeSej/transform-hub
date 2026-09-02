import type { AuditEntry, Comment, Lever } from "@/types";

/**
 * Logique PURE de planification du reset "scopé entreprise" du tableau de bord admin (voir
 * `lib/firestore/companyReset.ts` pour la partie I/O Firestore qui s'appuie dessus, et
 * `components/admin/CompanyDatabasePanel.tsx` pour l'UI/la modale de confirmation).
 *
 * Contrairement au reset global (`forceReseedLevers`, qui purge TOUTES les entreprises), ce plan
 * ne doit affecter QUE les documents explicitement tagués `companyId` pour l'entreprise ciblée :
 * - levers : ceux dont `companyId === companyId` (les leviers sans companyId sont des données
 *   historiques/partagées, volontairement épargnés — un reset scopé ne doit jamais purger des
 *   données qui pourraient appartenir à une autre entreprise ou n'être taguées à personne).
 * - comments / audit : stockés dans DEUX documents globaux uniques (pas de collection par
 *   entreprise, voir lib/firestore/levers.ts). On ne peut les scoper qu'via les ids de lever qu'on
 *   vient de déterminer comme appartenant à l'entreprise (même technique que
 *   `filterAuditByCompany`) : on retire les entrées de commentaires dont la clé est un de ces ids,
 *   et les entrées d'audit dont l'entité matche un id de lever de l'entreprise. Les entrées non
 *   liées à un lever connu (mouvements RH, employés — pas encore multi-tenant) sont TOUJOURS
 *   conservées : elles ne peuvent pas être attribuées de façon fiable à une entreprise, donc les
 *   supprimer risquerait de perdre des données d'une autre entreprise.
 */
export type CompanyResetPlan = {
  leverIds: string[];
  /** Doc `leverMeta/comments` après suppression des entrées de l'entreprise. */
  remainingComments: Record<string, Comment[]>;
  /** Entrées d'audit après suppression de celles de l'entreprise. */
  remainingAudit: AuditEntry[];
  removedCommentKeys: string[];
  removedAuditCount: number;
  /** Nombre de documents supprimés dans chaque collection du Plan Stratégique (axes, chantiers,
   *  actions, étapes de maturité, indicateurs, mesures). Renseigné par la couche I/O (voir
   *  `lib/firestore/companyReset.ts`) — la planification pure n'a pas ces documents en entrée :
   *  contrairement aux leviers, ils sont TOUS tagués `companyId` sans exception, donc leur
   *  suppression est une requête directe qui n'a besoin d'aucune règle de filtrage métier.
   *  Absent = reset planifié mais pas encore exécuté. */
  strategicRemoved?: Record<StrategicCollection, number>;
};

/** Collections du Plan Stratégique purgées par un reset d'entreprise. Toutes portent un
 *  `companyId` obligatoire (voir types/index.ts), d'où une purge par simple requête scopée —
 *  aucune donnée « partagée / non attribuable » à épargner comme pour comments/audit. */
export const STRATEGIC_COLLECTIONS = [
  "strategicAxes",
  "chantiers",
  "chantierActions",
  "maturityStageConfigs",
  "indicators",
  "indicatorMeasurements",
] as const;

export type StrategicCollection = (typeof STRATEGIC_COLLECTIONS)[number];

export function planCompanyScopedReset(
  levers: Lever[],
  comments: Record<string, Comment[]>,
  audit: AuditEntry[],
  companyId: string
): CompanyResetPlan {
  const companyLevers = levers.filter((l) => l.companyId === companyId);
  const leverIds = companyLevers.map((l) => l.id);
  const scopedIds = new Set(leverIds);

  const removedCommentKeys = Object.keys(comments).filter((key) => scopedIds.has(key));
  const remainingComments = Object.fromEntries(
    Object.entries(comments).filter(([key]) => !scopedIds.has(key))
  );

  const remainingAudit = audit.filter((entry) => !scopedIds.has(entry.entity));
  const removedAuditCount = audit.length - remainingAudit.length;

  return {
    leverIds,
    remainingComments,
    remainingAudit,
    removedCommentKeys,
    removedAuditCount,
  };
}
