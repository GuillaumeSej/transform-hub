"use client";

import { Fragment, type ReactNode } from "react";
import { CalendarClock, Hash, ListChecks, Ruler } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Indicator } from "@/types";

/**
 * Ligne de métadonnées d'un KPI (nature · fréquence · unité) — SEUL rendu de ces caractéristiques
 * dans le Plan Stratégique (carte KPI, vue Tableau, modale d'historique, fiche d'axe). Texte sobre
 * en petites capitales grises, séparateurs verticaux fins et petites icônes : pas de pastilles.
 * L'unité reste en casse d'origine (« k€ » ne doit pas devenir « K€ »).
 */
export function IndicatorMetaLine({
  indicator,
  showUnit = true,
  className,
}: {
  indicator: Pick<Indicator, "kind" | "frequency" | "unit">;
  showUnit?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const quantitative = indicator.kind === "quantitative";

  const items: { key: string; icon: ReactNode; content: ReactNode }[] = [
    {
      key: "kind",
      icon: quantitative ? <Hash size={11} /> : <ListChecks size={11} />,
      content: <span className="uppercase">{t(`kpi.kind.${indicator.kind}`)}</span>,
    },
    {
      key: "frequency",
      icon: <CalendarClock size={11} />,
      content: <span className="uppercase">{t(`kpi.frequency.${indicator.frequency}`)}</span>,
    },
  ];
  if (showUnit && quantitative && indicator.unit) {
    items.push({
      key: "unit",
      icon: <Ruler size={11} />,
      content: (
        <span>
          <span className="uppercase">{t("kpi.meta.unit", "Unité")}</span>
          <span className="normal-case"> : {indicator.unit}</span>
        </span>
      ),
    });
  }

  return (
    <span
      role="group"
      aria-label={t("kpi.meta.label", "Caractéristiques de l'indicateur")}
      className={`inline-flex flex-wrap items-center gap-y-1 text-[10px] font-medium tracking-[0.08em] text-tertiary ${className ?? ""}`}
    >
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {index > 0 && <span aria-hidden className="mx-2 h-3 w-px shrink-0 bg-border" />}
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <span aria-hidden className="shrink-0 text-text-secondary/70">
              {item.icon}
            </span>
            {item.content}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
