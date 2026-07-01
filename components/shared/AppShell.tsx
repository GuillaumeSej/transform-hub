"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { initializeStorage, getAlerts, resetToMockData } from "@/lib/storage";
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
  const [ready, setReady] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    if (!role) {
      router.replace("/login");
      return;
    }
    initializeStorage();
    setAlertCount(getAlerts().length);
    setReady(true);
  }, [role, router]);

  if (!role || !ready) return null;

  return (
    <div className="flex h-screen">
      <Sidebar alertCount={alertCount} role={role} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          alertCount={alertCount}
          role={role}
          onReset={() => {
            resetToMockData();
            setAlertCount(getAlerts().length);
            window.location.reload();
          }}
        />
        <main className="flex-1 overflow-y-auto px-6 pb-10 pt-5">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
