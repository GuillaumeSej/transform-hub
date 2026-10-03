import type { Lever, WorkforceMovement } from "@/types";
import { hrProgramSummary, targetMovementFteImpact, type HrKpi } from "@/lib/hrProgramSummary";
import { fteCoverage } from "@/lib/fteCoverage";
import { leverTargetFte } from "@/lib/engine";
import { isActiveMovement } from "@/lib/workforceLogic";
import type {
  HrKpiBreakdownRow,
  HrKpiDetail,
  HrKpiKey,
  HrKpiMovementRow,
  LeverCoverageRow,
} from "@/lib/hrKpiDetailTypes";

export type {
  HrKpiBreakdownRow,
  HrKpiDetail,
  HrKpiKey,
  HrKpiMovementRow,
  LeverCoverageRow,
} from "@/lib/hrKpiDetailTypes";

/**
 * Fiche détaillée d'un KPI du Dashboard RH (`HrKpiDetailModal`).
 *
 * Cohérence garantie avec le bandeau : les totaux sont EXACTEMENT `hrProgramSummary(movements)[kpi]`,
 * et la contribution de chaque mouvement est calculée par `hrProgramSummary([m])[kpi]` — mêmes
 * règles (abandonnés exclus, lockedPlan / reforecast, signe ETP, −salaryImpact…) sans aucune
 * duplication de logique métier. Contrepartie : chaque contribution est arrondie (0,1 ETP / 1 €),
 * donc la somme des lignes peut s'écarter du total d'au plus un arrondi par mouvement.
 *
 * Fonction pure, sans dépendance React.
 */

const SANS_LEVIER = "Sans levier";
const SANS_DEPARTEMENT = "—";

type MovementValues = { realized: number; target: number; reforecast: number };

function movementValues(kpi: HrKpiKey, m: WorkforceMovement): MovementValues {
  const k = hrProgramSummary([m])[kpi];
  return { realized: k.realized, target: k.target, reforecast: k.reforecast };
}

/** Arrondi d'affichage des agrégats : 0,1 pour l'ETP, 1 € pour les KPI monétaires. */
function roundFor(kpi: HrKpiKey): (n: number) => number {
  return kpi === "fte" ? (n) => Math.round(n * 10) / 10 : (n) => Math.round(n);
}

const byAbsTargetDesc = <T extends { target: number }>(a: T, b: T) =>
  Math.abs(b.target) - Math.abs(a.target);

function groupRows(
  kpi: HrKpiKey,
  rows: { movement: WorkforceMovement; values: MovementValues }[],
  groupOf: (m: WorkforceMovement) => {
    key: string;
    label: string;
    leverCode?: string;
    leverId?: string;
  }
): HrKpiBreakdownRow[] {
  const round = roundFor(kpi);
  const groups = new Map<string, HrKpiBreakdownRow>();
  for (const { movement, values } of rows) {
    const g = groupOf(movement);
    let row = groups.get(g.key);
    if (!row) {
      row = {
        ...g,
        realized: 0,
        target: 0,
        reforecast: 0,
        count: 0,
        movementIds: [],
      };
      groups.set(g.key, row);
    }
    row.realized += values.realized;
    row.target += values.target;
    row.reforecast += values.reforecast;
    row.count += 1;
    row.movementIds.push(movement.id);
  }
  return Array.from(groups.values())
    .map((r) => ({
      ...r,
      realized: round(r.realized),
      target: round(r.target),
      reforecast: round(r.reforecast),
    }))
    .sort(byAbsTargetDesc);
}

export function hrKpiDetail(
  kpi: HrKpiKey,
  movements: WorkforceMovement[],
  levers: Lever[]
): HrKpiDetail {
  const totals: HrKpi = hrProgramSummary(movements)[kpi];
  const leverById = new Map(levers.map((l) => [l.id, l]));

  // Mouvements actifs qui contribuent au KPI (au moins une vue non nulle).
  const contributing = movements
    .filter(isActiveMovement)
    .map((movement) => ({ movement, values: movementValues(kpi, movement) }))
    .filter(
      ({ values }) => values.target !== 0 || values.realized !== 0 || values.reforecast !== 0
    );

  const byLever = groupRows(kpi, contributing, (m) => {
    const lever = leverById.get(m.leverId);
    if (!lever) return { key: "", label: SANS_LEVIER };
    return {
      key: lever.id,
      label: `${lever.code} — ${lever.name}`,
      leverCode: lever.code,
      leverId: lever.id,
    };
  });
  // Type brut : la traduction est faite par l'UI.
  const byType = groupRows(kpi, contributing, (m) => ({ key: m.type, label: m.type }));
  const byDepartment = groupRows(kpi, contributing, (m) => {
    const dep = m.department || SANS_DEPARTEMENT;
    return { key: dep, label: dep };
  });

  const movementRows: HrKpiMovementRow[] = contributing
    .filter(({ values }) => values.target !== 0 || values.realized !== 0)
    .map(({ movement, values }) => ({
      movement,
      realized: values.realized,
      target: values.target,
    }))
    .sort(byAbsTargetDesc);

  return { kpi, totals, byLever, byType, byDepartment, movements: movementRows };
}

/**
 * Couverture de l'ambition ETP de chaque levier par ses mouvements rattachés (carte ETP →
 * « Reste à couvrir »). Même règle que `fteCoverage` : un mouvement de sens contraire au levier
 * augmente le reste à couvrir. Ambition levier = `leverTargetFte([lever])` ; les leviers ABANDONNÉS
 * sont exclus, avec leurs mouvements (comme `leverFteCoverage`). `levers` = périmètre déjà filtré par
 * l'appelant. Ne retient que les leviers avec une ambition ≠ 0 ou au moins un mouvement rattaché
 * d'impact ETP cible ≠ 0 ; tri par reste à couvrir décroissant puis |ambition| décroissante.
 */
export function leverCoverageRows(
  levers: Lever[],
  movements: WorkforceMovement[]
): LeverCoverageRow[] {
  const movementsByLever = new Map<string, WorkforceMovement[]>();
  for (const m of movements) {
    const list = movementsByLever.get(m.leverId);
    if (list) list.push(m);
    else movementsByLever.set(m.leverId, [m]);
  }

  const rows: LeverCoverageRow[] = [];
  for (const lever of levers) {
    // Levier abandonné : ni ambition ni couverture (même périmètre que `leverFteCoverage`, décision
    // PO audit lot 6) — la somme des lignes se réconcilie ainsi avec le reste global.
    if (lever.status === "cancelled") continue;
    const attached = (movementsByLever.get(lever.id) ?? []).filter(
      (m) => targetMovementFteImpact(m) !== 0
    );
    const leverFte = leverTargetFte([lever]);
    if (leverFte === 0 && attached.length === 0) continue;
    const rawMovementFte = attached.reduce((s, m) => s + targetMovementFteImpact(m), 0);
    const coverage = fteCoverage(leverFte, rawMovementFte);
    rows.push({
      leverId: lever.id,
      leverCode: lever.code,
      leverName: lever.name,
      leverFte: coverage.leverFte,
      movementFte: coverage.movementFte,
      remaining: coverage.remaining,
      movementIds: attached.map((m) => m.id),
    });
  }

  return rows.sort(
    (a, b) => b.remaining - a.remaining || Math.abs(b.leverFte) - Math.abs(a.leverFte)
  );
}
