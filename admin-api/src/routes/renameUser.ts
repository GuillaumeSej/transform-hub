import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { Router } from "express";
import { assertCanManageAccount, authorizeAdminCaller } from "../lib/authz";
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
      // Verrou d'élévation, vérifié AVANT toute modification Auth : le document est recopié tel
      // quel (seul `username` change), donc aucun champ d'habilitation ne peut être injecté ici —
      // mais un admin d'entreprise ne doit pas pouvoir renommer/changer le mot de passe d'un
      // compte admin global, ni (admin d'entreprise) ceux d'un AUTRE admin d'entreprise.
      const preSlug = accountSlug(oldUsername, companyId);
      const preSnap = await db.collection("adminUsers").doc(preSlug).get();
      assertCanManageAccount(caller, preSlug, preSnap.data(), "rename");

      const oldEmail = usernameToSyntheticEmail(oldUsername, companyId);
      const newEmail = usernameToSyntheticEmail(newUsername, companyId);

      // d. Resolve the target Auth user. Certains profils Firestore n'ont volontairement AUCUN
      // compte Firebase Auth associé (ex. les "owners" créés par un script de seed — pickers
      // uniquement, jamais destinés à se connecter, voir scripts/seed-strategic-demo.js). Avant,
      // ce cas faisait échouer tout renommage/changement de mot de passe avec une erreur "Aucun
      // compte trouvé" ; on le traite maintenant comme la création du tout premier compte Auth de
      // cet utilisateur, plutôt que d'échouer.
      let targetUser;
      let authAccountExisted = true;
      try {
        targetUser = await auth.getUserByEmail(oldEmail);
      } catch {
        authAccountExisted = false;
      }
      let uid = targetUser?.uid;

      if (!authAccountExisted) {
        if (!newPassword) {
          // Rien à faire côté Auth : pas de compte existant, pas de mot de passe fourni pour en
          // créer un — on se contente de la mise à jour Firestore ci-dessous (étape g).
          uid = undefined;
        } else {
          try {
            const created = await auth.createUser({ email: newEmail, password: newPassword });
            uid = created.uid;
          } catch (err) {
            if (isFirebaseErrorCode(err, "auth/email-already-exists")) {
              throw Errors.conflict(
                `Le nom d'utilisateur "${newUsername}" est déjà utilisé par un autre compte.`
              );
            }
            throw Errors.internal("Échec de la création du compte Firebase Auth.");
          }
        }
      } else {
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
          await auth.updateUser(uid as string, {
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
        // Auth succeeded but Firestore failed: roll back so we never leave Auth and Firestore
        // inconsistent. Two cases: an existing Auth account had its email changed (roll back the
        // email), or a brand-new Auth account was just created for a previously Auth-less user
        // (delete it — there was nothing to roll back to).
        try {
          if (uid) {
            if (authAccountExisted) {
              await auth.updateUser(uid, { email: oldEmail });
            } else {
              await auth.deleteUser(uid);
            }
          }
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
