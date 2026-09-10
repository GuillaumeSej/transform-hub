import { cn } from "@/lib/utils";

/**
 * Barre horizontale GÉNÉRIQUE "consommé vs planifié" — patron similaire à `BudgetDonutChart`
 * (`components/shared/charts/BudgetDonutChart.tsx`) : ni unité, ni devise, ni domaine en dur,
 * `formatValue` est fourni par l'appelant (ex. `"€2,3M"`, `"4,5 ETP"`), ce qui rend le composant
 * réutilisable aussi bien pour du budget (€) que pour de l'effort humain (ETP) — voir
 * `Chantier.consumedBudget`/`consumedFte` et `ChantierAction.consumedBudget`/`consumedFte`
 * (`types/index.ts`).
 *
 * Rendu volontairement simple : une seule barre de remplissage (pas de double-barre superposée),
 * track neutre (`bg-neutral-100`, même convention que `KPICard`'s `barPct`), remplissage neutre
 * foncé par défaut (`bg-neutral-900`, même token que `Button`'s variant `dark`) — PAS la palette
 * rouge/ambre/vert de `progressBucket` (`lib/axisLogic.ts`), qui porte une sémantique
 * d'avancement de jalon sans rapport avec un dépassement budgétaire. Seul cas colorié : le
 * dépassement (`consumed > planned`), signalé en rouge via le même token que `BUCKET_DOT_CLASS.red`
 * (`bg-rag-red`, voir `ChantierDetailPanel.tsx`/`MilestoneChecklistPanel.tsx`).
 *
 * `planned === 0` : pas de division par zéro — la barre affiche 0% si `consumed` est aussi à 0
 * (rien à comparer), ou 100% en rouge si `consumed > 0` (tout dépassement d'un budget nul est par
 * définition un dépassement total, la barre sature visuellement à 100% plutôt que de tenter un
 * pourcentage non borné).
 */
export function BudgetVsActualBar({
  planned,
  consumed,
  formatValue,
  label,
  className,
}: {
  /** Valeur planifiée/cible (ex. `Chantier.allocatedBudget`, `ChantierAction.budget`). */
  planned: number;
  /** Valeur réellement consommée (ex. `Chantier.consumedBudget`, `ChantierAction.consumedFte`). */
  consumed: number;
  /** Formatage de valeur fourni par l'appelant — le composant ne connaît ni unité ni devise. */
  formatValue: (value: number) => string;
  /** Libellé optionnel affiché au-dessus de la barre (ex. "Budget", "ETP"). */
  label?: string;
  className?: string;
}): JSX.Element {
  const overBudget = consumed > planned;
  const pct =
    planned <= 0
      ? consumed > 0
        ? 100
        : 0
      : Math.min(100, Math.max(0, (consumed / planned) * 100));

  return (
    <div className={cn("w-full", className)}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
        {label ? <span className="text-tertiary">{label}</span> : <span />}
        <span className={cn("font-semibold", overBudget ? "text-rag-red" : "text-primary")}>
          {formatValue(consumed)} <span className="text-tertiary">/ {formatValue(planned)}</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className={cn("h-full rounded-full", overBudget ? "bg-rag-red" : "bg-neutral-900")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
