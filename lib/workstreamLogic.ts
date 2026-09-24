import type { Lever, LeverAction } from "@/types";

/** Avancement déclaratif d'un levier — moyenne simple (non pondérée, aucune notion de poids par
 *  action n'a été demandée) des `declaredProgressPct` de ses actions déclarées. Les actions dont
 *  `declaredProgressPct` est `undefined` sont ignorées plutôt que comptées comme 0%, pour ne pas
 *  faire chuter artificiellement l'avancement d'un levier dont seules quelques actions ont déjà
 *  été déclarées par leur pilote. */
export function leverDeclaredProgress(actions: LeverAction[] | undefined): number | null {
  const declared = (actions ?? []).filter(
    (a) => typeof a.declaredProgressPct === "number" && !Number.isNaN(a.declaredProgressPct)
  );
  if (declared.length === 0) return null;
  const sum = declared.reduce((acc, a) => acc + (a.declaredProgressPct as number), 0);
  return sum / declared.length;
}

/** Avancement déclaratif d'un workstream — moyenne pondérée des avancements de ses leviers
 *  (`leverDeclaredProgress`), pondérée par `Lever.workstreamWeightPct` (poids déclaré par le
 *  pilote du workstream). Un levier sans poids déclaré reçoit un poids implicite égal aux autres
 *  leviers sans poids (répartition du poids restant, pas 0). Un levier sans aucune action déclarée
 *  (`leverDeclaredProgress` = null) est exclu du calcul (poids et tout), plutôt que de compter
 *  comme 0% d'avancement.
 *
 *  `progressOf` : mesure d'avancement d'un levier (par défaut l'avancement déclaratif de ses
 *  actions) — `engine.workstreamProgressPct` y passe `leverProgressPct` pour appliquer les poids
 *  déclarés à l'« Avancement » affiché (Kanban, bibliothèque de leviers). */
export function workstreamDeclaredProgress(
  levers: Lever[],
  workstreamId: string,
  progressOf: (lever: Lever) => number | null = (l) => leverDeclaredProgress(l.actions)
): number | null {
  const wsLevers = levers.filter((l) => l.ws === workstreamId && l.status !== "cancelled");
  const withProgress = wsLevers
    .map((l) => ({ lever: l, progress: progressOf(l) }))
    .filter((x): x is { lever: Lever; progress: number } => x.progress !== null);
  if (withProgress.length === 0) return null;

  const declaredWeightSum = withProgress.reduce(
    (acc, x) =>
      acc + (typeof x.lever.workstreamWeightPct === "number" ? x.lever.workstreamWeightPct : 0),
    0
  );
  const undeclaredCount = withProgress.filter(
    (x) => typeof x.lever.workstreamWeightPct !== "number"
  ).length;
  const remainingWeight = Math.max(0, 100 - declaredWeightSum);
  const implicitWeight = undeclaredCount > 0 ? remainingWeight / undeclaredCount : 0;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const { lever, progress } of withProgress) {
    const weight =
      typeof lever.workstreamWeightPct === "number" ? lever.workstreamWeightPct : implicitWeight;
    weightedSum += weight * progress;
    totalWeight += weight;
  }
  if (totalWeight === 0) {
    // Tous les poids déclarés valent 0 (ou aucun poids, aucun reste) — repli en moyenne simple.
    return withProgress.reduce((acc, x) => acc + x.progress, 0) / withProgress.length;
  }
  return weightedSum / totalWeight;
}
