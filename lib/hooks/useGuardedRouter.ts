"use client";

import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";

/**
 * Version "guardée" de `useRouter()` : intercepte `push`, `replace` et `back` pour demander
 * confirmation via la modale globale si des modifications ne sont pas enregistrées.
 *
 * Règles :
 *  - Une navigation vers le même pathname (mise à jour de query params seulement) n'est PAS
 *    bloquée : c'est utilisé par les listes/filtres (`router.replace('/levers?f_status=x')`).
 *  - Les autres méthodes (`forward`, `prefetch`, `refresh`) sont passées telles quelles — elles
 *    ne changent pas la page courante au sens métier.
 */
export function useGuardedRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const { confirmDiscard, isAnyDirty } = useUnsavedChanges();

  return useMemo(() => {
    const sameTarget = (href: string) => {
      const targetPathname = href.split(/[?#]/)[0];
      return targetPathname === pathname;
    };

    const guarded = async <T>(runNav: () => T, targetHref?: string): Promise<T | void> => {
      if (!isAnyDirty || (targetHref && sameTarget(targetHref))) {
        return runNav();
      }
      const proceed = await confirmDiscard();
      if (proceed) return runNav();
    };

    return {
      push: (href: string, options?: Parameters<typeof router.push>[1]) =>
        guarded(() => router.push(href, options), href),
      replace: (href: string, options?: Parameters<typeof router.replace>[1]) =>
        guarded(() => router.replace(href, options), href),
      back: () => guarded(() => router.back()),
      forward: () => router.forward(),
      prefetch: (href: string) => router.prefetch(href),
      refresh: () => router.refresh(),
    };
  }, [router, pathname, isAnyDirty, confirmDiscard]);
}
