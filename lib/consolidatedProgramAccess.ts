import { resolveProgramType } from "@/lib/axisLogic";
import { hasRole } from "@/lib/roleProfiles";
import type { AuthUser, Program } from "@/types";

/**
 * Fondation "vue consolidée multi-programmes" (chantier CTO) : détermine, pour UN utilisateur, la
 * liste des `Program` de type "performance" auxquels il a droit dans une vue AGRÉGÉE (toutes les
 * données combinées — économies, alertes, leviers, mouvements RH), par opposition au sélecteur
 * mono-programme historique (`getAuthorizedPrograms`, voir lib/roleProfiles.ts).
 *
 * Volontairement une fonction SÉPARÉE de `getAuthorizedPrograms` plutôt qu'une extension de
 * celle-ci :
 *  - `getAuthorizedPrograms` répond à "quels programmes cet utilisateur peut-il SÉLECTIONNER un à
 *    un dans le Topbar ?" — dérivé de `ProfileAssignment.programId` (le rattachement du PROFIL à un
 *    programme, ou l'absence de rattachement = tous les programmes de l'entreprise du même type).
 *  - Cette fonction répond à "quels programmes entrent dans SA vue consolidée ?" — dérivée du rôle
 *    le plus large détenu et, pour les deux rôles scopés programme, de `Program.sponsor`/
 *    `Program.owner` (qui DÉSIGNE le programme, indépendamment de tout `ProfileAssignment`).
 *  Mélanger les deux logiques dans une seule fonction aurait rendu `getAuthorizedPrograms` (déjà
 *  utilisée par le sélecteur mono-programme existant, ne pas casser) plus difficile à lire pour un
 *  besoin qui ne le concerne pas.
 *
 * Règle de résolution, par rôle le plus large détenu par l'utilisateur (un utilisateur peut cumuler
 * plusieurs rôles Plan Performance sur des programmes différents — round multi-profils
 * multi-programmes — priorité descendante ci-dessous, du périmètre le plus large au plus étroit) :
 *  - `cto`             : TOUS les programmes "performance" de l'entreprise, QUE son/ses profil(s)
 *                         `cto` portent ou non un `programId` — la vue consolidée CTO n'est jamais
 *                         limitée par le rattachement programme de son profil (contrairement au
 *                         sélecteur mono-programme, voir la note ci-dessus).
 *  - `program_sponsor` : les programmes "performance" dont `Program.sponsor === user.username`.
 *  - `program_owner`   : les programmes "performance" dont `Program.owner === user.username`.
 *  - tout autre rôle (ou aucun de ces trois)              : `[]` — pas de vue consolidée disponible.
 *
 * `allPrograms` doit déjà être scopé à la bonne entreprise par l'appelant (même convention que
 * `getAuthorizedPrograms`) — cette fonction ne filtre QUE par type "performance" et par
 * rôle/périmètre, jamais par `companyId`.
 */
export function getConsolidatedPerformancePrograms(
  user: AuthUser | null | undefined,
  allPrograms: Program[]
): Program[] {
  if (!user) return [];

  const performancePrograms = allPrograms.filter(
    (program) => resolveProgramType(program) === "performance"
  );

  if (hasRole(user, "cto")) return performancePrograms;

  if (hasRole(user, "program_sponsor")) {
    return performancePrograms.filter((program) => program.sponsor === user.username);
  }

  if (hasRole(user, "program_owner")) {
    return performancePrograms.filter((program) => program.owner === user.username);
  }

  return [];
}
