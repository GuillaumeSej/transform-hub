import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { accountSlugFromEmail } from "./authLogic";
import { Errors } from "./errors";

type CallerProfile = {
  uid: string;
  slug: string;
  username: string;
  role: string;
  companyId: string | null;
};

/**
 * Verifies the caller's Firebase ID token, resolves their `adminUsers` profile (same slug logic
 * as the frontend), and checks they are authorized to act on `targetCompanyId`:
 *  - role "admin" (global) is always authorized.
 *  - role "admin_entreprise" is authorized only when their own companyId matches targetCompanyId.
 * Throws an ApiError (401/403) otherwise — callers should let it propagate to the error handler.
 */
export async function authorizeAdminCaller(
  auth: Auth,
  db: Firestore,
  authorizationHeader: string | undefined,
  targetCompanyId: string | null
): Promise<CallerProfile> {
  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    throw Errors.unauthenticated("En-tête Authorization Bearer manquant.");
  }
  const idToken = authorizationHeader.slice("Bearer ".length).trim();
  if (!idToken) {
    throw Errors.unauthenticated("Jeton d'authentification manquant.");
  }

  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch {
    throw Errors.unauthenticated("Jeton d'authentification invalide ou expiré.");
  }

  const callerEmail = decoded.email;
  if (!callerEmail) {
    throw Errors.unauthenticated("Le compte authentifié n'a pas d'e-mail associé.");
  }

  const slug = accountSlugFromEmail(callerEmail);
  const snap = await db.collection("adminUsers").doc(slug).get();
  if (!snap.exists) {
    throw Errors.forbidden("Profil administrateur introuvable pour ce compte.");
  }

  const data = snap.data() as {
    username?: string;
    role?: string;
    companyId?: string | null;
    isGlobalAdmin?: boolean;
    isCompanyAdmin?: boolean;
  };
  const role = data.role;
  const companyId = data.companyId ?? null;

  // Compatible avec les deux formats de doc `adminUsers` : nouveau (`isGlobalAdmin`/
  // `isCompanyAdmin` booléens) et legacy (`role` scalaire "admin"/"admin_entreprise") — pas de
  // migration forcée, voir lib/auth.ts:resolveAuthUserProfile pour le même raisonnement côté
  // lecture client.
  const isGlobalAdmin = data.isGlobalAdmin === true || role === "admin";
  const isCompanyAdminForTarget =
    (data.isCompanyAdmin === true || role === "admin_entreprise") &&
    targetCompanyId !== null &&
    companyId === targetCompanyId;

  if (!isGlobalAdmin && !isCompanyAdminForTarget) {
    throw Errors.forbidden(
      "Seul un administrateur global ou un administrateur de cette entreprise peut effectuer cette action."
    );
  }

  return { uid: decoded.uid, slug, username: data.username ?? slug, role: role ?? "", companyId };
}
