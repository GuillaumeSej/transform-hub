import type { Program, WorkforceMovement } from "@/types";
import { daysBetween } from "@/lib/dateUtils";
import { HR_TODAY } from "@/lib/hrEngine";

export type MovementExecutionStatus = "realized" | "overdue" | "dueSoon" | "later" | "abandoned";
export type MovementActionStatus = Exclude<MovementExecutionStatus, "abandoned"> | "toValidate";
export type OwnerActionStatus = MovementActionStatus;
export type ExecutionDimension = "function" | "country" | "program";

export const EXECUTION_LABELS: Record<MovementExecutionStatus | "toValidate", string> = {
  realized: "Réalisé",
  overdue: "En retard",
  dueSoon: "À venir < 90 j",
  later: "À venir > 90 j",
  abandoned: "Abandonné",
  toValidate: "À valider RH",
};

export function classifyMovementExecution(
  movement: WorkforceMovement,
  today: string = HR_TODAY,
  dueSoonDays = 90
): MovementExecutionStatus {
  if (movement.status === "Abandonné") return "abandoned";
  if (movement.status === "Réalisé") return "realized";
  if (movement.plannedDate < today) return "overdue";
  return daysBetween(today, movement.plannedDate) <= dueSoonDays ? "dueSoon" : "later";
}

export function classifyMovementAction(
  movement: WorkforceMovement,
  today: string = HR_TODAY,
  dueSoonDays = 90
): MovementActionStatus | null {
  if (movement.status === "Abandonné") return null;
  if (movement.status === "Réalisé" && !movement.hrValidated) return "toValidate";
  return classifyMovementExecution(movement, today, dueSoonDays) as MovementActionStatus;
}

export type ExecutionImpactCell = { volume: number; net: number; count: number };
export type ExecutionImpactRow = {
  key: string;
  label: string;
  realized: ExecutionImpactCell;
  overdue: ExecutionImpactCell;
  dueSoon: ExecutionImpactCell;
  later: ExecutionImpactCell;
  abandoned: ExecutionImpactCell;
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

export function executionByDimension(
  movements: WorkforceMovement[],
  dimension: ExecutionDimension,
  programs: Program[],
  mode: "fte" | "salary",
  today: string = HR_TODAY
): ExecutionImpactRow[] {
  const rows = new Map<string, ExecutionImpactRow>();
  for (const movement of movements) {
    const status = classifyMovementExecution(movement, today);
    const key = dimensionLabel(movement, dimension, programs);
    const row = rows.get(key) ?? {
      key,
      label: key,
      realized: emptyCell(),
      overdue: emptyCell(),
      dueSoon: emptyCell(),
      later: emptyCell(),
      abandoned: emptyCell(),
    };
    const value =
      mode === "fte"
        ? status === "realized"
          ? movement.fte
          : (movement.reforecast?.fte ?? movement.lockedPlan?.fte ?? movement.fte)
        : movement.salaryImpact / 1_000_000;
    row[status].volume += value;
    row[status].net += value;
    row[status].count += 1;
    rows.set(key, row);
  }
  return Array.from(rows.values()).sort(
    (a, b) =>
      Math.abs(b.overdue.volume) +
      Math.abs(b.dueSoon.volume) -
      (Math.abs(a.overdue.volume) + Math.abs(a.dueSoon.volume))
  );
}

export const fteExecutionByDimension = (
  movements: WorkforceMovement[],
  dimension: ExecutionDimension,
  programs: Program[],
  today: string = HR_TODAY
) => executionByDimension(movements, dimension, programs, "fte", today);

export const salaryExecutionByDimension = (
  movements: WorkforceMovement[],
  dimension: ExecutionDimension,
  programs: Program[],
  today: string = HR_TODAY
) => executionByDimension(movements, dimension, programs, "salary", today);

export type MovementStatusCell = {
  movement: WorkforceMovement;
  execution: MovementExecutionStatus;
};
export type MovementStatusGroup = { key: string; label: string; cells: MovementStatusCell[] };

export function movementStatusGroups(
  movements: WorkforceMovement[],
  dimension: ExecutionDimension,
  programs: Program[],
  today: string = HR_TODAY
): MovementStatusGroup[] {
  const groups = new Map<string, MovementStatusCell[]>();
  for (const movement of movements) {
    const execution = classifyMovementExecution(movement, today);
    const key = dimensionLabel(movement, dimension, programs);
    groups.set(key, [...(groups.get(key) ?? []), { movement, execution }]);
  }
  return Array.from(groups.entries())
    .map(([key, cells]) => ({ key, label: key, cells }))
    .sort((a, b) => b.cells.length - a.cells.length || a.label.localeCompare(b.label, "fr"));
}

export type MovementStatusByTypeRow = {
  type: WorkforceMovement["type"];
  realized: number;
  overdue: number;
  dueSoon: number;
  later: number;
  abandoned: number;
};
const MOVEMENT_TYPE_ORDER: WorkforceMovement["type"][] = [
  "Recrutement",
  "Attrition",
  "Départ forcé",
  "Transfert entrant",
  "Transfert sortant",
];

export function movementStatusByType(
  movements: WorkforceMovement[],
  filters: { department?: string; country?: string } = {},
  today: string = HR_TODAY
): MovementStatusByTypeRow[] {
  const rows = new Map(
    MOVEMENT_TYPE_ORDER.map((type) => [
      type,
      { type, realized: 0, overdue: 0, dueSoon: 0, later: 0, abandoned: 0 },
    ])
  );
  for (const movement of movements) {
    if (filters.department && movement.department !== filters.department) continue;
    if (filters.country && movement.country !== filters.country) continue;
    rows.get(movement.type)![classifyMovementExecution(movement, today)] += 1;
  }
  return MOVEMENT_TYPE_ORDER.map((type) => rows.get(type)!).sort((a, b) => {
    const totalA = a.realized + a.overdue + a.dueSoon + a.later + a.abandoned;
    const totalB = b.realized + b.overdue + b.dueSoon + b.later + b.abandoned;
    return (
      totalB - totalA || MOVEMENT_TYPE_ORDER.indexOf(a.type) - MOVEMENT_TYPE_ORDER.indexOf(b.type)
    );
  });
}

export type OwnerActionCell = { count: number; fte: number };
export type OwnerActionRow = {
  owner: string;
  overdue: OwnerActionCell;
  dueSoon: OwnerActionCell;
  later: OwnerActionCell;
  realized: OwnerActionCell;
  toValidate: OwnerActionCell;
  nextDueDate: string | null;
};
const emptyOwnerCell = (): OwnerActionCell => ({ count: 0, fte: 0 });

export function ownerActionSummary(
  movements: WorkforceMovement[],
  today: string = HR_TODAY,
  dueSoonDays = 90
): OwnerActionRow[] {
  const rows = new Map<string, OwnerActionRow>();
  for (const movement of movements) {
    const action = classifyMovementAction(movement, today, dueSoonDays);
    if (!action) continue;
    const owner = movement.hrOwner || "Non renseigné";
    const row = rows.get(owner) ?? {
      owner,
      overdue: emptyOwnerCell(),
      dueSoon: emptyOwnerCell(),
      later: emptyOwnerCell(),
      realized: emptyOwnerCell(),
      toValidate: emptyOwnerCell(),
      nextDueDate: null,
    };
    row[action].count += 1;
    row[action].fte += movement.fte;
    if (movement.status === "Réalisé" && action === "toValidate") {
      row.realized.count += 1;
      row.realized.fte += movement.fte;
    } else if (movement.status !== "Réalisé") {
      if (!row.nextDueDate || movement.plannedDate < row.nextDueDate)
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
