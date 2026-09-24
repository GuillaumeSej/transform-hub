"use client";

import { useState } from "react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  currentPeriod,
  findPeriodCollision,
  isBaseline,
  MeasurementPeriodCollisionError,
  parseNumber,
  type IndicatorValueInput,
  type MeasurementEditPatch,
} from "@/lib/kpiHistory";
import { editKpiValueFlow, submitKpiValueFlow } from "@/lib/strategicApprovalFlows";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import type { AuthUser, Indicator, IndicatorMeasurement } from "@/types";

const FIELD =
  "mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral";

/**
 * Modale de saisie d'une valeur (période, valeur, commentaire optionnel) — KPI marché — et de
 * CORRECTION d'une mesure déjà publiée (`editing` fourni : champs pré-remplis, écriture via
 * `editKpiValueFlow`). Monter avec une `key` propre à la mesure éditée : l'état initial est lu au
 * montage.
 */
export function IndicatorValueModal({
  indicator,
  user,
  addMeasurement,
  open,
  onOpenChange,
  editing,
  measurements = [],
  updateMeasurement,
}: {
  indicator: Indicator;
  user: AuthUser;
  addMeasurement?: (input: IndicatorValueInput) => Promise<unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mesure à corriger (mode édition). */
  editing?: IndicatorMeasurement;
  /** Mesures de l'indicateur (contrôle de doublon de période, détection de la baseline). */
  measurements?: IndicatorMeasurement[];
  updateMeasurement?: (id: string, patch: MeasurementEditPatch) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const sa = useStrategicApprovalsApi();
  const quantitative = indicator.kind === "quantitative";
  const [period, setPeriod] = useState(() => editing?.period ?? currentPeriod(indicator.frequency));
  const [value, setValue] = useState(() =>
    editing?.value !== undefined ? String(editing.value) : ""
  );
  const [note, setNote] = useState(() => editing?.note ?? "");
  const [saving, setSaving] = useState(false);
  const editingBaseline = !!editing && isBaseline(editing, measurements);

  const collisionMessage = (p: string) =>
    t(
      "kpi.measurement.periodCollision",
      "Une mesure existe déjà pour la période {period}."
    ).replace("{period}", p);

  const submitEdit = async (p: string, parsed: number | undefined) => {
    if (!editing || !updateMeasurement) return;
    if (findPeriodCollision(measurements, indicator.id, p, editing.id)) {
      showToast(collisionMessage(p), indicator.name, "error");
      return;
    }
    setSaving(true);
    try {
      const outcome = await editKpiValueFlow(
        sa,
        indicator,
        editing,
        { period: p, value: parsed ?? null, note: note.trim() === "" ? null : note },
        updateMeasurement
      );
      showToast(
        outcome === "pending"
          ? t(
              "kpi.measurement.correctionSubmitted",
              "Correction soumise à validation du responsable du plan"
            )
          : t("kpi.measurement.updated", "Mesure corrigée"),
        indicator.name,
        "success"
      );
      onOpenChange(false);
    } catch (err) {
      showToast(
        err instanceof MeasurementPeriodCollisionError
          ? collisionMessage(err.period)
          : t("kpi.saveError"),
        indicator.name,
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    const p = period.trim();
    if (!p) return showToast(t("kpi.periodRequired"), "", "error");
    const parsed = quantitative ? parseNumber(value) : undefined;
    if (parsed === null) return showToast(t("kpi.valueInvalid"), "", "error");
    if (parsed === undefined && note.trim() === "")
      return showToast(t("kpi.valueRequired"), "", "error");
    if (editing) return submitEdit(p, parsed);
    if (!addMeasurement) return;
    setSaving(true);
    try {
      const outcome = await submitKpiValueFlow(
        sa,
        indicator,
        {
          indicatorId: indicator.id,
          period: p,
          reportedBy: user.username,
          value: parsed,
          note,
        },
        addMeasurement
      );
      setValue("");
      setNote("");
      if (outcome === "pending") {
        showToast(
          t("kpi.valueSubmittedForApproval", "Valeur soumise à validation du responsable du plan"),
          indicator.name,
          "success"
        );
      } else {
        showToast(t("kpi.measurementSaved"), indicator.name, "success");
      }
      onOpenChange(false);
    } catch {
      showToast(t("kpi.saveError"), indicator.name, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${
        editing
          ? t("kpi.measurement.editTitle", "Corriger la mesure")
          : t("kpi.fillValue", "Renseigner la valeur")
      } — ${indicator.name}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={saving}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-[11px] font-medium text-text-secondary">
          {t("kpi.period")}
          <input value={period} onChange={(e) => setPeriod(e.target.value)} className={FIELD} />
        </label>
        {quantitative && (
          <label className="block text-[11px] font-medium text-text-secondary">
            {t("kpi.value")}
            {indicator.unit ? ` (${indicator.unit})` : ""}
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              className={FIELD}
            />
          </label>
        )}
        <label className="block text-[11px] font-medium text-text-secondary">
          {quantitative ? t("kpi.noteOptional") : t("kpi.qualitativeNote")}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className={FIELD}
          />
        </label>
        <p className="text-[11px] text-tertiary">{t("kpi.periodHint")}</p>
        {editingBaseline && (
          <p className="rounded-md border border-bp-coral/40 bg-bp-coral/5 px-2.5 py-1.5 text-[11px] text-text-secondary">
            {t(
              "kpi.measurement.baselineEditHint",
              "Cette mesure est la valeur initiale (référence) de l'indicateur : la corriger change la base de calcul de l'avancement."
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}
