"use client";

import { localDateOfInstant, todayISO } from "@/lib/dateUtils";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { useCompanyDepartments } from "@/lib/hooks/useCompanyDepartments";
import { useStaffingThresholds } from "@/lib/hooks/useStaffingThresholds";
import {
  receivesStaffingAlerts,
  staffingOverrunHref,
  staffingOverrunText,
  staffingOverruns,
} from "@/lib/staffingAlerts";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import {
  chantierDependencyAlerts,
  latestNumericMeasurement,
  programBudgetOverrun,
  resolveIndicatorStatus,
} from "@/lib/axisLogic";
import { cleanupLegacyStorage } from "@/lib/legacyStorageCleanup";
import { maskDependencyAlerts } from "@/lib/strategicProgramScope";
import { resolveLandingRoute, resolveUserNav } from "@/lib/nav-config";
import { canOpenRoute } from "@/lib/routeAccess";
import { useTrackInAppNavigation } from "@/lib/hooks/useBackOrFallback";
import { Sidebar } from "@/components/shared/Sidebar";
import { Topbar } from "@/components/shared/Topbar";
import { Toaster } from "@/components/shared/Toaster";
import { useNotifications } from "@/lib/hooks/useNotifications";
import { relevantAlertsFor } from "@/lib/alertRelevance";
import { useSidebarCollapsed } from "@/lib/hooks/useSidebarCollapsed";
import { useCurrentCompany } from "@/lib/hooks/useCurrentCompany";
import {
  useApprovalQueue,
  useRealizedApprovalQueue,
  useDeletionQueue,
} from "@/lib/hooks/useApprovalQueue";
import { canAccessPerformanceProgram } from "@/lib/roleProfiles";
import { useStrategicApprovals } from "@/lib/hooks/useStrategicApprovals";
import { StrategicApprovalsProvider } from "@/lib/hooks/useStrategicApprovalsContext";
import { APPROVAL_ALERT_ROUTE, decisionAlertApprovalId } from "@/lib/strategicApprovals";
import { approvalTargetHref } from "@/lib/strategicLinks";
import { bellAlertCount, receivesBudgetOverrunAlert } from "@/lib/strategicBell";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Alert } from "@/types";
import { formatCurrency } from "@/lib/format";

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
  const { user, loading, logout } = useRole();
  const { confirmDiscard } = useUnsavedChanges();
  // Type du programme actif — le garde-fou de routes ci-dessous doit appliquer EXACTEMENT le même
  // filtre que la Sidebar, sinon une page masquée dans la nav (ex. /hr en mode stratégique)
  // resterait accessible en tapant son URL directement.
  const {
    programs,
    programType,
    activeProgram,
    activeProgramId,
    loading: programsLoading,
  } = useActiveProgram();
  const router = useRouter();
  const pathname = usePathname();
  // Historique interne pour les boutons « Retour » (`useBackOrFallback`).
  useTrackInAppNavigation();
  const data = useBeTrackData(user?.companyId ?? null, user);
  const notifications = useNotifications(data, user);
  // File d'attente de validation en cascade (owner -> sponsor -> cto, voir
  // lib/hooks/useApprovalQueue.ts) : uniquement pertinente pour le Plan Performance (les leviers,
  // pas les chantiers/indicateurs du Plan Stratégique) — non filtrée ci-dessous par `isStrategic`
  // (calculé plus bas) puisque `resolveApprovalQueue` ne retient déjà que les leviers portant un
  // `approval` en cours, structurellement absent en mode stratégique.
  const approvalQueue = useApprovalQueue(data, user);
  // Impacts cochés « Réalisé » en attente de la finance (audit C4) — vide hors profil finance.
  // Entreprise courante passée pour le filtre de confidentialité : le badge doit compter EXACTEMENT
  // la file de la page `/validation`.
  const company = useCurrentCompany(user?.companyId);
  const realizedApprovalQueue = useRealizedApprovalQueue(data, user, company);
  // Suppressions de leviers à confirmer (double validation CTO ↔ responsable de chantier).
  const deletionQueue = useDeletionQueue(data, user);
  const [ready, setReady] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Sidebar desktop réductible en rail d'icônes (préférence par navigateur) — le contenu, en
  // `flex-1`, récupère automatiquement la largeur libérée. Sans effet sur le drawer mobile.
  const sidebar = useSidebarCollapsed();

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
  // Round 25 (RBAC) : `user` désormais passé en 3e argument — sans lui, ce hook sautait à la fois
  // le masquage de confidentialité ET le périmètre par propriétaire nommé (`axis_sponsor`/
  // `chantier_owner`/`chantier_contributor`), la cloche de notifications ci-dessous
  // (`strategicNotifications`) exposait alors des alertes sur des chantiers/indicateurs hors du
  // périmètre de l'utilisateur.
  const strategic = useStrategicData(
    isStrategic ? (user?.companyId ?? null) : null,
    activeProgramId,
    user
  );
  // Validation stratégique (lib/strategicApprovals.ts) : alertes dérivées + badge de la sidebar.
  // Neutralisé hors mode stratégique (`companyId` null → aucun abonnement).
  const strategicApprovals = useStrategicApprovals({
    user,
    companyId: isStrategic ? (user?.companyId ?? null) : null,
    programId: activeProgramId,
    data: strategic,
  });

  // Sur-staffing (lib/staffingAlerts.ts) : base ETP chargée UNIQUEMENT pour les destinataires
  // (pilote du plan, RH du programme, admins) en mode stratégique — sinon aucun abonnement.
  const staffingRecipient = isStrategic && receivesStaffingAlerts(user, activeProgramId);
  const { fteByDept: staffingFteByDept } = useCompanyDepartments(
    staffingRecipient ? (user?.companyId ?? null) : null,
    { withRealizedMovements: true }
  );
  const { thresholds: staffingThresholds } = useStaffingThresholds();

  const strategicNotifications = useMemo(() => {
    const alerts: Alert[] = [];
    // Route d'atterrissage par alerte : le clic sur une notification ne peut pas passer par
    // `getLeverById` en mode stratégique (les scopes sont des chantiers/indicateurs, pas des
    // leviers). On mémorise donc la destination au moment où l'alerte est construite, là où on a
    // encore le contexte (axe parent du chantier).
    const routes: Record<string, string | undefined> = {};
    if (!isStrategic) return { alerts, routes };
    // Destination retenue SEULEMENT si l'utilisateur peut ouvrir la page (même règle que la garde
    // de route ci-dessous) — sinon l'alerte reste affichée mais n'est pas cliquable, au lieu d'un
    // clic renvoyé sans explication vers « Mon espace » (audit fix #3).
    const reachable = (...hrefs: (string | undefined)[]) =>
      hrefs.find((href) => !!href && canOpenRoute(user, href, "strategic"));

    const today = todayISO();
    const companyId = user?.companyId ?? null;
    // Round 24 : un chantier peut appartenir à plusieurs axes — l'axe PRIMAIRE (`axisIds[0]`) est
    // utilisé ici pour router la notification vers une seule page d'axe, comportement voulu pour ce
    // cas précis (pas d'exposition de la notion "primaire" à l'utilisateur, simple choix interne).
    const axisIdByChantier = new Map(strategic.chantiers.map((c) => [c.id, c.axisIds[0]]));

    // 1. Cascades de dépendance entre chantiers — signalement pur (aucune date n'est modifiée),
    //    voir lib/axisLogic.ts. `desc` reprend le message déjà formulé par le moteur (il nomme les
    //    deux chantiers et le nombre de jours), le titre porte le chantier impacté.
    //    Lot 3 : évaluées sur le programme COMPLET (une dépendance vers un chantier masqué compte
    //    pour tous les profils), notifiées seulement pour un chantier BLOQUÉ visible, l'autre
    //    extrémité renommée « chantier hors de votre périmètre » si elle est masquée.
    const dependencyAlerts = maskDependencyAlerts(
      chantierDependencyAlerts(strategic.program.chantiers, strategic.program.chantierActions),
      strategic.visibleChantierIds,
      t("strategicScope.outOfScopeChantier", "Chantier hors de votre périmètre"),
      "source"
    );
    for (const dep of dependencyAlerts) {
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
      routes[id] = reachable(axisId ? `/levers/detail?id=${axisId}` : undefined, "/levers");
    }

    // 2. Indicateurs à risque — statut LIVE (`resolveIndicatorStatus`, trois états, audit fix #2) :
    //    même verdict que les pastilles du dashboard et de la page KPI ; « Sans donnée » n'alerte pas.
    for (const indicator of strategic.indicators) {
      if (resolveIndicatorStatus(indicator, strategic.measurements) !== "at_risk") continue;
      const id = `strategic-indicator-${indicator.id}`;
      // Dernière mesure NUMÉRIQUE (même ordre période puis `reportedAt` que le statut,
      // `compareMeasurements`) : un commentaire seul saisi après la valeur ne date pas l'alerte.
      const latest = latestNumericMeasurement(indicator.id, strategic.measurements);
      alerts.push({
        id,
        type: "red",
        // Jour LOCAL de la saisie (`reportedAt` est un instant UTC complet).
        ts: latest?.reportedAt ? localDateOfInstant(latest.reportedAt) : today,
        createdAt: latest?.reportedAt ? localDateOfInstant(latest.reportedAt) : today,
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
      // Indicateur ciblé sur la page Indicateurs ; sans accès à /kpi, fiche de l'axe porteur.
      routes[id] = reachable(
        `/kpi?indicator=${encodeURIComponent(indicator.id)}`,
        indicator.axisId ? `/levers/detail?id=${indicator.axisId}` : undefined
      );
    }

    // 3. Dépassement du budget prévisionnel TOTAL du programme actif (round 28) —
    //    `programBudgetOverrun` (lib/axisLogic.ts) ne renvoie un montant que si `Program.budget`
    //    est déclaré ET dépassé par la somme réelle des budgets leviers : rien à signaler tant que
    //    l'admin n'a pas renseigné ce budget total (voir ProgramsPanel.tsx), même convention
    //    "absent = pas d'alerte fabriquée" que les deux blocs précédents. Cette alerte est pour le
    //    PILOTE du plan (`actorRole: "strategic_lead"`), même esprit que `indicator.responsibleRoles[0]`
    //    ci-dessus qui cible le responsable métier de l'indicateur.
    //    Lot 3 : total calculé sur le programme COMPLET (`program`) — même montant que la puce
    //    « Budget alloué » du dashboard, quel que soit le périmètre du lecteur.
    //    Lot 5 : réservée au pilote du plan, aux admins et au sponsor du programme
    //    (`receivesBudgetOverrunAlert`) — plus diffusée à tout profil stratégique.
    if (activeProgram && receivesBudgetOverrunAlert(user, activeProgram)) {
      const overrun = programBudgetOverrun(
        activeProgram,
        strategic.program.chantiers,
        strategic.program.chantierActions
      );
      if (overrun !== undefined) {
        const id = `strategic-budget-overrun-${activeProgram.id}`;
        const amountLabel = formatCurrency(overrun, { currency: activeProgram.currency });
        alerts.push({
          id,
          type: "red",
          ts: today,
          createdAt: today,
          scope: activeProgram.id,
          scopeLabel: activeProgram.name,
          title: t(
            "shared.appShell.strategicBudgetOverrunTitle",
            "Dépassement budgétaire · {program}"
          ).replace("{program}", activeProgram.name),
          desc: t(
            "shared.appShell.strategicBudgetOverrunDesc",
            "Le budget prévisionnel du programme est dépassé de {amount}."
          ).replace("{amount}", amountLabel),
          actorRole: "strategic_lead",
          resolved: false,
          source: "auto",
          companyId,
        });
        routes[id] = reachable("/dashboard");
      }
    }

    // 4. Sur-staffing : équipe au-delà du seuil « sur-staffé » sur un mois en cours ou à venir
    //    (mêmes calculs que la page Budget & effectifs). Pour le pilote, le RH et les admins.
    //    Lot 3 : sur les lignes ETP du programme COMPLET — même taux, mêmes alertes pour tous les
    //    destinataires (une RH non habilitée voyait 75 % là où l'admin voyait 125 %).
    if (staffingRecipient) {
      for (const overrun of staffingOverruns(
        strategic.program.staffing,
        staffingFteByDept,
        today,
        staffingThresholds
      )) {
        const id = `strategic-staffing-${activeProgramId ?? ""}-${overrun.team}`;
        const text = staffingOverrunText(overrun, t);
        alerts.push({
          id,
          type: "red",
          ts: today,
          createdAt: today,
          scope: overrun.team,
          scopeLabel: overrun.team,
          title: text.title,
          desc: text.desc,
          actorRole: "strategic_lead",
          resolved: false,
          source: "auto",
          companyId,
        });
        routes[id] = reachable(staffingOverrunHref(overrun), "/effectifs");
      }
    }

    // 5. Alertes des demandes de validation (à valider, en attente, décision, information) —
    //    `buildApprovalAlerts`, déjà masquées pour un lecteur non habilité sur la cible (lot 5).
    //    Lot 5 : la décision sur MES demandes n'est plus signalée DEUX fois (ancien doublon
    //    `decision-<id>` sur 7 j + `…-decision` sur 14 j) — seule l'alerte de
    //    `buildApprovalAlerts` reste ; elle mène à l'objet concerné quand il est ouvrable (comme
    //    l'ancien avis), sinon à la page Validation.
    const approvalById = new Map(strategicApprovals.approvals.map((a) => [a.id, a]));
    for (const alert of strategicApprovals.alerts) {
      alerts.push(alert);
      const decided = decisionAlertApprovalId(alert.id);
      const approval = decided ? approvalById.get(decided) : undefined;
      routes[alert.id] = reachable(
        approval
          ? (approvalTargetHref(approval, {
              axes: strategic.axes,
              chantiers: strategic.chantiers,
              chantierActions: strategic.chantierActions,
              indicators: strategic.indicators,
            }) ?? undefined)
          : undefined,
        APPROVAL_ALERT_ROUTE
      );
    }

    return { alerts, routes };
  }, [
    strategicApprovals.alerts,
    strategicApprovals.approvals,
    isStrategic,
    activeProgram,
    strategic.chantiers,
    strategic.chantierActions,
    strategic.indicators,
    strategic.measurements,
    strategic.program,
    strategic.visibleChantierIds,
    strategic.axes,
    staffingRecipient,
    staffingFteByDept,
    staffingThresholds,
    activeProgramId,
    user,
    t,
  ]);

  // Alertes réellement affichées (cloche du Topbar + badge de nav) : celles du plan actif, jamais
  // les deux mélangées. Plan Performance : alertes ciblées filtrées par pertinence métier du rôle
  // (`relevantAlertsFor`, ex. pas de dépassement de coûts pour un profil RH) — même filtre que
  // « Mon espace » (lib/myWorkspace.ts), audit fix #5.
  const shellAlerts = isStrategic
    ? strategicNotifications.alerts
    : relevantAlertsFor(notifications.unresolvedAlerts, user);

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
    if (!user) {
      router.replace("/login");
      return;
    }
    // L'union des nav des profils/habilitations de l'utilisateur (voir resolveUserNav) borne les
    // pages accessibles (+ le détail levier, qui n'est jamais dans la sidebar). Le Lever Owner en
    // particulier n'a pas accès à un dashboard.
    //
    // Le périmètre autorisé suit le TYPE du programme actif, comme la Sidebar. Tant que les
    // programmes ne sont pas chargés, on retient la nav NON filtrée (surensemble des deux types) :
    // filtrer trop tôt sur le repli "performance" éjecterait un utilisateur légitimement arrivé
    // sur /kpi avec un programme stratégique. Ce surensemble est exactement le comportement
    // historique, donc rien ne change pour le Plan Performance.
    const unfilteredNavItems = resolveUserNav(user);
    // Utilisateur sans AUCUN profil métier ni habilitation admin (round multi-profils : un compte
    // peut exister avec `profiles: []`, `isGlobalAdmin`/`isCompanyAdmin` absents — ex. pendant la
    // configuration d'un nouveau compte, ou un profil retiré) — `resolveUserNav` renvoie alors un
    // tableau vide, donc AUCUNE page ne lui est destinée. Avant, `PAGE_ROUTES[navItems[0]?.id] ??
    // "/levers"` repliait silencieusement sur /levers, qui affichait son contenu par défaut comme
    // si de rien n'était : un compte sans droit voyait quand même une page avec des données.
    // Prise en charge explicite ici, AVANT tout calcul de route : écran dédié "aucun accès" plutôt
    // qu'une page qui n'a jamais vérifié qu'elle avait le droit de s'afficher pour ce profil.
    if (unfilteredNavItems.length === 0) {
      setNoAccess(true);
      setReady(true);
      return;
    }
    setNoAccess(false);
    const navItems = programsLoading
      ? unfilteredNavItems
      : unfilteredNavItems.filter(
          (item) => !item.programTypes || item.programTypes.includes(programType)
        );
    // Règle d'accès partagée (`canOpenRoute`, lib/routeAccess.ts) — la MÊME que celle qui masque
    // les liens vers les pages non ouvrables dans l'app : nav résolue filtrée par le type du
    // programme actif (non filtrée pendant le chargement), pages Performance program-type-aware
    // (message de bascule plutôt que redirection), fiche levier `/levers/…`, « Mon profil »
    // `/profile` (tout utilisateur connecté) et hub entreprise `/admin/companies/detail` (global
    // admin uniquement).
    if (!canOpenRoute(user, pathname, programsLoading ? undefined : programType)) {
      // Repli sur la première page RÉELLEMENT autorisée (nav filtrée elle ne peut plus être vide
      // ici, voir le retour anticipé ci-dessus) : renvoyer vers `navItems[0]` SANS le filtre par
      // type de programme pourrait pointer une page elle-même interdite pour le type de programme
      // actif (ex. /workstreams pour un sponsor en mode stratégique) et provoquer une boucle de
      // redirection — d'où `navItems[0]` (filtré), avec `unfilteredNavItems[0]` en dernier repli
      // si le filtrage par programme a lui-même tout exclu (programme actif d'un type que ce
      // profil ne couvre pas du tout). En pratique : /me (« Mon espace », sans `programTypes`, donc
      // jamais exclu par le filtre) — explicite via resolveLandingRoute, l'item n'étant plus le
      // 1er de la nav.
      router.replace(resolveLandingRoute(navItems.length > 0 ? navItems : unfilteredNavItems));
      return;
    }
    cleanupLegacyStorage();
    setReady(true);
  }, [user, loading, router, pathname, programType, programsLoading]);

  // Garde PROGRAMME de la fiche levier (`/levers/detail?id=…`, jamais dans la nav donc non bornée
  // par `allowedRoutes`) : sur un programme Performance, ouvrir un levier par URL directe exige un
  // profil/droit sur le programme DU LEVIER (`canAccessPerformanceProgram` — admin, cto, sponsor/
  // owner désigné du programme, ou tout profil rattaché à ce programme, `comex_member`/`hr` compris
  // en lecture seule). La page applique la MÊME règle (`leverAccessDenialReason`, motif "program",
  // message dédié si elle s'affiche avant cette redirection) en plus du périmètre nominatif et de
  // la confidentialité. `?id=` est lu depuis `window.location` (pas de `useSearchParams`
  // dans la coquille, qui exigerait une frontière Suspense au niveau du layout) : réévalué au
  // chargement des leviers et à chaque changement de route — cas visé = l'URL saisie/partagée.
  const leverDetailId =
    pathname === "/levers/detail" && typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("id")
      : null;
  const leverDetailProgramId = leverDetailId
    ? data.getLeverById(leverDetailId)?.programId
    : undefined;
  useEffect(() => {
    if (loading || !user || programsLoading || isStrategic) return;
    if (!leverDetailProgramId) return;
    const program = programs.find((p) => p.id === leverDetailProgramId) ?? null;
    if (canAccessPerformanceProgram(user, leverDetailProgramId, program)) return;
    const nav = resolveUserNav(user).filter(
      (item) => !item.programTypes || item.programTypes.includes(programType)
    );
    router.replace(resolveLandingRoute(nav));
  }, [
    leverDetailProgramId,
    loading,
    user,
    programsLoading,
    isStrategic,
    programs,
    programType,
    router,
  ]);

  // Destination d'une alerte de la cloche — `undefined` = alerte affichée mais NON cliquable
  // (aucune page ouvrable pour cet utilisateur, audit fix #3). Stratégique : routes calculées à la
  // construction (chantier → fiche de l'axe, indicateur → `/kpi?indicator=…` ou fiche de l'axe).
  // Performance : TOUJOURS la fiche du levier concerné ; alerte sans levier (scope chantier) →
  // bibliothèque si ouvrable, sinon rien.
  const alertHref = (alert: Alert): string | undefined => {
    if (isStrategic) return strategicNotifications.routes[alert.id];
    const leverId = data.getLeverById(alert.scope)?.id;
    if (leverId) return `/levers/detail?id=${leverId}`;
    return canOpenRoute(user, "/levers", programsLoading ? undefined : programType)
      ? "/levers"
      : undefined;
  };

  if (loading || !user || !ready) return null;

  if (noAccess) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-50 px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-lg font-semibold text-primary">
            {t("shared.appShell.noAccessTitle", "Aucun accès configuré")}
          </h1>
          <p className="mt-2 text-sm text-secondary">
            {t(
              "shared.appShell.noAccessDesc",
              "Votre compte n'a encore aucun profil ni habilitation associé. Contactez un administrateur pour qu'il vous en attribue un."
            )}
          </p>
          <button
            type="button"
            onClick={async () => {
              const proceed = await confirmDiscard();
              if (!proceed) return;
              logout();
              router.push("/login");
            }}
            className="mt-5 rounded-full border border-border bg-white px-4 py-2 text-xs font-semibold text-secondary transition hover:border-black"
          >
            {t("topbar.logout", "Déconnexion")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh">
      {/* Sidebar fixe — visible seulement à partir de `lg` (1024px). En dessous, remplacée par le
          bouton hamburger du Topbar + ce drawer coulissant. */}
      <div className="hidden lg:flex">
        <Sidebar
          alertCount={shellAlerts.length}
          pendingApprovalCount={strategicApprovals.pendingCount}
          collapsed={sidebar.collapsed}
          onToggleCollapsed={sidebar.toggle}
        />
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
            role="presentation"
            onClick={() => setMobileNavOpen(false)}
          />
          <Sidebar
            alertCount={shellAlerts.length}
            pendingApprovalCount={strategicApprovals.pendingCount}
            onNavigate={() => setMobileNavOpen(false)}
            className="relative z-10 h-dvh w-[min(248px,85vw)] min-w-0 shadow-xl"
          />
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          // Lot 5 : en mode stratégique, la cloche ne compte (et ne liste) que les alertes du
          // plan actif — jamais les files du Plan Performance.
          alertCount={bellAlertCount({
            isStrategic,
            alerts: shellAlerts.length,
            performanceQueues: [
              approvalQueue.count,
              realizedApprovalQueue.count,
              deletionQueue.count,
            ],
          })}
          alerts={shellAlerts}
          approvalQueue={isStrategic ? [] : approvalQueue.queue}
          realizedApprovalQueue={isStrategic ? [] : realizedApprovalQueue.queue}
          deletionQueue={isStrategic ? [] : deletionQueue.queue}
          alertHref={alertHref}
          onAlertClick={(alert) => {
            const href = alertHref(alert);
            if (href) router.push(href);
          }}
          onMenuClick={() => setMobileNavOpen((v) => !v)}
        />
        <main className="flex-1 overflow-y-auto px-4 pb-10 pt-5 sm:px-6">
          <StrategicApprovalsProvider value={isStrategic ? strategicApprovals : null}>
            {children}
          </StrategicApprovalsProvider>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
