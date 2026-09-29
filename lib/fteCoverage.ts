/**
 * Couverture des ETP visés par les leviers par les mouvements RH (décision PO — réconcilier le KPI
 * « ETP visés par les leviers » du dashboard Performance et l'« Impact ETP » du Dashboard RH) :
 *   - `leverFte`    : ambition ETP déclarée sur les leviers (signée, réductions négatives), voir
 *                     `engine.leverTargetFte` ;
 *   - `movementFte` : ETP des mouvements RH nominatifs planifiés ou réalisés (signé, même
 *                     convention), voir `hrProgramSummary(...).fte.target` ;
 *   - reste à couvrir = |leviers| − mouvements projetés dans le SENS des leviers : un mouvement de
 *     sens contraire (ex. recrutement face à un levier de réduction) augmente le reste à couvrir.
 *
 * Fonction pure, sans dépendance React.
 */

export type FteCoverageStatus =
  /** Ni ambition levier ni mouvement : rien à afficher. */
  | "empty"
  /** Des réductions (ou hausses) visées restent à affecter à des personnes. */
  | "remaining"
  /** Mouvements = ambition des leviers, au dixième près. */
  | "covered"
  /** Les mouvements vont au-delà de l'ambition des leviers. */
  | "exceeded"
  /** Mouvements sans aucune ambition ETP portée par les leviers du périmètre. */
  | "noLeverTarget";

export type FteCoverage = {
  /** ETP visés par les leviers (signé, arrondi au dixième). */
  leverFte: number;
  /** ETP couverts par les mouvements (signé, arrondi au dixième). */
  movementFte: number;
  /** Reste à couvrir (≥ 0, en valeur absolue) — 0 si couvert ou dépassé. */
  remaining: number;
  /** Dépassement de couverture (≥ 0, en valeur absolue) — 0 sauf statut `exceeded`. */
  exceeded: number;
  /** Part de l'ambition couverte, en % (0-100, borné) — 0 sans ambition levier. */
  coveragePct: number;
  status: FteCoverageStatus;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const finite = (n: number) => (Number.isFinite(n) ? n : 0);

export function fteCoverage(leverFte: number, movementFte: number): FteCoverage {
  const levers = round1(finite(leverFte));
  const movements = round1(finite(movementFte));
  const base = { leverFte: levers, movementFte: movements };

  if (levers === 0) {
    return {
      ...base,
      remaining: 0,
      exceeded: 0,
      coveragePct: 0,
      status: movements === 0 ? "empty" : "noLeverTarget",
    };
  }

  // Mouvements projetés dans le sens des leviers (négatif si sens contraire).
  const covered = movements * Math.sign(levers);
  const gap = round1(Math.abs(levers) - covered);
  const coveragePct = Math.max(0, Math.min(100, Math.round((covered / Math.abs(levers)) * 100)));

  if (gap > 0) return { ...base, remaining: gap, exceeded: 0, coveragePct, status: "remaining" };
  if (gap < 0) return { ...base, remaining: 0, exceeded: -gap, coveragePct, status: "exceeded" };
  return { ...base, remaining: 0, exceeded: 0, coveragePct, status: "covered" };
}
