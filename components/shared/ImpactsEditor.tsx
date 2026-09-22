"use client";

import { useEffect, useState } from "react";
import { MessageSquare } from "lucide-react";
import { HierarchyLeafSelect } from "@/components/shared/HierarchyLeafSelect";
import { Popover } from "@/components/shared/Popover";
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
import {
  canDecideImpactRealized,
  coerceImpactStatus,
  decideImpactRealized,
  impactStatusOf,
  isImpactRealizedPending,
  realizedTogglePatch,
} from "@/lib/impactStatus";
import { effectiveLeafLevel, leafLevels } from "@/lib/hierarchyLogic";
import { useRole } from "@/lib/hooks/useRole";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Comment, Company, HierarchyNode, LeverImpact } from "@/types";

const inputClass =
  "w-full min-w-0 truncate rounded-sm border border-transparent bg-transparent px-1 py-1 text-[12px] hover:border-border focus:border-bp-coral focus:bg-white focus:outline-none disabled:cursor-default disabled:hover:border-transparent disabled:text-primary";
const invalidClass = "!border-bp-coral bg-bp-coral/5";
const thClass =
  "whitespace-nowrap px-1 py-1.5 text-left text-[9.5px] font-semibold uppercase tracking-wide text-tertiary";

const TYPE_STYLE: Record<ImpactTypeKey, string> = {
  fte: "bg-violet-100 text-violet-700",
  opex_rec: "bg-amber-100 text-amber-800",
  opex_oneoff: "bg-orange-100 text-orange-800",
  capex: "bg-sky-100 text-sky-800",
  gain_rec: "bg-emerald-100 text-emerald-800",
  gain_oneoff: "bg-teal-100 text-teal-800",
};

