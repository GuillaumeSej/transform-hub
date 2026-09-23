"use client";

import { StaffingThresholdsControl } from "@/components/strategic/StaffingThresholdsControl";
import { useStaffingThresholds } from "@/lib/hooks/useStaffingThresholds";
import { useTranslation } from "@/lib/i18n/useTranslation";

/**
 * Section « Paramètres d'affichage » du hub admin d'une entreprise : seuils du taux de staffing
 * (tendu / sur-staffé) communs à tous les utilisateurs de CETTE entreprise — même donnée et même
 * contrôle que le bouton « Seuils » de la page Budget & effectifs (voir useStaffingThresholds).
 */
export function CompanyDisplaySettingsPanel({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const { thresholds, save, saving, canEdit } = useStaffingThresholds(companyId);
  const legend = t("effectifs.staffingRate.legend")
    .replace("{tense}", String(thresholds.tense))
    .replace("{over}", String(thresholds.over));

  return (
    <section className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-bold text-primary">
        {t("adminCompanies.displaySettings.title", "Paramètres d'affichage")}
      </h3>
      <p className="mb-3 mt-1 text-xs text-text-secondary">
        {t(
          "adminCompanies.displaySettings.description",
          "Seuils du taux de staffing (page Budget & effectifs), appliqués à tous les utilisateurs de l'entreprise."
        )}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs tabular-nums text-secondary">{legend}</span>
        <StaffingThresholdsControl
          value={thresholds}
          onSave={save}
          saving={saving}
          readOnly={!canEdit}
        />
      </div>
    </section>
  );
}
