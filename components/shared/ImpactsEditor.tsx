"use client";

import { useEffect, useState } from "react";
import { HierarchyLeafSelect } from "@/components/shared/HierarchyLeafSelect";
import { subscribeHierarchyNodes } from "@/lib/firestore/admin";
import { getImpactNatures } from "@/lib/impactConfig";
import {
  impactDatesOf,
  impactDatesPatch,
  impactKindPatch,
  impactTypeOf,
  impactTypePatch,
  missingImpactFields,
  type ImpactTypeKey,
} from "@/lib/impactKinds";
import { leverImpactTotals } from "@/lib/engine";
import { coerceImpactStatus, impactStatusOf } from "@/lib/impactStatus";
import { effectiveLeafLevel, leafLevels } from "@/lib/hierarchyLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Company, HierarchyNode, LeverImpact } from "@/types";

const inputClass =
  "w-full min-w-0 rounded-sm border border-border bg-white px-1.5 py-1 text-[12px] focus:border-bp-coral focus:outline-none disabled:bg-neutral-100 disabled:text-tertiary";
const invalidClass = "border-bp-coral";
const thClass =
  "whitespace-nowrap px-1.5 py-1.5 text-left text-[9.5px] font-semibold uppercase tracking-wide text-tertiary";

function newId(): string {
  return "IMP" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function emptyImpact(): LeverImpact {
  return { id: newId(), label: "", amount: 0, ...impactKindPatch("opex") } as LeverImpact;
}

function GeographyLeafSelect({
  companyId,
  levelKeys,
  value,
  onChange,
  disabled,
}: {
  companyId: string;
  levelKeys: string[];
  value?: string;
  onChange: (v: string | undefined) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useState<HierarchyNode[]>([]);
  useEffect(() => {
    let cancelled = false;
    const unsub = subscribeHierarchyNodes(
      companyId,
      (n) => {
        if (!cancelled) setNodes(n);
      },
      "geographic"
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [companyId]);
  return (
    <select
      className={inputClass}
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{t("leverForm.selectPlaceholder", "Sélectionner")}</option>
      {nodes
        .filter((n) => levelKeys.includes(n.levelKey))
        .map((n) => (
          <option key={n.id} value={n.id}>
            {n.label} ({n.code})
          </option>
        ))}
    </select>
  );
}

const fmt = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €M`;

/** Éditeur d'impacts d'un levier (OPEX, CAPEX, gains, ETP) — vue tableau inline, illimitée,
 *  avec pied de synthèse. Réutilisable par l'onglet Impact de la fiche détail. */
export function ImpactsEditor({
  impacts,
  onChange,
  company,
  canEdit = true,
  readOnly = false,
}: {
  impacts: LeverImpact[];
  onChange: (next: LeverImpact[]) => void;
  company?: Company | null;
  canEdit?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const editable = canEdit && !readOnly;
  const companyId = company?.id;
  const finLevel = effectiveLeafLevel(company?.hierarchyLevels ?? []);
  const geoLevel = effectiveLeafLevel(company?.geographyHierarchyLevels ?? []);
  const totals = leverImpactTotals(impacts);

  const update = (id: string, patch: Partial<LeverImpact>) =>
    onChange(
      impacts.map((i) => {
        if (i.id !== id) return i;
        const next = { ...i, ...patch };
        if (next.status && !("status" in patch))
          next.status = coerceImpactStatus(next, next.status);
        return next;
      })
    );
  const remove = (id: string) => onChange(impacts.filter((i) => i.id !== id));

  const TYPE_LABELS: Record<ImpactTypeKey, string> = {
    fte: t("impactsEditor.typeFte", "ETP"),
    opex_rec: t("impactsEditor.typeOpexRec", "OPEX récurrent"),
    opex_oneoff: t("impactsEditor.typeOpexOneOff", "OPEX one-off"),
    capex: "CAPEX",
    gain_rec: t("impactsEditor.typeGainRec", "Gain récurrent"),
    gain_oneoff: t("impactsEditor.typeGainOneOff", "Gain one-off"),
  };
  const FIN_TYPES: ImpactTypeKey[] = [
    "opex_rec",
    "opex_oneoff",
    "capex",
    "gain_rec",
    "gain_oneoff",
  ];
  const dash = <span className="px-1.5 text-tertiary">—</span>;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-md border border-border bg-white">
        <table className="w-full min-w-[1180px] border-collapse text-[12px]">
          <thead className="border-b border-border bg-neutral-50">
            <tr>
              <th className={thClass} style={{ width: 170 }}>
                {t("impactsEditor.impactType", "Type d'impact")}
              </th>
              <th className={thClass} style={{ width: 150 }}>
                {t("impactsEditor.label", "Libellé")}
              </th>
              <th className={thClass} style={{ width: 90 }}>
                {t("impactsEditor.amountOrFte", "Montant (€M) / ETP")}
              </th>
              <th className={thClass} style={{ width: 130 }}>
                {t("impactsEditor.nature", "Nature")} <span className="text-bp-coral">*</span>
              </th>
              <th className={thClass} style={{ width: 150 }}>
                {finLevel?.label ?? t("leverForm.costCenter", "Centre de coût")}{" "}
                <span className="text-bp-coral">*</span>
              </th>
              <th className={thClass} style={{ width: 130 }}>
                {geoLevel?.label ?? t("impactsEditor.geography", "Géographie")}
              </th>
              <th className={thClass} style={{ width: 120 }}>
                {t("impactsEditor.technology", "Technologie impactée")}
              </th>
              <th className={thClass} style={{ width: 120 }}>
                {t("impactsEditor.startDate", "Début")}
              </th>
              <th className={thClass} style={{ width: 120 }}>
                {t("impactsEditor.endDate", "Fin")}
              </th>
              <th className={thClass} style={{ width: 100 }}>
                {t("impactsEditor.status", "Statut")}
              </th>
              {editable && <th className={thClass} style={{ width: 28 }} />}
            </tr>
          </thead>
          <tbody>
            {impacts.length === 0 && (
              <tr>
                <td
                  colSpan={editable ? 11 : 10}
                  className="px-3 py-4 text-center text-[11px] text-tertiary"
                >
                  {t("impactsEditor.empty", "Aucun impact renseigné.")}
                </td>
              </tr>
            )}
            {impacts.map((imp) => {
              const key = impactTypeOf(imp);
              const isFte = key === "fte";
              const isCapex = key === "capex";
              const smoothed = isCapex && imp.capexAllocationMode === "smoothed";
              const isGain = key === "gain_rec" || key === "gain_oneoff";
              const dates = impactDatesOf(imp);
              const showEnd = isFte || smoothed;
              const missing = missingImpactFields(imp);
              const natures = getImpactNatures(company, isGain ? "saving" : "cost");
              // « En cours » (legacy, récurrent) s'affiche comme « Réalisé ».
              const uiStatus = impactStatusOf(imp) === "planned" ? "planned" : "done";
              const futureWarn =
                uiStatus === "done" && !!dates.start && new Date(dates.start) > new Date();
              return (
                <tr key={imp.id} className="border-b border-border align-top last:border-b-0">
                  <td className="p-1">
                    <select
                      className={inputClass}
                      disabled={!editable}
                      value={key}
                      onChange={(e) =>
                        update(imp.id, impactTypePatch(imp, e.target.value as ImpactTypeKey))
                      }
                    >
                      <option value="fte">{TYPE_LABELS.fte}</option>
                      <optgroup label={t("impactsEditor.financialGroup", "Financier (hors ETP)")}>
                        {FIN_TYPES.map((k) => (
                          <option key={k} value={k}>
                            {TYPE_LABELS[k]}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {isCapex && (
                      <select
                        className={`${inputClass} mt-1`}
                        disabled={!editable}
                        value={imp.capexAllocationMode ?? "one_shot"}
                        onChange={(e) => {
                          const mode = e.target.value as "one_shot" | "smoothed";
                          const { start } = impactDatesOf(imp);
                          const next = { ...imp, capexAllocationMode: mode } as LeverImpact;
                          update(imp.id, {
                            capexAllocationMode: mode,
                            capexStartDate: undefined,
                            capexDeploymentDate: undefined,
                            ...impactDatesPatch(next, { start: start ?? null }),
                          });
                        }}
                      >
                        <option value="one_shot">{t("impactsEditor.oneOff", "One-off")}</option>
                        <option value="smoothed">{t("impactsEditor.smoothed", "Lissé")}</option>
                      </select>
                    )}
                    {isFte && (
                      <select
                        className={`${inputClass} mt-1`}
                        disabled={!editable}
                        value={imp.fteDirection ?? "hire"}
                        onChange={(e) => {
                          const dir = e.target.value as "hire" | "departure";
                          const { start } = impactDatesOf(imp);
                          const next = { ...imp, fteDirection: dir } as LeverImpact;
                          update(imp.id, {
                            fteDirection: dir,
                            gainDate: undefined,
                            capexDeploymentDate: undefined,
                            ...impactDatesPatch(next, { start: start ?? null }),
                          });
                        }}
                      >
                        <option value="hire">{t("impactsEditor.hire", "Recrutement (+)")}</option>
                        <option value="departure">
                          {t("impactsEditor.departure", "Départ (−)")}
                        </option>
                      </select>
                    )}
                  </td>
                  <td className="p-1">
                    <input
                      className={inputClass}
                      disabled={!editable}
                      value={imp.label}
                      placeholder={t("impactsEditor.untitled", "Impact sans libellé")}
                      onChange={(e) => update(imp.id, { label: e.target.value })}
                    />
                  </td>
                  <td className="p-1">
                    {isFte ? (
                      <input
                        className={`${inputClass} text-right`}
                        type="number"
                        step="0.1"
                        min={0}
                        disabled={!editable}
                        aria-label={t("impactsEditor.fteCount", "Nombre d'ETP")}
                        value={imp.fteCount ?? ""}
                        onChange={(e) =>
                          update(imp.id, {
                            fteCount: e.target.value ? parseFloat(e.target.value) : undefined,
                          })
                        }
                      />
                    ) : (
                      <input
                        className={`${inputClass} text-right`}
                        type="number"
                        step="0.01"
                        min={0}
                        disabled={!editable}
                        aria-label={t("impactsEditor.amount", "Montant (€M)")}
                        value={imp.amount || ""}
                        onChange={(e) =>
                          update(imp.id, { amount: parseFloat(e.target.value) || 0 })
                        }
                      />
                    )}
                  </td>
                  <td className="p-1">
                    {isFte ? (
                      dash
                    ) : (
                      <select
                        className={`${inputClass} ${missing.includes("nature") ? invalidClass : ""}`}
                        disabled={!editable}
                        required
                        value={imp.natureId ?? ""}
                        onChange={(e) => update(imp.id, { natureId: e.target.value || undefined })}
                      >
                        <option value="">—</option>
                        {natures.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="p-1">
                    {isFte ? (
                      dash
                    ) : editable && companyId ? (
                      <HierarchyLeafSelect
                        companyId={companyId}
                        value={imp.hierarchyLeafId}
                        onChange={(v) => update(imp.id, { hierarchyLeafId: v })}
                        className={`${inputClass} ${missing.includes("hierarchy") ? invalidClass : ""}`}
                      />
                    ) : (
                      <input
                        className={inputClass}
                        disabled={!editable}
                        value={imp.costCenter ?? ""}
                        onChange={(e) =>
                          update(imp.id, { costCenter: e.target.value || undefined })
                        }
                      />
                    )}
                  </td>
                  <td className="p-1">
                    {geoLevel && companyId ? (
                      <GeographyLeafSelect
                        companyId={companyId}
                        levelKeys={leafLevels(company?.geographyHierarchyLevels ?? []).map(
                          (l) => l.key
                        )}
                        value={imp.geographyLeafId}
                        disabled={!editable}
                        onChange={(v) => update(imp.id, { geographyLeafId: v })}
                      />
                    ) : (
                      dash
                    )}
                  </td>
                  <td className="p-1">
                    {isFte ? (
                      dash
                    ) : (
                      <input
                        className={inputClass}
                        disabled={!editable}
                        value={imp.technology ?? ""}
                        onChange={(e) =>
                          update(imp.id, { technology: e.target.value || undefined })
                        }
                      />
                    )}
                  </td>
                  <td className="p-1">
                    <input
                      className={inputClass}
                      type="date"
                      disabled={!editable}
                      value={dates.start ?? ""}
                      onChange={(e) =>
                        update(imp.id, impactDatesPatch(imp, { start: e.target.value }))
                      }
                    />
                  </td>
                  <td className="p-1">
                    {showEnd ? (
                      <input
                        className={inputClass}
                        type="date"
                        disabled={!editable}
                        value={dates.end ?? ""}
                        onChange={(e) =>
                          update(imp.id, impactDatesPatch(imp, { end: e.target.value }))
                        }
                      />
                    ) : (
                      dash
                    )}
                  </td>
                  <td className="p-1">
                    <select
                      className={inputClass}
                      disabled={!editable}
                      value={uiStatus}
                      onChange={(e) =>
                        update(imp.id, {
                          status: coerceImpactStatus(imp, e.target.value as "planned" | "done"),
                        })
                      }
                    >
                      <option value="planned">
                        {t("impactsEditor.statusPlanned", "Planifié")}
                      </option>
                      <option value="done">{t("impactsEditor.statusDone", "Réalisé")}</option>
                    </select>
                    {futureWarn && (
                      <span className="mt-0.5 block text-[10px] text-bp-coral">
                        {t(
                          "impactsEditor.statusFutureWarn",
                          "Impact réalisé : la date de début est dans le futur."
                        )}
                      </span>
                    )}
                  </td>
                  {editable && (
                    <td className="p-1 text-center">
                      <button
                        type="button"
                        onClick={() => remove(imp.id)}
                        aria-label={t("common.delete", "Supprimer")}
                        className="text-[14px] leading-none text-tertiary hover:text-bp-coral"
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && (
        <div>
          <button
            type="button"
            onClick={() => onChange([...impacts, emptyImpact()])}
            className="rounded-sm bg-bp-coral/10 px-2.5 py-1 text-xs font-semibold text-bp-coral transition hover:bg-bp-coral/20"
          >
            + {t("impactsEditor.add", "Ajouter un impact")}
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-neutral-50 p-3 text-[11px] md:grid-cols-3">
        <Stat
          label={t("impactsEditor.grossAnnual", "Total gains bruts (annualisés)")}
          v={fmt(totals.grossAnnual)}
        />
        <Stat
          label={t("impactsEditor.oneOffGains", "Total gains ponctuels")}
          v={fmt(totals.oneOffGains)}
          hint={t("impactsEditor.oneOffHint", "Non comptés dans les savings")}
        />
        <Stat label={t("impactsEditor.netAnnual", "Total gains nets")} v={fmt(totals.netAnnual)} />
        <Stat label="OPEX one-off" v={fmt(totals.opexOneOff)} />
        <Stat label={t("impactsEditor.opexRec", "OPEX récurrent")} v={fmt(totals.opexRec)} />
        <Stat label="CAPEX" v={fmt(totals.capex)} />
        <Stat label={t("impactsEditor.fteNet", "ETP net")} v={String(totals.fteNet)} />
      </div>
    </div>
  );
}

function Stat({ label, v, hint }: { label: string; v: string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-tertiary">{label}</div>
      <div className="text-[13px] font-semibold text-primary">{v}</div>
      {hint && <div className="text-[10px] text-tertiary">{hint}</div>}
    </div>
  );
}
