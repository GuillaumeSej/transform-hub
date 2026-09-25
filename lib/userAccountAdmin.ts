import type { AuthUser } from "@/types";
import { accountSlug } from "@/lib/auth";

/**
 * Helpers PURS (sans React ni Firebase) de la gestion des comptes par un admin (global ou
 * d'entreprise) — voir components/admin/UsersPanel.tsx. Les garde-fous de désactivation sont
 * dupliqués côté backend (admin-api/src/lib/accountRules.ts), qui reste l'autorité : ici ils ne
 * servent qu'à griser/expliquer l'action dans l'UI.
 */

/** Format d'e-mail volontairement simple (un "@", un domaine avec un point, aucun espace) : on ne
 *  valide qu'une adresse de CONTACT saisie par un admin, pas un identifiant de connexion. */
const CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** E-mail de contact réel (`AuthUser.email`) — optionnel : une chaîne vide est valide. */
export function isValidContactEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed === "" || CONTACT_EMAIL_RE.test(trimmed);
}

type AccountLike = Pick<AuthUser, "username" | "companyId" | "isCompanyAdmin" | "disabled"> & {
  /** Documents `adminUsers` legacy (avant le round multi-profils) : rôle scalaire. */
  role?: string;
};

/** Admin d'entreprise ACTIF (nouveau format `isCompanyAdmin` ou legacy `role`). */
export function isActiveCompanyAdmin(u: AccountLike): boolean {
  return (u.isCompanyAdmin === true || u.role === "admin_entreprise") && u.disabled !== true;
}

export type DisableBlockReason = "self" | "lastCompanyAdmin";

/**
 * Raison pour laquelle `target` ne peut PAS être désactivé par `viewer`, ou `null` si l'action est
 * permise. `companyUsers` = comptes de la même entreprise que la cible (cible comprise).
 *  - "self" : un admin ne se désactive jamais lui-même (il perdrait l'accès immédiatement).
 *  - "lastCompanyAdmin" : la cible est le dernier admin d'entreprise actif — l'entreprise
 *    n'aurait plus personne pour gérer ses comptes.
 */
export function disableBlockReason(
  target: AccountLike,
  companyUsers: AccountLike[],
  viewer: Pick<AuthUser, "username" | "companyId"> | null | undefined
): DisableBlockReason | null {
  const targetSlug = accountSlug(target.username, target.companyId);
  if (viewer && accountSlug(viewer.username, viewer.companyId) === targetSlug) return "self";
  if (target.companyId && isActiveCompanyAdmin(target)) {
    const others = companyUsers.filter(
      (u) =>
        u.companyId === target.companyId &&
        accountSlug(u.username, u.companyId) !== targetSlug &&
        isActiveCompanyAdmin(u)
    );
    if (others.length === 0) return "lastCompanyAdmin";
  }
  return null;
}

export type UserStatusFilter = "all" | "active" | "disabled";

export function filterUsersByStatus<T extends Pick<AuthUser, "disabled">>(
  users: T[],
  status: UserStatusFilter
): T[] {
  if (status === "active") return users.filter((u) => u.disabled !== true);
  if (status === "disabled") return users.filter((u) => u.disabled === true);
  return users;
}

/**
 * Lien `mailto:` pré-rempli (en français) pour transmettre un lien de réinitialisation à
 * l'e-mail de contact RÉEL de l'utilisateur. Nécessaire parce que les comptes Firebase Auth
 * utilisent des e-mails synthétiques (`…@betrack.local`) qui ne reçoivent aucun courrier — Firebase
 * ne peut donc pas envoyer lui-même l'e-mail de réinitialisation.
 */
export function buildPasswordResetMailto(params: {
  email: string;
  displayName: string;
  username: string;
  link: string;
}): string {
  const subject = "BeTrack — définissez votre mot de passe";
  const greeting = params.displayName.trim() ? `Bonjour ${params.displayName.trim()},` : "Bonjour,";
  const body = [
    greeting,
    "",
    `Votre identifiant de connexion BeTrack est : ${params.username}`,
    "",
    "Pour définir votre mot de passe, ouvrez le lien ci-dessous (à usage unique, valable pour une durée limitée) :",
    params.link,
    "",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message et prévenez votre administrateur.",
  ].join("\n");
  return `mailto:${encodeURIComponent(params.email.trim())}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

/**
 * Mot de passe aléatoire fort, jamais affiché ni communiqué : utilisé pour créer le compte
 * Firebase Auth d'un nouvel utilisateur, qui définit ensuite lui-même son mot de passe via le lien
 * de réinitialisation. `getRandomValues` (Web Crypto) : disponible dans le navigateur et Node ≥ 19.
 */
export function generateRandomPassword(length = 32): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!@#%";
  const bytes = new Uint32Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}
