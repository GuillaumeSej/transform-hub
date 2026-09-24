import { AlertTriangle } from "lucide-react";

import { useTranslation } from "@/lib/i18n/useTranslation";
import { cn } from "@/lib/utils";

/**
 * Ligne GÉNÉRIQUE "consommé vs planifié" — patron similaire à `BudgetDonutChart`
 * (`components/shared/charts/BudgetDonutChart.tsx`) : ni unité, ni devise, ni domaine en dur,
 * `formatValue` est fourni par l'appelant (ex. `"€2,3M"`, `"4,5 ETP"`), ce qui rend le composant
 * réutilisable aussi bien pour du budget (€) que pour de l'effort humain (ETP) — voir
 * `Chantier.consumedBudget`/`consumedFte` et `ChantierAction.consumedBudget`/`consumedFte`
 * (`types/index.ts`).
 *
 * Purement textuel depuis le round 20 : plus de barre de remplissage. Décision explicite du PO
 * après avoir constaté que `consumedBudget`/`consumedFte` sont une saisie 100% manuelle (aucune
 * intégration API/ERP, cf. `ChantierDetailPanel.tsx`) — une barre de progression suggérait une
 * précision/fiabilité de mesure que la donnée n'a pas. Seul signal visuel restant : en cas de
 * dépassement (`consumed > planned`), un petit badge discret (icône + libellé "Dépassé") plutôt
 * qu'une barre pleine rouge, ton `rag-red` — même convention que `BUCKET_PILL_CLASS`
 * (`ChantierDetailPanel.tsx`, fond `bg-rag-red-light` + texte `text-rag-red`).
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
  /** Libellé optionnel affiché à gauche de la ligne (ex. "Budget", "ETP"). */
  label?: string;
  className?: string;
}): JSX.Element {
  const { t } = useTranslation();
  const overBudget = consumed > planned;

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        {label ? <span className="text-tertiary">{label}</span> : <span />}
        <span className="flex items-center gap-1.5">
          <span className={cn("font-semibold", overBudget ? "text-rag-red" : "text-primary")}>
            {formatValue(consumed)} <span className="text-tertiary">/ {formatValue(planned)}</span>
          </span>
          {overBudget ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-rag-red-light px-1.5 py-0.5 text-[10px] font-bold text-rag-red">
              <AlertTriangle size={11} className="shrink-0" aria-hidden />
              {t("shared.budgetVsActual.over", "Dépassé")}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
