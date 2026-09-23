"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Popover } from "@/components/shared/Popover";
import * as engine from "@/lib/engine";
import {
  attachChildren,
  financeTotals,
  sortFinanceRows,
  type FinanceSortKey,
} from "@/lib/dashboardSavings";
import { sortedHierarchyLevels } from "@/lib/financeCosts";
import { impactDatesOf } from "@/lib/impactKinds";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode, Lever } from "@/types";

/** Années couvertes par un levier — dates de ses lignes d'impact (début/fin), ou à défaut la
 *  période du levier lui-même (leviers sans impact chiffré). Approximation volontaire : un levier
 *  qui déborde sur plusieurs années matche chacune d'elles (pas de répartition € par année). */
function yearOf(d?: string): number | undefined {
  if (!d) return undefined;
  const y = new Date(d).getFullYear();
  return Number.isNaN(y) ? undefined : y;
}

function addRange(years: Set<number>, from?: number, to?: number) {
  if (from === undefined && to === undefined) return;
  const lo = from ?? to!;
  const hi = to ?? from!;
  for (let y = Math.min(lo, hi); y <= Math.max(lo, hi); y++) years.add(y);
}

function leverYears(l: Lever): number[] {
  const years = new Set<number>();
  const imps = engine.leverImpactsOf(l);
  if (imps.length === 0) {
    addRange(years, yearOf(l.start), yearOf(l.end));
    return Array.from(years);
  }
  for (const imp of imps) {
    const { start, end } = impactDatesOf(imp);
    addRange(years, yearOf(start), yearOf(end));
  }
  return Array.from(years);
}

/** `labelKey`/`label` = clé i18n + fallback français, résolus au rendu via `t()`. */
const COLUMNS: { key: Exclude<FinanceSortKey, "label">; labelKey: string; label: string }[] = [
  { key: "planned", labelKey: "finance.hierarchyTable.col.planned", label: "Planifié initial" },
  { key: "reforecast", labelKey: "finance.hierarchyTable.col.reforecast", label: "Réactualisé" },
  { key: "cancelled", labelKey: "finance.hierarchyTable.col.cancelled", label: "Annulé" },
  { key: "late", labelKey: "finance.hierarchyTable.col.late", label: "En retard" },
  { key: "realized", labelKey: "finance.hierarchyTable.col.realized", label: "Réalisé" },
];

const fmt = (v: number) => v.toFixed(1);

/** Tableau Finance (€M) par niveau de la hiérarchie financière (P&L, centre de coût…), avec
 *  totaux, tri par colonne, export Excel et dépliage parent → enfants (niveau suivant). Les
 *  leviers annulés n'apparaissent que dans la colonne "Annulé" (exclus du réactualisé/réalisé). */
