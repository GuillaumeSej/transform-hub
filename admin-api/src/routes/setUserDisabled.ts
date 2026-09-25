import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { Router } from "express";
import { assertCanActOnTarget, authorizeAdminCaller } from "../lib/authz";
import { normalizeUsername, usernameToSyntheticEmail, accountSlug } from "../lib/authLogic";
import { setUserDisabledSchema } from "../lib/validation";
import { ApiError, Errors, errorBody } from "../lib/errors";
import { writeAuditEntry } from "../lib/audit";
import { isLastActiveCompanyAdmin, type AccountFlags } from "../lib/accountRules";

/**
 * Désactive / réactive un compte : flag `disabled` du document `adminUsers` (lu par le client à la
 * connexion, voir lib/auth.ts:resolveAuthUserProfile — c'est ce qui bloque la connexion même si ce
 * service est injoignable) ET flag `disabled` du compte Firebase Auth (bloque l'émission de tout
 * nouveau jeton). À la désactivation, les refresh tokens sont en plus révoqués pour couper les
 * sessions ouvertes dès l'expiration de leur jeton d'ID courant (≤ 1 h).
 * Garde-fous : on ne se désactive pas soi-même, et on ne désactive pas le dernier admin
 * d'entreprise actif (l'entreprise n'aurait plus personne pour gérer ses comptes).
 */
export function setUserDisabledRouter(auth: Auth, db: Firestore): Router {
  const router = Router();

  router.post("/set-user-disabled", async (req, res) => {
    try {
      const parsed = setUserDisabledSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidInput(
          "Corps de requête invalide : username, companyId et disabled (booléen) sont requis."
        );
      }
      const { username, disabled } = parsed.data;
      const companyId = parsed.data.companyId ?? null;

      const caller = await authorizeAdminCaller(auth, db, req.headers.authorization, companyId);

      const slug = accountSlug(username, companyId);
      if (disabled && caller.slug === slug) {
        throw Errors.forbidden("Vous ne pouvez pas désactiver votre propre compte.");
      }

      const ref = db.collection("adminUsers").doc(slug);
      const snap = await ref.get();
      if (!snap.exists) {
        throw Errors.notFound(`Profil Firestore introuvable pour "${username}".`);
      }
      assertCanActOnTarget(caller, snap.data());

      if (disabled && companyId) {
        const companySnap = await db
          .collection("adminUsers")
          .where("companyId", "==", companyId)
          .get();
        const accounts = companySnap.docs.map((d) => ({
          slug: d.id,
          data: d.data() as AccountFlags,
        }));
        if (isLastActiveCompanyAdmin(slug, accounts)) {
          throw Errors.conflict(
            "Impossible de désactiver le dernier administrateur actif de l'entreprise."
          );
        }
      }

      // Comptes "picker" sans compte Firebase Auth (voir renameUser.ts) : seul le flag Firestore
      // compte, il n'y a rien à désactiver côté Auth.
      let uid: string | null = null;
      try {
        uid = (await auth.getUserByEmail(usernameToSyntheticEmail(username, companyId))).uid;
      } catch {
        uid = null;
      }

      if (uid) {
        try {
          await auth.updateUser(uid, { disabled });
          if (disabled) await auth.revokeRefreshTokens(uid);
        } catch {
          throw Errors.internal("Échec de la mise à jour du compte Firebase Auth.");
        }
      }

      try {
        await ref.update({ disabled });
      } catch {
        // Même principe que renameUser.ts : ne jamais laisser Auth et Firestore incohérents.
        if (uid) {
          try {
            await auth.updateUser(uid, { disabled: !disabled });
          } catch (rollbackErr) {
            console.error(
              JSON.stringify({
                msg: "set_user_disabled_rollback_failed",
                uid,
                error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
              })
            );
          }
        }
        throw Errors.internal("Échec de la mise à jour du profil Firestore, opération annulée.");
      }

      await writeAuditEntry(db, {
        ts: new Date().toISOString(),
        action: disabled ? "disable_user" : "enable_user",
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
          msg: "set_user_disabled_unhandled_error",
          error: err instanceof Error ? err.message : String(err),
        })
      );
      const internal = Errors.internal();
      res.status(internal.status).json(errorBody(internal));
    }
  });

  return router;
}
