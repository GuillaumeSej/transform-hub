"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ActiveFilters, FilterDef } from "@/components/shared/FilterBar";

/**
 * État d'un `FilterBar` (components/shared/FilterBar.tsx), synchronisé dans l'URL — base COMMUNE
 * pour toute page qui affiche un `FilterBar`, à la place d'une implémentation ad hoc par page
 * (round <n> : avant ce hook, `LeversPagePerformance.tsx`, `app/(app)/hr/etp/page.tsx` et
 * `app/(app)/hr/page.tsx` réécrivaient chacune leur propre variante — deux d'entre elles avec un
 * bug identique qui rendait le PREMIER clic sur un bouton de filtre totalement invisible).
 *
 * PIÈGE historique (cause du bug) : `FilterBar` active une dimension à ZÉRO valeur sélectionnée
 * (voir son commentaire — style Excel, l'utilisateur coche ensuite ce qu'il veut voir). Une
 * implémentation qui n'écrit un paramètre d'URL que lorsque `values.length > 0` perd donc
 * TOUJOURS ce premier clic (rien n'est encore coché à ce moment-là) : le paramètre n'atteint
 * jamais l'URL, `activeFilters` ne voit donc jamais la clé, le bouton ne s'allume pas et la ligne
 * de valeurs n'apparaît jamais — d'où l'impression qu'« il ne se passe rien » au clic. Le fix
 * ci-dessous n'utilise PAS `values.length` pour décider d'écrire le paramètre : c'est la
 * PRÉSENCE de la clé dans `next` (un objet JS peut porter une clé à valeur `[]`) qui déclenche
 * l'écriture (avec une valeur vide), et c'est la PRÉSENCE du paramètre dans l'URL (pas son
 * contenu) qui redevient le signal « dimension activée » côté lecture.
 *
 * `namespace` : préfixe ajouté aux clés d'URL — nécessaire quand DEUX `FilterBar` coexistent sur
 * la même page avec des `FilterDef` qui partagent le même `key` (ex. un filtre "Département" sur
 * le tableau effectifs ET un filtre "Département" sur le tableau mouvements de la page Base ETP) :
 * sans lui, les deux liraient/écriraient le MÊME paramètre d'URL et s'activeraient l'un l'autre à
 * tort. Omis pour une page n'ayant qu'un seul `FilterBar`.
 */
export function useFilterBarState<T>(
  filterDefs: FilterDef<T>[],
  options?: { namespace?: string }
): { activeFilters: ActiveFilters; setFilters: (next: ActiveFilters) => void } {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefix = options?.namespace ? `${options.namespace}_` : "";

  const activeFilters: ActiveFilters = useMemo(() => {
    const result: ActiveFilters = {};
    for (const def of filterDefs) {
      const paramKey = `${prefix}${def.key}`;
      if (searchParams.has(paramKey)) {
        result[def.key] = (searchParams.get(paramKey) ?? "").split(",").filter(Boolean);
      }
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, filterDefs, prefix]);

  const setFilters = (next: ActiveFilters) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const def of filterDefs) {
      params.delete(`${prefix}${def.key}`);
    }
    for (const [key, values] of Object.entries(next)) {
      params.set(`${prefix}${key}`, values.join(","));
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  return { activeFilters, setFilters };
}
