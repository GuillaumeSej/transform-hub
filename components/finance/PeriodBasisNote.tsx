"use client";

import { Info } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Mention affichée à côté d'un filtre de période (décision PO, `engine.periodLineShare`) :
 *  exercice / toutes les années → « Base annuelle (effet année pleine) » (run-rate) ;
 *  trimestre / mois → « Effet sur la période » (montant annuel × mois actifs / 12). */
export function PeriodBasisNote({ subAnnual }: { subAnnual: boolean }) {
  const { t } = useTranslation();
  const label = subAnnual
    ? t("pnl.periodBasis.period", "Effet sur la période")
    : t("pnl.periodBasis.annual", "Base annuelle (effet année pleine)");
  const hint = subAnnual
    ? t(
        "pnl.periodBasis.periodHint",
        "Montants proratisés sur la période : montant annuel × (mois actifs dans la période / 12). Ex. 1 M€/an démarrant le 1er octobre = 0,25 M€ sur oct.–déc., 0,083 M€ sur octobre. Les éléments ponctuels comptent en entier dans la période de leur date."
      )
    : t(
        "pnl.periodBasis.annualHint",
        "Montants en effet année pleine (run-rate) : un gain récurrent de 1 M€/an compte 1 M€ dans chaque exercice où il est actif, quelle que soit sa date de début dans l'exercice. Les éléments ponctuels comptent en entier dans l'exercice de leur date."
      );
  return (
    <span
      title={hint}
      aria-label={`${label}. ${hint}`}
      className="inline-flex cursor-help items-center gap-1 text-[10.5px] italic text-tertiary"
    >
      <Info size={11} aria-hidden="true" />
      {label}
    </span>
  );
}
