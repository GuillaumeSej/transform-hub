"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { signInUser } from "@/lib/auth";
import { subscribeCompanyDirectory } from "@/lib/firestore/admin";
import { PAGE_ROUTES, resolveUserNav } from "@/lib/nav-config";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/locales";
import { assetPath } from "@/lib/utils";

/**
 * Écran de connexion — identifiant + mot de passe contre Firebase Auth (voir lib/auth.ts).
 * Aucun compte n'est pré-seedé : le premier compte admin se crée via `npm run create-admin`
 * (scripts/create-admin.js), les suivants via le panneau Admin > Utilisateurs une fois connecté.
 *
 * Sélecteur d'entreprise (round 5) : depuis que `usernameToSyntheticEmail`/`accountSlug` (voir
 * lib/auth.ts) encodent l'entreprise dans l'identifiant technique Firebase Auth, un même
 * identifiant humain (ex. "alice") peut désormais correspondre à PLUSIEURS comptes Firebase Auth
 * distincts (mots de passe séparés) — un par entreprise, plus éventuellement un compte admin
 * global. La connexion n'est donc plus (identifiant, mot de passe) mais bien (identifiant,
 * entreprise, mot de passe) : ce sélecteur, alimenté par `companyDirectory` (collection PUBLIQUE
 * id+nom, lisible avant authentification — voir firestore.rules), laisse l'utilisateur préciser
 * quelle entreprise avant de tenter la connexion. "Administrateur global" (valeur "") correspond à
 * `companyId: null`, le mode utilisé par le tout premier compte créé via `scripts/create-admin.js`.
 */
export default function LoginPage() {
  const { login } = useRole();
  const router = useRouter();
  const { t, locale, setLocale } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeCompanyDirectory(setCompanies), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const user = await signInUser(username, password, companyId || null);
      login(user);
      // Page d'atterrissage : premier item de l'union des nav de tous les profils/habilitations
      // de l'utilisateur (voir resolveUserNav) — profil Plan Performance, puis Plan Stratégique,
      // puis admin. Repli sur /levers si l'utilisateur n'a ni profil ni habilitation admin.
      const firstNavItem = resolveUserNav(user)[0];
      router.replace((firstNavItem && PAGE_ROUTES[firstNavItem.id]) ?? "/levers");
    } catch (err) {
      setError(describeSignInError(err));
    }
  };

  /**
   * Distingue deux causes d'échec très différentes pour l'utilisateur :
   *  - identifiants invalides (cas normal, message générique volontairement vague : on ne révèle
   *    pas si c'est le username ou le mot de passe qui est faux) ;
   *  - Firebase Auth mal configuré côté console ('auth/operation-not-allowed', méthode e-mail/mot
   *    de passe non activée dans Firebase Console > Authentication > Sign-in method) — un vrai
   *    problème de configuration, pas une erreur de saisie, qui mérite un message différent.
   */
  function describeSignInError(err: unknown): string {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code === "auth/operation-not-allowed" || code === "auth/configuration-not-found") {
      return t("login.errorNotConfigured");
    }
    // Authentifié avec succès mais aucun document 'adminUsers' correspondant (voir
    // resolveAuthUserProfile dans lib/auth.ts) — pas un problème d'identifiants, message dédié.
    if (err instanceof Error && err.message.includes("profil introuvable")) {
      return err.message;
    }
    return t("login.error");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex justify-end">
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number])}
            aria-label={t("topbar.language")}
            className="rounded-sm border border-white/20 bg-white/5 px-2 py-1 text-xs text-white outline-none"
          >
            {LOCALES.map((l) => (
              <option key={l} value={l} className="bg-black">
                {LOCALE_LABELS[l]}
              </option>
            ))}
          </select>
        </div>
        <div className="mb-10 flex flex-col items-start text-left">
          <Image
            src={assetPath("/brand/logo-wordmark-white.png")}
            alt="BearingPoint"
            width={210}
            height={36}
            priority
            className="h-[30px] w-auto"
          />
          <div className="mt-5 bp-overline !text-white/50">{t("login.tagline")}</div>
          <h1 className="mt-2 whitespace-pre-line text-3xl font-bold leading-[1.05] tracking-tight text-white">
            {t("login.heading")}
          </h1>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-3.5 border border-white/15 bg-white/[0.04] p-6"
        >
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
              {t("login.username")}
            </label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("login.usernamePlaceholder")}
              className="w-full rounded-sm border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
              {t("login.company")}
            </label>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="w-full rounded-sm border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-white"
            >
              <option value="" className="bg-black">
                {t("login.companyGlobalAdmin")}
              </option>
              {companies.map((c) => (
                <option key={c.id} value={c.id} className="bg-black">
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
              {t("login.password")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("login.passwordPlaceholder")}
              className="w-full rounded-sm border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-white"
            />
          </div>
          {error && (
            <p className="border-l-2 border-bp-coral pl-2 text-xs font-semibold text-white">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="mt-1 rounded-sm bg-white px-3 py-2.5 text-sm font-bold text-black transition hover:bg-neutral-200"
          >
            {t("login.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
