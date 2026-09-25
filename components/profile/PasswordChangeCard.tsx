"use client";

import { useState, type FormEvent } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { getAuthInstance } from "@/lib/firebase";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  PASSWORD_ERROR_MESSAGES,
  PROFILE_MIN_PASSWORD_LENGTH,
  passwordChangeErrorMessage,
  validatePasswordChange,
  type PasswordChangeInput,
} from "@/lib/profile";

const EMPTY: PasswordChangeInput = { current: "", next: "", confirm: "" };

/**
 * Carte « Mot de passe » de la page Mon profil : ré-authentification avec le mot de passe actuel
 * (exigée par Firebase pour une opération sensible) puis `updatePassword`, sur l'instance Auth
 * PRINCIPALE (celle de la session en cours — voir lib/firebase.ts).
 *
 * Seul Firebase Auth détient le mot de passe de connexion : on n'écrit RIEN dans Firestore. Le
 * champ legacy `AuthUser.password` du document `adminUsers` n'est lu par aucun flux de connexion
 * (lib/auth.ts:signInUser passe exclusivement par signInWithEmailAndPassword) — y recopier le
 * nouveau mot de passe en clair ne ferait qu'exposer un secret sans rien synchroniser d'utile.
 */
export function PasswordChangeCard({ username }: { username: string }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [form, setForm] = useState<PasswordChangeInput>(EMPTY);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = validatePasswordChange(form);
  const hasErrors = Object.keys(errors).length > 0;
  const fieldError = (field: keyof PasswordChangeInput): string | null => {
    const code = errors[field];
    if (!submitted || !code) return null;
    const { key, fallback } = PASSWORD_ERROR_MESSAGES[code];
    return t(key, fallback).replace("{n}", String(PROFILE_MIN_PASSWORD_LENGTH));
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (hasErrors || saving) return;

    const currentUser = getAuthInstance().currentUser;
    if (!currentUser?.email) {
      const { key, fallback } = passwordChangeErrorMessage({ code: "auth/requires-recent-login" });
      setServerError(t(key, fallback));
      return;
    }
    setSaving(true);
    try {
      await reauthenticateWithCredential(
        currentUser,
        EmailAuthProvider.credential(currentUser.email, form.current)
      );
      await updatePassword(currentUser, form.next);
      setForm(EMPTY);
      setSubmitted(false);
      showToast(
        t("profile.password.successTitle", "Mot de passe modifié"),
        t(
          "profile.password.successBody",
          "Utilisez votre nouveau mot de passe lors de votre prochaine connexion."
        ),
        "success"
      );
    } catch (err) {
      const { key, fallback } = passwordChangeErrorMessage(err);
      setServerError(t(key, fallback));
    } finally {
      setSaving(false);
    }
  };

  const input = (
    field: keyof PasswordChangeInput,
    label: string,
    autoComplete: "current-password" | "new-password"
  ) => {
    const error = fieldError(field);
    const id = `profile-password-${field}`;
    return (
      <div>
        <label htmlFor={id} className="text-xs font-medium text-secondary">
          {label}
        </label>
        <input
          id={id}
          type="password"
          autoComplete={autoComplete}
          value={form[field]}
          onChange={(e) => {
            const value = e.target.value;
            setForm((f) => ({ ...f, [field]: value }));
            setServerError(null);
          }}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`mt-1 w-full rounded-lg border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral ${
            error ? "border-rag-red" : "border-border"
          }`}
        />
        {error && (
          <p id={`${id}-error`} className="mt-1 text-xs text-rag-red">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <Card>
      <CardHeader title={t("profile.password.title", "Mot de passe")} />
      <CardBody>
        <form onSubmit={onSubmit} noValidate className="max-w-md space-y-4">
          {/* Aide aux gestionnaires de mots de passe : associe le nouveau mot de passe au bon compte. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={username}
            readOnly
            hidden
          />
          {input(
            "current",
            t("profile.password.current", "Mot de passe actuel"),
            "current-password"
          )}
          {input("next", t("profile.password.next", "Nouveau mot de passe"), "new-password")}
          <p className="-mt-2 text-[11px] text-secondary">
            {t("profile.password.hint", "Au moins {n} caractères.").replace(
              "{n}",
              String(PROFILE_MIN_PASSWORD_LENGTH)
            )}
          </p>
          {input(
            "confirm",
            t("profile.password.confirm", "Confirmer le nouveau mot de passe"),
            "new-password"
          )}
          {serverError && (
            <p role="alert" className="text-xs font-medium text-rag-red">
              {serverError}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={saving}>
            {saving
              ? t("profile.password.saving", "Modification…")
              : t("profile.password.submit", "Modifier le mot de passe")}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
