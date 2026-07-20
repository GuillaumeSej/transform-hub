"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

export type GlobalFilters = {
  f_status: string;
  f_ws: string;
  f_function: string;
  f_geography: string;
  f_country: string;
  f_owner: string;
  f_type: string;
  f_priority: string;
  f_risk: string;
  f_endMonth: string;
  f_endQuarter: string;
};

const DEFAULT_FILTERS: GlobalFilters = {
  f_status: "",
  f_ws: "",
  f_function: "",
  f_geography: "",
  f_country: "",
  f_owner: "",
  f_type: "",
  f_priority: "",
  f_risk: "",
  f_endMonth: "",
  f_endQuarter: "",
};

type FilterContextValue = {
  filters: GlobalFilters;
  setFilter: <K extends keyof GlobalFilters>(key: K, value: GlobalFilters[K]) => void;
  resetFilters: () => void;
  hasActiveFilters: boolean;
};

const FilterContext = createContext<FilterContextValue | null>(null);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilters>(DEFAULT_FILTERS);

  const setFilter = useCallback(
    <K extends keyof GlobalFilters>(key: K, value: GlobalFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
  }, []);

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((v) => v !== ""),
    [filters]
  );

  return (
    <FilterContext.Provider value={{ filters, setFilter, resetFilters, hasActiveFilters }}>
      {children}
    </FilterContext.Provider>
  );
}

export function useGlobalFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useGlobalFilters doit être utilisé dans un <FilterProvider>");
  return ctx;
}

/** Check if a lever matches the active global filters. */
export function matchesGlobalFilters(
  lever: { status: string; ws: string; function: string; geography: string; country: string; owner: string; type: string; priority: string; risk: string; end: string },
  filters: GlobalFilters
): boolean {
  const check = (filterVal: string, leverVal: string) => {
    if (!filterVal) return true;
    const values = filterVal.split(",").filter(Boolean);
    return values.length === 0 || values.includes(leverVal);
  };

  if (!check(filters.f_status, lever.status)) return false;
  if (!check(filters.f_ws, lever.ws)) return false;
  if (!check(filters.f_function, lever.function)) return false;
  if (!check(filters.f_geography, lever.geography)) return false;
  if (!check(filters.f_country, lever.country)) return false;
  if (!check(filters.f_owner, lever.owner)) return false;
  if (!check(filters.f_type, lever.type)) return false;
  if (!check(filters.f_priority, lever.priority)) return false;
  if (!check(filters.f_risk, lever.risk)) return false;

  if (filters.f_endMonth || filters.f_endQuarter) {
    const d = new Date(lever.end);
    const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthLabel = `${monthLabels[d.getMonth()]} ${d.getFullYear()}`;
    const quarterLabel = `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;

    if (!check(filters.f_endMonth, monthLabel)) return false;
    if (!check(filters.f_endQuarter, quarterLabel)) return false;
  }

  return true;
}
