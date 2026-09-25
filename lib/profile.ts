import type { AuthUser, Company, Program } from "@/types";
import { roles } from "@/lib/nav-config";
import { isAnyAdmin } from "@/lib/roleProfiles";
import { levelRank } from "@/lib/confidentiality";
import { resolveConfidentialityClearance } from "@/lib/leversLogic";

/**
 * Logique PURE de la page « Mon profil » (app/(app)/profile/page.tsx) — validation du changement
 * de mot de passe, traduction des erreurs Firebase Auth, résumé des profils et de l'habilitation de
 * confidentialité. Aucun import Firebase ici : testable sans mock (lib/__tests__/profile.test.ts).
 */

/** Longueur minimale d'un mot de passe — alignée sur la politique par défaut de Firebase Auth
 *  (6 caractères, rejet `auth/weak-password` en dessous) et sur `MIN_PASSWORD_LENGTH` du
 *  formulaire admin (components/admin/UsersPanel.tsx), pour qu'un utilisateur ne puisse pas se
 *  voir imposer une règle différente de celle appliquée par son administrateur. */
export const PROFILE_MIN_PASSWORD_LENGTH = 6;

export type PasswordChangeInput = {
  current: string;
  next: string;
  confirm: string;
};

export type PasswordChangeErrorCode =
  "currentRequired" | "nextRequired" | "tooShort" | "sameAsCurrent" | "mismatch";

/** Erreurs de validation CÔTÉ CLIENT, par champ (au plus une par champ, la plus pertinente). Un
 *  objet vide = formulaire valide. Aucune normalisation (trim) : un mot de passe peut légitimement
 *  contenir des espaces, on compare les valeurs saisies telles quelles. */
export function validatePasswordChange(
  input: PasswordChangeInput,
  minLength: number = PROFILE_MIN_PASSWORD_LENGTH
): Partial<Record<keyof PasswordChangeInput, PasswordChangeErrorCode>> {
  const errors: Partial<Record<keyof PasswordChangeInput, PasswordChangeErrorCode>> = {};
  if (input.current.length === 0) errors.current = "currentRequired";
  if (input.next.length === 0) errors.next = "nextRequired";
  else if (input.next.length < minLength) errors.next = "tooShort";
  else if (input.current.length > 0 && input.next === input.current) errors.next = "sameAsCurrent";
  if (input.next.length > 0 && input.confirm !== input.next) errors.confirm = "mismatch";
  return errors;
}

/** Libellé (clé i18n + repli français) d'une erreur de validation — `{n}` = longueur minimale. */
export const PASSWORD_ERROR_MESSAGES: Record<
  PasswordChangeErrorCode,
  { key: string; fallback: string }
> = {
  currentRequired: {
    key: "profile.password.errorCurrentRequired",
    fallback: "Saisissez votre mot de passe actuel.",
  },
  nextRequired: {
    key: "profile.password.errorNextRequired",
    fallback: "Saisissez un nouveau mot de passe.",
  },
  tooShort: {
    key: "profile.password.errorTooShort",
    fallback: "Le mot de passe doit contenir au moins {n} caractères.",
  },
  sameAsCurrent: {
    key: "profile.password.errorSameAsCurrent",
    fallback: "Le nouveau mot de passe doit être différent de l'actuel.",
  },
  mismatch: {
    key: "profile.password.errorMismatch",
    fallback: "La confirmation ne correspond pas au nouveau mot de passe.",
  },
};

/** Traduit une erreur levée par `reauthenticateWithCredential`/`updatePassword` en message
 *  (clé i18n + repli français). Les codes Firebase varient selon la version du SDK et le réglage
 *  « protection contre l'énumération d'e-mails » : un mauvais mot de passe actuel remonte en
 *  `auth/wrong-password` OU `auth/invalid-credential` / `auth/invalid-login-credentials`. */
