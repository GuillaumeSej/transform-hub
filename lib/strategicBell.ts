import { isStrategicLeadOf } from "@/lib/axisLogic";
import { hasRole, isAnyAdmin } from "@/lib/roleProfiles";
import type { AuthUser, Program } from "@/types";

/**
 * Règles PURES de la cloche (Topbar / AppShell) en mode Plan Stratégique — lot 5.
 */

/**
 * Destinataires de l'alerte « Dépassement budgétaire » du programme : le PILOTE du plan
 * (`strategic_lead` de ce programme, ou « tous programmes »), les admins, et le SPONSOR du programme
 * (`Program.sponsor`, rôle `program_sponsor`) quand il est désigné. Personne d'autre : un montant
 * de dépassement sur le programme entier n'a pas à être diffusé à tout profil stratégique.
 */
export function receivesBudgetOverrunAlert(
  user:
    | (Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> & { username?: string })
    | null
    | undefined,
  program: Pick<Program, "id" | "sponsor"> | null | undefined
): boolean {
  if (!user || !program) return false;
  if (isAnyAdmin(user)) return true;
  if (isStrategicLeadOf({ programId: program.id }, user)) return true;
  return (
    !!user.username &&
    !!program.sponsor &&
    program.sponsor === user.username &&
    hasRole(user, "program_sponsor")
  );
}

/**
 * Nombre affiché sur la cloche : en mode stratégique, UNIQUEMENT les alertes du plan actif — les
 * files du Plan Performance (portes de validation de leviers, réalisés, suppressions) n'y ont rien
 * à faire (elles ne sont d'ailleurs pas listées dans le menu de la cloche stratégique).
 */
export function bellAlertCount(input: {
  isStrategic: boolean;
  alerts: number;
  performanceQueues: number[];
}): number {
  if (input.isStrategic) return input.alerts;
  return input.performanceQueues.reduce((sum, n) => sum + n, input.alerts);
}
