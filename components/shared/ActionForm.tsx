"use client";

import { useState } from "react";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type {
  ActionImpact,
  ActionStatus,
  BeTrackData,
  LeverAction,
  RecognitionMode,
  SavingType,
} from "@/types";

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
    done: t("leverDetail.finished", "Terminé"),
    delayed: t("leverDetail.late", "En retard"),
  };
}

function savingTypeLabels(
  t: (key: string, fallback?: string) => string
): Record<SavingType, string> {
  return {
    cost_reduction: t("shared.actionForm.savingCostReduction", "Réduction de coût"),
    revenue_increase: t("shared.actionForm.savingRevenueIncrease", "Augmentation du CA"),
    working_capital: t("shared.actionForm.savingWorkingCapital", "Impact BFR"),
  };
}

function generateId(): string {
  return "IMP" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function emptyImpact(): ActionImpact {
  return {
    id: generateId(),
    label: "",
    type: "cost",
    nature: "oneoff",
    amount: 0,
  };
}

export type ActionFormValues = Omit<LeverAction, "id">;

/** Formulaire de création/édition d'une action enrichie, avec un tableau d'impacts inline.
 *  Le tableau d'impacts permet d'ajouter/supprimer des lignes comme dans un tableur. Pour les
 *  gains (type="saving"), on précise en plus la nature du gain (coût/CA/BFR), la date
 *  d'encaissement et le mode de reconnaissance (lissé/one-shot) ; pour les CAPEX (nature="capex"),
 *  la date d'engagement. Un commentaire libre peut expliquer la méthode de calcul. */
export function ActionForm({
  data,
  companyDefaultRecognition = "smoothing",
  initialValues,
  submitLabel,
  onSubmit,
  onCancel,
  onDelete,
}: {
  data: BeTrackData;
  /** Mode de reconnaissance par défaut de l'entreprise (Company.defaultRecognition), affiché en
   * clair sur l'option "Défaut entreprise" du sélecteur par ligne d'impact. */
  companyDefaultRecognition?: RecognitionMode;
  initialValues?: Partial<LeverAction>;
  submitLabel?: string;
  onSubmit: (values: ActionFormValues) => void;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const STATUS_LABELS = actionStatusLabels(t);
  const SAVING_TYPE_LABELS = savingTypeLabels(t);
  const resolvedSubmitLabel = submitLabel ?? t("leverDetail.createAction", "Créer l'action");
  const [name, setName] = useState(initialValues?.name ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [owner, setOwner] = useState(initialValues?.owner ?? "");
  const [start, setStart] = useState(initialValues?.start ?? "");
  const [end, setEnd] = useState(initialValues?.end ?? "");
  const [status, setStatus] = useState<ActionStatus>(initialValues?.status ?? "todo");
  const [impacts, setImpacts] = useState<ActionImpact[]>(
    initialValues?.impacts && initialValues.impacts.length > 0
      ? initialValues.impacts
      : [emptyImpact()]
  );

  const updateImpact = (idx: number, patch: Partial<ActionImpact>) => {
    setImpacts((prev) => prev.map((imp, i) => (i === idx ? { ...imp, ...patch } : imp)));
  };
  const removeImpact = (idx: number) => setImpacts((prev) => prev.filter((_, i) => i !== idx));
  const addImpact = () => setImpacts((prev) => [...prev, emptyImpact()]);

  const handleSubmit = () => {
    const validImpacts = impacts.filter((imp) => imp.label.trim() !== "" && imp.amount > 0);
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
      status,
      cost: 0,
      impacts: validImpacts,
    });
  };

  const pnlOptions = data.pnlAccounts.filter((a) => !a.computed && a.selectable !== false);
  const entityOptions = Array.from(
    new Set(data.levers.map((l) => l.entity).filter((v): v is string => !!v))
  ).sort();

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
            {t("shared.actionForm.owner", "Owner")}
          </label>
          <input className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-secondary">
            {t("hr.status", "Statut")}
          </label>
          <select
            className={selectClass}
            value={status}
            onChange={(e) => setStatus(e.target.value as ActionStatus)}
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
      </div>

      {/* Tableau d'impacts inline */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-secondary">
            {t("action.impacts", "Lignes d'impact")}
          </span>
          <button
            type="button"
            onClick={addImpact}
            className="rounded-sm bg-bp-coral/10 px-2 py-0.5 text-xs font-semibold text-bp-coral transition hover:bg-bp-coral/20"
          >
            + {t("common.add", "Ajouter")}
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto rounded-md border border-border">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1620px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-border bg-neutral-50">
                  <th className="sticky left-0 z-10 w-[90px] min-w-[90px] bg-neutral-50 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("shared.actionForm.type", "Type")}
                  </th>
                  <th className="w-[160px] min-w-[160px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("leverForm.sectionDescription", "Description")}
                  </th>
                  <th className="w-[110px] min-w-[110px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("leverDetail.impactTable.nature", "Nature")}
                  </th>
                  <th className="w-[90px] min-w-[90px] px-2 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-secondary">
                    €M
                  </th>
                  <th className="w-[70px] min-w-[70px] px-2 py-1.5 text-right text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("shared.actionForm.fteColumn", "ETP")}
                  </th>
                  <th className="w-[130px] min-w-[130px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("shared.actionForm.savingType", "Type de gain")}
                  </th>
                  <th className="w-[120px] min-w-[120px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("shared.actionForm.capexDate", "Date CAPEX")}
                  </th>
                  <th className="w-[120px] min-w-[120px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("shared.actionForm.gainDate", "Date gain")}
                  </th>
                  <th className="w-[130px] min-w-[130px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("shared.actionForm.recognition", "Reconnaissance")}
                  </th>
                  <th className="w-[150px] min-w-[150px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("shared.actionForm.costLine", "Poste de coût")}
                  </th>
                  <th className="w-[110px] min-w-[110px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("leverForm.costCenter", "Centre de coût")}
                  </th>
                  <th className="w-[120px] min-w-[120px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("leverDetail.impactTable.entityPnl", "Entité (P&L)")}
                  </th>
                  <th className="w-[180px] min-w-[180px] px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-secondary">
                    {t("hr.column.comment", "Commentaire")}
                  </th>
                  <th
                    className="w-[40px] min-w-[40px] px-2 py-1.5"
                    aria-label={t("shared.actionForm.actionsColumnAria", "Actions")}
                  />
                </tr>
              </thead>
              <tbody>
                {impacts.map((imp, idx) => (
                  <tr key={imp.id} className="border-b border-border last:border-b-0">
                    <td className="sticky left-0 z-10 w-[90px] min-w-[90px] bg-white px-2 py-1.5 align-top">
                      <select
                        className={selectClass}
                        value={imp.type}
                        onChange={(e) => {
                          const newType = e.target.value as "cost" | "saving";
                          const patch: Partial<ActionImpact> = { type: newType };
                          // Si on passe en "saving" et que la nature est "capex" (non valide), basculer vers "oneoff"
                          if (newType === "saving" && imp.nature === "capex") {
                            patch.nature = "oneoff";
                          }
                          if (newType === "cost") {
                            patch.savingType = undefined;
                            patch.gainDate = undefined;
                          }
                          updateImpact(idx, patch);
                        }}
                      >
                        <option value="cost">{t("action.cost", "Coût")}</option>
                        <option value="saving">{t("action.saving", "Gain")}</option>
                      </select>
                    </td>

                    <td className="w-[160px] min-w-[160px] px-2 py-1.5 align-top">
                      <input
                        className={inputClass}
                        value={imp.label}
                        onChange={(e) => updateImpact(idx, { label: e.target.value })}
                        placeholder={t(
                          "shared.actionForm.descriptionPlaceholder",
                          "Description..."
                        )}
                      />
                    </td>

                    <td className="w-[110px] min-w-[110px] px-2 py-1.5 align-top">
                      <select
                        className={selectClass}
                        value={imp.nature}
                        onChange={(e) => {
                          const nature = e.target.value as ActionImpact["nature"];
                          const patch: Partial<ActionImpact> = { nature };
                          if (nature !== "capex") patch.capexDeploymentDate = undefined;
                          updateImpact(idx, patch);
                        }}
                      >
                        {imp.type === "cost" ? (
                          <>
                            <option value="capex">{t("leverForm.capex", "CAPEX")}</option>
                            <option value="opex_rec">
                              {t("shared.actionForm.opexRecShort", "OPEX réc.")}
                            </option>
                            <option value="oneoff">
                              {t("shared.actionForm.oneOff", "One-off")}
                            </option>
                          </>
                        ) : (
                          <>
                            <option value="opex_rec">
                              {t("leverDetail.impactTable.recurrent", "Récurrent")}
                            </option>
                            <option value="oneoff">
                              {t("shared.actionForm.oneOff", "One-off")}
                            </option>
                          </>
                        )}
                      </select>
                    </td>

                    <td className="w-[90px] min-w-[90px] px-2 py-1.5 align-top">
                      <input
                        className={`${inputClass} text-right`}
                        type="number"
                        step="0.01"
                        value={imp.amount || ""}
                        onChange={(e) =>
                          updateImpact(idx, { amount: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>

                    <td className="w-[70px] min-w-[70px] px-2 py-1.5 align-top">
                      <input
                        className={`${inputClass} text-right`}
                        type="number"
                        step="1"
                        value={imp.fteCount ?? ""}
                        onChange={(e) =>
                          updateImpact(idx, {
                            fteCount: e.target.value ? parseInt(e.target.value) : undefined,
                          })
                        }
                      />
                    </td>

                    <td className="w-[130px] min-w-[130px] px-2 py-1.5 align-top">
                      {imp.type === "saving" ? (
                        <select
                          className={selectClass}
                          value={imp.savingType ?? ""}
                          onChange={(e) =>
                            updateImpact(idx, {
                              savingType: (e.target.value || undefined) as SavingType | undefined,
                            })
                          }
                        >
                          <option value="">—</option>
                          {(Object.keys(SAVING_TYPE_LABELS) as SavingType[]).map((st) => (
                            <option key={st} value={st}>
                              {SAVING_TYPE_LABELS[st]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-tertiary">—</span>
                      )}
                    </td>

                    <td className="w-[120px] min-w-[120px] px-2 py-1.5 align-top">
                      {imp.nature === "capex" ? (
                        <input
                          className={inputClass}
                          type="date"
                          value={imp.capexDeploymentDate ?? ""}
                          onChange={(e) =>
                            updateImpact(idx, { capexDeploymentDate: e.target.value || undefined })
                          }
                          title={t(
                            "shared.actionForm.capexDeploymentTitle",
                            "Date à laquelle le CAPEX est engagé à 100%"
                          )}
                        />
                      ) : (
                        <span className="text-tertiary">—</span>
                      )}
                    </td>

                    <td className="w-[120px] min-w-[120px] px-2 py-1.5 align-top">
                      {imp.type === "saving" ? (
                        <input
                          className={inputClass}
                          type="date"
                          value={imp.gainDate ?? ""}
                          onChange={(e) =>
                            updateImpact(idx, { gainDate: e.target.value || undefined })
                          }
                          title={t(
                            "shared.actionForm.gainDateTitle",
                            "Date d'encaissement réel du gain"
                          )}
                        />
                      ) : (
                        <span className="text-tertiary">—</span>
                      )}
                    </td>

                    <td className="w-[130px] min-w-[130px] px-2 py-1.5 align-top">
                      {imp.type === "saving" || imp.nature === "capex" ? (
                        <select
                          className={selectClass}
                          value={imp.recognition ?? ""}
                          onChange={(e) =>
                            updateImpact(idx, {
                              recognition: (e.target.value || undefined) as
                                RecognitionMode | undefined,
                            })
                          }
                        >
                          <option value="">
                            {t("shared.actionForm.recognitionDefault", "Défaut ({value})").replace(
                              "{value}",
                              companyDefaultRecognition === "one_shot"
                                ? t("shared.actionForm.oneShotLower", "one-shot")
                                : t("shared.actionForm.smoothedLower", "lissé")
                            )}
                          </option>
                          <option value="smoothing">
                            {t("shared.actionForm.smoothed", "Lissé")}
                          </option>
                          <option value="one_shot">
                            {t("shared.actionForm.oneShot", "One-shot")}
                          </option>
                        </select>
                      ) : (
                        <span className="text-tertiary">—</span>
                      )}
                    </td>

                    <td className="w-[150px] min-w-[150px] px-2 py-1.5 align-top">
                      <select
                        className={selectClass}
                        value={imp.pnlMap ?? ""}
                        onChange={(e) => updateImpact(idx, { pnlMap: e.target.value || undefined })}
                      >
                        <option value="">—</option>
                        {pnlOptions.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="w-[110px] min-w-[110px] px-2 py-1.5 align-top">
                      <input
                        className={inputClass}
                        value={imp.costCenter ?? ""}
                        onChange={(e) =>
                          updateImpact(idx, { costCenter: e.target.value || undefined })
                        }
                        placeholder={t("shared.actionForm.costCenterPlaceholder", "CC...")}
                      />
                    </td>

                    <td className="w-[120px] min-w-[120px] px-2 py-1.5 align-top">
                      <select
                        className={selectClass}
                        value={imp.entity ?? ""}
                        onChange={(e) => updateImpact(idx, { entity: e.target.value || undefined })}
                      >
                        <option value="">—</option>
                        {entityOptions.map((ent) => (
                          <option key={ent} value={ent}>
                            {ent}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="w-[180px] min-w-[180px] px-2 py-1.5 align-top">
                      <input
                        className={inputClass}
                        value={imp.comments?.[imp.comments.length - 1]?.text ?? ""}
                        onChange={(e) => {
                          const text = e.target.value;
                          updateImpact(idx, {
                            comments: text
                              ? [
                                  {
                                    user:
                                      owner.trim() ||
                                      t("shared.actionForm.demoUser", "Utilisateur démo"),
                                    ts: new Date().toISOString().slice(0, 10),
                                    text,
                                  },
                                ]
                              : [],
                          });
                        }}
                        placeholder={t(
                          "shared.actionForm.calcMethodPlaceholder",
                          "Méthode de calcul, hypothèses..."
                        )}
                      />
                    </td>

                    <td className="w-[40px] min-w-[40px] px-2 py-1.5 align-top">
                      {impacts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeImpact(idx)}
                          className="text-tertiary transition hover:text-bp-coral"
                          aria-label={t(
                            "shared.actionForm.deleteImpactRowAria",
                            "Supprimer cette ligne d'impact"
                          )}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
