"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { resolveIndicatorStatus } from "@/lib/axisLogic";
import { readKpi, type LinkedKpi } from "@/lib/chantierKpis";
import type { Chantier, Indicator, IndicatorMeasurement } from "@/types";

/** Une entrée de `Chantier.successKpis` — voir `types/index.ts`. */
type SuccessKpi = NonNullable<Chantier["successKpis"]>[number];

/** Id généré côté client pour un nouveau KPI de succès — même idiome que `makeDeliverableId`/
 *  `makePrerequisiteId` (app/(app)/levers/chantier/ChantierDetailClient.tsx) : jamais affiché,
 *  seulement une clé de liste stable. Le compteur de module évite la collision de deux créations
 *  dans la même milliseconde. */
let idSeq = 0;
function makeSuccessKpiId(): string {
  idSeq += 1;
  return `kpi-${Date.now()}-${idSeq}`;
}

/**
 * Critères de succès mesurables du chantier (round 5, point 3) — liste cochable en complément du
 * texte libre existant `Chantier.successCriteria` (INCHANGÉ, monté séparément). Même logique
 * d'auto-sauvegarde que le reste de la fiche chantier : chaque interaction reconstruit le tableau
 * complet et le remonte via `onChange`, à charge du parent de persister
 * (`updateChantierField({ successKpis: next })`).
 */
export function SuccessKpiList({
  value,
  onChange,
  indicators = [],
  measurements = [],
  indicatorNumbers,
  linkedKpis = [],
  onOpenIndicator,
  readOnly = false,
}: {
  value: SuccessKpi[];
  onChange: (next: SuccessKpi[]) => void;
  /** KPI proposables comme critère de succès. */
  indicators?: Indicator[];
  measurements?: IndicatorMeasurement[];
  indicatorNumbers?: Map<string, number>;
  /** KPI des projets/leviers du chantier, DÉJÀ dédupliqués et hors critères de succès. */
  linkedKpis?: LinkedKpi[];
  /** Même navigation que depuis un levier (`/kpi?indicator=<id>`). */
  onOpenIndicator?: (indicatorId: string) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [draftIndicator, setDraftIndicator] = useState("");
  const [draftTarget, setDraftTarget] = useState("");
  const byId = new Map(indicators.map((i) => [i.id, i]));

  const kpiLink = (indicator: Indicator) => (
    <button
      type="button"
      onClick={() => onOpenIndicator?.(indicator.id)}
      className="text-left text-[12.5px] font-medium text-bp-coral hover:underline"
    >
      {t("strategicChantierDetail.indicatorLink.label", "KPI n°{n} · {name}")
        .replace("{n}", String(indicatorNumbers?.get(indicator.id) ?? "?"))
        .replace("{name}", indicator.name)}
    </button>
  );

  const reading = (indicator: Indicator, target?: number) => {
    const r = readKpi(indicator, measurements, target);
    const unit = indicator.unit ? ` ${indicator.unit}` : "";
    const fmt = (v?: number) => (v === undefined ? "—" : `${v}${unit}`);
    return (
      <span className="text-[11.5px] text-secondary">
        {t("strategicChantierDetail.successKpis.current", "Actuel")} : {fmt(r.current)} ·{" "}
        {t("strategicChantierDetail.successKpis.target", "Cible")} : {fmt(r.target)}
        {r.progressPct !== undefined ? ` · ${r.approximate ? "≈" : ""}${r.progressPct} %` : ""}
        {" · "}
        <span
          className={
            resolveIndicatorStatus(indicator) === "at_risk" ? "text-rag-red" : "text-rag-green"
          }
        >
          ●
        </span>
      </span>
    );
  };

  const toggle = (id: string) =>
    onChange(value.map((kpi) => (kpi.id === id ? { ...kpi, achieved: !kpi.achieved } : kpi)));

  const remove = (id: string) => onChange(value.filter((kpi) => kpi.id !== id));

  const add = () => {
    const label = draft.trim();
    if (!label) return;
    const target = draftTarget.trim() === "" ? NaN : Number(draftTarget);
    onChange([
      ...value,
      {
        id: makeSuccessKpiId(),
        label,
        ...(draftIndicator ? { indicatorId: draftIndicator } : {}),
        ...(Number.isFinite(target) ? { targetValue: target } : {}),
      },
    ]);
    setDraft("");
    setDraftIndicator("");
    setDraftTarget("");
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
        {t("strategicChantierDetail.successKpis.title")}
      </div>

      <p className="mb-2 text-[11.5px] text-tertiary">
        {t(
          "strategicChantierDetail.successKpis.hint",
          "Un critère de succès = un KPI + la valeur cible que le chantier vise."
        )}
      </p>
      {value.length === 0 ? (
        <p className="text-[12px] text-tertiary">
          {t("strategicChantierDetail.successKpis.empty")}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {value.map((kpi) => (
            <li key={kpi.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={kpi.achieved ?? false}
                onChange={() => toggle(kpi.id)}
              />
              <div className="flex flex-1 flex-col">
                <span
                  className={`text-[12.5px] ${
                    kpi.achieved ? "text-tertiary line-through" : "text-primary"
                  }`}
                >
                  {kpi.label}
                </span>
                {kpi.indicatorId && byId.get(kpi.indicatorId) ? (
                  <>
                    {kpiLink(byId.get(kpi.indicatorId)!)}
                    {reading(byId.get(kpi.indicatorId)!, kpi.targetValue)}
                  </>
                ) : kpi.targetValue !== undefined ? (
                  <span className="text-[11.5px] text-secondary">
                    {t("strategicChantierDetail.successKpis.target", "Cible")} : {kpi.targetValue}
                  </span>
                ) : null}
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => remove(kpi.id)}
                  className="shrink-0 text-tertiary hover:text-rag-red"
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="mt-2 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={t("strategicChantierDetail.successKpis.placeholder")}
            className="flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-[12.5px] text-primary outline-none focus:border-bp-coral"
          />
          <select
            value={draftIndicator}
            onChange={(e) => setDraftIndicator(e.target.value)}
            className="max-w-[180px] rounded-md border border-border bg-white px-2 py-1.5 text-[12.5px] text-primary"
          >
            <option value="">{t("strategicChantierDetail.successKpis.noKpi", "Sans KPI")}</option>
            {indicators.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={draftTarget}
            onChange={(e) => setDraftTarget(e.target.value)}
            placeholder={t("strategicChantierDetail.successKpis.target", "Cible")}
            className="w-24 rounded-md border border-border bg-white px-2 py-1.5 text-[12.5px] text-primary"
          />
          <Button variant="outline" size="sm" onClick={add}>
            <Plus size={12} /> {t("strategicChantierDetail.successKpis.addLabel")}
          </Button>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
          {t("strategicChantierDetail.successKpis.linkedTitle", "KPI associés aux projets")}
        </div>
        <p className="mb-2 text-[11.5px] text-tertiary">
          {t(
            "strategicChantierDetail.successKpis.linkedHint",
            "Indicateurs de mesure rattachés aux projets de ce chantier (hors critères de succès)."
          )}
        </p>
        {linkedKpis.length === 0 ? (
          <p className="text-[12px] text-tertiary">
            {t(
              "strategicChantierDetail.successKpis.linkedEmpty",
              "Aucun autre KPI rattaché aux projets."
            )}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {linkedKpis.map(({ indicator, projetNames }) => (
              <li key={indicator.id} className="flex flex-col">
                {kpiLink(indicator)}
                {reading(indicator)}
                <span className="text-[11px] text-tertiary">
                  {t("strategicChantierDetail.successKpis.projects", "Projets")} :{" "}
                  {projetNames.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
