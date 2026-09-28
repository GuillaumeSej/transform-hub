"use client";

import { useCallback, useMemo } from "react";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { canOpenRoute } from "@/lib/routeAccess";
import { resolveLandingRoute, resolveUserNav } from "@/lib/nav-config";

/**
 * `canOpenRoute` (lib/routeAccess.ts) lié à l'utilisateur connecté et au type du programme actif —
 * MÊME règle que la garde de route d'AppShell, y compris la prudence pendant le chargement des
 * programmes (pas de filtre par type tant qu'ils chargent). Sert à masquer/neutraliser un lien vers
 * une page que l'utilisateur ne peut pas ouvrir, au lieu de le laisser cliquer et d'être renvoyé
 * sans explication vers « Mon espace » (audit, point 3).
 */
export function useCanOpenRoute(): (href: string) => boolean {
  const { user } = useRole();
  const { programType, loading } = useActiveProgram();
  const effectiveType = loading ? undefined : programType;
  return useCallback(
    (href: string) => canOpenRoute(user, href, effectiveType),
    [user, effectiveType]
  );
}

/**
 * Page d'arrivée de l'utilisateur (même calcul que le repli de la garde d'AppShell :
 * `resolveLandingRoute` sur la nav filtrée par le type du programme actif) — repli ultime des
 * boutons « Retour » quand ni l'historique ni la page naturelle de repli ne sont disponibles.
 */
export function useLandingRoute(): string {
  const { user } = useRole();
  const { programType, loading } = useActiveProgram();
  return useMemo(() => {
    const nav = resolveUserNav(user);
    const filtered = loading
      ? nav
      : nav.filter((item) => !item.programTypes || item.programTypes.includes(programType));
    return resolveLandingRoute(filtered.length > 0 ? filtered : nav);
  }, [user, programType, loading]);
}