export function passwordChangeErrorMessage(err: unknown): { key: string; fallback: string } {
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return {
        key: "profile.password.errorWrongCurrent",
        fallback: "Le mot de passe actuel est incorrect.",
      };
    case "auth/weak-password":
      return {
        key: "profile.password.errorWeak",
        fallback: "Ce mot de passe est trop faible. Choisissez-en un plus long.",
      };
    case "auth/too-many-requests":
      return {
        key: "profile.password.errorTooMany",
        fallback: "Trop de tentatives. Réessayez dans quelques minutes.",
      };
    case "auth/requires-recent-login":
    case "auth/user-token-expired":
      return {
        key: "profile.password.errorRecentLogin",
        fallback:
          "Votre session a expiré. Déconnectez-vous puis reconnectez-vous avant de réessayer.",
      };
    case "auth/network-request-failed":
      return {
        key: "profile.password.errorNetwork",
        fallback: "Connexion réseau indisponible. Vérifiez votre connexion et réessayez.",
      };
    default:
      return {
        key: "profile.password.errorGeneric",
        fallback: "Le mot de passe n'a pas pu être modifié. Réessayez plus tard.",
      };
  }
}

/** Une ligne « profil » affichable : clé i18n du libellé de rôle + programme éventuel. */
export type ProfileRow = {
  roleLabelKey: string;
  /** Nom du programme ciblé ; `null` = profil « tous programmes » (pas de `programId`). Un
   *  programme introuvable (supprimé, hors périmètre) retombe sur son identifiant brut. */
  programName: string | null;
};

export function describeProfiles(
  user: Pick<AuthUser, "profiles"> | null | undefined,
  programs: Pick<Program, "id" | "name">[]
): ProfileRow[] {
  return (user?.profiles ?? [])
    .filter((p) => !!p.role && !!roles[p.role])
    .map((p) => ({
      roleLabelKey: roles[p.role].label,
      programName: p.programId
        ? (programs.find((program) => program.id === p.programId)?.name ?? p.programId)
        : null,
    }));
}

/** Résumé de l'habilitation de confidentialité EFFECTIVE, pour affichage :
 *  - `admin` : admin global/entreprise, accès total (voir `filterAggregateVisibleLevers`) ;
 *  - `all`   : habilitation individuelle « tous les niveaux » ;
 *  - `level` : niveau le plus haut accessible (et tous ceux en dessous) — sur l'une OU l'autre
 *              piste (Performance/Stratégique), la plus permissive des deux ;
 *  - `none`  : aucun niveau confidentiel accessible.
 *  `source` : `individual` si l'utilisateur a une habilitation propre, `profile` si elle est
 *  héritée de `Company.roleClearance` pour ses profils. */
export type ClearanceSummary =
  | { kind: "admin" }
  | { kind: "all"; source: "individual" }
  | { kind: "level"; level: string; source: "individual" | "profile" }
  | { kind: "none"; source: "individual" | "profile" };

export function summarizeClearance(
  user:
    | Pick<AuthUser, "profiles" | "isGlobalAdmin" | "isCompanyAdmin" | "confidentialityClearance">
    | null
    | undefined,
  company: Pick<Company, "roleClearance" | "confidentialityLevels"> | null | undefined
): ClearanceSummary {
  if (isAnyAdmin(user)) return { kind: "admin" };
  const source = user?.confidentialityClearance !== undefined ? "individual" : "profile";
  if (user?.confidentialityClearance === "all") return { kind: "all", source: "individual" };
  const orderedLevels = company?.confidentialityLevels ?? [];
  let best: string | undefined;
  for (const track of ["performance", "strategic"] as const) {
    const resolved = resolveConfidentialityClearance(
      user,
      company?.roleClearance,
      track,
      orderedLevels
    );
    if (resolved === "all") return { kind: "all", source: "individual" };
    for (const level of resolved) {
      // Sans échelle définie, `resolved` est la liste brute : on garde la première valeur.
      if (best === undefined || levelRank(level, orderedLevels) > levelRank(best, orderedLevels)) {
        best = level;
      }
    }
  }
  return best ? { kind: "level", level: best, source } : { kind: "none", source };
}
