"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import {
  chantierDependencyAlerts,
  latestMeasurement,
  resolveIndicatorStatus,
} from "@/lib/axisLogic";
import { cleanupLegacyStorage } from "@/lib/legacyStorageCleanup";
import { PAGE_ROUTES, roles } from "@/lib/nav-config";
import { Sidebar } from "@/components/shared/Sidebar";
import { Topbar } from "@/components/shared/Topbar";
import { Toaster } from "@/components/shared/Toaster";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Alert } from "@/types";

/**
 * Coquille de l'app (sidebar + topbar) + garde d'authentification : redirige vers /login si
 * aucun profil n'a été choisi. Le choix de profil est verrouillé pour la session (voir useRole) —
 * pas de sélecteur ici, seulement un bouton de déconnexion dans le Topbar.
 *
 * Multi-tenancy : companyId de l'utilisateur connecté est passé à useBeTrackData pour filtrer
 * les données Firestore. Un admin (companyId null) voit toutes les données.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { role, user, loading } = useRole();
  // Type du programme actif — le garde-fou de routes ci-dessous doit appliquer EXACTEMENT le même
  // filtre que la Sidebar, sinon une page masquée dans la nav (ex. /hr en mode stratégique)
  // resterait accessible en tapant son URL directement.
  const { programType, activeProgramId, loading: programsLoading } = useActiveProgram();
  const router = useRouter();
  const pathname = usePathname();
  const data = useBeTrackData(user?.companyId ?? null);
  const notifications = useNotifications(data, user);
  const [ready, setReady] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // ── Notifications : un jeu d'alertes PAR TYPE DE PROGRAMME ────────────────────────────────
  // La cloche du Topbar affichait jusqu'ici les alertes du Plan Performance (financières, leviers)
  // quel que soit le programme actif — sans aucun sens sur un Plan Stratégique, qui a ses propres
  // signaux (cascades de dépendance entre chantiers, indicateurs à risque). Tant que les
  // programmes chargent, `isStrategic` reste faux : on garde le comportement historique plutôt que
  // de vider la cloche le temps du chargement (même prudence que le filtre de nav ci-dessous).
  const isStrategic = !programsLoading && programType === "strategic";
  // `companyId` passé à null hors mode stratégique : `useStrategicData` n'ouvre alors AUCUN
  // abonnement Firestore — un Plan Performance ne paie donc rien pour ce hook (on ne peut pas
  // appeler un hook conditionnellement, mais on peut le neutraliser par ses arguments).
  const strategic = useStrategicData(
    isStrategic ? (user?.companyId ?? null) : null,
    activeProgramId
  );

  const strategicNotifications = useMemo(() => {
    const alerts: Alert[] = [];
    // Route d'atterrissage par alerte : le clic sur une notification ne peut pas passer par
    // `getLeverById` en mode stratégique (les scopes sont des chantiers/indicateurs, pas des
    // leviers). On mémorise donc la destination au moment où l'alerte est construite, là où on a
    // encore le contexte (axe parent du chantier).
    const routes: Record<string, string> = {};
    if (!isStrategic) return { alerts, routes };

    const today = new Date().toISOString().slice(0, 10);
    const companyId = user?.companyId ?? null;
    const axisIdByChantier = new Map(strategic.chantiers.map((c) => [c.id, c.axisId]));

    // 1. Cascades de dépendance entre chantiers — signalement pur (aucune date n'est modifiée),
    //    voir lib/axisLogic.ts. `desc` reprend le message déjà formulé par le moteur (il nomme les
    //    deux chantiers et le nombre de jours), le titre porte le chantier impacté.
    for (const dep of chantierDependencyAlerts(strategic.chantiers, strategic.chantierActions)) {
      const id = `strategic-dep-${dep.sourceId}-${dep.type}-${dep.targetId}`;
      const axisId = axisIdByChantier.get(dep.sourceId);
      alerts.push({
        id,
        type: "amber",
        ts: today,
        createdAt: today,
        scope: dep.sourceId,
        scopeLabel: dep.sourceName,
        title: t(
          "shared.appShell.strategicDependencyTitle",
          "Dépendance à risque · {chantier}"
        ).replace("{chantier}", dep.sourceName),
        desc: dep.message,
        actorRole: "",
        resolved: false,
        source: "auto",
        companyId,
      });
      routes[id] = axisId ? `/levers/detail?id=${axisId}` : "/levers";
    }

    // 2. Indicateurs à risque — statut EFFECTIF (surcharge manuelle du responsable comprise).
    for (const indicator of strategic.indicators) {
      if (resolveIndicatorStatus(indicator) !== "at_risk") continue;
      const id = `strategic-indicator-${indicator.id}`;
      const latest = latestMeasurement(indicator.id, strategic.measurements);
      alerts.push({
        id,
        type: "red",
        ts: latest?.reportedAt?.slice(0, 10) ?? today,
        createdAt: latest?.reportedAt?.slice(0, 10) ?? today,
        scope: indicator.id,
        scopeLabel: indicator.name,
        title: t("shared.appShell.strategicIndicatorTitle", "Indicateur à risque · {name}").replace(
          "{name}",
          indicator.name
        ),
        desc: t(
          "shared.appShell.strategicIndicatorDesc",
          "La dernière mesure est en dehors de l'objectif : {objective}."
        ).replace("{objective}", indicator.objective),
        actorRole: indicator.responsibleRoles[0] ?? "",
        resolved: false,
        source: "auto",
        companyId,
      });
      routes[id] = "/kpi";
    }

    return { alerts, routes };
  }, [
    isStrategic,
    strategic.chantiers,
    strategic.chantierActions,
    strategic.indicators,
    strategic.measurements,
    user?.companyId,
    t,
  ]);

  // Alertes réellement affichées (cloche du Topbar + badge de nav) : celles du plan actif, jamais
  // les deux mélangées. Le Plan Performance conserve exactement son comportement historique.
  const shellAlerts = isStrategic ? strategicNotifications.alerts : notifications.unresolvedAlerts;

  // Le drawer mobile ne doit jamais rester ouvert après une navigation (changement de page) — au
  // cas où la fermeture au clic sur un lien de nav (via Sidebar.onNavigate) n'aurait pas suffi
  // (ex. navigation programmatique).
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    // Tant que Firebase n'a pas fini de résoudre une éventuelle session existante (premier appel
    // asynchrone d'onAuthStateChanged, voir useRole), on ne décide de rien : rediriger vers
    // /login ici serait prématuré et éjecterait un utilisateur pourtant déjà connecté.
    if (loading) return;
    if (!role) {
      router.replace("/login");
      return;
    }
    // Un rôle ne peut naviguer que vers les pages listées dans sa nav (+ le détail levier, qui
    // n'est jamais dans la sidebar). Le Lever Owner en particulier n'a pas accès à un dashboard.
    //
    // Le périmètre autorisé suit le TYPE du programme actif, comme la Sidebar. Tant que les
    // programmes ne sont pas chargés, on retient la nav NON filtrée (surensemble des deux types) :
    // filtrer trop tôt sur le repli "performance" éjecterait un utilisateur légitimement arrivé
    // sur /kpi avec un programme stratégique. Ce surensemble est exactement le comportement
    // historique, donc rien ne change pour le Plan Performance.
    const navItems = programsLoading
      ? roles[role].nav
      : roles[role].nav.filter(
          (item) => !item.programTypes || item.programTypes.includes(programType)
        );
    const allowedRoutes = new Set(navItems.map((item) => PAGE_ROUTES[item.id]));
    const isLeverDetail = pathname.startsWith("/levers/");
    // Hub de détail entreprise (/admin/companies/detail?id=...) : jamais dans la nav (on y accède
    // en cliquant "Gérer" depuis la liste, comme pour /levers/detail ci-dessus) et réservé au
    // global admin — les autres rôles n'ont pas /admin/companies dans leur nav, donc
    // allowedRoutes.has() suffirait déjà à les bloquer, mais on le rend explicite ici.
    const isCompanyDetail = pathname === "/admin/companies/detail";
    const companyDetailAllowed = isCompanyDetail && role === "admin";
    if (!isLeverDetail && !companyDetailAllowed && !allowedRoutes.has(pathname)) {
      // Repli sur la première page RÉELLEMENT autorisée (nav filtrée) : renvoyer vers
      // `roles[role].nav[0]` sans filtre pourrait pointer une page elle-même interdite pour le
      // type de programme actif (ex. /workstreams pour un sponsor en mode stratégique) et
      // provoquer une boucle de redirection.
      router.replace(PAGE_ROUTES[navItems[0]?.id] ?? "/levers");
      return;
    }
    cleanupLegacyStorage();
    setReady(true);
  }, [role, loading, router, pathname, programType, programsLoading]);

  if (loading || !role || !ready) return null;

  return (
    <div className="flex h-dvh">
      {/* Sidebar fixe — visible seulement à partir de `lg` (1024px). En dessous, remplacée par le
          bouton hamburger du Topbar + ce drawer coulissant. */}
      <div className="hidden lg:flex">
        <Sidebar alertCount={shellAlerts.length} role={role} />
      </div>

      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 flex lg:hidden"
          role="dialog"
          aria-label={t("shared.appShell.mobileNavLabel", "Navigation principale")}
        >
          <div
            className="fixed inset-0 bg-black/50"
            aria-hidden="true"
            onClick={() => setMobileNavOpen(false)}
          />
          <Sidebar
            alertCount={shellAlerts.length}
            role={role}
            onNavigate={() => setMobileNavOpen(false)}
            className="relative z-10 h-dvh w-[min(248px,85vw)] min-w-0 shadow-xl"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          alertCount={shellAlerts.length}
          alerts={shellAlerts}
          onAlertClick={(alert) => {
            if (isStrategic) {
              // Une alerte stratégique ne pointe jamais un levier : cascade de dépendance → fiche
              // de l'axe portant le chantier impacté, indicateur à risque → page Indicateurs.
              router.push(strategicNotifications.routes[alert.id] ?? "/levers");
              return;
            }
            const leverId = data.getLeverById(alert.scope)?.id;
            router.push(leverId ? `/levers/detail?id=${leverId}` : "/levers");
          }}
          role={role}
          onReset={() => {
            data.resetToMockData().finally(() => window.location.reload());
          }}
          onMenuClick={() => setMobileNavOpen((v) => !v)}
        />
        <main className="flex-1 overflow-y-auto px-4 pb-10 pt-5 sm:px-6">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}
