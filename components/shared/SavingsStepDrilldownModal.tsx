"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Modal } from "@/components/shared/Modal";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  buildDrilldownEntries,
  drilldownTotals,
  groupEntries,
  type DrilldownDimension,
  type DrilldownGroup,
  type DrilldownStepKey,
  type OpexSegment,
} from "@/lib/savingsDrilldown";
import type { HierarchyLevelDef, HierarchyNode, Lever, Workstream } from "@/types";

const GREEN = "#2E9E6B";
const RED = "#D64545";
const fmt = (v: number) => `€${Math.round(v * 10) / 10}M`;
const signed = (v: number) => (v === 0 ? fmt(0) : `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))}`);

function Signed({ v }: { v: number }) {
  return (
    <span className="font-semibold" style={{ color: v === 0 ? undefined : v > 0 ? GREEN : RED }}>
      {signed(v)}
    </span>
  );
}

function SegmentBar({
  segments,
  colorOf,
}: {
  segments: OpexSegment[];
  colorOf: (key: string) => string;
}) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;
  return (
    <div className="flex h-2 w-24 overflow-hidden rounded-full bg-neutral-100">
      {segments.map((s) => (
        <span
          key={s.key}
          title={`${s.label} : ${fmt(s.value)}`}
          style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, background: colorOf(s.key) }}
        />
      ))}
    </div>
  );
}

/** Pop-up de détail d'une étape de la cascade des économies : composition de l'étape regroupée par
 *  chantier ou par niveau de l'arborescence géographique (configurable). Logique dans
 *  `lib/savingsDrilldown.ts`. */
