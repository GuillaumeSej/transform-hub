/**
 * MIRROR of transform-hub/lib/auth.ts (usernameToSyntheticEmail / accountSlug / normalizeUsername).
 *
 * This backend must compute the EXACT same synthetic emails and Firestore doc ids as the
 * frontend, byte for byte, or renames/deletes here would target the wrong Firebase Auth user or
 * the wrong `adminUsers` document. Any change to the frontend's lib/auth.ts MUST be mirrored here.
 *
 * Convention (see the frontend file for the full rationale):
 *  - `${username}@betrack.local` for a GLOBAL admin account (companyId null/omitted).
 *  - `${username}.${companyId}@betrack.local` for a COMPANY account.
 *  - The local part of that email (before "@") is also the `adminUsers/{accountSlug}` doc id.
 */

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function usernameToSyntheticEmail(username: string, companyId?: string | null): string {
  const normalized = normalizeUsername(username);
  return companyId ? `${normalized}.${companyId}@betrack.local` : `${normalized}@betrack.local`;
}

export function accountSlug(username: string, companyId?: string | null): string {
  const normalized = normalizeUsername(username);
  return companyId ? `${normalized}.${companyId}` : normalized;
}

/** Inverse: accountSlug (= local part of the synthetic email) from a full Firebase Auth email. */
export function accountSlugFromEmail(email: string): string {
  return email.split("@")[0];
}
