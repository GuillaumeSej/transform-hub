"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { findUser, TEST_USERS } from "@/lib/auth";
import { roles } from "@/lib/nav-config";

/**
 * Écran de connexion — identifiant + mot de passe. Comptes de démo uniquement (voir
 * lib/auth.ts) : 6 comptes de test, un par rôle, mot de passe "test" pour tous.
 */
export default function LoginPage() {
  const { login } = useRole();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const user = findUser(username, password);
    if (!user) {
      setError("Identifiant ou mot de passe incorrect.");
      return;
    }
    login(user);
    router.replace(user.role === "lever" ? "/levers" : "/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-[52px] w-[52px] items-center justify-center border-2 border-bp-coral bg-black text-lg font-black text-bp-coral">
            BT
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">BeTrack</h1>
          <p className="mt-1.5 text-sm text-white/50">
            Connectez-vous pour accéder à la plateforme
          </p>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-3.5 rounded-lg border border-white/10 bg-white/[0.04] p-6"
        >
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-white/40">
              Identifiant
            </label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="test.cto"
              className="w-full rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-bp-coral"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-white/40">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="test"
              className="w-full rounded border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-bp-coral"
            />
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            className="mt-1 rounded bg-bp-coral px-3 py-2 text-sm font-semibold text-black transition hover:opacity-90"
          >
            Se connecter
          </button>
        </form>

        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.02] p-4 text-[11px] text-white/40">
          <p className="mb-2 font-semibold uppercase tracking-wide text-white/50">
            Comptes de démo (mot de passe : test)
          </p>
          <ul className="space-y-0.5">
            {TEST_USERS.map((u) => (
              <li key={u.username} className="flex justify-between gap-3">
                <span className="text-white/60">{u.username}</span>
                <span>{roles[u.role].short}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