/** Sélecteur segmenté compact (2 choix) intégré à la ligne. */
function Segmented({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: { value: string; label: string; title: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex shrink-0 overflow-hidden rounded-sm border border-border text-[10px] font-semibold">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          title={o.title}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`px-1.5 py-0.5 ${value === o.value ? "bg-bp-coral text-white" : "bg-white text-tertiary hover:bg-neutral-100"}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

function newId(): string {
  return "IMP" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

function emptyFinancialImpact(): LeverImpact {
  return { id: newId(), label: "", amount: 0, ...impactKindPatch("opex") } as LeverImpact;
}

function emptyFteImpact(): LeverImpact {
  return { id: newId(), label: "", amount: 0, ...impactKindPatch("fte") } as LeverImpact;
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

function formatCommentTs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Bouton commentaire compact (icône + compteur) ouvrant un popover liste + ajout. */
function CommentsCell({
  comments,
  onAdd,
  canComment,
}: {
  comments: Comment[];
  onAdd: (text: string) => void;
  canComment: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const count = comments.length;
  return (
    <Popover
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          title={t("impactsEditor.comments", "Commentaires")}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10.5px] font-semibold ${
            count > 0
              ? "border-bp-coral/30 bg-bp-coral/10 text-bp-coral"
              : "border-border bg-white text-tertiary hover:bg-neutral-100"
          }`}
        >
          <MessageSquare size={11} />
          {count > 0 && count}
        </button>
      )}
      panelClassName="w-72"
    >
      <div className="flex flex-col gap-2">
        {comments.length === 0 ? (
          <p className="text-[11px] text-tertiary">
            {t("impactsEditor.noComments", "Aucun commentaire.")}
          </p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
            {[...comments]
              .sort((a, b) => (a.ts < b.ts ? 1 : -1))
              .map((c, i) => (
                <li key={i} className="rounded-sm bg-neutral-50 px-2 py-1 text-[11px]">
                  <div className="mb-0.5 flex items-center justify-between gap-2 text-[10px] text-tertiary">
                    <span className="font-semibold text-secondary">{c.user}</span>
                    <span>{formatCommentTs(c.ts)}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-primary">{c.text}</p>
                </li>
              ))}
          </ul>
        )}
        {canComment && (
          <div className="flex flex-col gap-1 border-t border-border pt-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t("impactsEditor.addComment", "Ajouter un commentaire…")}
              rows={2}
              className="w-full resize-none rounded-sm border border-border px-1.5 py-1 text-[11px] focus:border-bp-coral focus:outline-none"
            />
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => {
                if (!draft.trim()) return;
                onAdd(draft.trim());
                setDraft("");
              }}
              className="self-end rounded-sm bg-bp-coral px-2 py-0.5 text-[10.5px] font-semibold text-white disabled:opacity-40"
            >
              {t("common.add", "Ajouter")}
            </button>
          </div>
        )}
      </div>
    </Popover>
  );
}

/** Éditeur d'impacts d'un levier (OPEX, CAPEX, gains, ETP) — tableau inline, une ligne par
 *  impact, illimité. `scope` sépare la vue en 2 tableaux distincts (financier hors ETP / ETP) :
 *  l'appelant place chaque instance dans son bloc dédié (Impact financier / Impact RH). */
export function ImpactsEditor({
  impacts,
  onChange,
  company,
  canEdit = true,
  readOnly = false,
  scope,
}: {
  impacts: LeverImpact[];
  onChange: (next: LeverImpact[]) => void;
  company?: Company | null;
  canEdit?: boolean;
  readOnly?: boolean;
  /** "financial" = tout sauf ETP ; "fte" = uniquement les lignes ETP. */
  scope: "financial" | "fte";
}) {
  const { t } = useTranslation();
  const { user } = useRole();
  const editable = canEdit && !readOnly;
  const canDecide = canDecideImpactRealized(user);
  const companyId = company?.id;
  const geoLevel = effectiveLeafLevel(company?.geographyHierarchyLevels ?? []);
  const showGeo = !!(geoLevel && companyId);
  const isFteScope = scope === "fte";
  const rows = impacts.filter((imp) => (impactTypeOf(imp) === "fte") === isFteScope);
  const colCount = (isFteScope ? 6 : 8) + (showGeo ? 1 : 0) + (editable ? 1 : 0);
  const futureMsg = t(
    "impactsEditor.statusFutureWarn",
    "Impact réalisé : la date de début est dans le futur."
  );

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
  const addComment = (imp: LeverImpact, text: string) => {
    const comment: Comment = { user: user?.name ?? "?", ts: new Date().toISOString(), text };
    update(imp.id, { comments: [...(imp.comments ?? []), comment] });
  };

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
  const na = (
    <span className="block px-1 text-tertiary/50" aria-hidden>
      —
    </span>
  );
  const star = <span className="text-bp-coral">*</span>;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto rounded-md border border-border bg-white">
        <table
          className={`w-full ${isFteScope ? "min-w-[860px]" : "min-w-[1180px]"} table-fixed border-collapse text-[12px]`}
        >
          <thead className="sticky top-0 z-10 border-b border-border bg-neutral-50">
            <tr>
              <th className={thClass} style={{ width: isFteScope ? 96 : 150 }}>
                {t("impactsEditor.impactType", "Type d'impact")}
              </th>
              <th className={thClass} style={{ minWidth: 200 }}>
                {t("impactsEditor.label", "Libellé")}
              </th>
              <th className={`${thClass} text-right`} style={{ width: 78 }}>
                {isFteScope ? "ETP" : t("impactsEditor.amountShort", "€M")}
              </th>
              {!isFteScope && (
                <>
                  <th className={thClass} style={{ width: 104 }}>
                    {t("impactsEditor.nature", "Nature")} {star}
                  </th>
                  <th className={thClass} style={{ width: 112 }}>
                    {t("impactsEditor.destination", "Destination")} {star}
                  </th>
                </>
              )}
              {showGeo && (
                <th className={thClass} style={{ width: 96 }}>
                  {geoLevel?.label ?? t("impactsEditor.geography", "Géographie")}
                </th>
              )}
              {!isFteScope && (
                <th className={thClass} style={{ width: 84 }}>
                  {t("impactsEditor.technologyShort", "Techno.")}
                </th>
              )}
              <th className={thClass} style={{ width: 108 }}>
                {t("impactsEditor.startDate", "Début")}
              </th>
              <th className={thClass} style={{ width: 108 }}>
                {t("impactsEditor.endDate", "Fin")}
              </th>
              <th className={thClass} style={{ width: 44 }}>
                {t("impactsEditor.comments", "Commentaires")}
              </th>
              <th className={thClass} style={{ width: 140 }}>
                {t("impactsEditor.status", "Statut")}
              </th>
              {editable && <th className={thClass} style={{ width: 26 }} />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-3 py-5 text-center text-[11px] text-tertiary">
                  {t("impactsEditor.empty", "Aucun impact renseigné.")}
                </td>
              </tr>
            )}
            {rows.map((imp) => {
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
              const pending = isImpactRealizedPending(imp);
              const rejected =
                imp.realizedApproval?.status === "rejected" && uiStatus === "planned";
              return (
                <tr
                  key={imp.id}
                  className="group border-b border-border align-middle transition-colors last:border-b-0 even:bg-neutral-50/70 focus-within:bg-bp-coral/5 hover:bg-bp-coral/5"
                >
                  <td className="px-1 py-1">
                    <div className="flex items-center gap-1">
                      {isFte ? (
                        <span
                          className={`inline-flex shrink-0 items-center truncate rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_STYLE.fte}`}
                        >
                          {TYPE_LABELS.fte}
                        </span>
                      ) : (
                        <select
                          className={`min-w-0 flex-1 cursor-pointer truncate rounded-full border-0 px-1.5 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-1 focus:ring-bp-coral disabled:cursor-default ${TYPE_STYLE[key]}`}
                          disabled={!editable}
                          aria-label={t("impactsEditor.impactType", "Type d'impact")}
                          value={key}
                          onChange={(e) =>
                            update(imp.id, impactTypePatch(imp, e.target.value as ImpactTypeKey))
                          }
                        >
                          {FIN_TYPES.map((k) => (
                            <option key={k} value={k}>
                              {TYPE_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      )}
                      {isCapex && (
                        <Segmented
                          disabled={!editable}
                          value={imp.capexAllocationMode ?? "one_shot"}
                          options={[
                            {
                              value: "one_shot",
                              label: "1×",
                              title: t("impactsEditor.oneOff", "One-off"),
                            },
                            {
                              value: "smoothed",
                              label: "~",
                              title: t("impactsEditor.smoothed", "Lissé"),
                            },
                          ]}
                          onChange={(v) => {
                            const mode = v as "one_shot" | "smoothed";
                            const { start } = impactDatesOf(imp);
                            const next = { ...imp, capexAllocationMode: mode } as LeverImpact;
                            update(imp.id, {
                              capexAllocationMode: mode,
                              capexStartDate: undefined,
                              capexDeploymentDate: undefined,
                              ...impactDatesPatch(next, { start: start ?? null }),
                            });
                          }}
                        />
                      )}
                      {isFte && (
                        <Segmented
                          disabled={!editable}
                          value={imp.fteDirection ?? "hire"}
                          options={[
                            {
                              value: "hire",
                              label: "+",
                              title: t("impactsEditor.hire", "Recrutement (+)"),
                            },
                            {
                              value: "departure",
                              label: "−",
                              title: t("impactsEditor.departure", "Départ (−)"),
                            },
                          ]}
                          onChange={(v) => {
                            const dir = v as "hire" | "departure";
                            const { start } = impactDatesOf(imp);
                            const next = { ...imp, fteDirection: dir } as LeverImpact;
                            update(imp.id, {
                              fteDirection: dir,
                              gainDate: undefined,
                              capexDeploymentDate: undefined,
                              ...impactDatesPatch(next, { start: start ?? null }),
                            });
                          }}
                        />
                      )}
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      className={inputClass}
                      disabled={!editable}
                      value={imp.label}
                      title={imp.label}
                      placeholder={t("impactsEditor.untitled", "Impact sans libellé")}
                      onChange={(e) => update(imp.id, { label: e.target.value })}
                    />
                  </td>
                  <td className="px-1 py-1">
                    {isFte ? (
                      <input
                        className={`${inputClass} text-right tabular-nums`}
                        type="number"
                        step="0.1"
                        min={0}
                        placeholder="0"
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
                        className={`${inputClass} text-right tabular-nums`}
                        type="number"
                        step="0.01"
                        min={0}
                        placeholder="0"
                        disabled={!editable}
                        aria-label={t("impactsEditor.amount", "Montant (€M)")}
                        value={imp.amount || ""}
                        onChange={(e) =>
                          update(imp.id, { amount: parseFloat(e.target.value) || 0 })
                        }
                      />
                    )}
                  </td>
                  {!isFteScope && (
                    <>
                      <td className="px-1 py-1">
                        <select
                          className={`${inputClass} ${missing.includes("nature") ? invalidClass : ""}`}
                          disabled={!editable}
                          required
                          aria-invalid={missing.includes("nature")}
                          value={imp.natureId ?? ""}
                          onChange={(e) =>
                            update(imp.id, { natureId: e.target.value || undefined })
                          }
                        >
                          <option value="">{t("impactsEditor.required", "Requis *")}</option>
                          {natures.map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-1 py-1">
                        {editable && companyId ? (
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
                    </>
                  )}
                  {showGeo && (
                    <td className="px-1 py-1">
                      <GeographyLeafSelect
                        companyId={companyId!}
                        levelKeys={leafLevels(company?.geographyHierarchyLevels ?? []).map(
                          (l) => l.key
                        )}
                        value={imp.geographyLeafId}
                        disabled={!editable}
                        onChange={(v) => update(imp.id, { geographyLeafId: v })}
                      />
                    </td>
                  )}
                  {!isFteScope && (
                    <td className="px-1 py-1">
                      <input
                        className={inputClass}
                        disabled={!editable}
                        value={imp.technology ?? ""}
                        title={imp.technology ?? ""}
                        onChange={(e) =>
                          update(imp.id, { technology: e.target.value || undefined })
                        }
                      />
                    </td>
                  )}
                  <td className="px-1 py-1">
                    <input
                      className={`${inputClass} text-[11px]`}
                      type="date"
                      disabled={!editable}
                      aria-label={t("impactsEditor.startDate", "Début")}
                      value={dates.start ?? ""}
                      onChange={(e) =>
                        update(imp.id, impactDatesPatch(imp, { start: e.target.value }))
                      }
                    />
                  </td>
                  <td className="px-1 py-1">
                    {showEnd ? (
                      <input
                        className={`${inputClass} text-[11px]`}
                        type="date"
                        disabled={!editable}
                        aria-label={t("impactsEditor.endDate", "Fin")}
                        value={dates.end ?? ""}
                        onChange={(e) =>
                          update(imp.id, impactDatesPatch(imp, { end: e.target.value }))
                        }
                      />
                    ) : (
                      na
                    )}
                  </td>
                  <td className="px-1 py-1 text-center">
                    <CommentsCell
                      comments={imp.comments ?? []}
                      canComment={canEdit && !readOnly}
                      onAdd={(text) => addComment(imp, text)}
                    />
                  </td>
                  <td className="px-1 py-1">
                    <div className="flex flex-col items-start gap-0.5">
                      <label
                        className="inline-flex cursor-pointer items-center gap-1.5"
                        title={futureWarn ? futureMsg : undefined}
                      >
                        <input
                          type="checkbox"
                          disabled={!editable}
                          checked={uiStatus === "done"}
                          onChange={(e) =>
                            update(imp.id, realizedTogglePatch(imp, e.target.checked, user))
                          }
                          className="h-3.5 w-3.5 accent-bp-coral"
                        />
                        <span
                          className={`text-[11px] font-semibold ${uiStatus === "done" ? "text-emerald-700" : "text-tertiary"} ${futureWarn ? "underline decoration-bp-coral decoration-dotted" : ""}`}
                        >
                          {t("impactsEditor.statusDone", "Réalisé")}
                        </span>
                      </label>
                      {pending && (
                        <Popover
                          trigger={({ toggle }) => (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggle();
                              }}
                              className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-800"
                            >
                              {t("impactsEditor.pendingFinance", "En attente validation finance")}
                            </button>
                          )}
                        >
                          <div className="flex flex-col gap-1.5 text-[11px]">
                            <p className="text-secondary">
                              {t(
                                "impactsEditor.pendingFinanceDetail",
                                "Demandé par {who} — en attente de validation par un profil Finance."
                              ).replace("{who}", imp.realizedApproval?.requestedBy ?? "?")}
                            </p>
                            {canDecide && (
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    update(imp.id, decideImpactRealized(imp, "approved", user))
                                  }
                                  className="flex-1 rounded-sm bg-emerald-600 px-2 py-1 text-[10.5px] font-semibold text-white"
                                >
                                  {t("impactsEditor.approve", "Valider")}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    update(imp.id, decideImpactRealized(imp, "rejected", user))
                                  }
                                  className="flex-1 rounded-sm bg-rag-red px-2 py-1 text-[10.5px] font-semibold text-white"
                                >
                                  {t("impactsEditor.reject", "Rejeter")}
                                </button>
                              </div>
                            )}
                          </div>
                        </Popover>
                      )}
                      {rejected && (
                        <span className="rounded-full bg-rag-red-light px-1.5 py-0.5 text-[9.5px] font-semibold text-rag-red">
                          {t("impactsEditor.rejectedFinance", "Rejeté par la finance")}
                        </span>
                      )}
                    </div>
                  </td>
                  {editable && (
                    <td className="px-0.5 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => remove(imp.id)}
                        aria-label={t("common.delete", "Supprimer")}
                        title={t("common.delete", "Supprimer")}
                        className="text-[15px] leading-none text-tertiary opacity-0 transition hover:text-bp-coral focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
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
            onClick={() =>
              onChange([...impacts, isFteScope ? emptyFteImpact() : emptyFinancialImpact()])
            }
            className="inline-flex items-center gap-1 rounded-md bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            +{" "}
            {isFteScope
              ? t("impactsEditor.addFte", "Ajouter un impact ETP")
              : t("impactsEditor.addFinancial", "Ajouter un impact financier")}
          </button>
        </div>
      )}
    </div>
  );
}
