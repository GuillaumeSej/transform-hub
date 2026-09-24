import type {
  AuditEntry,
  Employee,
  MovementStatus,
  SocialScheme,
  WorkforceMovement,
} from "@/types";
import type { WorkforceMeta } from "@/lib/firestore/workforce";

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

/** Patch métier d'un changement de statut depuis les tableaux RH.
 * - passage à Réalisé : renseigne la date effective si absente ;
 * - retour à Planifié/En cours : efface la date effective et la validation RH. */
export function movementStatusPatch(
  movement: WorkforceMovement,
  status: MovementStatus,
  effectiveDate: string = nowDate()
): Partial<WorkforceMovement> {
  if (status === "Réalisé") {
    return {
      status,
      actualDate: movement.actualDate ?? effectiveDate,
    };
  }
  return {
    status,
    actualDate: null,
    hrValidated: false,
  };
}

/** Un mouvement abandonné est conservé dans la base et les exports mais exclu des prévisions,
 * trajectoires, KPI et alertes opérationnelles. */
export function isActiveMovement(movement: WorkforceMovement): boolean {
  return movement.status !== "Abandonné";
}

/** Synchronise le nouveau dispositif social et le booléen PSE historique. */
export function movementSocialSchemePatch(
  socialScheme: SocialScheme | undefined
): Partial<WorkforceMovement> {
  return {
    socialScheme,
    inPSE: socialScheme === "PSE",
  };
}

export function nextMovementId(existingIds: string[]): string {
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

export type EmployeeRenameResult = {
  employees: Employee[];
  movements: WorkforceMovement[];
  employee: Employee;
  /** Nombre de mouvements dont `empId` a été repointé vers le nouveau matricule. */
  movedMovements: number;
  auditEntries: AuditEntry[];
};

/**
 * Renommage RÉEL d'un matricule (édition inline de la Base ETP) : le nouveau matricule doit être
 * libre, l'ancien enregistrement disparaît et les mouvements rattachés (`empId`) suivent. Remplace
 * l'ancien `upsertEmployee({ ...employee, id: nouveau })` qui créait un doublon (l'ancien restait)
 * ou écrasait silencieusement un autre employé portant déjà ce matricule. Lève en cas d'erreur.
 */
export function renameEmployee(
  employees: Employee[],
  movements: WorkforceMovement[],
  oldId: string,
  newIdRaw: string,
  user: string
): EmployeeRenameResult {
  const newId = newIdRaw.trim();
  const idx = employees.findIndex((e) => e.id === oldId);
  if (idx === -1) throw new Error(`Employé "${oldId}" introuvable`);
  if (!newId) throw new Error("Le matricule ne peut pas être vide");
  if (newId !== oldId && employees.some((e) => e.id === newId))
    throw new Error(`Le matricule "${newId}" est déjà attribué à un autre employé`);
  const employee: Employee = { ...employees[idx], id: newId };
  const nextEmployees = [...employees];
  nextEmployees[idx] = employee;
  let movedMovements = 0;
  const nextMovements = movements.map((m) => {
    if (m.empId !== oldId) return m;
    movedMovements += 1;
    return { ...m, empId: newId };
  });
  return {
    employees: nextEmployees,
    movements: nextMovements,
    employee,
    movedMovements,
    auditEntries:
      newId === oldId
        ? []
        : [
            makeAuditEntry({
              user,
              action: "updated",
              entity: newId,
              field: "employé · matricule",
              old: oldId,
              new: newId,
            }),
          ],
  };
}

export type WorkforceImportResult = {
  employees: Employee[];
  movements: WorkforceMovement[];
  auditEntries: AuditEntry[];
};

/**
 * Fusion d'un import Excel RH (enregistrements complets déjà validés par
 * `lib/hrExcel.ts::buildHrImportPlan`) dans les listes courantes : upsert par matricule / id de
 * mouvement, en UNE opération (l'appelant écrit ensuite chaque liste en une seule écriture).
 */
export function mergeWorkforceImport(
  employees: Employee[],
  movements: WorkforceMovement[],
  importedEmployees: Employee[],
  importedMovements: WorkforceMovement[],
  user: string
): WorkforceImportResult {
  const auditEntries: AuditEntry[] = [];
  const empById = new Map(employees.map((e) => [e.id, e]));
  for (const e of importedEmployees) {
    const before = empById.get(e.id);
    auditEntries.push(
      makeAuditEntry({
        user,
        action: before ? "updated" : "created",
        entity: e.id,
        field: "employé (import Excel)",
        old: before ? before.name : "",
        new: e.name,
      })
    );
    empById.set(e.id, e);
  }
  const movById = new Map(movements.map((m) => [m.id, m]));
  for (const m of importedMovements) {
    const before = movById.get(m.id);
    auditEntries.push(
      makeAuditEntry({
        user,
        action: before ? "updated" : "created",
        entity: m.id,
        field: "mouvement RH (import Excel)",
        old: before ? `${before.type} · ${before.label}` : "",
        new: `${m.type} · ${m.label}`,
      })
    );
    movById.set(m.id, m);
  }
  return {
    employees: Array.from(empById.values()),
    movements: Array.from(movById.values()),
    auditEntries,
  };
}

/**
 * Rafraîchit la méta workforce après un import RH à partir de la baseline dérivée des employés
 * (`lib/hrEngine.ts::deriveWorkforceBaseline`) : effectif total, masse salariale, ETP par
 * département et par pays sont remplacés ; les CIBLES de département déjà saisies, les
 * départements sans employé (ETP 0), les libellés pays, le budget et les baselines par
 * workstream (non dérivables des fiches employé) sont conservés.
 */
export function mergeDerivedWorkforceBaseline(
  previous: WorkforceMeta,
  derived: Pick<WorkforceMeta, "totalFTE" | "massSalary" | "departments" | "countryBaselines">
): WorkforceMeta {
  const departments = derived.departments.map((d) => ({
    ...d,
    fteTarget: previous.departments.find((p) => p.name === d.name)?.fteTarget ?? d.fteTarget,
  }));
  for (const p of previous.departments) {
    if (!departments.some((d) => d.name === p.name)) departments.push({ ...p, fte: 0 });
  }
  return {
    ...previous,
    totalFTE: derived.totalFTE,
    massSalary: derived.massSalary,
    departments,
    countryBaselines: derived.countryBaselines.map((c) => ({
      ...c,
      label: previous.countryBaselines?.find((p) => p.key === c.key)?.label ?? c.label,
    })),
  };
}

/**
 * Somme des ETP RÉELS (`Employee.fte`) par département, calculée EN LIVE depuis la base ETP —
 * round 13, alimente la comparaison besoin/disponible du Plan Stratégique
 * (`app/(app)/effectifs/EffectifsPageClient.tsx`, `components/strategic/ChantierStaffingEditor.tsx`).
 *
 * Volontairement DISTINCT de `Department.fte`/`fteTarget` (baseline saisie séparément, jamais
 * recalculée depuis les employés — voir `types/index.ts`::Department) : ce total-ci est TOUJOURS
 * le décompte réel et à jour des fiches employé, pas une cible éditée à la main qui peut dériver.
 * Un employé sans `department` renseigné est ignoré (ne peut pas alimenter un agrégat par équipe).
 */
export function fteByDepartment(employees: Employee[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const e of employees) {
    if (!e.department) continue;
    map[e.department] = (map[e.department] ?? 0) + (e.fte || 0);
  }
  return map;
}
