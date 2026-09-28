/**
 * Traduction d'une erreur d'écriture (Firestore / Firebase / réseau) en message utilisateur clair.
 *
 * Logique PURE (aucune dépendance Firebase ni React) : utilisée par les mutations optimistes de
 * `useBeTrackData` (lib/hooks/useStorage.ts) pour le toast d'échec affiché après rollback, et par
 * `useApprovalErrorToast` pour les flux stratégiques — au lieu d'un `console.error` silencieux ou
 * du message brut anglais du SDK (« Missing or insufficient permissions. »).
 */

export type SaveErrorKind = "permission" | "network" | "other";

/** Codes Firestore/Firebase Auth considérés comme un refus de droits. */
const PERMISSION_CODES = new Set(["permission-denied", "unauthenticated"]);
/** Codes considérés comme une perte de connexion / service injoignable. */
const NETWORK_CODES = new Set(["unavailable", "deadline-exceeded", "network-request-failed"]);

/** Code Firebase normalisé (`"firestore/permission-denied"` / `"auth/…"` → partie après le `/`),
 *  ou `null` si l'erreur n'en porte pas. */
export function firebaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== "string" || code === "") return null;
  const slash = code.lastIndexOf("/");
  return slash >= 0 ? code.slice(slash + 1) : code;
}

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/** Nature d'une erreur d'écriture : droits, réseau, ou autre. `online` (défaut : `navigator.onLine`
 *  quand disponible) permet de classer « réseau » une erreur quelconque survenue hors ligne. */
export function saveErrorKind(error: unknown, online?: boolean): SaveErrorKind {
  const code = firebaseErrorCode(error);
  if (code && PERMISSION_CODES.has(code)) return "permission";
  if (code && NETWORK_CODES.has(code)) return "network";
  const text = errorText(error).toLowerCase();
  if (text.includes("missing or insufficient permissions") || text.includes("permission denied"))
    return "permission";
  if (
    text.includes("client is offline") ||
    text.includes("failed to fetch") ||
    text.includes("networkerror") ||
    text.includes("network error") ||
    text.includes("network request failed")
  )
    return "network";
  const isOnline =
    online ??
    (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine
      : true);
  if (!isOnline) return "network";
  return "other";
}

/** Libellés (clé i18n + texte français de repli) du toast d'échec d'enregistrement. */
export const SAVE_ERROR_LABELS = {
  title: { key: "saveError.title", fallback: "Échec de l'enregistrement" },
  permission: {
    key: "saveError.permission",
    fallback: "Vous n'avez pas le droit d'effectuer cette modification",
  },
  network: { key: "saveError.network", fallback: "Connexion perdue, modification non enregistrée" },
  other: {
    key: "saveError.generic",
    fallback: "La modification n'a pas pu être enregistrée. Réessayez.",
  },
} as const;

type Translate = (key: string, fallback?: string) => string;
const identity: Translate = (_key, fallback) => fallback ?? _key;

/** Titre + message du toast d'échec pour `error`. `t` : fonction de traduction (`useTranslation`),
 *  par défaut les textes français. */
export function saveErrorToast(
  error: unknown,
  t: Translate = identity,
  online?: boolean
): { title: string; message: string; kind: SaveErrorKind } {
  const kind = saveErrorKind(error, online);
  const label = SAVE_ERROR_LABELS[kind];
  return {
    title: t(SAVE_ERROR_LABELS.title.key, SAVE_ERROR_LABELS.title.fallback),
    message: t(label.key, label.fallback),
    kind,
  };
}

/** true si `error` provient du SDK Firebase (porte un code) ou ressemble à une erreur réseau/droits
 *  — utile aux appelants qui ne veulent remplacer QUE ces erreurs techniques et garder le message
 *  des erreurs métier (ex. `ApprovalForbiddenError`). */
export function isTechnicalSaveError(error: unknown, online?: boolean): boolean {
  return firebaseErrorCode(error) !== null || saveErrorKind(error, online) !== "other";
}

// Erreurs déjà signalées à l'utilisateur (toast affiché par la couche de persistance, voir
// `trackSave` dans lib/hooks/useStorage.ts) — permet à un appelant qui attend la même promesse
// de ne pas afficher un second toast d'erreur. WeakSet : aucune fuite mémoire.
const reportedErrors = new WeakSet<object>();

/** Marque `error` comme déjà signalée (toast affiché). Sans effet pour une valeur non-objet. */
export function markSaveErrorReported(error: unknown): void {
  if (error && typeof error === "object") reportedErrors.add(error);
}

/** true si `error` a déjà fait l'objet d'un toast d'erreur (voir `markSaveErrorReported`). */
export function isSaveErrorReported(error: unknown): boolean {
  return !!error && typeof error === "object" && reportedErrors.has(error);
}
