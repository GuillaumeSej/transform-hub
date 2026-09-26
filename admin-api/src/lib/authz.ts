import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { accountSlugFromEmail } from "./authLogic";
import { Errors } from "./errors";
import { accountActionDenial, type AccountAction, type AccountFlags } from "./accountRules";

type CallerProfile = {
  uid: string;
  slug: string;
  username: string;
  role: string;
  companyId: string | null;
  /** Admin BearingPoint (global) — seul habilité à agir sur un compte lui-même admin global. */
  isGlobalAdmin: boolean;
};

type TargetAccountData = ({ isGlobalAdmin?: boolean } & AccountFlags) | undefined;

/** Le document `adminUsers` cible porte-t-il l'habilitation admin BearingPoint (global) —
 *  nouveau format `isGlobalAdmin` ou legacy `role: "admin"` ? */
export function isGlobalAdminAccount(data: TargetAccountData): boolean {
  return data?.isGlobalAdmin === true || data?.role === "admin";
}

/**
 * Verrou d'élévation : un admin d'ENTREPRISE ne peut jamais agir (renommer, changer le mot de
 * passe, supprimer, désactiver, générer un lien de réinitialisation) sur un compte admin global —
 * sinon il pourrait prendre la main sur un compte BearingPoint. Seul un admin global le peut.
 * Même garde-fou côté règles Firestore (firestore.rules, `adminUsers`).
 */
export function assertCanActOnTarget(caller: CallerProfile, targetData: TargetAccountData): void {
  if (!caller.isGlobalAdmin && isGlobalAdminAccount(targetData)) {
    throw Errors.forbidden(
      "Seul un administrateur global peut agir sur un compte administrateur global."
    );
  }
}

/**
 * Garde-fous complets avant toute action sur un compte (voir `accountRules.ts::accountActionDenial`) :
 * verrou admin global (`assertCanActOnTarget`), jamais de suppression/désactivation de son propre
 * compte, et protection des PAIRS admins d'entreprise (un admin d'entreprise ne supprime, ne
 * désactive/réactive, ne renomme ni ne réinitialise le mot de passe d'un autre admin d'entreprise) —
 * même protection que firestore.rules (`adminUsers`). 403 sinon.
 */
export function assertCanManageAccount(
  caller: CallerProfile,
  targetSlug: string,
  targetData: TargetAccountData,
  action: AccountAction
): void {
  assertCanActOnTarget(caller, targetData);
  const denial = accountActionDenial(caller, targetSlug, targetData, action);
  if (denial) throw Errors.forbidden(denial);
}

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
    disabled?: boolean;
  };
  // Un compte désactivé (flag `disabled`, voir routes/setUserDisabled.ts) ne peut plus rien
  // administrer, même si son jeton Firebase n'a pas encore expiré.
  if (data.disabled === true) {
    throw Errors.forbidden("Ce compte est désactivé.");
  }
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

  return {
    uid: decoded.uid,
    slug,
    username: data.username ?? slug,
    role: role ?? "",
    companyId,
    isGlobalAdmin,
  };
}
