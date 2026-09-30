import type { WorkforceMovement } from "@/types";
import type { HrKpi } from "@/lib/hrProgramSummary";

/** KPI du Dashboard RH ouvrables en fiche détaillée (`HrKpiDetailModal`). */
export type HrKpiKey = "fte" | "salarySavings" | "socialCost" | "netEconomy";

/** Une ligne de répartition (par levier / type / département). Unités : ETP pour `fte`, € bruts
 *  (non divisés) pour les KPI monétaires. */
export type HrKpiBreakdownRow = {
  /** Identifiant du groupe (id levier, type de mouvement, nom de département). */
  key: string;
  label: string;
  /** Code levier (ex. « ORG-001 ») — uniquement pour la répartition par levier. */
  leverCode?: string;
  /** Renseigné pour la répartition par levier : lien vers la fiche levier. */
  leverId?: string;
  realized: number;
  /** Cible = réalisé + planifié (même définition que `HrKpi.target`). */
  target: number;
  reforecast: number;
  /** Mouvements actifs du groupe. */
  count: number;
  movementIds: string[];
};

/** Contribution d'un mouvement au KPI. */
export type HrKpiMovementRow = {
  movement: WorkforceMovement;
  realized: number;
  target: number;
};

export type HrKpiDetail = {
  kpi: HrKpiKey;
  /** Mêmes totaux que `hrProgramSummary(movements)[kpi]` (invariant testé). */
  totals: HrKpi;
  /** Triés par |target| décroissant. Mouvements sans levier connu : groupe `key: ""`. */
  byLever: HrKpiBreakdownRow[];
  byType: HrKpiBreakdownRow[];
  byDepartment: HrKpiBreakdownRow[];
  /** Mouvements actifs contribuant (target ≠ 0 ou realized ≠ 0), triés par |target| décroissant. */
  movements: HrKpiMovementRow[];
};

/** Couverture de l'ambition ETP d'un levier par ses mouvements (carte ETP → « Reste à couvrir »). */
export type LeverCoverageRow = {
  leverId: string;
  leverCode: string;
  leverName: string;
  /** Ambition ETP déclarée sur le levier (signée). */
  leverFte: number;
  /** Impact ETP cible des mouvements rattachés (signé, `targetMovementFteImpact`). */
  movementFte: number;
  /** |leverFte| − mouvements dans le sens du levier, borné à ≥ 0 (même règle que `fteCoverage`). */
  remaining: number;
  movementIds: string[];
};
