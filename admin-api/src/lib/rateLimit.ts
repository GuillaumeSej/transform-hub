import rateLimit from "express-rate-limit";

/**
 * Simple in-memory per-IP limiter for the two privileged POST routes. This is a low-traffic admin
 * tool (a handful of admins renaming/deleting accounts) — no Redis/shared store needed. Being
 * in-memory means limits reset on redeploy/restart and don't share state across multiple
 * instances, which is an accepted tradeoff here (see README "Scaling" note if that ever changes).
 */
export const adminActionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: "internal_error",
    message: "Trop de requêtes, réessayez plus tard.",
  },
});
