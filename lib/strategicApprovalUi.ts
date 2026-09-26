import { KPI_NEVER_FILL_ROLES, resolveStrategicRoleForProgram } from "@/lib/axisLogic";
import {
  ApprovalForbiddenError,
  ApprovalGateUnavailableError,
  ApprovalRetryError,
} from "@/lib/strategicApprovalFlows";
import {
  isPilotOrAdmin,
  type StaffingUpdateApprovalPayload,
  type StrategicApproval,
} from "@/lib/strategicApprovals";
import type { AuthUser, Chantier, StrategicAxis } from "@/types";

/**
 * Aides PURES au branchement UI des nouveaux kinds de validation (axes, objectifs KPI, staffing) :
 * classification des erreurs de flux (toasts), droit « Nouveau chantier » sur un axe, lookups des
 * demandes en attente (badges). Aucune dépendance React.
 */

// ─── Erreurs de flux → toast ─────────────────────────────────────────────────────────────────

export type ApprovalErrorKind = "retry" | "unavailable" | "forbidden" | "other";

/** Nature d'une erreur levée par un flux (`lib/strategicApprovalFlows.ts`). Se fie au `name`
 *  (robuste aux copies de classes entre bundles) autant qu'à `instanceof`. */
export function approvalErrorKind(error: unknown): ApprovalErrorKind {
  const name = error instanceof Error ? error.name : "";
  if (error instanceof ApprovalRetryError || name === "ApprovalRetryError") return "retry";
  if (error instanceof ApprovalGateUnavailableError || name === "ApprovalGateUnavailableError") {
    return "unavailable";
  }
  if (error instanceof ApprovalForbiddenError || name === "ApprovalForbiddenError") {
    return "forbidden";
  }
  return "other";
}

/** Titre + message d'un toast d'erreur de flux. `templates` : libellés traduits. Le cas "retry"
 *  affiche toujours le libellé traduit (« données en cours de chargement, réessayez ») ; les autres
 *  cas reprennent le message de l'erreur, à défaut le libellé générique. */
export function approvalErrorToast(
  error: unknown,
  templates: { title: string; retryTitle: string; retry: string; fallback: string }
): { title: string; message: string; kind: ApprovalErrorKind } {
  const kind = approvalErrorKind(error);
  if (kind === "retry") return { title: templates.retryTitle, message: templates.retry, kind };
  const message = error instanceof Error && error.message ? error.message : templates.fallback;
  return { title: templates.title, message, kind };
}

// ─── Droits ─────────────────────────────────────────────────────────────────────────────────

type PermUser = Pick<AuthUser, "username" | "profiles" | "isGlobalAdmin" | "isCompanyAdmin">;

/**
 * « Nouveau chantier » sur un axe : sponsor de chantier et au-dessus SUR CET AXE — pilote du
 * programme / admin, sponsor de l'axe (`owner`), ou sponsor (`pilote`) d'un chantier déjà rattaché
 * à l'axe. Jamais comex/RH ni un simple responsable projet / contributeur. La création reste
 * soumise à `createChantierFlow` (sponsor d'axe puis pilote).
 */
export function canCreateChantierOnAxis(
  user: PermUser | null | undefined,
  axis: Pick<StrategicAxis, "id" | "programId" | "owner"> | null | undefined,
  chantiers: Pick<Chantier, "pilote" | "axisIds">[]
): boolean {
  if (!user || !axis) return false;
  if (isPilotOrAdmin(user, axis.programId)) return true;
  const role = resolveStrategicRoleForProgram(user, axis.programId);
  if (role && KPI_NEVER_FILL_ROLES.includes(role)) return false;
  if (axis.owner && axis.owner === user.username) return true;
  return chantiers.some(
    (c) => !!c.pilote && c.pilote === user.username && (c.axisIds ?? []).includes(axis.id)
  );
}

// ─── Demandes en attente ─────────────────────────────────────────────────────────────────────

/** Demandes EN ATTENTE d'un kind sur une cible précise. */
export function pendingOfKind(
  approvals: StrategicApproval[] | undefined,
  kind: StrategicApproval["kind"],
  targetType: StrategicApproval["targetType"],
  targetId: string
): StrategicApproval[] {
  return (approvals ?? []).filter(
    (a) =>
      a.status === "pending" &&
      a.kind === kind &&
      a.targetType === targetType &&
      a.targetId === targetId
  );
}

/** Demandes "staffing_update" en attente, toutes cibles. */
function pendingStaffing(approvals: StrategicApproval[] | undefined): StrategicApproval[] {
  return (approvals ?? []).filter((a) => a.status === "pending" && a.kind === "staffing_update");
}

/** Demande "staffing_update" en attente sur une LIGNE ETP existante (modification / suppression). */
export function pendingStaffingForLine(
  approvals: StrategicApproval[] | undefined,
  lineId: string
): StrategicApproval | undefined {
  return pendingStaffing(approvals).find(
    (a) => (a.payload as StaffingUpdateApprovalPayload | undefined)?.line?.id === lineId
  );
}

/** Créations de lignes ETP en attente sur un chantier (et, si `actionId` est donné — `null` =
 *  lignes transverses au chantier —, restreintes à ce périmètre). */
export function pendingStaffingCreations(
  approvals: StrategicApproval[] | undefined,
  chantierId: string,
  actionId?: string | null
): StrategicApproval[] {
  return pendingStaffing(approvals).filter((a) => {
    const p = a.payload as StaffingUpdateApprovalPayload | undefined;
    if (p?.op !== "create" || p.line?.chantierId !== chantierId) return false;
    if (actionId === undefined) return true;
    return (p.line.actionId ?? null) === (actionId ?? null);
  });
}
