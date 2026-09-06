import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { Router } from "express";
import { authorizeAdminCaller } from "../lib/authz";
import { normalizeUsername, usernameToSyntheticEmail, accountSlug } from "../lib/authLogic";
import { renameUserSchema } from "../lib/validation";
import { ApiError, Errors, errorBody } from "../lib/errors";
import { writeAuditEntry } from "../lib/audit";

function isFirebaseErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === code
  );
}

export function renameUserRouter(auth: Auth, db: Firestore): Router {
  const router = Router();

  router.post("/rename-user", async (req, res) => {
    try {
      const parsed = renameUserSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidInput(
          "Corps de requête invalide : oldUsername, newUsername et companyId sont requis."
        );
      }
      const { oldUsername, newUsername, newPassword } = parsed.data;
      const companyId = parsed.data.companyId ?? null;

      const caller = await authorizeAdminCaller(auth, db, req.headers.authorization, companyId);

      const oldEmail = usernameToSyntheticEmail(oldUsername, companyId);
      const newEmail = usernameToSyntheticEmail(newUsername, companyId);

      // d. Resolve the target Auth user.
      let targetUser;
      try {
        targetUser = await auth.getUserByEmail(oldEmail);
      } catch {
        throw Errors.notFound(`Aucun compte trouvé pour l'utilisateur "${oldUsername}".`);
      }
      const uid = targetUser.uid;

      // e. Reject if newEmail already belongs to a DIFFERENT Firebase Auth user.
      if (normalizeUsername(oldUsername) !== normalizeUsername(newUsername)) {
        try {
          const existing = await auth.getUserByEmail(newEmail);
          if (existing.uid !== uid) {
            throw Errors.conflict(
              `Le nom d'utilisateur "${newUsername}" est déjà utilisé par un autre compte.`
            );
          }
        } catch (err) {
          if (err instanceof ApiError) throw err;
          // getUserByEmail throws auth/user-not-found when free — that's the expected happy path.
        }
      }

      // f. Update Firebase Auth email (and password if provided).
      try {
        await auth.updateUser(uid, {
          email: newEmail,
          ...(newPassword ? { password: newPassword } : {}),
        });
      } catch (err) {
        if (isFirebaseErrorCode(err, "auth/email-already-exists")) {
          throw Errors.conflict(
            `Le nom d'utilisateur "${newUsername}" est déjà utilisé par un autre compte.`
          );
        }
        throw Errors.internal("Échec de la mise à jour du compte Firebase Auth.");
      }

      // g. Move the Firestore adminUsers doc atomically (old -> new), only after (f) succeeded.
      const oldSlug = accountSlug(oldUsername, companyId);
      const newSlug = accountSlug(newUsername, companyId);
      try {
        const oldRef = db.collection("adminUsers").doc(oldSlug);
        const newRef = db.collection("adminUsers").doc(newSlug);
        const oldSnap = await oldRef.get();
        if (!oldSnap.exists) {
          throw Errors.notFound(`Profil Firestore introuvable pour "${oldUsername}".`);
        }
        const oldData = oldSnap.data() ?? {};
        const newData = { ...oldData, username: normalizeUsername(newUsername) };

        const batch = db.batch();
        batch.set(newRef, newData);
        if (oldSlug !== newSlug) {
          batch.delete(oldRef);
        }
        await batch.commit();
      } catch (err) {
        // Auth succeeded but Firestore failed: roll back the Auth email change so we never leave
        // Auth and Firestore inconsistent.
        try {
          await auth.updateUser(uid, { email: oldEmail });
        } catch (rollbackErr) {
          console.error(
            JSON.stringify({
              msg: "rename_user_rollback_failed",
              uid,
              error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
            })
          );
        }
        if (err instanceof ApiError) throw err;
        throw Errors.internal("Échec de la mise à jour du profil Firestore, opération annulée.");
      }

      // h. Audit log.
      await writeAuditEntry(db, {
        ts: new Date().toISOString(),
        action: "rename_user",
        actorUsername: caller.username,
        actorUid: caller.uid,
        targetOldUsername: normalizeUsername(oldUsername),
        targetNewUsername: normalizeUsername(newUsername),
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
          msg: "rename_user_unhandled_error",
          error: err instanceof Error ? err.message : String(err),
        })
      );
      const internal = Errors.internal();
      res.status(internal.status).json(errorBody(internal));
    }
  });

  return router;
}
