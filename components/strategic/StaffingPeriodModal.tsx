"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/shared/Modal";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import type { StaffingDetailRow } from "@/components/strategic/StaffingDetailModal";
import { useTranslation } from "@/lib/i18n/useTranslation";

export type PeriodModalRow = StaffingDetailRow & {
  /** Clés de série (équipe ou axe) auxquelles la ligne appartient. */
  groupKeys: string[];
};

export type PeriodModalSeries = { key: string; name: string; color: string };

/**
 * Grande pop-up dédiée à UNE période (colonne du graphique « Répartition des ETP »). Les filtres
 * de catégorie (séries du graphe : Commercial, Marketing, Production…) sont des chips
 * multi-sélection au-dessus ; sans chip active, toutes les catégories sont affichées. Chaque
 * catégorie visible est détaillée (lignes / chantiers / ETP mobilisés) dans un bloc dédié.
 */
export function StaffingPeriodModal({
  open,
  onOpenChange,
  title,
  series,
  rows,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  series: PeriodModalSeries[];
  rows: PeriodModalRow[];
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) setSelected([]);
  }, [open, title]);

  const fteByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) for (const k of r.groupKeys) m.set(k, (m.get(k) ?? 0) + r.fte);
    return m;
  }, [rows]);

  const chips = series.filter((s) => (fteByKey.get(s.key) ?? 0) > 0);
  const visible = chips.filter((s) => selected.length === 0 || selected.includes(s.key));
  const toggle = (k: string) =>
    setSelected((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  const visibleTotal = visible.reduce((sum, s) => sum + (fteByKey.get(s.key) ?? 0), 0);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} maxWidth="1100px">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-tertiary">
          {t("staffingPeriod.detailModal.empty", "Aucune ligne d'ETP pour cette sélection.")}
        </p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-[12px] font-semibold text-secondary">
              {t("staffingPeriod.periodModal.filters", "Filtrer par catégorie")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={selected.length === 0}
                onClick={() => setSelected([])}
                className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                  selected.length === 0
                    ? "bg-black text-white"
                    : "bg-neutral-100 text-primary hover:bg-neutral-200"
                }`}
              >
                {t("staffingPeriod.periodModal.all", "Toutes")}
              </button>
              {chips.map((s) => {
                const on = selected.includes(s.key);
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(s.key)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                      on
                        ? "bg-black text-white"
                        : "bg-neutral-100 text-primary hover:bg-neutral-200"
                    }`}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: s.color }}
                    />
                    {s.name}
                    <span className={on ? "text-white/70" : "text-tertiary"}>
                      {formatFte(fteByKey.get(s.key) ?? 0)} {t("staffing.fteUnit", "ETP")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-[12px] text-tertiary">
            {t("staffing.total", "Total")} :{" "}
            <strong className="text-primary">
              {formatFte(visibleTotal)} {t("staffing.fteUnit", "ETP")}
            </strong>
          </p>

          {visible.map((s) => {
            const groupRows = rows.filter((r) => r.groupKeys.includes(s.key));
            return (
              <section key={s.key} className="rounded-md border border-border">
                <header className="flex items-center justify-between gap-3 bg-neutral-50 px-3 py-2">
                  <span className="flex items-center gap-2 text-[13px] font-semibold text-primary">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: s.color }}
                    />
                    {s.name}
                  </span>
                  <span className="text-[12px] text-secondary">
                    {groupRows.length}{" "}
                    {t("staffingPeriod.periodModal.rowsFor", "Lignes mobilisées").toLowerCase()} ·{" "}
                    <strong className="text-primary">
                      {formatFte(fteByKey.get(s.key) ?? 0)} {t("staffing.fteUnit", "ETP")}
                    </strong>
                  </span>
                </header>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-[12px]">
                    <thead className="text-[11px] font-semibold uppercase tracking-wide text-secondary">
                      <tr>
                        <th className="px-3 py-2">{t("effectifs.byChantierLabel", "Chantiers")}</th>
                        <th className="px-3 py-2">
                          {t("staffingPeriod.detailModal.columnAxis", "Axe(s)")}
                        </th>
                        <th className="px-3 py-2 text-right">{t("etp.column.fte", "ETP")}</th>
                        <th className="px-3 py-2">
                          {t("staffingPeriod.detailModal.columnPeriod", "Période")}
                        </th>
                        <th className="px-3 py-2">
                          {t("staffingPeriod.detailModal.columnLever", "Levier")}
                        </th>
                        <th className="px-3 py-2">{t("staffing.note", "Précision")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {groupRows.map((r) => (
                        <tr key={`${s.key}-${r.id}`} className="text-primary">
                          <td className="px-3 py-2 font-medium">{r.chantierName}</td>
                          <td className="px-3 py-2 text-tertiary">{r.axisNames}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatFte(r.fte)}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-tertiary">
                            {r.periodLabel}
                          </td>
                          <td className="px-3 py-2 text-tertiary">{r.lever}</td>
                          <td className="px-3 py-2 text-tertiary">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
