/**
 * BeTrack admin-api — privileged Firebase Auth admin operations (rename/delete a user account)
 * that the statically-exported Next.js client cannot safely perform.
 *
 * PORTABILITY: this is a plain, framework-light Express app. All configuration comes from env
 * vars (PORT, ALLOWED_ORIGIN, FIREBASE_SERVICE_ACCOUNT_JSON), it is entirely stateless (no local
 * file writes, no in-memory session state beyond the rate limiter), and it uses no Render-specific
 * SDK or API anywhere. The exact same Docker image built from this directory can run unmodified on
 * Azure Container Apps or Azure App Service for Containers — see README.md "Migrating to Azure".
 */
import "dotenv/config"; // local dev only: loads .env if present, no-op otherwise (Render/Azure inject env vars directly)
import express from "express";
import { initFirebaseAdmin } from "./lib/firebaseAdmin";
import { buildCors } from "./lib/cors";
import { requestLogger } from "./lib/requestLogger";
import { adminActionLimiter } from "./lib/rateLimit";
import { renameUserRouter } from "./routes/renameUser";
import { deleteUserRouter } from "./routes/deleteUser";

function main() {
  const { auth, db } = initFirebaseAdmin();

  const app = express();
  app.disable("x-powered-by");
  app.use(requestLogger);
  app.use(buildCors());
  app.use(express.json({ limit: "64kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.use("/admin", adminActionLimiter, renameUserRouter(auth, db));
  app.use("/admin", adminActionLimiter, deleteUserRouter(auth, db));

  // CORS errors thrown by the origin callback, and any other uncaught error, land here rather
  // than crashing the process or leaking a stack trace to the client.
  app.use(
    // Express only treats a 4-arg handler as an error middleware; `_next` must stay in the
    // signature even though it's unused.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(
        JSON.stringify({
          msg: "unhandled_express_error",
          error: err instanceof Error ? err.message : String(err),
        })
      );
      if (res.headersSent) return;
      res
        .status(500)
        .json({ ok: false, error: "internal_error", message: "Erreur interne du serveur." });
    }
  );

  const port = Number(process.env.PORT) || 8080;
  app.listen(port, () => {
    console.log(JSON.stringify({ msg: "admin_api_started", port }));
  });
}

main();
