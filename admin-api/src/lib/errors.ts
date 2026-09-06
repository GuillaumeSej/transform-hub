export type ErrorCode =
  "unauthenticated" | "forbidden" | "not_found" | "conflict" | "invalid_input" | "internal_error";

export class ApiError extends Error {
  status: number;
  code: ErrorCode;

  constructor(status: number, code: ErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const Errors = {
  unauthenticated: (message = "Authentification requise ou jeton invalide.") =>
    new ApiError(401, "unauthenticated", message),
  forbidden: (message = "Vous n'avez pas les droits nécessaires pour cette action.") =>
    new ApiError(403, "forbidden", message),
  notFound: (message = "Utilisateur introuvable.") => new ApiError(404, "not_found", message),
  conflict: (message = "Ce nom d'utilisateur est déjà utilisé.") =>
    new ApiError(409, "conflict", message),
  invalidInput: (message = "Requête invalide.") => new ApiError(400, "invalid_input", message),
  internal: (message = "Erreur interne du serveur.") =>
    new ApiError(500, "internal_error", message),
};

export function errorBody(err: ApiError) {
  return { ok: false as const, error: err.code, message: err.message };
}
