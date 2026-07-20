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
  if (filters.f_status && lever.status !== filters.f_status) return false;
  if (filters.f_ws && lever.ws !== filters.f_ws) return false;
  if (filters.f_function && lever.function !== filters.f_function) return false;
  if (filters.f_geography && lever.geography !== filters.f_geography) return false;
  if (filters.f_country && lever.country !== filters.f_country) return false;
  if (filters.f_owner && lever.owner !== filters.f_owner) return false;
  if (filters.f_type && lever.type !== filters.f_type) return false;
  if (filters.f_priority && lever.priority !== filters.f_priority) return false;
  if (filters.f_risk && lever.risk !== filters.f_risk) return false;

  if (filters.f_endMonth || filters.f_endQuarter) {
    const d = new Date(lever.end);
    const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const monthLabel = `${monthLabels[d.getMonth()]} ${d.getFullYear()}`;
    const quarterLabel = `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;

    if (filters.f_endMonth && monthLabel !== filters.f_endMonth) return false;
    if (filters.f_endQuarter && quarterLabel !== filters.f_endQuarter) return false;
  }

  return true;
}