export function FinanceHierarchyTable({
  data,
  hierarchyLevels,
  hierarchyNodes,
}: {
  data: BeTrackData;
  hierarchyLevels: HierarchyLevelDef[];
  hierarchyNodes: HierarchyNode[];
}) {
  const { t } = useTranslation();
  const levels = useMemo(() => sortedHierarchyLevels(hierarchyLevels), [hierarchyLevels]);
  const [levelKey, setLevelKey] = useState<string>("");
  const [sort, setSort] = useState<{ key: FinanceSortKey; dir: "asc" | "desc" }>({
    key: "planned",
    dir: "desc",
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Filtre années : ensemble vide = toutes les années (case décochée globalement = pas de filtre).
  const allYears = useMemo(() => {
    const years = new Set<number>();
    for (const l of data.levers) leverYears(l).forEach((y) => years.add(y));
    return Array.from(years).sort((a, b) => a - b);
  }, [data.levers]);
  const [selectedYears, setSelectedYears] = useState<Set<number>>(new Set());
  const yearFilterActive = selectedYears.size > 0;
  const toggleYear = (y: number) =>
    setSelectedYears((prev) => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y);
      else next.add(y);
      return next;
    });
  const yearsButtonLabel = useMemo(() => {
    if (!yearFilterActive) return t("finance.hierarchyTable.allYears", "Toutes les années");
    const sorted = Array.from(selectedYears).sort((a, b) => a - b);
    if (sorted.length <= 2) return sorted.join(", ");
    return `${sorted.length} ${t("finance.hierarchyTable.yearsSelected", "années sélectionnées")}`;
  }, [selectedYears, yearFilterActive, t]);

  const levelIdx = Math.max(
    0,
    levels.findIndex((l) => l.key === levelKey)
  );
  const level = levels[levelIdx];
  const childLevel = levels[levelIdx + 1];

  const company = useMemo(() => ({ hierarchyLevels }), [hierarchyLevels]);
  // `financeByHierarchyLevel` restreint aux montants (planifié/réactualisé/réalisé/en retard) des
  // impacts qui couvrent réellement les années sélectionnées — pas un simple filtre de leviers
  // entiers — donc un levier partiellement dans les années choisies n'apparaît qu'au prorata.
  const yearsOpt = yearFilterActive ? selectedYears : undefined;
  const parents = useMemo(
    () =>
      level
        ? engine.financeByHierarchyLevel(data, company, level.order, hierarchyNodes, {
            years: yearsOpt,
          })
        : [],
    [data, company, level, hierarchyNodes, yearsOpt]
  );
  const children = useMemo(
    () =>
      childLevel
        ? engine.financeByHierarchyLevel(data, company, childLevel.order, hierarchyNodes, {
            years: yearsOpt,
          })
        : [],
    [data, company, childLevel, hierarchyNodes, yearsOpt]
  );
  const tree = useMemo(() => {
    const t0 = attachChildren(parents, children, hierarchyNodes);
    return sortFinanceRows(t0, sort.key, sort.dir).map((r) => ({
      ...r,
      children: sortFinanceRows(r.children, sort.key, sort.dir),
    }));
  }, [parents, children, hierarchyNodes, sort]);
  const totals = useMemo(() => financeTotals(parents), [parents]);

  if (levels.length === 0) return null;

  const toggleSort = (key: FinanceSortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }
    );
  const arrow = (key: FinanceSortKey) =>
    sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";

  const exportXlsx = () => {
    const rows: Record<string, string | number>[] = [];
    const toRow = (label: string, values: Record<Exclude<FinanceSortKey, "label">, number>) => {
      const row: Record<string, string | number> = { [level.label]: label };
      for (const c of COLUMNS) row[t(c.labelKey, c.label)] = values[c.key];
      return row;
    };
    for (const r of tree) rows.push(toRow(r.label, r));
    rows.push(toRow(t("finance.hierarchyTable.total", "Total"), totals));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Finance");
    XLSX.writeFile(wb, `finance_${level.key}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const numCell = "px-3 py-2 text-right tabular-nums";

  return (
    <Card className="mb-0">
      <CardHeader
        title={t("finance.hierarchyTable.title", "Économies par niveau financier (€M)")}
        actions={
          <div className="flex items-center gap-2">
            <select
              aria-label={t("finance.hierarchyTable.level", "Niveau")}
              value={level.key}
              onChange={(e) => {
                setLevelKey(e.target.value);
                setExpanded(new Set());
              }}
              className="rounded-sm border border-border bg-white px-2 py-1 text-xs font-semibold text-primary focus:border-bp-coral focus:outline-none"
            >
              {levels.map((l) => (
                <option key={l.key} value={l.key}>
                  {l.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportXlsx}
              className="inline-flex items-center gap-1 rounded-sm border border-border-strong px-2 py-1 text-xs font-semibold text-secondary hover:text-primary"
            >
              <Download size={12} /> {t("finance.hierarchyTable.export", "Exporter")}
            </button>
          </div>
        }
      />
      <CardBody>
        {allYears.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-tertiary">
              {t("finance.hierarchyTable.yearFilter", "Années")}
            </span>
            <Popover
              align="start"
              trigger={({ open, toggle }) => (
                <button
                  type="button"
                  onClick={toggle}
                  aria-expanded={open}
                  aria-haspopup="menu"
                  aria-label={
                    yearFilterActive
                      ? `${t("finance.hierarchyTable.yearFilter", "Années")} (${selectedYears.size})`
                      : t("finance.hierarchyTable.yearFilter", "Années")
                  }
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    yearFilterActive
                      ? "border-bp-coral bg-bp-coral/10 text-bp-coral"
                      : "border-border bg-white text-secondary hover:bg-neutral-100"
                  }`}
                >
                  {yearsButtonLabel}
                  <ChevronDown
                    size={12}
                    className={yearFilterActive ? "text-bp-coral" : "text-tertiary"}
                  />
                </button>
              )}
            >
              <div className="flex items-center justify-between border-b border-border px-1 pb-1.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setSelectedYears(new Set())}
                  disabled={!yearFilterActive}
                  className="text-bp-coral hover:underline disabled:opacity-40"
                >
                  {t("finance.hierarchyTable.allYears", "Toutes les années")}
                </button>
              </div>
              <div className="max-h-[240px] overflow-y-auto pt-1">
                {allYears.map((y) => (
                  <label
                    key={y}
                    role="menuitemcheckbox"
                    aria-checked={selectedYears.has(y)}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs font-medium text-secondary transition hover:bg-neutral-50"
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-bp-coral"
                      checked={selectedYears.has(y)}
                      onChange={() => toggleYear(y)}
                    />
                    <span className={selectedYears.has(y) ? "font-semibold text-primary" : ""}>
                      {y}
                    </span>
                  </label>
                ))}
              </div>
            </Popover>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase text-tertiary">
                <th className="px-3 py-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSort({
                        key: "label",
                        dir: sort.key === "label" && sort.dir === "asc" ? "desc" : "asc",
                      })
                    }
                  >
                    {level.label}
                    {arrow("label")}
                  </button>
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className="px-3 py-2 text-right">
                    <button type="button" onClick={() => toggleSort(c.key)}>
                      {t(c.labelKey, c.label)}
                      {arrow(c.key)}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tree.map((r) => {
                const open = expanded.has(r.nodeId);
                const canExpand = r.children.length > 0;
                return (
                  <Fragment key={r.nodeId}>
                    <tr className="border-b border-border/60">
                      <td className="px-3 py-2 font-semibold text-primary">
                        {canExpand ? (
                          <button
                            type="button"
                            aria-label={
                              open
                                ? t("finance.hierarchyTable.collapse", "Replier")
                                : t("finance.hierarchyTable.expand", "Déplier")
                            }
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev);
                                if (next.has(r.nodeId)) next.delete(r.nodeId);
                                else next.add(r.nodeId);
                                return next;
                              })
                            }
                            className="mr-1 inline-flex align-middle"
                          >
                            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                        ) : (
                          <span className="mr-1 inline-block w-3.5" />
                        )}
                        {r.label}
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className={numCell}>
                          {fmt(r[c.key])}
                        </td>
                      ))}
                    </tr>
                    {open &&
                      r.children.map((ch) => (
                        <tr
                          key={ch.nodeId}
                          className="border-b border-border/40 bg-neutral-50 text-secondary"
                        >
                          <td className="py-1.5 pl-9 pr-3">{ch.label}</td>
                          {COLUMNS.map((c) => (
                            <td key={c.key} className={`${numCell} py-1.5`}>
                              {fmt(ch[c.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
              <tr className="bg-neutral-100 font-bold text-primary">
                <td className="px-3 py-2">{t("finance.hierarchyTable.total", "Total")}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className={numCell}>
                    {fmt(totals[c.key])}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
