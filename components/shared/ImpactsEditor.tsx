"use client";

import { useEffect, useState } from "react";
import { HierarchyLeafSelect } from "@/components/shared/HierarchyLeafSelect";
import { subscribeHierarchyNodes } from "@/lib/firestore/admin";
import { getImpactNatures } from "@/lib/impactConfig";
import { impactKindOf, impactKindPatch, type ImpactKind } from "@/lib/impactKinds";
import { leverImpactTotals } from "@/lib/engine";
import {
  allowedImpactStatuses,
  coerceImpactStatus,
  impactStatusOf,
  isRecurringImpact,
  type ImpactStatus,
} from "@/lib/impactStatus";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Company, HierarchyLevelDef, HierarchyNode, LeverImpact } from "@/types";

const inputClass =
  "w-full rounded-sm border border-border bg-white px-2 py-1.5 text-[12px] focus:border-bp-coral focus:outline-none disabled:bg-neutral-100 disabled:text-tertiary";
const labelClass = "mb-0.5 block text-[9.5px] font-semibold uppercase tracking-wide text-tertiary";

function newId(): string {
  return "IMP" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function emptyImpact(): LeverImpact {
  return { id: newId(), label: "", amount: 0, ...impactKindPatch("opex") } as LeverImpact;
}

function finest(levels?: HierarchyLevelDef[]): HierarchyLevelDef | undefined {
  return [...(levels ?? [])].sort((a, b) => a.order - b.order).pop();
}

function GeographyLeafSelect({
  companyId,
  levelKey,
  value,
  onChange,
  disabled,
}: {
  companyId: string;
  levelKey: string;
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
        .filter((n) => n.levelKey === levelKey)
        .map((n) => (
          <option key={n.id} value={n.id}>
            {n.label} ({n.code})
          </option>
        ))}
    </select>
  );
}

