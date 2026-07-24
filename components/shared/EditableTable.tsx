"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type ColumnDef<T> = {
  key: keyof T & string;
  label: string;
  type?: "text" | "number" | "select" | "readonly";
  editable?: boolean;
  options?: string[];
  allowCustom?: boolean;
  sortable?: boolean;
  align?: "left" | "right" | "center";
  render?: (row: T) => React.ReactNode;
  width?: string;
  /** Rôle de la colonne dans la vue carte mobile (< sm) qui remplace le tableau : "primary" pour
   * les champs mis en avant en tête de carte (titre, badges clés), "hide" pour l'exclure de la
   * carte (champ secondaire consultable en détail), défaut ("secondary" implicite) = listé en
   * paire libellé/valeur sous l'en-tête. Sans configuration explicite, la 1ère colonne sert de
   * titre et le reste est listé — pertinent pour les tableaux à peu de colonnes. */
  mobile?: "primary" | "secondary" | "hide";
};

export type EditableTableProps<T extends { id: string }> = {
  data: T[];
  columns: ColumnDef<T>[];
  onCellUpdate?: (rowId: string, field: keyof T, value: string | number) => void;
  onRowClick?: (row: T) => void;
  searchPlaceholder?: string;
  showTotalsRow?: boolean;
  totalsConfig?: Partial<Record<keyof T, (rows: T[]) => React.ReactNode>>;
  defaultSort?: { key: keyof T & string; direction: "asc" | "desc" };
  className?: string;
};

/**
 * Table générique éditable — tri, recherche, filtres par colonne, édition inline (double-clic).
 * Réutilisée pour la baseline P&L, ETP, KPI industriels et le plan d'action (voir CONTRIBUTING.md).
 */
