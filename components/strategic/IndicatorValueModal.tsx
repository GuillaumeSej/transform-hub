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
  measurementLabel,
  parseNumber,
  type IndicatorValueInput,
  type MeasurementEditPatch,
} from "@/lib/kpiHistory";
import { parsePeriodForFrequency, periodFormatHint } from "@/lib/indicatorPeriod";
import { editKpiValueFlow, submitKpiValueFlow } from "@/lib/strategicApprovalFlows";
import { useStrategicApprovalsApi } from "@/lib/hooks/useStrategicApprovalsContext";
import { KpiCorrectionNotice } from "@/components/strategic/KpiCorrectionNotice";
import type { KpiCorrectionRoute } from "@/lib/kpiCorrectionRouting";
import type { AuthUser, Indicator, IndicatorMeasurement } from "@/types";

const FIELD =
  "mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-sm text-text-primary outline-none focus:border-bp-coral";

/**
 * Modale de saisie d'une valeur (période, valeur, commentaire optionnel) — KPI marché — et de
 * CORRECTION d'une mesure déjà publiée (`editing` fourni : champs pré-remplis, écriture via
 * `editKpiValueFlow`). Monter avec une `key` propre à la mesure éditée : l'état initial est lu au
 * montage.
 *
 * Période déjà renseignée (saisie d'une NOUVELLE valeur sur une période prise) : jamais de second
 * document pour la même période. La modale propose de REMPLACER la valeur existante — ce qui
 * devient une correction de cette mesure, avec les MÊMES règles de routage
 * (`routeKpiCorrection` : directe ou demande au responsable) — ou refuse avec un message clair si
 * l'utilisateur n'a pas le droit de corriger.
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
  correctionRoute,
  initialDraft,
  replacing = false,
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
  /** Circuit de la correction (`routeKpiCorrection`) — texte explicatif + demande/directe. */
  correctionRoute?: KpiCorrectionRoute | null;
  /** Valeur/commentaire pré-remplis (remplacement d'une mesure sur une période déjà prise). */
  initialDraft?: { value?: number; note?: string };
  /** `editing` est ouvert pour REMPLACER sa valeur par une nouvelle saisie (bandeau explicatif). */
  replacing?: boolean;
}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const sa = useStrategicApprovalsApi();
  const quantitative = indicator.kind === "quantitative";
  const [period, setPeriod] = useState(() => editing?.period ?? currentPeriod(indicator.frequency));
  const [value, setValue] = useState(() => {
    const v = initialDraft ? initialDraft.value : editing?.value;
    return v !== undefined ? String(v) : "";
  });
  const [note, setNote] = useState(() => (initialDraft ? initialDraft.note : editing?.note) ?? "");
  const [saving, setSaving] = useState(false);
  /** Mesure existante sur la période saisie (saisie d'une NOUVELLE valeur) : la validation
   *  suivante la REMPLACE (correction routée), voir l'en-tête. */
  const [replaceTarget, setReplaceTarget] = useState<IndicatorMeasurement | null>(null);
  const target = editing ?? replaceTarget ?? undefined;
  const route =
    correctionRoute !== undefined
      ? correctionRoute
      : sa && user
        ? sa.kpiCorrectionRoute(indicator)
        : null;
  const canReplace = !!updateMeasurement && (route ? route.mode !== "forbidden" : true);
  const editingBaseline = !!target && isBaseline(target, measurements);

  const collisionMessage = (p: string) =>
    t(
      "kpi.measurement.periodCollision",
      "Une mesure existe déjà pour la période {period}."
    ).replace("{period}", p);

  const submitEdit = async (p: string, parsed: number | undefined) => {
    const editing = target;
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
        updateMeasurement,
        route ?? undefined
      );
      showToast(
        outcome === "pending"
          ? t(
              "kpi.measurement.correctionSubmitted",
              "Demande de correction envoyée pour validation"
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
    const raw = period.trim();
    if (!raw) return showToast(t("kpi.periodRequired"), "", "error");
    // Période STRICTE par fréquence (normalisée : "2026-3" → "2026-03", "T1 2026" → "2026-Q1") ;
    // une période historique inchangée d'une mesure corrigée reste acceptée telle quelle.
    const p =
      parsePeriodForFrequency(raw, indicator.frequency) ??
      (target && raw === target.period.trim() ? raw : undefined);
    if (!p) {
      return showToast(
        t("kpi.periodInvalid", "Période invalide — format attendu : {format}").replace(
          "{format}",
          periodFormatHint(indicator.frequency)
        ),
        "",
        "error"
      );
    }
    const parsed = quantitative ? parseNumber(value) : undefined;
    if (parsed === null) return showToast(t("kpi.valueInvalid"), "", "error");
    if (parsed === undefined && note.trim() === "")
      return showToast(t("kpi.valueRequired"), "", "error");
    if (target) return submitEdit(p, parsed);
    if (!addMeasurement) return;
    const existing = findPeriodCollision(measurements, indicator.id, p);
    if (existing) {
      const full = measurements.find((m) => m.id === existing.id);
      if (full && canReplace) {
        // 1er clic : on bascule en mode « remplacer » (bandeau + bouton explicites) ; la
        // validation suivante corrige la mesure existante (routage de correction).
        setReplaceTarget(full);
        return;
      }
      return showToast(
        t(
          "kpi.measurement.periodTakenNoRight",
          "Une valeur existe déjà pour la période {period} et vous n'êtes pas habilité à la remplacer."
        ).replace("{period}", p),
        indicator.name,
        "error"
      );
    }
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
        addMeasurement,
        measurements
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

  const showReplaceNotice = replacing || !!replaceTarget;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${
        target
          ? t("kpi.measurement.editTitle", "Corriger la mesure")
          : t("kpi.fillValue", "Renseigner la valeur")
      } — ${indicator.name}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={submit} disabled={saving}>
            {replaceTarget
              ? t("kpi.measurement.replaceConfirm", "Remplacer la valeur")
              : t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block text-[11px] font-medium text-text-secondary">
          {t("kpi.period")}
          <input
            value={period}
            onChange={(e) => {
              setPeriod(e.target.value);
              // Changer de période annule le remplacement proposé (la nouvelle période peut être libre).
              setReplaceTarget(null);
            }}
            placeholder={periodFormatHint(indicator.frequency)}
            className={FIELD}
          />
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
        {showReplaceNotice && target && (
          <p className="rounded-md border border-bp-coral/40 bg-bp-coral/5 px-2.5 py-1.5 text-[11px] text-text-secondary">
            {t(
              "kpi.measurement.replaceNotice",
              "Une valeur existe déjà pour la période {period} ({value}) : la nouvelle saisie la remplacera."
            )
              .replace("{period}", target.period)
              .replace("{value}", measurementLabel(target, indicator.unit))}
          </p>
        )}
        {target && <KpiCorrectionNotice route={route} action="edit" />}
      </div>
    </Modal>
  );
}
