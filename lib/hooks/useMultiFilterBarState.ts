"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FilterDef, MultiActiveFilters } from "@/components/shared/FilterBar";
import { parseFilterValues, serializeFilterValues } from "@/lib/filterUtils";

/**
 * Version multi-sélection de `useFilterBarState` : état d'un `<DropdownFilterBar multiple>`
 * synchronisé dans l'URL (`?key=a,b` — valeurs encodées, séparées par des virgules ; une ancienne
 * URL `?key=a` reste valide). `namespace` : même rôle que dans `useFilterBarState`.
 */
export function useMultiFilterBarState<T>(
  filterDefs: FilterDef<T>[],
  options?: { namespace?: string }
): { activeFilters: MultiActiveFilters; setFilters: (next: MultiActiveFilters) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefix = options?.namespace ? `${options.namespace}_` : "";

  const activeFilters: MultiActiveFilters = useMemo(() => {
    const result: MultiActiveFilters = {};
    for (const def of filterDefs) {
      const values = parseFilterValues(searchParams.get(`${prefix}${def.key}`));
      if (values.length > 0) result[def.key] = values;
    }
    return result;
  }, [searchParams, filterDefs, prefix]);

  const setFilters = (next: MultiActiveFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const def of filterDefs) params.delete(`${prefix}${def.key}`);
    for (const [key, values] of Object.entries(next)) {
      if (values && values.length > 0) params.set(`${prefix}${key}`, serializeFilterValues(values));
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  return { activeFilters, setFilters };
}
