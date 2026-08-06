import type { Program, WorkforceMovement } from "@/types";
import { daysBetween } from "@/lib/dateUtils";
import { fteEffect, HR_TODAY } from "@/lib/hrEngine";

export type MovementExecutionStatus = "realized" | "inProgress" | "overdue" | "upcoming";
export type MovementActionStatus = MovementExecutionStatus | "dueSoon" | "later" | "toValidate";
export type OwnerActionStatus = Exclude<MovementActionStatus, "upcoming">;
export type ExecutionDimension = "function" | "country" | "program";

export const EXECUTION_LABELS: Record<MovementActionStatus, string> = {
  realized: "Réalisé",
  inProgress: "En cours",
  overdue: "En retard",
  upcoming: "À venir",
  dueSoon: "À venir ≤ 90 j",
  later: "Plus lointain",
  toValidate: "À valider RH",
};

/** Classification commune des graphiques d'exécution. */
export function classifyMovementExecution(
  movement: WorkforceMovement,
  today: string = HR_TODAY
): MovementExecutionStatus {
  if (movement.status === "Réalisé") return "realized";
  if (movement.plannedDate < today) return "overdue";
  if (movement.status === "En cours") return "inProgress";
  return "upcoming";
}

/** Classification détaillée pour la table RH Owner, avec horizon court terme paramétrable. */
export function classifyMovementAction(
  movement: WorkforceMovement,
  today: string = HR_TODAY,
  dueSoonDays = 90
): OwnerActionStatus {
  if (movement.status === "Réalisé" && !movement.hrValidated) return "toValidate";
  const execution = classifyMovementExecution(movement, today);
  if (execution !== "upcoming") return execution;
  return daysBetween(today, movement.plannedDate) <= dueSoonDays ? "dueSoon" : "later";
}

export type ExecutionImpactCell = {
  volume: number;
  net: number;
  count: number;
};

export type ExecutionImpactRow = {
  key: string;
  label: string;
  realized: ExecutionImpactCell;
  inProgress: ExecutionImpactCell;
  overdue: ExecutionImpactCell;
  upcoming: ExecutionImpactCell;
};

const emptyCell = (): ExecutionImpactCell => ({ volume: 0, net: 0, count: 0 });

function dimensionLabel(
  movement: WorkforceMovement,
  dimension: ExecutionDimension,
  programs: Program[]
): string {
  if (dimension === "function") return movement.function || "Non renseigné";
  if (dimension === "country") return movement.country || "Non renseigné";
  return (
    programs.find((program) => program.id === movement.programId)?.name ??
    movement.programId ??
    "Non renseigné"
  );
}

/** Volumes ETP pilotés par statut. Les barres restent positives ; `net` conserve l'impact signé
 * pour le tooltip afin que recrutements et départs ne se masquent pas visuellement. */
export function fteExecutionByDimension(
  movements: WorkforceMovement[],
  dimension: ExecutionDimension,
  programs: Program[],
  today: string = HR_TODAY
): ExecutionImpactRow[] {
  const rows = new Map<string, ExecutionImpactRow>();
  for (const movement of movements) {
    const key = dimensionLabel(movement, dimension, programs);
    const row = rows.get(key) ?? {
      key,
      label: key,
      realized: emptyCell(),
      inProgress: emptyCell(),
      overdue: emptyCell(),
      upcoming: emptyCell(),
    };
    const status = classifyMovementExecution(movement, today);
    const fte =
      status === "realized"
        ? movement.fte
        : (movement.reforecast?.fte ?? movement.lockedPlan?.fte ?? movement.fte);
    row[status].volume += fte;
    row[status].net += fteEffect({ ...movement, fte });
    row[status].count += 1;
    rows.set(key, row);
  }
  return Array.from(rows.values()).sort(
    (a, b) =>
      b.overdue.volume +
      b.inProgress.volume +
      b.upcoming.volume -
      (a.overdue.volume + a.inProgress.volume + a.upcoming.volume)
  );
}

/** Impact masse salariale signé (€M annualisés) par statut et dimension. */
export function salaryExecutionByDimension(
  movements: WorkforceMovement[],
  dimension: ExecutionDimension,
  programs: Program[],
  today: string = HR_TODAY
): ExecutionImpactRow[] {
  const rows = new Map<string, ExecutionImpactRow>();
  for (const movement of movements) {
    const key = dimensionLabel(movement, dimension, programs);
    const row = rows.get(key) ?? {
      key,
      label: key,
      realized: emptyCell(),
      inProgress: emptyCell(),
      overdue: emptyCell(),
      upcoming: emptyCell(),
    };
    const status = classifyMovementExecution(movement, today);
    const value =
      (status === "realized"
        ? movement.salaryImpact
        : (movement.reforecast?.salaryImpact ??
          movement.lockedPlan?.salaryImpact ??
          movement.salaryImpact)) / 1_000_000;
    row[status].volume += value;
    row[status].net += value;
    row[status].count += 1;
    rows.set(key, row);
  }
  return Array.from(rows.values()).sort(
    (a, b) =>
      Math.abs(b.overdue.volume) +
      Math.abs(b.inProgress.volume) -
      (Math.abs(a.overdue.volume) + Math.abs(a.inProgress.volume))
  );
}

export type OwnerActionCell = { count: number; fte: number };
export type OwnerActionRow = {
  owner: string;
  overdue: OwnerActionCell;
  inProgress: OwnerActionCell;
  dueSoon: OwnerActionCell;
  later: OwnerActionCell;
  realized: OwnerActionCell;
  toValidate: OwnerActionCell;
  nextDueDate: string | null;
};

const emptyOwnerCell = (): OwnerActionCell => ({ count: 0, fte: 0 });

/** Vue actionnable par RH Owner. */
export function ownerActionSummary(
  movements: WorkforceMovement[],
  today: string = HR_TODAY,
  dueSoonDays = 90
): OwnerActionRow[] {
  const rows = new Map<string, OwnerActionRow>();
  for (const movement of movements) {
    const owner = movement.hrOwner || "Non renseigné";
    const row = rows.get(owner) ?? {
      owner,
      overdue: emptyOwnerCell(),
      inProgress: emptyOwnerCell(),
      dueSoon: emptyOwnerCell(),
      later: emptyOwnerCell(),
      realized: emptyOwnerCell(),
      toValidate: emptyOwnerCell(),
      nextDueDate: null,
    };
    const action = classifyMovementAction(movement, today, dueSoonDays);
    row[action].count += 1;
    row[action].fte += movement.fte;
    if (movement.status === "Réalisé") {
      row.realized.count += action === "realized" ? 0 : 1;
      row.realized.fte += action === "realized" ? 0 : movement.fte;
    } else if (!row.nextDueDate || movement.plannedDate < row.nextDueDate) {
      row.nextDueDate = movement.plannedDate;
    }
    rows.set(owner, row);
  }
  return Array.from(rows.values()).sort((a, b) => {
    if (b.overdue.count !== a.overdue.count) return b.overdue.count - a.overdue.count;
    if (b.dueSoon.count !== a.dueSoon.count) return b.dueSoon.count - a.dueSoon.count;
    return (a.nextDueDate ?? "9999-12-31").localeCompare(b.nextDueDate ?? "9999-12-31");
  });
}
