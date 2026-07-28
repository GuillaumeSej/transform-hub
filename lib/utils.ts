import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Préfixe un asset statique de `public/` avec le basePath du déploiement.
 *
 * Nécessaire car `images: { unoptimized: true }` (next.config.mjs) court-circuite le loader
 * Next qui appliquerait normalement le basePath : sur GitHub Pages (`/transform-hub`), un
 * `src="/brand/logo.png"` brut résout vers la racine du domaine → 404. */
export function assetPath(path: string): string {
  return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`;
}
