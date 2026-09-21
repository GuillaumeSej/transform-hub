"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import * as engine from "@/lib/engine";
import {
  attachChildren,
  financeTotals,
  sortFinanceRows,
  type FinanceSortKey,
} from "@/lib/dashboardSavings";
import { sortedHierarchyLevels } from "@/lib/financeCosts";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { BeTrackData, HierarchyLevelDef, HierarchyNode } from "@/types";

const COLUMNS: { key: Exclude<FinanceSortKey, "label">; label: string }[] = [
  { key: "planned", label: "Planifié initial" },
  { key: "reforecast", label: "Réactualisé" },
  { key: "cancelled", label: "Annulé" },
  { key: "late", label: "En retard" },
  { key: "realized", label: "Réalisé" },
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

  const levelIdx = Math.max(
    0,
    levels.findIndex((l) => l.key === levelKey)
  );
  const level = levels[levelIdx];
  const childLevel = levels[levelIdx + 1];

  const company = useMemo(() => ({ hierarchyLevels }), [hierarchyLevels]);
  const parents = useMemo(
    () => (level ? engine.financeByHierarchyLevel(data, company, level.order, hierarchyNodes) : []),
    [data, company, level, hierarchyNodes]
  );
  const children = useMemo(
    () =>
      childLevel
        ? engine.financeByHierarchyLevel(data, company, childLevel.order, hierarchyNodes)
        : [],
    [data, company, childLevel, hierarchyNodes]
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
    for (const r of tree) {
      rows.push({
        [level.label]: r.label,
        "Planifié initial": r.planned,
        Réactualisé: r.reforecast,
        Annulé: r.cancelled,
        "En retard": r.late,
        Réalisé: r.realized,
      });
    }
    rows.push({
      [level.label]: "Total",
      "Planifié initial": totals.planned,
      Réactualisé: totals.reforecast,
      Annulé: totals.cancelled,
      "En retard": totals.late,
      Réalisé: totals.realized,
    });
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
                      {c.label}
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
                            aria-label={open ? "Replier" : "Déplier"}
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
