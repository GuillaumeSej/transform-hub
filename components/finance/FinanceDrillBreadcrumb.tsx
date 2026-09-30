"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
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
 *  La consigne de clic n'est plus affichée ici : l'aperçu au survol de chaque part l'indique
 *  (« Cliquer pour détailler → » / « Cliquer pour ouvrir le détail → »).
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

  return (
    <div className="mb-3 space-y-1.5">
      {/* Chemin (retour + miettes) : seulement une fois qu'on a détaillé une part (retour PO :
          moins de texte au repos — la consigne de clic est portée par l'aperçu au survol). */}
      {path.length > 0 && (
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
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className="flex flex-wrap items-center gap-1"
          aria-label={t("finance.drill.levelOf", "Niveau {n}/{total} : {level}")
            .replace("{n}", String(info.levelNumber))
            .replace("{total}", String(info.totalLevels))
            .replace("{level}", levels[info.levelNumber - 1] ?? "")}
        >
          {levels.map((label, index) => {
            const isCurrent = index === info.levelNumber - 1;
            const isPast = index < info.levelNumber - 1;
            return (
              <span key={`${label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight size={11} className="text-tertiary" />}
                <span
                  className={
                    isCurrent
                      ? "bg-black px-2 py-0.5 text-[10.5px] font-semibold text-white"
                      : isPast
                        ? "px-2 py-0.5 text-[10.5px] font-medium text-secondary"
                        : "px-2 py-0.5 text-[10.5px] font-medium text-tertiary"
                  }
                >
                  {label}
                </span>
              </span>
            );
          })}
        </span>
      </div>
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
