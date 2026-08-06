import type {
  Lever,
  MovementStatus,
  MovementType,
  Program,
  SocialScheme,
  WorkforceMovement,
} from "@/types";

/** Ligne prête à afficher dans le tableau "Synthèse des mouvements". Les informations programme
 * et owner sont dérivées des référentiels, jamais dupliquées dans le mouvement. */
export type HrMovementTableRow = {
  id: string;
  label: string;
  type: MovementType;
  programName: string;
  socialScheme: SocialScheme | "—";
  department: string;
  country: string;
  initiativeOwner: string;
  hrOwner: string;
  fte: number;
  plannedDate: string;
  status: MovementStatus;
  actualDate: string;
  comment: string;
  salaryImpact: number;
  cost: number;
  movement: WorkforceMovement;
};

export function buildMovementTableRows(
  movements: WorkforceMovement[],
  levers: Lever[],
  programs: Program[]
): HrMovementTableRow[] {
  const leverById = new Map(levers.map((lever) => [lever.id, lever]));
  const programById = new Map(programs.map((program) => [program.id, program]));

  return movements.map((movement) => {
    const lever = leverById.get(movement.leverId);
    const program =
      programById.get(movement.programId ?? "") ?? programById.get(lever?.programId ?? "");
    return {
      id: movement.id,
      label: movement.label,
      type: movement.type,
      programName: program?.name ?? "—",
      socialScheme: movement.socialScheme ?? (movement.inPSE ? "PSE" : "—"),
      department: movement.toDepartment
        ? `${movement.department} → ${movement.toDepartment}`
        : movement.department,
      country: movement.country,
      initiativeOwner: lever?.owner ?? "—",
      hrOwner: movement.hrOwner,
      fte: movement.fte,
      plannedDate: movement.plannedDate,
      status: movement.status,
      actualDate: movement.actualDate ?? "",
      comment: movement.comment ?? "",
      salaryImpact: movement.salaryImpact,
      cost: movement.cost,
      movement,
    };
  });
}
