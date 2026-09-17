"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FilterDef, SingleActiveFilters } from "@/components/shared/FilterBar";

/**
 * État d'un `DropdownFilterBar` (components/shared/DropdownFilterBar.tsx), synchronisé dans
 * l'URL — base COMMUNE pour toute page qui affiche des filtres, à la place d'une implémentation
 * ad hoc par page (round <n> : avant ce hook, `LeversPagePerformance.tsx`,
 * `app/(app)/hr/etp/page.tsx` et `app/(app)/hr/page.tsx` réécrivaient chacune leur propre
 * variante — deux d'entre elles avec un bug identique qui rendait le PREMIER clic sur un bouton
 * de filtre totalement invisible).
 *
 * Round <n+1> : le hook portait à l'origine l'état d'un `FilterBar` à chips (multi-valeurs par
 * dimension, `ActiveFilters = Record<string, string[]>`). `FilterBar` a été remplacé sur ses 4
 * pages appelantes par `DropdownFilterBar` (sélection UNIQUE par dimension, demande produit —
 * voir le commentaire de tête de `DropdownFilterBar.tsx`) : l'état est donc désormais
 * `SingleActiveFilters = Record<string, string | null>`, une valeur (ou absence de clé) par
 * dimension, sérialisée dans l'URL sans jointure par virgule.
 *
 * `namespace` : préfixe ajouté aux clés d'URL — nécessaire quand DEUX barres de filtres coexistent
 * sur la même page avec des `FilterDef` qui partagent le même `key` (ex. un filtre "Département"
 * sur le tableau effectifs ET un filtre "Département" sur le tableau mouvements de la page Base
 * ETP) : sans lui, les deux liraient/écriraient le MÊME paramètre d'URL et s'activeraient l'une
 * l'autre à tort. Omis pour une page n'ayant qu'une seule barre de filtres.
 */
export function useFilterBarState<T>(
  filterDefs: FilterDef<T>[],
  options?: { namespace?: string }
): { activeFilters: SingleActiveFilters; setFilters: (next: SingleActiveFilters) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefix = options?.namespace ? `${options.namespace}_` : "";

  const activeFilters: SingleActiveFilters = useMemo(() => {
    const result: SingleActiveFilters = {};
    for (const def of filterDefs) {
      const paramKey = `${prefix}${def.key}`;
      const value = searchParams.get(paramKey);
      if (value) result[def.key] = value;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, filterDefs, prefix]);

  const setFilters = (next: SingleActiveFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const def of filterDefs) {
      params.delete(`${prefix}${def.key}`);
    }
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(`${prefix}${key}`, value);
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  return { activeFilters, setFilters };
}
