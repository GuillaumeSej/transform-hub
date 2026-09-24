"use client";

import { useMemo } from "react";
import { isStrategicLeadOf } from "@/lib/axisLogic";
import { isLeverSponsoredBy } from "@/lib/leversLogic";
import { hasRole, isAnyAdmin } from "@/lib/roleProfiles";
import type { AuthUser, BeTrackData, Chantier, ChantierAction, Lever } from "@/types";

/** L'utilisateur a-t-il le rôle "cto" sur le programme de ce levier ? Fonction LOCALE à ce
 *  fichier (ne pas la déplacer dans `lib/leversLogic.ts`, réservé à l'autre agent qui implémente
 *  la logique métier de la cascade) : un profil "cto" sans `programId` couvre tous les
 *  programmes, un profil scopé à un programme ne couvre que celui-ci — même convention que
 *  `getAuthorizedPrograms` dans `lib/roleProfiles.ts`. */
function isCtoForLever(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  lever: Pick<Lever, "programId">
): boolean {
  return (
    hasRole(user, "cto") &&
    !!user?.profiles?.some(
      (p) => p.role === "cto" && (!p.programId || p.programId === lever.programId)
    )
  );
}

/**
 * Résolution PURE de la file d'attente de validation, extraite du hook pour être testable sans
 * rendu React (voir lib/hooks/useApprovalQueue.test.ts). Même mécanique que `canUserViewLever`
 * (lib/leversLogic.ts) pour la résolution du sponsor de workstream : lu pour s'en inspirer, non
 * modifié. Modèle à approbateur UNIQUE (voir lib/leversLogic.ts::approveLeverGate) : un levier
 * avec une demande en cours apparaît pour le sponsor du workstream OU le CTO habilité, peu
 * importe la porte concernée (M1→M2/M2→M3/M3→M4) — et pour tout admin (global ou entreprise),
 * habilité sur n'importe quelle demande comme `approveLeverGate`/`rejectLeverApproval`.
 */
export function resolveApprovalQueue(
  data: Pick<BeTrackData, "levers" | "workstreams">,
  user: AuthUser | null | undefined
): Lever[] {
  if (!user) return [];
  if (isAnyAdmin(user)) return data.levers.filter((lever) => !!lever.approval);
  return data.levers.filter((lever) => {
    if (!lever.approval) return false;
    const parentWorkstream = data.workstreams.find((w) => w.id === lever.ws);
    return isLeverSponsoredBy(lever, parentWorkstream, user) || isCtoForLever(user, lever);
  });
}

/**
 * Sur le modèle exact de `useNotifications` (lib/hooks/useNotifications.ts) : résout la file des
 * leviers dont la demande de validation (sponsor OU cto, voir `lib/leversLogic.ts::approveLeverGate`
 * pour la logique métier) attend actuellement CET utilisateur — pour alimenter le badge/dropdown
 * de notifications ET la page dédiée `/validation` ("mes leviers à valider").
 */
export function useApprovalQueue(data: BeTrackData, user: AuthUser | null | undefined) {
  const queue = useMemo(() => resolveApprovalQueue(data, user), [data, user]);

  return {
    queue,
    count: queue.length,
  };
}

// ─── Pendant Plan Stratégique — jalons E0→E4 (round "jalon validation gate") ───────────────────
//
// Même page dédiée `/validation` et même dropdown Topbar que la file ci-dessus, mais pour la
// DEMANDE DE VALIDATION DE JALON d'un projet (`ChantierAction.milestoneApproval`, voir
// `lib/axisLogic.ts::requestMilestoneApproval`/`approveMilestoneGate`) plutôt qu'une porte de
// cycle de vie de levier — modèle à approbateur UNIQUE (`strategic_lead`, voir
// `isStrategicLeadOf`), pas de sponsor/cto : structurellement absent du Plan Stratégique.

/** UNE ligne de la file d'attente de validation de jalon — le projet en attente ET son chantier
 *  parent déjà résolu (mêmes deux informations que la page/le dropdown ont besoin d'afficher :
 *  nom du chantier, nom du projet), même esprit que `ProgramRoadmapRow` (lib/axisLogic.ts). */
export type MilestoneApprovalQueueEntry = {
  action: ChantierAction;
  chantier: Chantier;
};

/**
 * Résolution PURE de la file d'attente de validation de jalon — voir `resolveApprovalQueue`
 * ci-dessus (même mécanique, adaptée). Un projet dont le chantier parent est introuvable
 * (référence orpheline) n'apparaît jamais dans la file : `isStrategicLeadOf` a besoin du chantier
 * pour résoudre son `programId`, et aucun projet fantôme ne doit être présenté à l'approbation.
 */
export function resolveMilestoneApprovalQueue(
  chantierActions: ChantierAction[],
  chantiers: Chantier[],
  user: AuthUser | null | undefined
): MilestoneApprovalQueueEntry[] {
  if (!user) return [];
  const chantierById = new Map(chantiers.map((c) => [c.id, c]));
  const entries: MilestoneApprovalQueueEntry[] = [];
  for (const action of chantierActions) {
    if (!action.milestoneApproval) continue;
    const chantier = chantierById.get(action.chantierId);
    if (!chantier) continue;
    if (isAnyAdmin(user) || isStrategicLeadOf(chantier, user)) {
      entries.push({ action, chantier });
    }
  }
  return entries;
}

/** Sur le modèle exact de `useApprovalQueue` ci-dessus — résout la file des projets dont la
 *  demande de validation de jalon (`strategic_lead` scopé au programme, voir `isStrategicLeadOf`)
 *  attend actuellement CET utilisateur, pour alimenter le badge/dropdown de notifications ET la
 *  page dédiée `/validation` en mode Plan Stratégique. */
export function useMilestoneApprovalQueue(
  data: { chantierActions: ChantierAction[]; chantiers: Chantier[] },
  user: AuthUser | null | undefined
) {
  const queue = useMemo(
    () => resolveMilestoneApprovalQueue(data.chantierActions, data.chantiers, user),
    [data.chantierActions, data.chantiers, user]
  );

  return {
    queue,
    count: queue.length,
  };
}
