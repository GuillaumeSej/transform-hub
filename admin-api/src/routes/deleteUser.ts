import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { Router } from "express";
import { authorizeAdminCaller } from "../lib/authz";
import { normalizeUsername, usernameToSyntheticEmail, accountSlug } from "../lib/authLogic";
import { deleteUserSchema } from "../lib/validation";
import { ApiError, Errors, errorBody } from "../lib/errors";
import { writeAuditEntry } from "../lib/audit";

export function deleteUserRouter(auth: Auth, db: Firestore): Router {
  const router = Router();

  router.post("/delete-user", async (req, res) => {
    try {
      const parsed = deleteUserSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidInput("Corps de requête invalide : username et companyId sont requis.");
      }
      const { username } = parsed.data;
      const companyId = parsed.data.companyId ?? null;

      const caller = await authorizeAdminCaller(auth, db, req.headers.authorization, companyId);

      const email = usernameToSyntheticEmail(username, companyId);

      let targetUser;
      try {
        targetUser = await auth.getUserByEmail(email);
      } catch {
        throw Errors.notFound(`Aucun compte trouvé pour l'utilisateur "${username}".`);
      }

      try {
        await auth.deleteUser(targetUser.uid);
      } catch {
        throw Errors.internal("Échec de la suppression du compte Firebase Auth.");
      }

      const slug = accountSlug(username, companyId);
      try {
        await db.collection("adminUsers").doc(slug).delete();
      } catch (err) {
        // Auth account is already gone at this point; log clearly rather than silently losing the
        // Firestore doc — a stray adminUsers doc is far less harmful than a duplicate/ghost Auth
        // account, so we do not attempt to recreate the Auth user here.
        console.error(
          JSON.stringify({
            msg: "delete_user_firestore_cleanup_failed",
            slug,
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }

      await writeAuditEntry(db, {
        ts: new Date().toISOString(),
        action: "delete_user",
        actorUsername: caller.username,
        actorUid: caller.uid,
        targetOldUsername: normalizeUsername(username),
        companyId,
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.status).json(errorBody(err));
        return;
      }
      console.error(
        JSON.stringify({
          msg: "delete_user_unhandled_error",
          error: err instanceof Error ? err.message : String(err),
        })
      );
      const internal = Errors.internal();
      res.status(internal.status).json(errorBody(internal));
    }
  });

  return router;
}
