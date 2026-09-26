import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { Router } from "express";
import { randomBytes } from "crypto";
import { assertCanManageAccount, authorizeAdminCaller } from "../lib/authz";
import { normalizeUsername, usernameToSyntheticEmail, accountSlug } from "../lib/authLogic";
import { passwordResetLinkSchema } from "../lib/validation";
import { ApiError, Errors, errorBody } from "../lib/errors";
import { writeAuditEntry } from "../lib/audit";

/**
 * Génère un lien de réinitialisation de mot de passe à usage unique (firebase-admin
 * `generatePasswordResetLink`) et le RENVOIE à l'admin appelant — l'admin ne voit ni ne choisit
 * jamais le mot de passe : c'est l'utilisateur qui le définit en ouvrant le lien.
 *
 * Pourquoi renvoyer le lien plutôt que laisser Firebase envoyer l'e-mail : les comptes Firebase
 * Auth utilisent des e-mails SYNTHÉTIQUES (`username[.companyId]@betrack.local`, voir
 * lib/authLogic.ts), qui ne peuvent recevoir aucun courrier. L'UI propose donc de copier le lien
 * ou de l'envoyer via `mailto:` à l'e-mail de contact réel (`adminUsers.email`) s'il est renseigné.
 *
 * Compte "picker" sans compte Firebase Auth (voir renameUser.ts) : un compte Auth lui est créé
 * avec un mot de passe aléatoire jamais communiqué, puis le lien lui permet de définir le sien —
 * c'est la voie d'activation de la connexion pour ces comptes.
 *
 * `PASSWORD_RESET_CONTINUE_URL` (optionnel) : URL de retour après réinitialisation (ex. la page de
 * connexion de l'app) ; son domaine doit figurer dans les domaines autorisés Firebase Auth.
 */
export function passwordResetLinkRouter(auth: Auth, db: Firestore): Router {
  const router = Router();

  router.post("/password-reset-link", async (req, res) => {
    try {
      const parsed = passwordResetLinkSchema.safeParse(req.body);
      if (!parsed.success) {
        throw Errors.invalidInput("Corps de requête invalide : username et companyId sont requis.");
      }
      const { username } = parsed.data;
      const companyId = parsed.data.companyId ?? null;

      const caller = await authorizeAdminCaller(auth, db, req.headers.authorization, companyId);

      const targetSlug = accountSlug(username, companyId);
      const snap = await db.collection("adminUsers").doc(targetSlug).get();
      if (!snap.exists) {
        throw Errors.notFound(`Profil Firestore introuvable pour "${username}".`);
      }
      assertCanManageAccount(caller, targetSlug, snap.data(), "reset_password");
      if ((snap.data() as { disabled?: boolean } | undefined)?.disabled === true) {
        throw Errors.conflict(
          "Ce compte est désactivé : réactivez-le avant de réinitialiser son mot de passe."
        );
      }

      const email = usernameToSyntheticEmail(username, companyId);
      let authExists = true;
      try {
        await auth.getUserByEmail(email);
      } catch {
        authExists = false;
      }
      if (!authExists) {
        try {
          await auth.createUser({ email, password: randomBytes(24).toString("base64url") });
        } catch {
          throw Errors.internal("Échec de la création du compte Firebase Auth.");
        }
      }

      const continueUrl = process.env.PASSWORD_RESET_CONTINUE_URL?.trim();
      let link: string;
      try {
        link = await auth.generatePasswordResetLink(
          email,
          continueUrl ? { url: continueUrl } : undefined
        );
      } catch {
        throw Errors.internal("Échec de la génération du lien de réinitialisation.");
      }

      await writeAuditEntry(db, {
        ts: new Date().toISOString(),
        action: "password_reset_link",
        actorUsername: caller.username,
        actorUid: caller.uid,
        targetOldUsername: normalizeUsername(username),
        companyId,
      });

      res.status(200).json({ ok: true, link });
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.status).json(errorBody(err));
        return;
      }
      console.error(
        JSON.stringify({
          msg: "password_reset_link_unhandled_error",
          error: err instanceof Error ? err.message : String(err),
        })
      );
      const internal = Errors.internal();
      res.status(internal.status).json(errorBody(internal));
    }
  });

  return router;
}
