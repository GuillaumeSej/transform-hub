/**
 * Rattrapage des URLs à slash final sur GitHub Pages (logique pure, testée).
 *
 * L'export statique Next (`output: "export"`, `trailingSlash` à false) génère `login.html`, que
 * GitHub Pages sert pour `/transform-hub/login` — mais `/transform-hub/login/` y est traité comme
 * un DOSSIER (`login/index.html`, inexistant) → 404. La page 404 exportée (app/not-found.tsx →
 * out/404.html) appelle ce helper : si l'URL se termine par « / », on propose la même URL SANS le
 * slash (requête + ancre conservées), que la page vérifie avant d'y rediriger.
 *
 * On ne passe pas à `trailingSlash: true` : toutes les URLs de l'app changeraient de forme
 * (`/levers/detail/?id=…`), les liens déjà partagés/bookmarkés sans slash passeraient par une
 * redirection, et les liens relatifs éventuels changeraient de base.
 */
export function trailingSlashRedirectTarget(
  pathname: string,
  search = "",
  hash = "",
  basePath = ""
): string | null {
  if (!pathname.endsWith("/")) return null;
  const stripped = pathname.replace(/\/+$/, "");
  // Racine du site (ou du basePath) : servie par index.html, jamais une 404 à rattraper.
  if (stripped === "" || stripped === basePath.replace(/\/+$/, "")) return null;
  return `${stripped}${search}${hash}`;
}
