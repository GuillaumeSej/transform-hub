"use client";

import { useState, type ReactNode } from "react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { IndicatorValueModal } from "@/components/strategic/IndicatorValueModal";
import { KpiCorrectionNotice } from "@/components/strategic/KpiCorrectionNotice";
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
import type { IndicatorFillContext } from "@/lib/axisLogic";
import type { AuthUser, Indicator, IndicatorMeasurement } from "@/types";

export type MeasurementCorrection = {
  /** L'utilisateur peut-il corriger/supprimer les mesures de cet indicateur ? */
  canCorrect: boolean;
  startEdit: (measurement: IndicatorMeasurement) => void;
  startDelete: (measurement: IndicatorMeasurement) => void;
  /** Nouvelle saisie sur une période DÉJÀ renseignée : ouvre la correction de la mesure existante
   *  pré-remplie avec la nouvelle valeur (remplacement = correction, même routage). */
  startReplace: (existing: IndicatorMeasurement, draft: { value?: number; note?: string }) => void;
  /** Modales (édition + confirmation de suppression) à rendre par l'appelant. */
  dialogs: ReactNode;
};

/**
 * Correction / suppression d'une mesure KPI déjà publiée (« si on s'est trompé »). En contexte
 * stratégique, droit ET circuit suivent `routeKpiCorrection` (lib/kpiCorrectionRouting.ts) :
 * responsables plan/axe/chantier ⇒ correction directe + information des niveaux supérieurs ;
 * responsable de projet (ou autre saisisseur autorisé) ⇒ demande au responsable du chantier. Hors
 * contexte stratégique : droit de saisie (`canFillIndicatorValue`), écriture directe.
 */
export function useMeasurementCorrection({
  indicator,
  measurements,
  user,
  updateMeasurement,
  deleteMeasurement,
  fillCtx,
}: {
  indicator: Indicator;
  /** TOUTES les mesures de l'indicateur (pas la sélection d'année) : doublons + baseline. */
  measurements: IndicatorMeasurement[];
  user: AuthUser | null | undefined;
  updateMeasurement?: (id: string, patch: MeasurementEditPatch) => Promise<unknown>;
  deleteMeasurement?: (id: string) => Promise<unknown>;
  /** Axes/chantiers du programme : REQUIS pour reconnaître le sponsor d'axe/de chantier dans le
   *  repli `canFillIndicatorValue` (hors contexte d'approbation). */
  fillCtx?: IndicatorFillContext;
}): MeasurementCorrection {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const sa = useStrategicApprovalsApi();
  const [editing, setEditing] = useState<IndicatorMeasurement | null>(null);
  const [replaceDraft, setReplaceDraft] = useState<{ value?: number; note?: string } | null>(null);
  const [deleting, setDeleting] = useState<IndicatorMeasurement | null>(null);
  const [busy, setBusy] = useState(false);

  const route = sa && user ? sa.kpiCorrectionRoute(indicator) : null;
  const allowed = route
    ? route.mode !== "forbidden"
    : canFillIndicatorValue(indicator, user, fillCtx);
  const canCorrect = !!user && !!updateMeasurement && !!deleteMeasurement && allowed;

  const confirmDelete = async () => {
    if (!deleting || !deleteMeasurement) return;
    setBusy(true);
    try {
      const outcome = await deleteKpiValueFlow(
        sa,
        indicator,
        deleting,
        deleteMeasurement,
        route ?? undefined
      );
      showToast(
        outcome === "pending"
          ? t("kpi.measurement.deletionSubmitted", "Demande de suppression envoyée pour validation")
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
          key={`${editing.id}:${replaceDraft ? "replace" : "edit"}`}
          indicator={indicator}
          user={user}
          open
          onOpenChange={(open) => {
            if (!open) {
              setEditing(null);
              setReplaceDraft(null);
            }
          }}
          editing={editing}
          initialDraft={replaceDraft ?? undefined}
          replacing={!!replaceDraft}
          measurements={measurements}
          updateMeasurement={updateMeasurement}
          correctionRoute={route}
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
            <KpiCorrectionNotice route={route} action="delete" />
          </div>
        )}
      </Modal>
    </>
  ) : null;

  return {
    canCorrect,
    startEdit: (measurement) => {
      setReplaceDraft(null);
      setEditing(measurement);
    },
    startReplace: (existing, draft) => {
      setReplaceDraft(draft);
      setEditing(existing);
    },
    startDelete: setDeleting,
    dialogs,
  };
}