export function EditableTable<T extends { id: string }>({
  data,
  columns,
  onCellUpdate,
  onRowClick,
  searchPlaceholder = "Rechercher...",
  showTotalsRow = false,
  totalsConfig,
  defaultSort,
  className,
}: EditableTableProps<T>) {
  const [search, setSearch] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(defaultSort ?? null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);

  const filterableColumns = columns.filter((c) => c.options && c.options.length > 0);

  const filtered = useMemo(() => {
    let rows = data;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((row) =>
        columns.some((c) =>
          String(row[c.key] ?? "")
            .toLowerCase()
            .includes(q)
        )
      );
    }
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (!value) return;
      rows = rows.filter((row) => String(row[key as keyof T]) === value);
    });
    if (sort) {
      rows = [...rows].sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return sort.direction === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [data, search, columnFilters, sort, columns]);

  const toggleSort = (key: keyof T & string) => {
    setSort((prev) =>
      prev?.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key, direction: "asc" }
    );
  };

  const startEdit = (rowId: string, field: string, current: unknown) => {
    setEditingCell({ rowId, field });
    setDraftValue(String(current ?? ""));
    const col = columns.find((c) => c.key === field);
    if (col?.allowCustom && col.options && !col.options.includes(String(current ?? ""))) {
      setIsCustomMode(true);
    } else {
      setIsCustomMode(false);
    }
  };

  const commitEdit = (row: T, col: ColumnDef<T>) => {
    if (onCellUpdate) {
      const value = col.type === "number" ? Number(draftValue) : draftValue;
      if (!(col.type === "number" && Number.isNaN(value))) {
        onCellUpdate(row.id, col.key, value);
      }
    }
    setEditingCell(null);
    setIsCustomMode(false);
  };

  const resetFilters = () => {
    setSearch("");
    setColumnFilters({});
  };

  // Vue carte mobile (< sm) : sans configuration explicite via `mobile`, la 1ère colonne sert de
  // titre de carte et les suivantes sont listées en paire libellé/valeur — aucune colonne n'est
  // jamais coupée horizontalement.
  const hasExplicitMobileRoles = columns.some((c) => c.mobile);
  const mobilePrimaryCols = hasExplicitMobileRoles
    ? columns.filter((c) => c.mobile === "primary")
    : columns.slice(0, 1);
  const mobileSecondaryCols = hasExplicitMobileRoles
    ? columns.filter((c) => c.mobile !== "primary" && c.mobile !== "hide")
    : columns.slice(1);

  const cellContent = (row: T, c: ColumnDef<T>) =>
    c.render ? c.render(row) : String(row[c.key] ?? "");

  return (
    <div className={className}>
      <div className="mb-3.5 flex flex-wrap items-center gap-2 rounded-md border border-border bg-white p-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="min-w-[220px] rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-black focus:outline-none"
        />
        {filterableColumns.map((c) => (
          <select
            key={c.key}
            value={columnFilters[c.key] ?? ""}
            onChange={(e) => setColumnFilters((prev) => ({ ...prev, [c.key]: e.target.value }))}
            className="rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-black focus:outline-none"
          >
            <option value="">{c.label} (tous)</option>
            {c.options!.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ))}
        {(search || Object.values(columnFilters).some(Boolean)) && (
          <button
            onClick={resetFilters}
            className="text-xs font-medium text-bp-coral hover:underline"
          >
            Réinitialiser filtres
          </button>
        )}
        <span className="ml-auto text-xs text-secondary">
          <strong className="text-primary">{filtered.length}</strong> résultat
          {filtered.length > 1 ? "s" : ""} sur {data.length}
        </span>
      </div>

      {/* Vue tableau — desktop/tablette uniquement (>= sm) : le scroll horizontal contenu dans
       * cette boîte reste un swipe latéral, interdit sur mobile. En dessous de sm, la vue carte
       * ci-après prend le relais avec un empilement 100% vertical. */}
      <div className="hidden overflow-auto rounded-lg border border-border bg-white sm:block">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={() => c.sortable !== false && toggleSort(c.key)}
                  className={cn(
                    "sticky top-0 z-10 border-b border-border bg-neutral-50 px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-secondary",
                    c.sortable !== false && "cursor-pointer select-none",
                    c.align === "right" && "text-right",
                    c.align === "center" && "text-center"
                  )}
                  style={{ width: c.width }}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {c.sortable !== false &&
                      (sort?.key === c.key ? (
                        sort.direction === "asc" ? (
                          <ChevronUp size={11} />
                        ) : (
                          <ChevronDown size={11} />
                        )
                      ) : (
                        <ChevronsUpDown size={11} className="opacity-30" />
                      ))}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-10 text-center text-sm text-tertiary"
                >
                  Aucun résultat pour ces filtres.{" "}
                  <button
                    onClick={resetFilters}
                    className="font-medium text-bp-coral hover:underline"
                  >
                    Réinitialiser
                  </button>
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "border-b border-border hover:bg-neutral-50",
                  onRowClick && "cursor-pointer"
                )}
              >
                {columns.map((c) => {
                  const isEditing = editingCell?.rowId === row.id && editingCell?.field === c.key;
                  return (
                    <td
                      key={c.key}
                      onDoubleClick={(e) => {
                        if (!c.editable) return;
                        e.stopPropagation();
                        startEdit(row.id, c.key, row[c.key]);
                      }}
                      className={cn(
                        "px-3 py-2.5 align-middle text-primary",
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center"
                      )}
                    >
                      {isEditing ? (
                        c.options && c.options.length > 0 && !isCustomMode ? (
                          <select
                            autoFocus
                            value={c.options.includes(draftValue) ? draftValue : "__custom__"}
                            onChange={(e) => {
                              if (e.target.value === "__custom__") {
                                setIsCustomMode(true);
                                setDraftValue("");
                              } else {
                                setDraftValue(e.target.value);
                              }
                            }}
                            onBlur={() => {
                              if (!isCustomMode) commitEdit(row, c);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setIsCustomMode(false);
                                setEditingCell(null);
                              }
                              if (e.key === "Enter") commitEdit(row, c);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded-sm border-[1.5px] border-bp-coral px-1.5 py-0.5 text-xs"
                          >
                            {c.options.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                            {c.allowCustom && <option value="__custom__">Autre...</option>}
                          </select>
                        ) : (
                          <input
                            autoFocus
                            type={c.type === "number" ? "number" : "text"}
                            value={draftValue}
                            onChange={(e) => setDraftValue(e.target.value)}
                            onBlur={() => commitEdit(row, c)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setIsCustomMode(false);
                                setEditingCell(null);
                              }
                              if (e.key === "Enter") commitEdit(row, c);
                            }}
                            placeholder={isCustomMode ? "Saisir une nouvelle valeur..." : undefined}
                            className="w-full rounded-sm border-[1.5px] border-bp-coral px-1.5 py-0.5 text-xs"
                          />
                        )
                      ) : c.render ? (
                        c.render(row)
                      ) : (
                        String(row[c.key] ?? "")
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {showTotalsRow && totalsConfig && filtered.length > 0 && (
            <tfoot>
              <tr className="sticky bottom-0 border-t-2 border-border-strong bg-neutral-50 font-semibold">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn("px-3 py-2.5", c.align === "right" && "text-right tabular-nums")}
                  >
                    {totalsConfig[c.key]?.(filtered)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Vue carte — mobile uniquement (< sm), remplace le tableau : chaque ligne devient une
       * carte empilée verticalement (titre + paires libellé/valeur), aucun scroll horizontal. */}
      <div className="divide-y divide-border rounded-lg border border-border bg-white sm:hidden">
        {filtered.length === 0 && (
          <div className="px-3 py-10 text-center text-sm text-tertiary">
            Aucun résultat pour ces filtres.{" "}
            <button onClick={resetFilters} className="font-medium text-bp-coral hover:underline">
              Réinitialiser
            </button>
          </div>
        )}
        {filtered.map((row) => (
          <div
            key={row.id}
            onClick={() => onRowClick?.(row)}
            className={cn("p-3", onRowClick && "cursor-pointer active:bg-neutral-50")}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              {mobilePrimaryCols.map((c) => (
                <span key={c.key} className="text-[13px] font-semibold text-primary">
                  {cellContent(row, c)}
                </span>
              ))}
            </div>
            {mobileSecondaryCols.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {mobileSecondaryCols.map((c) => (
                  <div key={c.key} className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-tertiary">
                      {c.label}
                    </dt>
                    <dd
                      className={cn(
                        "truncate text-[12px] text-primary",
                        c.align === "right" && "text-right tabular-nums"
                      )}
                    >
                      {cellContent(row, c)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
