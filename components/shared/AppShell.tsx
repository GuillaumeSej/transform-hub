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
 *
 * Multi-tenancy : companyId de l'utilisateur connecté est passé à useBeTrackData pour filtrer
 * les données Firestore. Un admin (companyId null) voit toutes les données.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { role, user } = useRole();
  const router = useRouter();
  const pathname = usePathname();
  const data = useBeTrackData(user?.companyId ?? null);
  const [ready, setReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Le drawer mobile ne doit jamais rester ouvert après une navigation (changement de page) — au
  // cas où la fermeture au clic sur un lien de nav (via Sidebar.onNavigate) n'aurait pas suffi
  // (ex. navigation programmatique).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!role) {
      router.replace("/login");
      return;
    }
    // Un rôle ne peut naviguer que vers les pages listées dans sa nav (+ le détail levier, qui
    // n'est jamais dans la sidebar). Le Lever Owner en particulier n'a pas accès à un dashboard.
    const allowedRoutes = new Set(roles[role].nav.map((item) => PAGE_ROUTES[item.id]));
    const isLeverDetail = pathname.startsWith("/levers/");
    // Hub de détail entreprise (/admin/companies/detail?id=...) : jamais dans la nav (on y accède
    // en cliquant "Gérer" depuis la liste, comme pour /levers/detail ci-dessus) et réservé au
    // global admin — les autres rôles n'ont pas /admin/companies dans leur nav, donc
    // allowedRoutes.has() suffirait déjà à les bloquer, mais on le rend explicite ici.
    const isCompanyDetail = pathname === "/admin/companies/detail";
    const companyDetailAllowed = isCompanyDetail && role === "admin";
    if (!isLeverDetail && !companyDetailAllowed && !allowedRoutes.has(pathname)) {
      router.replace(PAGE_ROUTES[roles[role].nav[0]?.id] ?? "/levers");
      return;
    }
    initializeStorage();
    setReady(true);
  }, [role, router, pathname]);

  if (!role || !ready) return null;

  return (
    <div className="flex h-screen">
      {/* Sidebar fixe — visible seulement à partir de `lg` (1024px). En dessous, remplacée par le
          bouton hamburger du Topbar + ce drawer coulissant. */}
      <div className="hidden lg:flex">
        <Sidebar alertCount={data.alerts.length} role={role} />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => setMobileNavOpen(false)}
          />
          <Sidebar
            alertCount={data.alerts.length}
            role={role}
            onNavigate={() => setMobileNavOpen(false)}
            className="relative z-10 h-full w-[248px] min-w-[248px] shadow-xl"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          alertCount={data.alerts.length}
          role={role}
          onReset={() => {
            data.resetToMockData();
            window.location.reload();
          }}
          onMenuClick={() => setMobileNavOpen((v) => !v)}
        />
        <main className="flex-1 overflow-y-auto px-4 pb-10 pt-5 sm:px-6">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
