"use client";

import { useMemo } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { buildHistoryRows } from "@/lib/kpiHistory";
import type { Indicator, IndicatorMeasurement } from "@/types";

/** Historique chronologique des mesures d'un indicateur (plus récente d'abord) : période, valeur,
 *  écart à la cible, auteur, horodatage et commentaire. Défile horizontalement plutôt que de
 *  tronquer sur petit écran. */
export function IndicatorHistoryTable({
  indicator,
  measurements,
  onEdit,
  onDelete,
}: {
  indicator: Pick<Indicator, "objectiveValue" | "direction" | "unit" | "targetSchedule">;
  measurements: IndicatorMeasurement[];
  /** Actions par ligne (« Modifier » / « Supprimer ») — colonne affichée seulement si fournies
   *  (l'appelant les omet quand l'utilisateur n'a pas le droit de corriger, voir
   *  `useMeasurementCorrection`). */
  onEdit?: (measurement: IndicatorMeasurement) => void;
  onDelete?: (measurement: IndicatorMeasurement) => void;
}) {
  const withActions = !!onEdit || !!onDelete;
  const { t } = useTranslation();
  const rows = useMemo(
    // Écart de CHAQUE ligne vs la cible applicable à SA période (palier de trajectoire).
    () => buildHistoryRows(measurements, indicator, indicator.direction),
    [measurements, indicator]
  );
  const unit = indicator.unit ? ` ${indicator.unit}` : "";
  const th =
    "px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-tertiary";

  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
        {t("kpi.history.title", "Historique des mesures")}
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-tertiary">
          {t("kpi.history.empty", "Aucune mesure sur cette période.")}
        </p>
      ) : (
        <div className="max-h-72 overflow-auto rounded-lg border border-border">
          <table className="w-full min-w-[520px] text-xs">
            <thead className="sticky top-0 bg-bg-surface">
              <tr>
                <th className={th}>{t("kpi.history.period", "Période")}</th>
                <th className={th}>{t("kpi.history.value", "Valeur")}</th>
                <th className={th}>{t("kpi.history.gap", "Écart à la cible")}</th>
                <th className={th}>{t("kpi.history.author", "Auteur")}</th>
                <th className={th}>{t("kpi.history.comment", "Commentaire")}</th>
                {withActions && (
                  <th className={th}>
                    <span className="sr-only">{t("kpi.history.actions", "Actions")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {rows.map(({ measurement: m, gap, favorable }) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono">{m.period}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-text-primary">
                    {m.value !== undefined ? `${m.value}${unit}` : "—"}
                  </td>
                  <td
                    className={`whitespace-nowrap px-2 py-1.5 ${
                      favorable === undefined
                        ? "text-tertiary"
                        : favorable
                          ? "text-text-primary"
                          : "text-[#806659]"
                    }`}
                  >
                    {gap === undefined ? "—" : `${gap > 0 ? "+" : ""}${gap}${unit}`}
                  </td>
                  <td className="px-2 py-1.5 text-text-secondary">
                    {m.reportedBy} {t("kpi.history.entered", "a saisi")}
                    <span className="block text-[10px] text-tertiary">
                      {m.reportedAt ? new Date(m.reportedAt).toLocaleString() : ""}
                    </span>
                    {m.updatedBy && (
                      <span className="block text-[10px] italic text-tertiary">
                        {t("kpi.history.correctedBy", "corrigé par")} {m.updatedBy}
                        {m.updatedAt ? ` — ${new Date(m.updatedAt).toLocaleString()}` : ""}
                      </span>
                    )}
                  </td>
                  <td className="min-w-[140px] whitespace-pre-wrap break-words px-2 py-1.5 text-text-primary">
                    {m.note ?? "—"}
                  </td>
                  {withActions && (
                    <td className="whitespace-nowrap px-1 py-1 text-right">
                      {onEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(m)}
                          aria-label={`${t("common.edit", "Modifier")} ${m.period}`}
                          title={t("common.edit", "Modifier")}
                          className="cursor-pointer rounded p-1 text-text-secondary hover:bg-bg-surface hover:text-bp-coral"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(m)}
                          aria-label={`${t("common.delete", "Supprimer")} ${m.period}`}
                          title={t("common.delete", "Supprimer")}
                          className="cursor-pointer rounded p-1 text-text-secondary hover:bg-bg-surface hover:text-bp-coral"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
