"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hasNavigatedInApp, markInAppNavigation, shouldGoBack } from "@/lib/navigationHistory";

/**
 * Bouton « Retour » sûr : `router.back()` seulement s'il existe une page de l'application dans
 * l'historique de l'onglet ; sinon (lien direct, nouvel onglet) navigation vers `fallbackHref`
 * (ex. bibliothèque de leviers, page d'arrivée de l'utilisateur) plutôt que de quitter l'app.
 *
 * Réutilisable par toute fiche de détail (ex. AxisDetailClient).
 */
export function useBackOrFallback(fallbackHref: string): () => void {
  const router = useRouter();
  return useCallback(() => {
    const goBack =
      typeof window !== "undefined" &&
      shouldGoBack({
        navigatedInApp: hasNavigatedInApp(),
        historyLength: window.history.length,
        referrer: document.referrer,
        origin: window.location.origin,
      });
    if (goBack) router.back();
    else router.push(fallbackHref);
  }, [router, fallbackHref]);
}

/**
 * À monter UNE fois dans la coquille (AppShell) : note qu'une navigation interne a eu lieu dès que
 * la route change après le premier affichage — condition pour que `useBackOrFallback` revienne en
 * arrière.
 */
export function useTrackInAppNavigation(): void {
  const pathname = usePathname();
  const first = useRef<string | null>(null);
  useEffect(() => {
    if (first.current === null) {
      first.current = pathname;
      return;
    }
    if (pathname !== first.current) markInAppNavigation();
  }, [pathname]);
}
