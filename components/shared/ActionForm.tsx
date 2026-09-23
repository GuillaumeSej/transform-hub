"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { applyActionProgress, applyActionStatus } from "@/lib/leversLogic";
import type { ActionStatus, BeTrackData, LeverAction } from "@/types";

const inputClass =
  "w-full rounded-sm border border-border bg-white px-2 py-1.5 text-[12px] focus:border-bp-coral focus:outline-none";
const selectClass =
  "w-full rounded-sm border border-border bg-white px-1.5 py-1.5 text-[12px] focus:border-bp-coral focus:outline-none";

const ACTION_STATUSES: ActionStatus[] = ["todo", "in_progress", "done", "delayed"];

function actionStatusLabels(
  t: (key: string, fallback?: string) => string
): Record<ActionStatus, string> {
  return {
    todo: t("leverDetail.todo", "À faire"),
    in_progress: t("leverDetail.inProgress", "En cours"),
    done: t("leverDetail.finished", "Réalisé"),
    delayed: t("leverDetail.late", "En retard"),
  };
}

export type ActionFormValues = Omit<LeverAction, "id">;

/** Formulaire simplifié d'une action : identification, dates, statut, avancement (%) et poids
 *  optionnel. Les impacts vivent sur le levier (`Lever.impacts`). Statut et avancement restent
 *  synchronisés (voir `applyActionProgress`/`applyActionStatus`). */
export function ActionForm({
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  /** Conservés pour compat avec les appelants existants — non utilisés. */
  data?: BeTrackData;
  companyId?: string | null;
  initialValues?: Partial<LeverAction>;
  submitLabel?: string;
  onSubmit: (values: ActionFormValues) => void;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const STATUS_LABELS = actionStatusLabels(t);
  const resolvedSubmitLabel = submitLabel ?? t("leverDetail.createAction", "Créer l'action");
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [owner, setOwner] = useState(initialValues?.owner ?? "");
  const [start, setStart] = useState(initialValues?.start ?? "");
  const [end, setEnd] = useState(initialValues?.end ?? "");
  const [weightPct, setWeightPct] = useState<number | undefined>(initialValues?.weightPct);
  // Statut + avancement + date de livraison évoluent ensemble via les règles de leversLogic.
  const [sync, setSync] = useState<
    Pick<LeverAction, "status" | "declaredProgressPct" | "deliveredDate">
  >({
    status: initialValues?.status ?? "todo",
    declaredProgressPct:
      initialValues?.declaredProgressPct ?? (initialValues?.status === "done" ? 100 : undefined),
    deliveredDate: initialValues?.deliveredDate,
  });
  const base = { ...(initialValues as LeverAction), ...sync } as LeverAction;
  const pick = (a: LeverAction) =>
    setSync({
      status: a.status,
      declaredProgressPct: a.declaredProgressPct,
      deliveredDate: a.deliveredDate,
    });

  const handleSubmit = () => {
    onSubmit({
      name: name.trim(),
      description: description.trim() || undefined,
      owner: owner.trim() || undefined,
      ownerInit:
        owner
          .trim()
          .split(" ")
          .map((w) => w[0])
          .join("")
          .slice(0, 2)
          .toUpperCase() || undefined,
      start,
      end,
      status: sync.status,
      declaredProgressPct: sync.declaredProgressPct,
      deliveredDate: sync.deliveredDate,
      weightPct,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Identification */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("shared.actionForm.actionName", "Nom de l'action")}
          </label>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("shared.actionForm.actionNamePlaceholder", "Ex: Lancer le RFP")}
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("leverForm.sectionDescription", "Description")}
          </label>
          <textarea
            className={inputClass}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("shared.actionForm.owner", "Responsable")}
          </label>
          <input className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("hr.status", "Statut")}
          </label>
          <select
            className={selectClass}
            value={sync.status}
            onChange={(e) => pick(applyActionStatus(base, e.target.value as ActionStatus))}
          >
            {ACTION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("shared.actionForm.startDate", "Date début")}
          </label>
          <input
            className={inputClass}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("shared.actionForm.endDate", "Date fin")}
          </label>
          <input
            className={inputClass}
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("actionWeights.weight", "Poids (%)")}
          </label>
          <input
            className={inputClass}
            type="number"
            min={0}
            max={100}
            step={0.1}
            value={weightPct ?? ""}
            onChange={(e) =>
              setWeightPct(e.target.value === "" ? undefined : Number(e.target.value))
            }
            placeholder={t("actionWeights.optional", "Optionnel")}
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("shared.actionForm.declaredProgressPct", "Avancement déclaratif (%)")}
          </label>
          <input
            className={inputClass}
            type="number"
            min={0}
            max={100}
            step={1}
            value={sync.declaredProgressPct ?? ""}
            onChange={(e) => {
              if (e.target.value === "") {
                setSync((c) => ({ ...c, declaredProgressPct: undefined }));
                return;
              }
              pick(applyActionProgress(base, Number(e.target.value)));
            }}
            placeholder={t("shared.actionForm.declaredProgressPctPlaceholder", "Non déclaré")}
          />
        </div>
      </div>

      {/* Boutons */}
      <div className="flex items-center gap-2 pt-2">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="rounded-md px-3 py-2 text-[12px] font-semibold text-rag-red transition hover:bg-rag-red-light"
          >
            {t("common.delete", "Supprimer")}
          </button>
        )}
        <div className="flex-1" />
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-[12px] font-semibold text-secondary hover:bg-neutral-100"
          >
            {t("common.cancel", "Annuler")}
          </button>
        )}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim() || !start || !end}
          className="rounded-md bg-bp-coral px-4 py-2 text-[12px] font-semibold text-white transition hover:bg-bp-red-brick disabled:opacity-40"
        >
          {resolvedSubmitLabel}
        </button>
      </div>
    </div>
  );
}
