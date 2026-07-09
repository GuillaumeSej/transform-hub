"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { initializeStorage } from "@/lib/storage";
import { PAGE_ROUTES, roles } from "@/lib/nav-config";
import { Sidebar } from "@/components/shared/Sidebar";
import { Topbar } from "@/components/shared/Topbar";
import { Toaster } from "@/components/shared/Toaster";

/**
 * Coquille de l'app (sidebar + topbar) + garde d'authentification : redirige vers /login si
 * aucun profil n'a été choisi. Le choix de profil est verrouillé pour la session (voir useRole) —
 * pas de sélecteur ici, seulement un bouton de déconnexion dans le Topbar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { role } = useRole();
  const router = useRouter();
  const pathname = usePathname();
  const data = useBeTrackData();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!role) {
      router.replace("/login");
      return;
    }
    // Un rôle ne peut naviguer que vers les pages listées dans sa nav (+ le détail levier, qui
    // n'est jamais dans la sidebar). Le Lever Owner en particulier n'a pas accès à un dashboard.
    const allowedRoutes = new Set(roles[role].nav.map((item) => PAGE_ROUTES[item.id]));
    const isLeverDetail = pathname.startsWith("/levers/");
    if (!isLeverDetail && !allowedRoutes.has(pathname)) {
      router.replace(PAGE_ROUTES[roles[role].nav[0]?.id] ?? "/levers");
      return;
    }
    initializeStorage();
    setReady(true);
  }, [role, router, pathname]);

  if (!role || !ready) return null;

  return (
    <div className="flex h-screen">
      <Sidebar alertCount={data.alerts.length} role={role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          alertCount={data.alerts.length}
          role={role}
          onReset={() => {
            data.resetToMockData();
            window.location.reload();
          }}
        />
        <main className="flex-1 overflow-y-auto px-6 pb-10 pt-5">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
