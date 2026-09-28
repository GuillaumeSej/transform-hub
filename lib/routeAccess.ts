import { PAGE_ROUTES, PROGRAM_TYPE_AWARE_ROUTES, resolveUserNav } from "@/lib/nav-config";
import type { AuthUser, ProgramType } from "@/types";

/**
 * « Cet utilisateur peut-il ouvrir cette page ? » — MÊME règle que la garde de route d'AppShell
 * (nav résolue de tous ses profils, filtrée par le type du programme actif, plus les pages hors
 * nav explicitement ouvertes). Sert à MASQUER un lien/bouton vers une page que l'utilisateur ne
 * peut pas ouvrir, au lieu de le laisser cliquer et d'être renvoyé sans explication vers
 * « Mon espace » (audit, point 3).
 *
 * `href` peut porter une query string ou un hash (`/kpi?indicator=…`) : seul le chemin compte.
 * `programType` = type du programme actif ; `undefined` (programmes en cours de chargement) =
 * pas de filtre par type, comme AppShell pendant le chargement.
 */
export function canOpenRoute(
  user: Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin"> | null | undefined,
  href: string,
  programType?: ProgramType
): boolean {
  if (!user) return false;
  const path = href.split(/[?#]/)[0] || "/";
  // Pages hors nav ouvertes à tout utilisateur connecté (même liste blanche qu'AppShell).
  if (path === "/profile" || path.startsWith("/levers/")) return true;
  if (path === "/admin/companies/detail") return !!user.isGlobalAdmin;
  const unfiltered = resolveUserNav(user);
  if (unfiltered.length === 0) return false;
  const items = programType
    ? unfiltered.filter((item) => !item.programTypes || item.programTypes.includes(programType))
    : unfiltered;
  if (items.some((item) => PAGE_ROUTES[item.id] === path)) return true;
  // Page Performance ouverte en mode stratégique : elle affiche son message de bascule, donc elle
  // reste « ouvrable » si l'utilisateur y a droit hors filtre de type.
  return (
    PROGRAM_TYPE_AWARE_ROUTES.has(path) && unfiltered.some((item) => PAGE_ROUTES[item.id] === path)
  );
}
