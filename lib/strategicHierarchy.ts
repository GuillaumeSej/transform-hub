import type { Chantier, ChantierAction, StrategicAxis } from "@/types";

/**
 * Hiérarchie de validation du Plan Stratégique — module PUR, source unique de « qui valide les
 * saisies de qui » et « qui désigne qui ». Inspiré du Plan Transfo (CTO > responsable de chantier
 * > responsable de levier), décision PO :
 *
 *   pilote du plan (strategic_lead) > sponsor d'axe (StrategicAxis.owner)
 *     > sponsor de chantier (Chantier.pilote) > responsable projet (ChantierAction.owner)
 *     > contributeurs projet (ChantierAction.contributors)
 *
 * Règle de validation : une saisie est validée par les niveaux STRICTEMENT AU-DESSUS de son
 * auteur, dans l'ordre (N+1 puis N+2), jamais par l'auteur lui-même :
 *   - données de PILOTAGE (KPI, jalons, avancement, budget consommé, création/suppression de
 *     projet ou de chantier) → 2 validations ;
 *   - dates et livrables, désignation du responsable/des contributeurs → 1 validation (N+1) ;
 *   - commentaires, descriptions, libellés → libres.
 * Un niveau vide (personne désignée) est SAUTÉ : on remonte au suivant. Au sommet (le pilote),
 * il n'y a plus personne au-dessus : la chaîne est vide → application directe (comme le CTO).
 *
 * Désignation (décision PO) : sponsors d'axe et de chantier sont définis en amont par le pilote
 * (ou un admin) ; le responsable projet est désigné par le niveau au-dessus (sponsor de chantier
 * ou plus haut) ; les contributeurs par le responsable projet (ou plus haut).
 */

export type StrategicLevel =
  "contributor" | "projectOwner" | "chantierSponsor" | "axisSponsor" | "pilot";

/** Du plus bas au plus haut. */
export const STRATEGIC_LEVELS: StrategicLevel[] = [
  "contributor",
  "projectOwner",
  "chantierSponsor",
  "axisSponsor",
  "pilot",
];

const rank = (level: StrategicLevel) => STRATEGIC_LEVELS.indexOf(level);

/** Objet sur lequel porte la saisie, avec sa chaîne de responsables. `axis` = l'axe de
 *  rattachement du chantier (le 1er de `Chantier.axisIds` s'il y en a plusieurs — résolu par
 *  l'appelant) ; `pilots` = usernames des `strategic_lead` du programme. */
export type HierarchyContext = {
  axis?: Pick<StrategicAxis, "owner"> | null;
  /** Optionnel : TOUS les axes de rattachement (chantier multi-axe) — leurs sponsors détiennent
   *  alors ensemble le niveau "axisSponsor" (n'importe lequel peut valider ce palier), en plus de
   *  `axis`. Absent = seul `axis` compte (comportement d'origine). */
  axes?: Pick<StrategicAxis, "owner">[] | null;
  chantier?: Pick<Chantier, "pilote"> | null;
  projet?: Pick<ChantierAction, "owner" | "contributors"> | null;
  pilots: string[];
};

function uniq(list: (string | undefined | null)[]): string[] {
  const out: string[] = [];
  for (const v of list) if (v && !out.includes(v)) out.push(v);
  return out;
}

/** Usernames détenant chaque niveau sur cet objet. */
export function levelHolders(ctx: HierarchyContext): Record<StrategicLevel, string[]> {
  return {
    contributor: ctx.projet?.contributors ?? [],
    projectOwner: ctx.projet?.owner ? [ctx.projet.owner] : [],
    chantierSponsor: ctx.chantier?.pilote ? [ctx.chantier.pilote] : [],
    axisSponsor: uniq([ctx.axis?.owner, ...(ctx.axes ?? []).map((a) => a.owner)]),
    pilot: ctx.pilots,
  };
}

/** Niveau le plus HAUT détenu par `username` sur cet objet (null = aucun). */
export function authorLevel(username: string, ctx: HierarchyContext): StrategicLevel | null {
  const holders = levelHolders(ctx);
  for (const level of [...STRATEGIC_LEVELS].reverse()) {
    if (holders[level].includes(username)) return level;
  }
  return null;
}

export type ApprovalStep = { level: StrategicLevel; usernames: string[] };

/**
 * Chaîne de validation d'une saisie de `author` sur cet objet : les `count` premiers niveaux NON
 * VIDES strictement au-dessus de son niveau, sans jamais inclure l'auteur.
 * `minAuthorLevel` : niveau plancher de l'auteur pour ce type de saisie (ex. un KPI de chantier ou
 * d'axe saisi par un responsable désigné hors hiérarchie est traité comme venant du niveau
 * "chantierSponsor" → validé par sponsor d'axe puis pilote). Un auteur sans position sur l'objet
 * est traité comme `minAuthorLevel`, ou à défaut comme un contributeur.
 * Une même personne ne figure jamais dans DEUX paliers (ex. un sponsor d'axe également pilote du
 * plan) : elle est retirée des paliers supérieurs, sinon elle validerait seule les deux fois ; un
 * palier ainsi vidé est sauté comme un niveau vide.
 * Chaîne vide = personne au-dessus → application directe.
 */
export function approvalChain(
  author: string,
  ctx: HierarchyContext,
  count: 1 | 2,
  minAuthorLevel?: StrategicLevel
): ApprovalStep[] {
  const own = authorLevel(author, ctx);
  const floor = minAuthorLevel ?? "contributor";
  const start = Math.max(own ? rank(own) : rank(floor), rank(floor));
  const holders = levelHolders(ctx);
  const chain: ApprovalStep[] = [];
  const used = new Set<string>([author]);
  for (const level of STRATEGIC_LEVELS.slice(start + 1)) {
    const usernames = holders[level].filter((u) => !used.has(u));
    usernames.forEach((u) => used.add(u));
    if (usernames.length === 0) continue;
    chain.push({ level, usernames });
    if (chain.length === count) break;
  }
  return chain;
}

export type DesignationTarget = "axisSponsor" | "chantierSponsor" | "projectOwner" | "contributors";

/** Niveau MINIMUM requis pour désigner la personne de chaque niveau (décision PO). */
const DESIGNATION_MIN_LEVEL: Record<DesignationTarget, StrategicLevel> = {
  axisSponsor: "pilot",
  chantierSponsor: "pilot",
  projectOwner: "chantierSponsor",
  contributors: "projectOwner",
};

/** `username` peut-il modifier ce champ de désignation ? Les admins peuvent toujours. */
export function canDesignate(
  target: DesignationTarget,
  username: string,
  ctx: HierarchyContext,
  isAdmin: boolean
): boolean {
  if (isAdmin) return true;
  const own = authorLevel(username, ctx);
  return own != null && rank(own) >= rank(DESIGNATION_MIN_LEVEL[target]);
}
