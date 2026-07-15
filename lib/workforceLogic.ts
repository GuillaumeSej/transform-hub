import type { AuditEntry, Employee, WorkforceMovement } from "@/types";

/**
 * Logique métier pure du périmètre "workforce" (base ETP + mouvements) — pattern identique à
 * lib/leversLogic.ts : pas d'I/O, prend l'état courant en entrée et retourne le nouvel état +
 * les entités à persister + les entrées d'audit. useBeTrackData fait la mise à jour optimiste
 * puis écrit dans Firestore en tâche de fond.
 */

function nowTs(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextMovementId(existingIds: string[]): string {
  const maxNum = existingIds.reduce((max, id) => {
    const m = /^MV(\d+)$/.exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `MV${String(maxNum + 1).padStart(3, "0")}`;
}

function nextEmployeeId(existingIds: string[]): string {
  const maxNum = existingIds.reduce((max, id) => {
    const m = /^EMP(\d+)$/.exec(id);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
  return `EMP${String(maxNum + 1).padStart(3, "0")}`;
}

function makeAuditEntry(entry: Omit<AuditEntry, "ts">): AuditEntry {
  return { ...entry, ts: nowTs() };
}

export type MovementMutationResult = {
  movements: WorkforceMovement[];
  movement: WorkforceMovement;
  auditEntries: AuditEntry[];
};

export function createMovement(
  movements: WorkforceMovement[],
  input: Omit<WorkforceMovement, "id">,
  user: string
): MovementMutationResult {
  const movement: WorkforceMovement = {
    ...input,
    id: nextMovementId(movements.map((m) => m.id)),
  };
  return {
    movements: [...movements, movement],
    movement,
    auditEntries: [
      makeAuditEntry({
        user,
        action: "created",
        entity: movement.id,
        field: "mouvement RH",
        old: "",
        new: `${movement.type} · ${movement.label}`,
      }),
    ],
  };
}

export function updateMovement(
  movements: WorkforceMovement[],
  id: string,
  patch: Partial<WorkforceMovement>,
  user: string
): MovementMutationResult {
  const idx = movements.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(`Mouvement "${id}" introuvable`);
  const before = movements[idx];
  const after: WorkforceMovement = { ...before, ...patch };
  const next = [...movements];
  next[idx] = after;

  const auditEntries = (Object.keys(patch) as (keyof WorkforceMovement)[])
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) =>
      makeAuditEntry({
        user,
        action: "updated",
        entity: id,
        field: `mouvement RH · ${String(k)}`,
        old: String(before[k] ?? ""),
        new: String(after[k] ?? ""),
      })
    );

  return { movements: next, movement: after, auditEntries };
}

/** Validation RH : confirme que le mouvement a réellement eu lieu — passe le statut à Réalisé,
 * fixe la date réelle si absente, et pose le flag hrValidated. */
export function validateMovement(
  movements: WorkforceMovement[],
  id: string,
  user: string
): MovementMutationResult {
  const idx = movements.findIndex((m) => m.id === id);
  if (idx === -1) throw new Error(`Mouvement "${id}" introuvable`);
  const before = movements[idx];
  const after: WorkforceMovement = {
    ...before,
    status: "Réalisé",
    actualDate: before.actualDate ?? nowDate(),
    hrValidated: true,
  };
  const next = [...movements];
  next[idx] = after;
  return {
    movements: next,
    movement: after,
    auditEntries: [
      makeAuditEntry({
        user,
        action: "validated",
        entity: id,
        field: "mouvement RH",
        old: before.status,
        new: `Réalisé · validé RH (${after.actualDate})`,
      }),
    ],
  };
}

export function deleteMovement(
  movements: WorkforceMovement[],
  id: string,
  user: string
): { movements: WorkforceMovement[]; deletedId: string; auditEntries: AuditEntry[] } {
  const target = movements.find((m) => m.id === id);
  return {
    movements: movements.filter((m) => m.id !== id),
    deletedId: id,
    auditEntries: target
      ? [
          makeAuditEntry({
            user,
            action: "deleted",
            entity: id,
            field: "mouvement RH",
            old: `${target.type} · ${target.label}`,
            new: "supprimé",
          }),
        ]
      : [],
  };
}

export type EmployeeMutationResult = {
  employees: Employee[];
  employee: Employee;
  created: boolean;
  auditEntries: AuditEntry[];
};

/** Créé (id auto EMP###) ou met à jour (id fourni existant) un employé — utilisé par l'édition
 * inline de la Base ETP et par l'import Excel (upsert par matricule). */
export function upsertEmployee(
  employees: Employee[],
  input: Employee | (Omit<Employee, "id"> & { id?: string }),
  user: string
): EmployeeMutationResult {
  const idx = input.id ? employees.findIndex((e) => e.id === input.id) : -1;
  if (idx >= 0) {
    const before = employees[idx];
    const after: Employee = { ...before, ...input, id: before.id };
    const next = [...employees];
    next[idx] = after;
    const changed = (Object.keys(input) as (keyof Employee)[]).filter(
      (k) => String(before[k] ?? "") !== String(after[k] ?? "")
    );
    return {
      employees: next,
      employee: after,
      created: false,
      auditEntries: changed.map((k) =>
        makeAuditEntry({
          user,
          action: "updated",
          entity: before.id,
          field: `employé · ${String(k)}`,
          old: String(before[k] ?? ""),
          new: String(after[k] ?? ""),
        })
      ),
    };
  }

  const employee: Employee = {
    ...(input as Omit<Employee, "id">),
    id: input.id ?? nextEmployeeId(employees.map((e) => e.id)),
  };
  return {
    employees: [...employees, employee],
    employee,
    created: true,
    auditEntries: [
      makeAuditEntry({
        user,
        action: "created",
        entity: employee.id,
        field: "employé",
        old: "",
        new: employee.name,
      }),
    ],
  };
}
