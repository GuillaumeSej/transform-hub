"use client";

import { MultiSelect } from "@/components/shared/MultiSelect";
import { matchesFilter } from "@/lib/filterUtils";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { onActivateKey } from "@/lib/a11y";

export type ColumnDef<T> = {
  key: keyof T & string;
  label: string;
  type?: "text" | "number" | "select" | "date" | "textarea" | "readonly";
  editable?: boolean;
  options?: string[];
  /** Libellé affiché (traduit) d'une option — la valeur stockée reste `opt`. Défaut : `opt`. */
  optionLabel?: (opt: string) => string;
  allowCustom?: boolean;
  /** `false` = pas de filtre multi-sélection auto dans la barre du tableau pour cette colonne. */
  filterable?: boolean;
  sortable?: boolean;
  /** Valeur de tri, quand l'ordre alphabétique du champ ne convient pas (sévérité d'un risque,
   *  ordre des stades…). Défaut : `row[key]`. */
  sortValue?: (row: T) => number | string;
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
  /** Round 25 (gate d'édition COMEX) : désactive l'édition inline (double-clic) SANS toucher à la
   *  définition des colonnes de chaque appelant — plus sûr qu'obliger chaque appelant à retirer
   *  `editable`/`onCellUpdate` de sa propre config, ce composant générique étant réutilisé par
   *  plusieurs pages Plan Performance (leviers, ETP, RH, workstreams...). `false` par défaut :
   *  aucun changement pour les appelants existants qui ne passent pas ce prop. */
  readOnly?: boolean;
  /** Reçoit les ids des lignes réellement affichées (après recherche, filtres de colonnes et tri),
   *  à chaque changement — ex. pour exporter exactement ce que voit l'utilisateur. */
  onVisibleIdsChange?: (ids: string[]) => void;
  /** Recherche contrôlée par l'appelant (optionnelle) — ex. une même saisie appliquée à plusieurs
   *  tableaux. Sans elle, la recherche reste un état local du tableau. */
  search?: string;
  onSearchChange?: (search: string) => void;
  /** Prédicat de recherche (optionnel) remplaçant la recherche par défaut sur toutes les colonnes —
   *  ex. restreindre aux seuls champs texte visibles. */
  searchMatcher?: (row: T, query: string) => boolean;
  /** Masque le champ de recherche (la recherche contrôlée `search` s'applique quand même). */
  hideSearch?: boolean;
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
  searchPlaceholder,
  showTotalsRow = false,
  totalsConfig,
  defaultSort,
  className,
  readOnly = false,
  onVisibleIdsChange,
  search: controlledSearch,
  onSearchChange,
  searchMatcher,
  hideSearch = false,
}: EditableTableProps<T>) {
  const { t } = useTranslation();
  const resolvedSearchPlaceholder =
    searchPlaceholder ?? t("shared.editableTable.searchPlaceholder", "Rechercher...");
  const [localSearch, setLocalSearch] = useState("");
  const search = controlledSearch ?? localSearch;
  const setSearch = (value: string) => {
    if (controlledSearch === undefined) setLocalSearch(value);
    onSearchChange?.(value);
  };
  const [columnFilters, setColumnFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState(defaultSort ?? null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: string } | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);

  const filterableColumns = columns.filter(
    (c) => c.filterable !== false && c.options && c.options.length > 0
  );

  const filtered = useMemo(() => {
    let rows = data;
    if (search.trim()) {
      if (searchMatcher) {
        rows = rows.filter((row) => searchMatcher(row, search));
      } else {
        const q = search.toLowerCase();
        rows = rows.filter((row) =>
          columns.some((c) =>
            String(row[c.key] ?? "")
              .toLowerCase()
              .includes(q)
          )
        );
      }
    }
    Object.entries(columnFilters).forEach(([key, value]) => {
      if (!value || value.length === 0) return;
      rows = rows.filter((row) => matchesFilter(String(row[key as keyof T]), value));
    });
    if (sort) {
      const sortCol = columns.find((c) => c.key === sort.key);
      const valueOf = (row: T) => (sortCol?.sortValue ? sortCol.sortValue(row) : row[sort.key]);
      rows = [...rows].sort((a, b) => {
        const av = valueOf(a);
        const bv = valueOf(b);
        const cmp =
          typeof av === "number" && typeof bv === "number"
            ? av - bv
            : String(av).localeCompare(String(bv));
        return sort.direction === "asc" ? cmp : -cmp;
      });
    }
    return rows;
  }, [data, search, searchMatcher, columnFilters, sort, columns]);

  // Clé texte plutôt que tableau : `data` est souvent recalculé à chaque rendu par l'appelant, un
  // tableau neuf à chaque fois déclencherait l'effet (et un setState parent) en boucle.
  const visibleIdsKey = filtered.map((r) => r.id).join("\u0000");
  useEffect(() => {
    onVisibleIdsChange?.(visibleIdsKey ? visibleIdsKey.split("\u0000") : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rappel seulement si les lignes changent
  }, [visibleIdsKey]);

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

  // `rawValue` permet de committer une valeur qui vient tout juste d'être choisie (ex. option de
  // select cliquée) sans dépendre de `draftValue`, qui n'a pas encore été mis à jour par React au
  // moment où l'event handler appelant s'exécute (setState est asynchrone) — lire `draftValue` ici
  // dans ce cas donnerait l'ancienne valeur et l'édition semblerait ne "pas s'appliquer".
  const commitEdit = (row: T, col: ColumnDef<T>, rawValue?: string) => {
    const source = rawValue !== undefined ? rawValue : draftValue;
    if (onCellUpdate) {
      const value = col.type === "number" ? Number(source) : source;
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
        {!hideSearch && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={resolvedSearchPlaceholder}
            className="min-w-[220px] rounded-sm border border-border px-2.5 py-1.5 text-xs focus:border-black focus:outline-none"
          />
        )}
        {filterableColumns.map((c) => (
          <MultiSelect
            key={c.key}
            label={c.label}
            placeholder={t("shared.editableTable.allSuffix", "(tous)")}
            values={columnFilters[c.key] ?? []}
            onChange={(vals) => setColumnFilters((prev) => ({ ...prev, [c.key]: vals }))}
            options={c.options!.map((opt) => ({
              value: opt,
              label: c.optionLabel ? c.optionLabel(opt) : opt,
            }))}
          />
        ))}
        {(search || Object.values(columnFilters).some((v) => v.length > 0)) && (
          <button
            onClick={resetFilters}
            className="text-xs font-medium text-bp-coral hover:underline"
          >
            {t("shared.editableTable.resetFilters", "Réinitialiser filtres")}
          </button>
        )}
        <span className="ml-auto text-xs text-secondary">
          <strong className="text-primary">{filtered.length}</strong>{" "}
          {t("shared.editableTable.resultCount", "résultat(s) sur {total}").replace(
            "{total}",
            String(data.length)
          )}
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
                    "sticky top-0 z-10 whitespace-nowrap border-b border-border bg-neutral-50 px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wide text-secondary",
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
                  {t("shared.editableTable.noResults", "Aucun résultat pour ces filtres.")}{" "}
                  <button
                    onClick={resetFilters}
                    className="font-medium text-bp-coral hover:underline"
                  >
                    {t("dashboard.reset", "Réinitialiser")}
                  </button>
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr
                key={row.id}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={() => onRowClick?.(row)}
                onKeyDown={onRowClick ? onActivateKey(() => onRowClick(row)) : undefined}
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
                        if (!c.editable || readOnly) return;
                        e.stopPropagation();
                        startEdit(row.id, c.key, row[c.key]);
                      }}
                      className={cn(
                        "max-w-[260px] truncate whitespace-nowrap px-3 py-2.5 align-middle text-primary",
                        c.align === "right" && "text-right tabular-nums",
                        c.align === "center" && "text-center"
                      )}
                      title={
                        typeof row[c.key] === "string" || typeof row[c.key] === "number"
                          ? String(row[c.key])
                          : undefined
                      }
                    >
                      {isEditing ? (
                        c.options && c.options.length > 0 && !isCustomMode ? (
                          <select
                            autoFocus
                            value={c.options.includes(draftValue) ? draftValue : "__custom__"}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              if (nextValue === "__custom__") {
                                setIsCustomMode(true);
                                setDraftValue("");
                              } else {
                                // Commit immédiat au choix d'une option — un <select> natif ne
                                // déclenche pas forcément `blur` juste après un clic sur une
                                // option (le select garde le focus), donc attendre `onBlur` ici
                                // pouvait laisser l'édition "en l'air" tant que l'utilisateur ne
                                // cliquait pas ailleurs. On committe directement la valeur choisie
                                // (sans dépendre de `draftValue`, pas encore à jour à ce point).
                                setDraftValue(nextValue);
                                commitEdit(row, c, nextValue);
                              }
                            }}
                            onBlur={() => {
                              if (
                                !isCustomMode &&
                                editingCell?.rowId === row.id &&
                                editingCell?.field === c.key
                              ) {
                                commitEdit(row, c);
                              }
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
                                {c.optionLabel ? c.optionLabel(opt) : opt}
                              </option>
                            ))}
                            {c.allowCustom && (
                              <option value="__custom__">
                                {t("shared.editableTable.customOption", "Autre...")}
                              </option>
                            )}
                          </select>
                        ) : c.type === "textarea" ? (
                          <textarea
                            autoFocus
                            rows={3}
                            value={draftValue}
                            onChange={(e) => setDraftValue(e.target.value)}
                            onBlur={() => commitEdit(row, c)}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setIsCustomMode(false);
                                setEditingCell(null);
                              }
                              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit(row, c);
                            }}
                            className="min-w-[220px] resize-y rounded-sm border-[1.5px] border-bp-coral px-1.5 py-1 text-xs"
                          />
                        ) : (
                          <input
                            autoFocus
                            type={
                              c.type === "number" ? "number" : c.type === "date" ? "date" : "text"
                            }
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
                            placeholder={
                              isCustomMode
                                ? t(
                                    "shared.editableTable.customPlaceholder",
                                    "Saisir une nouvelle valeur..."
                                  )
                                : undefined
                            }
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
            {t("shared.editableTable.noResults", "Aucun résultat pour ces filtres.")}{" "}
            <button onClick={resetFilters} className="font-medium text-bp-coral hover:underline">
              {t("dashboard.reset", "Réinitialiser")}
            </button>
          </div>
        )}
        {filtered.map((row) => (
          <div
            key={row.id}
            role={onRowClick ? "button" : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={() => onRowClick?.(row)}
            onKeyDown={onRowClick ? onActivateKey(() => onRowClick(row)) : undefined}
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
