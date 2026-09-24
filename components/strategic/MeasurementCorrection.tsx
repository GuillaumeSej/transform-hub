"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { IndicatorValueModal } from "@/components/strategic/IndicatorValueModal";
import { useToast } from "@/lib/hooks/useToast";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  canFillIndicatorValue,
  isBaseline,
  measurementLabel,
  type MeasurementEditPatch,
} from "@/lib/kpiHistory";
import { deleteKpiValueFlow } from "@/lib/strategicApprovalFlows";
import type { AuthUser, Indicator, IndicatorMeasurement } from "@/types";

export type MeasurementCorrection = {
  /** L'utilisateur peut-il corriger/supprimer les mesures de cet indicateur ? */
  canCorrect: boolean;
  startEdit: (measurement: IndicatorMeasurement) => void;
  startDelete: (measurement: IndicatorMeasurement) => void;
  /** Modales (édition + confirmation de suppression) à rendre par l'appelant. */
  dialogs: ReactNode;
};

/**
 * Correction / suppression d'une mesure KPI déjà publiée (« si on s'est trompé »). Droit : le même
 * que la saisie (`canFillIndicatorValue` — responsables de l'indicateur, comptes additionnels,
 * strategic_lead du programme, admins). Le passage par la validation stratégique suit la même
 * porte `"kpi_value"` que la saisie (voir `editKpiValueFlow` / `deleteKpiValueFlow`).
 */
export function useMeasurementCorrection({
  indicator,
  measurements,
  user,
  updateMeasurement,
  deleteMeasurement,
}: {
  indicator: Indicator;
  /** TOUTES les mesures de l'indicateur (pas la sélection d'année) : doublons + baseline. */
  measurements: IndicatorMeasurement[];
  user: AuthUser | null | undefined;
  updateMeasurement?: (id: string, patch: MeasurementEditPatch) => Promise<unknown>;
  deleteMeasurement?: (id: string) => Promise<unknown>;
}): MeasurementCorrection {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const sa = useStrategicApprovalsApi();
  const [editing, setEditing] = useState<IndicatorMeasurement | null>(null);
  const [deleting, setDeleting] = useState<IndicatorMeasurement | null>(null);
  const [busy, setBusy] = useState(false);

  const canCorrect =
    !!user && !!updateMeasurement && !!deleteMeasurement && canFillIndicatorValue(indicator, user);

  const confirmDelete = async () => {
    if (!deleting || !deleteMeasurement) return;
    setBusy(true);
    try {
      const outcome = await deleteKpiValueFlow(sa, indicator, deleting, deleteMeasurement);
      showToast(
        outcome === "pending"
          ? t(
              "kpi.measurement.deletionSubmitted",
              "Suppression soumise à validation du responsable du plan"
            )
          : t("kpi.measurement.deleted", "Mesure supprimée"),
        indicator.name,
        "success"
      );
      setDeleting(null);
    } catch {
      showToast(
        t("kpi.measurement.deleteError", "Échec de la suppression"),
        indicator.name,
        "error"
      );
    } finally {
      setBusy(false);
    }
  };

  const deletingIsBaseline = !!deleting && isBaseline(deleting, measurements);

  const dialogs = canCorrect ? (
    <>
      {editing && user && (
        <IndicatorValueModal
          key={editing.id}
          indicator={indicator}
          user={user}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          editing={editing}
          measurements={measurements}
          updateMeasurement={updateMeasurement}
        />
      )}
      <Modal
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null);
        }}
        title={t("kpi.measurement.deleteTitle", "Supprimer la mesure")}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDelete} disabled={busy}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        {deleting && (
          <div className="space-y-2 text-sm text-text-primary">
            <p>
              {t("kpi.measurement.deleteConfirm", "Supprimer la mesure de {period} ({value}) ?")
                .replace("{period}", deleting.period)
                .replace("{value}", measurementLabel(deleting, indicator.unit))}
            </p>
            {deletingIsBaseline && (
              <p className="rounded-md border border-bp-coral/40 bg-bp-coral/5 px-2.5 py-1.5 text-xs text-text-secondary">
                {t(
                  "kpi.measurement.baselineDeleteWarning",
                  "Cette mesure est la valeur initiale (référence) de l'indicateur : la supprimer change la valeur de référence utilisée pour calculer l'avancement."
                )}
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  ) : null;

  return {
    canCorrect,
    startEdit: setEditing,
    startDelete: setDeleting,
    dialogs,
  };
}
