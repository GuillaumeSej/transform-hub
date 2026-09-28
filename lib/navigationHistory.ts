/**
 * Historique DANS l'application — pour les boutons « Retour » (`useBackOrFallback`) : un
 * `router.back()` sur une page ouverte par lien direct / nouvel onglet quitterait l'application
 * (ou ne ferait rien). On ne revient donc en arrière que si l'on sait qu'une page de l'app précède.
 *
 * `markInAppNavigation` est appelé par la coquille (AppShell) à chaque changement de route APRÈS
 * le premier affichage : état module (propre à l'onglet, perdu au rechargement — le referrer
 * même-origine prend alors le relais).
 */
let navigatedInApp = false;

export function markInAppNavigation(): void {
  navigatedInApp = true;
}

/** Réinitialisation — tests uniquement. */
export function resetInAppNavigationForTests(): void {
  navigatedInApp = false;
}

export function hasNavigatedInApp(): boolean {
  return navigatedInApp;
}

/** Décision pure : revenir en arrière (`true`) ou naviguer vers le repli (`false`). */
export function shouldGoBack(input: {
  navigatedInApp: boolean;
  historyLength: number;
  referrer: string;
  origin: string;
}): boolean {
  if (input.historyLength <= 1) return false;
  if (input.navigatedInApp) return true;
  if (!input.referrer) return false;
  try {
    return new URL(input.referrer).origin === input.origin;
  } catch {
    return false;
  }
}
