"use client";

import { useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { roles } from "@/lib/nav-config";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import type { Role } from "@/types";

/**
 * Écran de connexion — choix du profil, verrouillé pour la session (voir lib/hooks/useRole.tsx).
 * Pas de mot de passe : c'est une démo, l'authentification réelle est hors scope.
 */
export default function LoginPage() {
  const { login } = useRole();
  const router = useRouter();

  const selectRole = (role: Role) => {
    login(role);
    router.replace("/dashboard");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-900 px-6 py-10">
      <div className="w-full max-w-3xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-[52px] w-[52px] items-center justify-center border-2 border-bp-coral bg-black text-lg font-black text-bp-coral">
            BT
          </div>
          <h1 className="mt-4 text-2xl font-bold text-white">BeTrack</h1>
          <p className="mt-1.5 text-sm text-white/50">
            Choisissez votre profil pour accéder à la plateforme
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(roles).map(([key, def]) => {
            const Icon = ICON_REGISTRY[def.nav[0]?.icon] ?? ICON_REGISTRY.Target;
            return (
              <button
                key={key}
                onClick={() => selectRole(key as Role)}
                className="group flex flex-col items-start gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-5 text-left transition hover:border-bp-coral hover:bg-white/[0.08]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/70 transition group-hover:border-bp-coral group-hover:text-bp-coral">
                  {Icon && <Icon size={18} />}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{def.label}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-white/40">
                    {def.short}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
