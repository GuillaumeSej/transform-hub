import { cert, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let app: App;

/**
 * Initializes firebase-admin from a single stringified-JSON env var (`FIREBASE_SERVICE_ACCOUNT_JSON`)
 * — the standard way to hand a service account to a container platform (Render, Azure Container
 * Apps, ...) without committing a file to the repo. Fails fast and loudly on boot if the env var is
 * missing or not valid JSON: an admin API silently unable to reach Firebase is worse than one that
 * never starts.
 */
export function initFirebaseAdmin(): { app: App; auth: Auth; db: Firestore } {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is not set. Paste the full service account JSON " +
        "(Firebase Console → Project Settings → Service Accounts → Generate new private key) " +
        "as a single-line string into this env var."
    );
  }

  let serviceAccount: Record<string, unknown>;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON. " +
        "Make sure it is the raw service account JSON collapsed to a single line " +
        "(e.g. via JSON.stringify), not a file path."
    );
  }

  app = initializeApp({ credential: cert(serviceAccount as never) });
  return { app, auth: getAuth(app), db: getFirestore(app) };
}
