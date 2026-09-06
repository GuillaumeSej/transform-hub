import cors from "cors";

/**
 * Only allows the origin(s) configured via `ALLOWED_ORIGIN` (comma-separated). Defaults to
 * permissive `*` ONLY when unset AND NODE_ENV !== "production" (local dev convenience) —
 * otherwise the env var is required and every other origin is rejected.
 */
export function buildCors() {
  const raw = process.env.ALLOWED_ORIGIN;
  const isProd = process.env.NODE_ENV === "production";

  if (!raw || !raw.trim()) {
    if (isProd) {
      throw new Error(
        "ALLOWED_ORIGIN must be set in production (comma-separated list of allowed origins)."
      );
    }
    console.warn("[admin-api] ALLOWED_ORIGIN not set — allowing all origins (dev only).");
    return cors({ origin: "*" });
  }

  const allowed = raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  return cors({
    origin(origin, callback) {
      // No Origin header (curl, server-to-server, health checks) — allow.
      if (!origin) return callback(null, true);
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error(`Origin not allowed: ${origin}`));
    },
  });
}