export function SavingsStepDrilldownModal({
  step,
  stepLabel,
  onClose,
  levers,
  workstreams,
  geographyLevels,
  geographyNodes,
  natureLabels,
  opexColors,
}: {
  step: DrilldownStepKey;
  stepLabel: string;
  onClose: () => void;
  levers: Lever[];
  workstreams: Pick<Workstream, "id" | "name">[];
  geographyLevels: HierarchyLevelDef[];
  geographyNodes: HierarchyNode[];
  natureLabels: Map<string, string>;
  opexColors: string[];
}) {
  const { t } = useTranslation();
  const sortedLevels = useMemo(
    () => [...geographyLevels].sort((a, b) => a.order - b.order),
    [geographyLevels]
  );
  const hasTree = sortedLevels.length > 0 && geographyNodes.length > 0;
  const isOpex = step === "opexRec";
  const [dimension, setDimension] = useState<DrilldownDimension>("workstream");
  const [levelKey, setLevelKey] = useState<string>(sortedLevels[0]?.key ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const entries = useMemo(
    () =>
      buildDrilldownEntries(step, levers, {
        natureLabel: (id) =>
          (id && natureLabels.get(id)) ||
          t("chart.waterfall.opex.unspecified", "Nature non précisée"),
        labels: {
          fte: t("chart.waterfall.opex.fte", "Recrutements (ETP)"),
          other: t("chart.waterfall.opex.other", "Non détaillé"),
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [step, levers, natureLabels]
  );
  const groups = useMemo(
    () =>
      groupEntries(entries, dimension, {
        workstreams,
        geographyLevels: sortedLevels,
        geographyNodes,
        geographyLevelKey: levelKey,
        unattributedLabel: t("chart.waterfall.drill.unattributed", "Non attribué"),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, dimension, workstreams, sortedLevels, geographyNodes, levelKey]
  );
  const totals = drilldownTotals(groups);
  const segTotals = groups.length > 0 && isOpex ? groupSegments(groups) : [];
  const colorOf = (key: string) => {
    const i = segTotals.findIndex((x) => x.key === key);
    return opexColors[(i < 0 ? 0 : i) % opexColors.length];
  };
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const showBeforeAfter = step === "reforecast";
  const showRealized = step === "target";
  const dimLabel =
    dimension === "workstream"
      ? t("chart.waterfall.drill.workstream", "Chantier")
      : (sortedLevels.find((l) => l.key === levelKey)?.label ??
        t("chart.waterfall.drill.geography", "Géographie"));

  const intro: Record<DrilldownStepKey, string> = {
    gross: t(
      "chart.waterfall.drill.intro.gross",
      "Gain brut annualisé des leviers actifs = net + OPEX récurrent."
    ),
    initial: t(
      "chart.waterfall.drill.intro.initial",
      "Plan figé annualisé de tous les leviers (y compris annulés)."
    ),
    reforecast: t(
      "chart.waterfall.drill.intro.reforecast",
      "Uniquement les chantiers réactualisés : gain annualisé avant (plan initial) et après réactualisation."
    ),
    cancelled: t(
      "chart.waterfall.drill.intro.cancelled",
      "Plan initial annualisé des leviers annulés, retirés de la cible."
    ),
    target: t(
      "chart.waterfall.drill.intro.target",
      "Net réactualisé (brut − OPEX récurrent) = réalisé + reste à faire (mêmes chiffres que « Réalisation des économies »)."
    ),
    opexRec: t(
      "chart.waterfall.drill.intro.opexRec",
      "OPEX récurrent annuel des leviers actifs, par nature d'impact, déduit du brut pour obtenir le net."
    ),
  };

  const renderRow = (g: DrilldownGroup) => {
    const open = expanded.has(g.id);
    return (
      <>
        <tr
          key={g.id}
          className="cursor-pointer border-t border-border hover:bg-neutral-50"
          onClick={() => toggle(g.id)}
        >
          <td className="py-2 pr-2">
            <span className="inline-flex items-center gap-1 font-medium text-primary">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {g.label}
              <span className="text-[11px] font-normal text-tertiary">({g.entries.length})</span>
            </span>
          </td>
          {showBeforeAfter && <td className="px-2 text-right tabular-nums">{fmt(g.before)}</td>}
          {showBeforeAfter && <td className="px-2 text-right tabular-nums">{fmt(g.after)}</td>}
          {showRealized && <td className="px-2 text-right tabular-nums">{fmt(g.realized)}</td>}
          {showRealized && <td className="px-2 text-right tabular-nums">{fmt(g.remaining)}</td>}
          {isOpex && (
            <td className="px-2">
              <SegmentBar segments={g.segments} colorOf={colorOf} />
            </td>
          )}
          <td className="pl-2 text-right tabular-nums">
            {step === "gross" || step === "initial" || step === "target" ? (
              fmt(g.value)
            ) : (
              <Signed v={g.value} />
            )}
          </td>
        </tr>
        {open &&
          g.entries.map((e) => (
            <tr
              key={`${g.id}-${e.leverId}`}
              className="bg-neutral-50/60 text-[12px] text-secondary"
            >
              <td className="py-1 pl-6 pr-2">
                {e.name}
                {isOpex && e.segments.length > 0 && (
                  <span className="ml-2 text-tertiary">
                    {e.segments.map((s) => `${s.label} ${fmt(s.value)}`).join(" · ")}
                  </span>
                )}
              </td>
              {showBeforeAfter && <td className="px-2 text-right tabular-nums">{fmt(e.before)}</td>}
              {showBeforeAfter && <td className="px-2 text-right tabular-nums">{fmt(e.after)}</td>}
              {showRealized && <td className="px-2 text-right tabular-nums">{fmt(e.realized)}</td>}
              {showRealized && <td className="px-2 text-right tabular-nums">{fmt(e.remaining)}</td>}
              {isOpex && <td />}
              <td className="pl-2 text-right tabular-nums">
                {step === "gross" || step === "initial" || step === "target" ? (
                  fmt(e.value)
                ) : (
                  <Signed v={e.value} />
                )}
              </td>
            </tr>
          ))}
      </>
    );
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={stepLabel} maxWidth="820px">
      <p className="mb-3 text-xs text-secondary">{intro[step]}</p>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
          {(
            [
              ["workstream", t("chart.waterfall.drill.workstream", "Chantier")],
              ["geography", t("chart.waterfall.drill.geography", "Géographie")],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setDimension(k)}
              className={`px-3 py-1.5 ${dimension === k ? "bg-bp-coral text-white" : "bg-white text-secondary hover:bg-neutral-50"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {dimension === "geography" && hasTree && (
          <label className="inline-flex items-center gap-2 text-xs text-secondary">
            {t("chart.waterfall.drill.level", "Niveau")}
            <select
              value={levelKey}
              onChange={(e) => setLevelKey(e.target.value)}
              className="rounded-md border border-border bg-white px-2 py-1.5 text-xs"
            >
              {sortedLevels.map((lv) => (
                <option key={lv.key} value={lv.key}>
                  {lv.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {isOpex && segTotals.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-secondary">
          {segTotals.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: opexColors[i % opexColors.length] }}
              />
              {s.label} : {fmt(s.value)}
            </span>
          ))}
        </div>
      )}
      {groups.length === 0 ? (
        <p className="py-8 text-center text-sm text-tertiary">
          {t("chart.waterfall.drill.empty", "Aucun élément pour cette étape.")}
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-tertiary">
              <th className="pb-2 font-medium">{dimLabel}</th>
              {showBeforeAfter && (
                <th className="px-2 text-right font-medium">
                  {t("chart.waterfall.drill.before", "Avant (initial)")}
                </th>
              )}
              {showBeforeAfter && (
                <th className="px-2 text-right font-medium">
                  {t("chart.waterfall.drill.after", "Après (réactualisé)")}
                </th>
              )}
              {showRealized && (
                <th className="px-2 text-right font-medium">
                  {t("chart.waterfall.realized", "Réalisé")}
                </th>
              )}
              {showRealized && (
                <th className="px-2 text-right font-medium">
                  {t("chart.waterfall.remaining", "Reste à faire")}
                </th>
              )}
              {isOpex && (
                <th className="px-2 font-medium">{t("chart.waterfall.drill.nature", "Nature")}</th>
              )}
              <th className="pl-2 text-right font-medium">
                {showBeforeAfter
                  ? t("chart.waterfall.drill.delta", "Écart")
                  : t("chart.waterfall.drill.amount", "Montant annualisé")}
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => renderRow(g))}
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2">{t("chart.waterfall.drill.total", "Total")}</td>
              {showBeforeAfter && (
                <td className="px-2 text-right tabular-nums">{fmt(totals.before)}</td>
              )}
              {showBeforeAfter && (
                <td className="px-2 text-right tabular-nums">{fmt(totals.after)}</td>
              )}
              {showRealized && (
                <td className="px-2 text-right tabular-nums">{fmt(totals.realized)}</td>
              )}
              {showRealized && (
                <td className="px-2 text-right tabular-nums">{fmt(totals.remaining)}</td>
              )}
              {isOpex && <td />}
              <td className="pl-2 text-right tabular-nums">
                {step === "gross" || step === "initial" || step === "target" ? (
                  fmt(totals.value)
                ) : (
                  <Signed v={totals.value} />
                )}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function groupSegments(groups: DrilldownGroup[]): OpexSegment[] {
  const acc = new Map<string, OpexSegment>();
  for (const g of groups)
    for (const s of g.segments) {
      const k = s.label.trim().toLowerCase();
      const cur = acc.get(k);
      if (cur) cur.value += s.value;
      else acc.set(k, { ...s, key: k });
    }
  return Array.from(acc.values()).sort((a, b) => b.value - a.value);
}
