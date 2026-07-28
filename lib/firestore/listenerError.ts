import type { FirestoreError } from "firebase/firestore";

/**
 * Handler d'erreur commun pour tous les `onSnapshot` de l'app.
 *
 * Sans callback d'erreur, un listener Firestore rejeté (typiquement `permission-denied` quand
 * les règles déployées sont en retard sur firestore.rules du repo — l'équipe n'a pas toujours
 * l'accès CLI pour les redéployer, voir lib/firestore/workforce.ts) lève une exception non
 * gérée : console rouge en prod et listener silencieusement mort, sans que l'UI le sache.
 *
 * Ici on encaisse proprement : un warn contextualisé (une seule ligne, pas de stack trace
 * anxiogène) et l'UI continue avec ses données courantes (listes vides ou état précédent).
 */
export function onListenerError(context: string): (error: FirestoreError) => void {
  return (error) => {
    if (error.code === "permission-denied") {
      console.warn(
        `[betrack] Firestore "${context}" : accès refusé (règles déployées probablement ` +
          `antérieures à firestore.rules — redéployer via \`firebase deploy --only firestore:rules\`).`
      );
      return;
    }
    console.warn(`[betrack] Firestore "${context}" : listener en erreur (${error.code}).`, error);
  };
}
