"use client";

import { ChevronLeft, ChevronRight, MousePointerClick } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { drillLevelInfo, type DrillStep } from "@/lib/financeDrilldown";

/**
 * Fil d'Ariane commun aux donuts à drill-down EN PLACE du module Finance
 * (`CostEngagedVsUpcomingChart` et `CostByHierarchyChart`, FinanceCostCharts.tsx) — les deux
 * graphiques se comportent ainsi de la même façon :
 *  - ligne 1 : bouton "← Retour" (remonte d'un niveau) + chemin cliquable
 *    "Tous › Procurement Excellence › …" (chaque miette ramène à son niveau) ;
 *  - ligne 2 : repère "Niveau 2/4 : Agrégat" + les niveaux de la hiérarchie (niveau courant en
 *    pastille sombre, niveaux déjà parcourus en gris foncé, niveaux restants en gris clair) ;
 *  - ligne 3 : consigne de clic — "Cliquez pour détailler par X" tant qu'il reste un niveau,
 *    "Dernier niveau : cliquez pour ouvrir le détail" au niveau feuille (seul niveau qui ouvre la
 *    modale de détail).
 * La logique de chemin (troncature, position) vit dans lib/financeDrilldown.ts (pure, testée).
 */
export function FinanceDrillBreadcrumb({
  levels,
  path,
  onNavigate,
}: {
  /** Libellés des niveaux, du plus macro au plus fin (ex. ["Compte P&L", "Agrégat", "Centre de coût"]). */
  levels: string[];
  /** Éléments cliqués jusqu'ici (longueur = profondeur courante). */
  path: DrillStep[];
  /** `-1` = retour à la racine, sinon index de la miette cliquée dans `path`. */
  onNavigate: (index: number) => void;
}) {
  const { t } = useTranslation();
  if (levels.length === 0) return null;
  const info = drillLevelInfo(path.length, levels.length);
  const currentLevel = levels[info.levelNumber - 1];
  const nextLevel = levels[info.levelNumber];

  const levelText = t("finance.drill.levelOf", "Niveau {n}/{total} : {level}")
    .replace("{n}", String(info.levelNumber))
    .replace("{total}", String(info.totalLevels))
    .replace("{level}", currentLevel ?? "");
  const hint = info.isLastLevel
    ? t("finance.drill.hintLeaf", "Dernier niveau : cliquez sur une part pour ouvrir le détail")
    : t("finance.drill.hintNext", "Cliquez sur une part pour détailler par {level}").replace(
        "{level}",
        nextLevel ?? ""
      ) +
      " · " +
      t("finance.drill.remaining", "{n} niveau(x) restant(s)").replace(
        "{n}",
        String(info.remaining)
      );

  return (
    <div className="mb-3 space-y-1.5">
      <nav
        aria-label={t("finance.drill.breadcrumbAria", "Chemin de détail")}
        className="flex flex-wrap items-center gap-1 text-[11.5px]"
      >
        {path.length > 0 && (
          <button
            type="button"
            onClick={() => onNavigate(path.length - 2)}
            className="mr-1 inline-flex items-center gap-0.5 rounded-md border border-border px-1.5 py-0.5 font-semibold text-secondary transition hover:bg-neutral-50 hover:text-primary"
          >
            <ChevronLeft size={13} />
            {t("finance.drill.back", "Retour")}
          </button>
        )}
        <Crumb
          label={t("finance.drill.all", "Tous")}
          current={path.length === 0}
          onClick={() => onNavigate(-1)}
        />
        {path.map((step, index) => (
          <span key={`${step.id}-${index}`} className="flex min-w-0 items-center gap-1">
            <ChevronRight size={12} className="shrink-0 text-tertiary" />
            <Crumb
              label={step.label}
              current={index === path.length - 1}
              onClick={() => onNavigate(index)}
            />
          </span>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-semibold text-primary">{levelText}</span>
        <span className="flex flex-wrap items-center gap-1" aria-hidden>
          {levels.map((label, index) => {
            const isCurrent = index === info.levelNumber - 1;
            const isPast = index < info.levelNumber - 1;
            return (
              <span key={`${label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight size={11} className="text-tertiary" />}
                <span
                  className={
                    isCurrent
                      ? "rounded-full bg-black px-2 py-0.5 text-[10.5px] font-semibold text-white"
                      : isPast
                        ? "rounded-full px-2 py-0.5 text-[10.5px] font-medium text-secondary"
                        : "rounded-full px-2 py-0.5 text-[10.5px] font-medium text-tertiary"
                  }
                >
                  {label}
                </span>
              </span>
            );
          })}
        </span>
      </div>

      <p className="flex items-center gap-1 text-[10.5px] text-tertiary">
        <MousePointerClick size={12} className="shrink-0" />
        {hint}
      </p>
    </div>
  );
}

function Crumb({
  label,
  current,
  onClick,
}: {
  label: string;
  current: boolean;
  onClick: () => void;
}) {
  if (current) {
    return (
      <span aria-current="page" className="truncate font-semibold text-primary" title={label}>
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="truncate font-medium text-secondary underline-offset-2 hover:text-primary hover:underline"
    >
      {label}
    </button>
  );
}
