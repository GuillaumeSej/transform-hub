/**
 * Client fin pour le backend admin séparé (`admin-api/`, base URL `NEXT_PUBLIC_ADMIN_API_BASE_URL`)
 * — les deux seules opérations qui doivent passer par ce service plutôt que par Firestore
 * directement : renommer un compte (identifiant + mot de passe, qui touchent Firebase Auth, pas
 * seulement le profil Firestore) et supprimer un compte (idem, pour que le compte Firebase Auth
 * soit réellement supprimé et pas seulement le document Firestore). Voir UsersPanel.tsx.
 *
 * `NEXT_PUBLIC_ADMIN_API_BASE_URL` peut être vide en dev local (ce service n'existe pas forcément
 * en local) — dans ce cas on échoue explicitement avec un message clair plutôt que de laisser
 * `fetch("/admin/...")` planter sur une URL relative absurde.
 */

export type AdminApiErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "internal_error"
  | "network_error"
  | "not_configured";

export class AdminApiError extends Error {
  code: AdminApiErrorCode;

  constructor(code: AdminApiErrorCode, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.code = code;
  }
}

function getBaseUrl(): string {
  const base = process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL;
  if (!base) {
    throw new AdminApiError(
      "not_configured",
      "Le service d'administration des comptes n'est pas configuré (NEXT_PUBLIC_ADMIN_API_BASE_URL manquant)."
    );
  }
  return base.replace(/\/+$/, "");
}

async function postAdminApi<TBody extends object>(
  path: string,
  idToken: string,
  body: TBody
): Promise<void> {
  const base = getBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError(
      "network_error",
      "Impossible de joindre le service d'administration des comptes. Vérifiez votre connexion et réessayez."
    );
  }

  let data: { ok?: boolean; error?: AdminApiErrorCode; message?: string } | null = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok || !data?.ok) {
    const code = data?.error ?? "internal_error";
    const message = data?.message ?? "Erreur inconnue du service d'administration des comptes.";
    throw new AdminApiError(code, message);
  }
}

/**
 * Renomme un compte utilisateur (identifiant applicatif + éventuellement mot de passe) côté
 * Firebase Auth ET Firestore, via le backend admin. `newPassword` omis = mot de passe inchangé.
 */
export async function renameUser(
  idToken: string,
  params: {
    oldUsername: string;
    newUsername: string;
    companyId: string | null;
    newPassword?: string;
  }
): Promise<void> {
  await postAdminApi("/admin/rename-user", idToken, params);
}

/** Supprime le compte Firebase Auth ET le profil Firestore d'un utilisateur, via le backend admin. */
export async function deleteUserAccount(
  idToken: string,
  params: { username: string; companyId: string | null }
): Promise<void> {
  await postAdminApi("/admin/delete-user", idToken, params);
}
