import { matchesFilter } from "@/lib/filterUtils";
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

export type ExecutionImpactCell = {
  volume: number;
  net: number;
  count: number;
  /** Mouvements derrière ce statut — alimente le drill-down au clic sur une barre/segment
   *  (`ExecutionStatusChart` + `MovementDrilldownModal`), même pattern que
   *  `movementStatusByType`'s `movementsByStatus` ci-dessous. */
  movements: WorkforceMovement[];
};
export type ExecutionImpactRow = {
  key: string;
  label: string;
  realized: ExecutionImpactCell;
  overdue: ExecutionImpactCell;
  dueSoon: ExecutionImpactCell;
  later: ExecutionImpactCell;
  abandoned: ExecutionImpactCell;
};
const emptyCell = (): ExecutionImpactCell => ({ volume: 0, net: 0, count: 0, movements: [] });

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
    row[status].movements.push(movement);
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
  /** Mouvements derrière chaque compteur de statut — alimente le drill-down au clic sur une barre
   *  (`MovementStatusByTypeChart` + `MovementDrilldownModal`). */
  movementsByStatus: Record<MovementExecutionStatus, WorkforceMovement[]>;
};
const MOVEMENT_TYPE_ORDER: WorkforceMovement["type"][] = [
  "Recrutement",
  "Attrition",
  "Départ forcé",
  "Transfert entrant",
  "Transfert sortant",
];
const emptyMovementsByStatus = (): Record<MovementExecutionStatus, WorkforceMovement[]> => ({
  realized: [],
  overdue: [],
  dueSoon: [],
  later: [],
  abandoned: [],
});

export function movementStatusByType(
  movements: WorkforceMovement[],
  filters: { department?: string | string[]; country?: string | string[] } = {},
  today: string = HR_TODAY
): MovementStatusByTypeRow[] {
  const rows = new Map(
    MOVEMENT_TYPE_ORDER.map((type) => [
      type,
      {
        type,
        realized: 0,
        overdue: 0,
        dueSoon: 0,
        later: 0,
        abandoned: 0,
        movementsByStatus: emptyMovementsByStatus(),
      },
    ])
  );
  for (const movement of movements) {
    if (!matchesFilter(movement.department, filters.department)) continue;
    if (!matchesFilter(movement.country, filters.country)) continue;
    const status = classifyMovementExecution(movement, today);
    const row = rows.get(movement.type)!;
    row[status] += 1;
    row.movementsByStatus[status].push(movement);
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

// ─── Avancement des mouvements par dimension (widget "movement-progress", proposition) ─────────

export type MovementProgressDimension = "program" | "department" | "country";

/** Ordre d'affichage (empilement + légende) des 5 statuts du widget "Avancement des mouvements". */
export const MOVEMENT_PROGRESS_STATUS_ORDER: MovementExecutionStatus[] = [
  "realized",
  "overdue",
  "dueSoon",
  "later",
  "abandoned",
];

export type MovementProgressRow = {
  key: string;
  label: string;
  total: number;
  /** Nombre de mouvements par statut (compteurs = longueur de `movementsByStatus[status]`). */
  counts: Record<MovementExecutionStatus, number>;
  /** Mouvements derrière chaque segment — alimente le drill-down "qui a fait quoi". */
  movementsByStatus: Record<MovementExecutionStatus, WorkforceMovement[]>;
};

/** Regroupe les mouvements par programme / département / pays et les répartit dans les 5 statuts
 *  d'exécution (`classifyMovementExecution` : Abandonné, Réalisé, En retard = date prévue passée,
 *  À venir ≤ 90 j, À venir > 90 j). Contrairement à `movementBreakdownByDimension`
 *  (lib/hrEngine.ts), les mouvements abandonnés sont CONSERVÉS (segment dédié). Tri : total
 *  décroissant puis libellé. */
export function movementProgressByDimension(
  movements: WorkforceMovement[],
  dimension: MovementProgressDimension,
  programLabels: Record<string, string> = {},
  today: string = HR_TODAY,
  dueSoonDays = 90
): MovementProgressRow[] {
  const rows = new Map<string, MovementProgressRow>();
  for (const movement of movements) {
    const raw =
      dimension === "program"
        ? movement.programId
          ? (programLabels[movement.programId] ?? movement.programId)
          : ""
        : dimension === "department"
          ? movement.department
          : movement.country;
    const key = raw || "Non renseigné";
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        label: key,
        total: 0,
        counts: { realized: 0, overdue: 0, dueSoon: 0, later: 0, abandoned: 0 },
        movementsByStatus: emptyMovementsByStatus(),
      };
      rows.set(key, row);
    }
    const status = classifyMovementExecution(movement, today, dueSoonDays);
    row.counts[status] += 1;
    row.movementsByStatus[status].push(movement);
    row.total += 1;
  }
  return Array.from(rows.values()).sort(
    (a, b) => b.total - a.total || a.label.localeCompare(b.label, "fr")
  );
}