const fmt = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} €M`;

/** Éditeur d'impacts d'un levier (OPEX, CAPEX, gains, ETP) — illimité, avec pied de synthèse.
 *  Réutilisable par l'onglet Impact de la fiche détail (`canEdit`/`readOnly`). */
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
  const finLevel = finest(company?.hierarchyLevels);
  const geoLevel = finest(company?.geographyHierarchyLevels);
  const totals = leverImpactTotals(impacts);
  const [openId, setOpenId] = useState<string | null>(null);

  // Un changement de mode (récurrent ↔ ponctuel) corrige un statut devenu invalide (réalisé ↔ en cours).
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
  const STATUS_LABELS: Record<ImpactStatus, string> = {
    planned: t("impactsEditor.statusPlanned", "Planifié"),
    done: t("impactsEditor.statusDone", "Réalisé"),
    ongoing: t("impactsEditor.statusOngoing", "En cours"),
  };
  const STATUS_STYLES: Record<ImpactStatus, string> = {
    planned: "bg-neutral-100 text-secondary",
    done: "bg-emerald-50 text-emerald-700",
    ongoing: "bg-blue-50 text-blue-700",
  };
  const remove = (id: string) => onChange(impacts.filter((i) => i.id !== id));

  const KIND_LABELS: Record<ImpactKind, string> = {
    opex: "OPEX",
    capex: "CAPEX",
    gain: t("impactsEditor.gain", "Gain"),
    fte: t("impactsEditor.fte", "ETP"),
  };

  return (
    <div className="flex flex-col gap-3">
      {impacts.length === 0 && (
        <div className="rounded-sm border border-dashed border-border px-3 py-4 text-center text-[11px] text-tertiary">
          {t("impactsEditor.empty", "Aucun impact renseigné.")}
        </div>
      )}
      {impacts.map((imp) => {
        const kind = impactKindOf(imp);
        const natures = getImpactNatures(
          company,
          kind === "gain" || (kind === "fte" && imp.fteDirection === "departure")
            ? "saving"
            : "cost"
        );
        const open = openId === imp.id;
        const start =
          kind === "gain" || (kind === "fte" && imp.fteDirection === "departure")
            ? imp.gainDate
            : (imp.capexStartDate ?? imp.capexDeploymentDate);
        const recurring = isRecurringImpact(imp);
        const isNegative = !(
          kind === "gain" ||
          (kind === "fte" && imp.fteDirection === "departure")
        );
        const status = impactStatusOf(imp);
        const futureWarn = status !== "planned" && !!start && new Date(start) > new Date();
        return (
          <div key={imp.id} className="rounded-md border border-border bg-white">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : imp.id)}
              aria-expanded={open}
              className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2 text-left hover:bg-neutral-50 md:grid-cols-[1fr_110px_120px_100px_90px_70px]"
            >
              <span className="truncate text-xs font-semibold text-primary">
                {imp.label || t("impactsEditor.untitled", "Impact sans libellé")}
              </span>
              <span className="text-[11px] text-secondary">
                {KIND_LABELS[kind]} ·{" "}
                {recurring
                  ? t("impactsEditor.recurring", "Récurrent")
                  : t("impactsEditor.oneOff", "One-off")}
              </span>
              <span
                className={`text-right text-xs font-semibold tabular-nums ${isNegative ? "text-bp-coral" : "text-emerald-700"}`}
              >
                {isNegative ? "−" : "+"}
                {fmt(imp.amount)}
                {recurring ? t("impactsEditor.perYear", " /an") : ""}
              </span>
              <span className="text-[11px] text-secondary">
                {start ? start : t("impactsEditor.noDate", "Date à définir")}
              </span>
              <span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status]}`}
                >
                  {STATUS_LABELS[status]}
                </span>
              </span>
              <span className="text-right text-[11px] font-semibold text-bp-coral">
                {open
                  ? t("impactsEditor.close", "Fermer")
                  : editable
                    ? t("impactsEditor.edit", "Modifier")
                    : t("impactsEditor.view", "Détail")}
              </span>
            </button>
            {open && (
              <div className="border-t border-border p-2.5">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label>
                    <span className={labelClass}>{t("impactsEditor.kind", "Type")}</span>
                    <select
                      className={inputClass}
                      disabled={!editable}
                      value={kind}
                      onChange={(e) =>
                        update(imp.id, impactKindPatch(e.target.value as ImpactKind))
                      }
                    >
                      {(Object.keys(KIND_LABELS) as ImpactKind[]).map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className={labelClass}>{t("impactsEditor.status", "Statut")}</span>
                    <select
                      className={inputClass}
                      disabled={!editable}
                      value={status}
                      onChange={(e) => update(imp.id, { status: e.target.value as ImpactStatus })}
                    >
                      {allowedImpactStatuses(imp).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    {futureWarn && (
                      <span className="mt-0.5 block text-[10px] text-bp-coral">
                        {t(
                          "impactsEditor.statusFutureWarn",
                          "Impact réalisé / en cours : la date de début est dans le futur."
                        )}
                      </span>
                    )}
                  </label>
                  <label className="md:col-span-2">
                    <span className={labelClass}>{t("impactsEditor.label", "Libellé")}</span>
                    <input
                      className={inputClass}
                      disabled={!editable}
                      value={imp.label}
                      onChange={(e) => update(imp.id, { label: e.target.value })}
                    />
                  </label>
                  <label>
                    <span className={labelClass}>
                      {kind === "fte"
                        ? t("impactsEditor.loadedSalary", "Salaire chargé total (€M)")
                        : t("impactsEditor.amount", "Montant (€M)")}
                    </span>
                    <input
                      className={`${inputClass} text-right`}
                      type="number"
                      step="0.01"
                      min={0}
                      disabled={!editable}
                      value={imp.amount || ""}
                      onChange={(e) => update(imp.id, { amount: parseFloat(e.target.value) || 0 })}
                    />
                  </label>

                  {kind === "opex" && (
                    <label>
                      <span className={labelClass}>{t("impactsEditor.mode", "Mode")}</span>
                      <select
                        className={inputClass}
                        disabled={!editable}
                        value={imp.nature === "oneoff" ? "oneoff" : "opex_rec"}
                        onChange={(e) =>
                          update(imp.id, { nature: e.target.value as LeverImpact["nature"] })
                        }
                      >
                        <option value="oneoff">{t("impactsEditor.oneOff", "One-off")}</option>
                        <option value="opex_rec">
                          {t("impactsEditor.recurring", "Récurrent")}
                        </option>
                      </select>
                    </label>
                  )}
                  {kind === "capex" && (
                    <>
                      <label>
                        <span className={labelClass}>{t("impactsEditor.mode", "Mode")}</span>
                        <select
                          className={inputClass}
                          disabled={!editable}
                          value={imp.capexAllocationMode ?? "one_shot"}
                          onChange={(e) =>
                            update(imp.id, {
                              capexAllocationMode: e.target.value as "one_shot" | "smoothed",
                              capexStartDate:
                                e.target.value === "smoothed" ? imp.capexStartDate : undefined,
                            })
                          }
                        >
                          <option value="one_shot">{t("impactsEditor.oneOff", "One-off")}</option>
                          <option value="smoothed">{t("impactsEditor.smoothed", "Lissé")}</option>
                        </select>
                      </label>
                      {imp.capexAllocationMode === "smoothed" && (
                        <label>
                          <span className={labelClass}>
                            {t("impactsEditor.capexStart", "Début de période")}
                          </span>
                          <input
                            className={inputClass}
                            type="date"
                            disabled={!editable}
                            value={imp.capexStartDate ?? ""}
                            onChange={(e) =>
                              update(imp.id, { capexStartDate: e.target.value || undefined })
                            }
                          />
                        </label>
                      )}
                      <label>
                        <span className={labelClass}>
                          {imp.capexAllocationMode === "smoothed"
                            ? t("impactsEditor.capexEnd", "Fin de période")
                            : t("impactsEditor.capexDeployment", "Date d'engagement")}
                        </span>
                        <input
                          className={inputClass}
                          type="date"
                          disabled={!editable}
                          value={imp.capexDeploymentDate ?? ""}
                          onChange={(e) =>
                            update(imp.id, { capexDeploymentDate: e.target.value || undefined })
                          }
                        />
                      </label>
                    </>
                  )}
                  {kind === "gain" && (
                    <>
                      <label>
                        <span className={labelClass}>{t("impactsEditor.mode", "Mode")}</span>
                        <select
                          className={inputClass}
                          disabled={!editable}
                          value={imp.gainRecurrence ?? "annual"}
                          onChange={(e) =>
                            update(imp.id, {
                              gainRecurrence: e.target.value as "annual" | "oneoff",
                            })
                          }
                        >
                          <option value="annual">{t("impactsEditor.annual", "Annuel")}</option>
                          <option value="oneoff">{t("impactsEditor.oneOff", "One-off")}</option>
                        </select>
                      </label>
                      <label>
                        <span className={labelClass}>
                          {t("impactsEditor.gainDate", "Date du gain")}
                        </span>
                        <input
                          className={inputClass}
                          type="date"
                          disabled={!editable}
                          value={imp.gainDate ?? ""}
                          onChange={(e) =>
                            update(imp.id, { gainDate: e.target.value || undefined })
                          }
                        />
                      </label>
                    </>
                  )}
                  {kind === "fte" && (
                    <>
                      <label>
                        <span className={labelClass}>{t("impactsEditor.direction", "Sens")}</span>
                        <select
                          className={inputClass}
                          disabled={!editable}
                          value={imp.fteDirection ?? "hire"}
                          onChange={(e) =>
                            update(imp.id, { fteDirection: e.target.value as "hire" | "departure" })
                          }
                        >
                          <option value="hire">{t("impactsEditor.hire", "Recrutement (+)")}</option>
                          <option value="departure">
                            {t("impactsEditor.departure", "Départ (−)")}
                          </option>
                        </select>
                      </label>
                      <label>
                        <span className={labelClass}>
                          {t("impactsEditor.fteCount", "Nombre d'ETP")}
                        </span>
                        <input
                          className={`${inputClass} text-right`}
                          type="number"
                          step="0.1"
                          min={0}
                          disabled={!editable}
                          value={imp.fteCount ?? ""}
                          onChange={(e) =>
                            update(imp.id, {
                              fteCount: e.target.value ? parseFloat(e.target.value) : undefined,
                            })
                          }
                        />
                      </label>
                    </>
                  )}

                  <label>
                    <span className={labelClass}>{t("impactsEditor.nature", "Nature")}</span>
                    <select
                      className={inputClass}
                      disabled={!editable}
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
                  </label>
                  <label>
                    <span className={labelClass}>
                      {t("impactsEditor.technology", "Technologie impactée")}
                    </span>
                    <input
                      className={inputClass}
                      disabled={!editable}
                      value={imp.technology ?? ""}
                      onChange={(e) => update(imp.id, { technology: e.target.value || undefined })}
                    />
                  </label>
                  <div>
                    <span className={labelClass}>
                      {finLevel?.label ?? t("leverForm.costCenter", "Centre de coût")}
                    </span>
                    {editable && companyId ? (
                      <HierarchyLeafSelect
                        companyId={companyId}
                        value={imp.hierarchyLeafId}
                        onChange={(v) => update(imp.id, { hierarchyLeafId: v })}
                        className={inputClass}
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
                  </div>
                  {geoLevel && companyId && (
                    <div>
                      <span className={labelClass}>{geoLevel.label}</span>
                      <GeographyLeafSelect
                        companyId={companyId}
                        levelKey={geoLevel.key}
                        value={imp.geographyLeafId}
                        disabled={!editable}
                        onChange={(v) => update(imp.id, { geographyLeafId: v })}
                      />
                    </div>
                  )}
                </div>
                {editable && (
                  <div className="mt-2 text-right">
                    <button
                      type="button"
                      onClick={() => remove(imp.id)}
                      className="text-[11px] font-semibold text-tertiary hover:text-bp-coral"
                    >
                      {t("common.delete", "Supprimer")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {editable && (
        <div>
          <button
            type="button"
            onClick={() => {
              const n = emptyImpact();
              onChange([...impacts, n]);
              setOpenId(n.id);
            }}
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
