"use client";

import { useTranslation } from "@/lib/i18n/useTranslation";
import type { OwnerActionStatus, OwnerActionCell, OwnerActionRow } from "@/lib/hrExecution";

function getColumns(
  t: (key: string, fallback?: string) => string
): { key: OwnerActionStatus; label: string; className: string }[] {
  return [
    { key: "overdue", label: t("hr.alert.overdue", "En retard"), className: "text-bp-coral" },
    {
      key: "dueSoon",
      label: t("shared.hrOwnerActionTable.dueSoon", "À venir < 90 j"),
      className: "text-primary",
    },
    {
      key: "later",
      label: t("shared.hrOwnerActionTable.later", "À venir > 90 j"),
      className: "text-secondary",
    },
    {
      key: "realized",
      label: t("shared.hrOwnerActionTable.realized", "Réalisés"),
      className: "text-bp-purple",
    },
    {
      key: "toValidate",
      label: t("shared.hrOwnerActionTable.toValidateHr", "À valider RH"),
      className: "text-bp-coral",
    },
  ];
}

function CellValue({
  value,
  t,
}: {
  value: OwnerActionCell;
  t: (key: string, fallback?: string) => string;
}) {
  return (
    <span className="inline-flex flex-col leading-tight">
      <strong className="text-[13px] tabular-nums">{value.count}</strong>
      <span className="text-[9.5px] text-tertiary">
        {value.fte.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}{" "}
        {t("shared.hrOwnerActionTable.fteAbbrev", "ETP")}
      </span>
    </span>
  );
}

export function HrOwnerActionTable({
  rows,
  onCellClick,
}: {
  rows: OwnerActionRow[];
  onCellClick?: (owner: string, status: OwnerActionStatus) => void;
}) {
  const { t } = useTranslation();
  const COLUMNS = getColumns(t);
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-tertiary">
        {t("shared.hrOwnerActionTable.empty", "Aucun mouvement à piloter.")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="border-b border-border bg-neutral-50 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-secondary">
              {t("shared.hrOwnerActionTable.rhOwner", "RH Owner")}
            </th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                className="border-b border-border bg-neutral-50 px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wide text-secondary"
              >
                {column.label}
              </th>
            ))}
            <th className="border-b border-border bg-neutral-50 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wide text-secondary">
              {t("shared.hrOwnerActionTable.nextDueDate", "Prochaine échéance")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.owner}
              className="border-b border-border last:border-b-0 hover:bg-neutral-50"
            >
              <td className="px-3 py-2.5 font-semibold text-primary">{row.owner}</td>
              {COLUMNS.map((column) => (
                <td key={column.key} className={`px-3 py-2 text-center ${column.className}`}>
                  <button
                    type="button"
                    disabled={row[column.key].count === 0}
                    onClick={() => onCellClick?.(row.owner, column.key)}
                    className="rounded-sm px-2 py-1 hover:bg-neutral-100 disabled:cursor-default disabled:opacity-35"
                  >
                    <CellValue value={row[column.key]} t={t} />
                  </button>
                </td>
              ))}
              <td className="px-3 py-2.5 tabular-nums text-secondary">{row.nextDueDate ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
