"use client";

import { useState } from "react";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { currentPeriod, parseNumber, type IndicatorValueInput } from "@/lib/kpiHistory";
import { submitKpiValueFlow } from "@/lib/strategicApprovalFlows";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import type { AuthUser, Indicator } from "@/types";

const FIELD =
  "mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral";

/** Modale de saisie d'une valeur (période, valeur, commentaire optionnel) — KPI marché. */
export function IndicatorValueModal({
  indicator,
  user,
  addMeasurement,
  open,
  onOpenChange,
}: {
  indicator: Indicator;
  user: AuthUser;
  addMeasurement: (input: IndicatorValueInput) => Promise<unknown>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const sa = useStrategicApprovalsApi();
  const quantitative = indicator.kind === "quantitative";
  const [period, setPeriod] = useState(() => currentPeriod(indicator.frequency));
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const p = period.trim();
    if (!p) return showToast(t("kpi.periodRequired"), "", "error");
    const parsed = quantitative ? parseNumber(value) : undefined;
    if (parsed === null) return showToast(t("kpi.valueInvalid"), "", "error");
    if (parsed === undefined && note.trim() === "")
      return showToast(t("kpi.valueRequired"), "", "error");
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
      title={`${t("kpi.fillValue", "Renseigner la valeur")} — ${indicator.name}`}
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
      </div>
    </Modal>
  );
}
