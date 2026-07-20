"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut } from "lucide-react";
import { useRole } from "@/lib/hooks/useRole";

import { roles } from "@/lib/nav-config";
import { ResetDemoButton } from "@/components/shared/ResetDemoButton";
import type { Role } from "@/types";

const CRUMBS: Record<string, string> = {
  "/dashboard": "Executive Dashboard",
  "/levers": "Lever Library",
  "/workstreams": "Workstream Dashboard",
  "/finance": "Finance Module",
  "/hr": "Dashboard RH",
  "/hr/etp": "Base ETP",
  "/operations": "Operations Module",
};

const COMPANY_LABELS: Record<string, string> = {
  c1: "Acme Corp",
};

/** Barre supérieure — porté depuis `.topbar` du prototype legacy. Le profil est verrouillé pour
 * la session (choisi sur /login) : plus de sélecteur, seulement un bouton de déconnexion. */
export function Topbar({
  alertCount,
  role,
  onReset,
}: {
  alertCount: number;
  role: Role;
  onReset: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useRole();
  const isLeverDetail = pathname.startsWith("/levers/") && pathname !== "/levers";
  const label = isLeverDetail ? "Détail du levier" : (CRUMBS[pathname] ?? "BeTrack");

  const companyLabel = user?.companyId
    ? COMPANY_LABELS[user.companyId] ?? user.companyId
    : "Global";

  return (
    <header className="flex h-[60px] min-h-[60px] items-center justify-between border-b border-border bg-white px-6">
      <div className="flex items-center gap-2 text-xs text-secondary">
        <strong className="font-semibold text-primary">{label}</strong>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-border bg-neutral-50 px-3 py-1.5 text-xs font-medium text-primary">
          {user?.name ?? roles[role].label} · {companyLabel}
        </span>
        <button
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black"
          aria-label="Alertes"
        >
          <Bell size={14} />
          {alertCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full border-2 border-white bg-bp-coral" />
          )}
        </button>
        <ResetDemoButton onReset={onReset} />
        <button
          onClick={() => {
            logout();
            router.push("/login");
          }}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black"
          aria-label="Se déconnecter"
          title="Se déconnecter"
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
