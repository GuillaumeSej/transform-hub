"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
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
    <div className="flex min-h-screen items-center justify-center bg-black px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-start text-left">
          <Image
            src="/brand/logo-wordmark-white.png"
            alt="BearingPoint"
            width={210}
            height={36}
            priority
            className="h-[30px] w-auto"
          />
          <div className="mt-5 bp-overline !text-white/50">BeTrack · Transformation</div>
          <h1 className="mt-2 text-3xl font-bold leading-[1.05] tracking-tight text-white">
            Piloter la transformation,
            <br />
            ensemble.
          </h1>
        </div>

        <form
          onSubmit={submit}
          className="flex flex-col gap-3.5 border border-white/15 bg-white/[0.04] p-6"
        >
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
              Identifiant
            </label>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="test.cto"
              className="w-full rounded-sm border border-white/20 bg-white/5 px-3 py-2 text-sm text-white outline-none transition focus:border-white"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-white/50">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="test"
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
            Se connecter
          </button>
        </form>

        <div className="mt-5 border border-white/10 bg-white/[0.02] p-4 text-[11px] text-white/40">
          <p className="mb-2 font-semibold uppercase tracking-[0.14em] text-white/50">
            Comptes de démo (mot de passe : test)
          </p>
          <ul className="space-y-0.5">
            {TEST_USERS.map((u) => (
              <li key={u.username} className="flex justify-between gap-3">
                <span className="font-mono text-white/60">{u.username}</span>
                <span>{roles[u.role].short}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
