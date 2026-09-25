"use client";

import { fmtCurr } from "@/lib/engine";

import { useDismissable } from "@/lib/hooks/useDismissable";
import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Menu } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { ProgramSwitcher } from "@/components/shared/ProgramSwitcher";

import { getDisplayRoleDefinition } from "@/lib/nav-config";
import { displayMilestoneId } from "@/lib/axisLogic";
import type {
  MilestoneApprovalQueueEntry,
  RealizedApprovalEntry,
} from "@/lib/hooks/useApprovalQueue";
import { Avatar } from "@/components/shared/Avatar";
import type { Alert, Company, Lever } from "@/types";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { STATUS_SHORT_LABEL } from "@/lib/status-config";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { alertDesc, alertTitle } from "@/lib/alertText";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/locales";

const CRUMBS: Record<string, string> = {
  "/me": "nav.myWorkspace",
  "/dashboard": "nav.executiveDashboard",
  "/levers": "nav.leverLibrary",
  "/kpi": "nav.kpi",
  "/effectifs": "nav.effectifs",
  "/workstreams": "nav.workstreamDashboard",
  "/finance": "nav.financeModule",
  "/hr": "nav.hrDashboard",
  "/hr/etp": "nav.hrEtp",
  "/operations": "nav.operationsModule",
  "/validation": "nav.validation",
  "/profile": "profile.title",
};

/** Fil d'ariane des routes PARTAGÉES entre les deux types de programme : `/levers` sert aussi le
 *  portefeuille d'axes stratégiques (même route, contenu routé selon le programme actif), il ne
 *  doit donc pas s'annoncer « Bibliothèque des leviers » dans ce contexte — même relabeling que la
 *  nav (`NavItem.labelByProgramType`, voir lib/nav-config.ts). Vide pour "performance" : le
 *  comportement historique reste strictement inchangé. */
const STRATEGIC_CRUMBS: Record<string, string> = {
  "/levers": "nav.axes",
};

/** Petit sélecteur de langue (texte seul, pas de drapeaux) — disponible pour tous les profils,
 * pas seulement admin. Ferme au clic extérieur via `useDismissable` (pointerdown hors du composant + Échap). */
function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismissable(open, () => setOpen(false), rootRef);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("topbar.language")}
        title={t("topbar.language")}
        className="flex h-[34px] items-center gap-1 rounded-full border border-border bg-white px-2.5 text-xs font-semibold text-secondary transition hover:border-black"
      >
        {locale.toUpperCase()}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-[38px] z-20 min-w-[140px] overflow-hidden rounded-md border border-border bg-white py-1 shadow-md">
          {LOCALES.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => {
                setLocale(l);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium transition hover:bg-neutral-50 ${
                l === locale ? "text-primary font-semibold" : "text-secondary"
              }`}
            >
              {LOCALE_LABELS[l]}
              <span className="text-[10px] text-tertiary">{l.toUpperCase()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Barre supérieure — porté depuis `.topbar` du prototype legacy. Le PROFIL (rôle) est verrouillé
 * pour la session (choisi sur /login), mais le PROGRAMME actif reste sélectionnable ici via
 * `ProgramSwitcher` quand l'utilisateur en a plusieurs autorisés (round multi-profils). */
export function Topbar({
  alertCount,
  onMenuClick,
  alerts,
  onAlertClick,
  approvalQueue = [],
  milestoneApprovalQueue = [],
  realizedApprovalQueue = [],
  deletionQueue = [],
}: {
  alertCount: number;
  onMenuClick: () => void;
  alerts: Alert[];
  onAlertClick: (alert: Alert) => void;
  /** File d'attente de validation en cascade (owner -> sponsor -> cto, voir
   *  lib/hooks/useApprovalQueue.ts) concernant l'utilisateur courant — affichée en section
   *  distincte du dropdown de notifications ci-dessous. Optionnel (défaut vide) pour ne pas
   *  casser un éventuel autre appelant de `Topbar` qui ne la fournirait pas encore. Plan
   *  Performance uniquement — voir `milestoneApprovalQueue` ci-dessous pour le pendant Plan
   *  Stratégique. */
  approvalQueue?: Lever[];
  /** Pendant Plan Stratégique de `approvalQueue` ci-dessus (round "jalon validation gate") :
   *  projets dont la demande de validation de JALON attend cet utilisateur (`strategic_lead` scopé
   *  programme, ou admin — voir `lib/hooks/useApprovalQueue.ts::useMilestoneApprovalQueue`).
   *  Structurellement vide en mode Plan Performance (aucun `ChantierAction` chargé), et
   *  réciproquement pour `approvalQueue` en mode Plan Stratégique — les deux sections ne
   *  s'affichent donc jamais en même temps en pratique, même mécanisme que `AppShell.tsx`'s
   *  `approvalQueue`/`shellAlerts`. */
  milestoneApprovalQueue?: MilestoneApprovalQueueEntry[];
  /** Impacts cochés « Réalisé » en attente de validation finance (profil finance uniquement,
   *  voir `useRealizedApprovalQueue`) — la décision se prend dans la page Validation. */
  realizedApprovalQueue?: RealizedApprovalEntry[];
  /** Leviers dont la suppression attend la confirmation de l'utilisateur (CTO ↔ responsable de
   *  chantier, voir `useDeletionQueue`). */
  deletionQueue?: Lever[];
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const alertsRef = useRef<HTMLDivElement>(null);
  useDismissable(alertsOpen, () => setAlertsOpen(false), alertsRef);
  const { logout, user, profiles, isGlobalAdmin, isCompanyAdmin } = useRole();

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies, user?.companyId ?? null);
    return unsub;
  }, [user?.companyId]);

  const pathname = usePathname();
  const router = useRouter();
  const { t } = useTranslation();
  const { confirmDiscard } = useUnsavedChanges();
  const { programType } = useActiveProgram();
  const isLeverDetail = pathname.startsWith("/levers/") && pathname !== "/levers";
  const isStrategic = programType === "strategic";
  const label = isLeverDetail
    ? t(isStrategic ? "topbar.axisDetail" : "topbar.leverDetail")
    : t(
        (isStrategic ? STRATEGIC_CRUMBS[pathname] : undefined) ?? CRUMBS[pathname] ?? "",
        "BeTrack"
      );

  const companyLabel = user?.companyId
    ? (companies.find((c) => c.id === user.companyId)?.name ?? user.companyId)
    : t("topbar.global");

  const displayRole = getDisplayRoleDefinition({ profiles, isGlobalAdmin, isCompanyAdmin });
  const displayName = user?.name ?? (displayRole ? t(displayRole.label) : "—");
  const initials = displayName
    .split(" ")
    .map((x) => x[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-[60px] min-h-[60px] items-center justify-between gap-1 border-b border-border bg-white px-2 sm:gap-2 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-xs text-secondary">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={t("topbar.menu")}
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black lg:hidden"
        >
          <Menu size={16} />
        </button>
        <strong className="truncate font-semibold text-primary">{label}</strong>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1 sm:gap-2">
        <span className="hidden rounded-md border border-border bg-neutral-50 px-3 py-1.5 text-xs font-medium text-primary sm:inline-block">
          {displayName} · {companyLabel}
        </span>
        <span
          className="hidden min-[360px]:inline sm:hidden"
          title={`${displayName} · ${companyLabel}`}
        >
          <Avatar initials={initials || "?"} size="sm" />
        </span>
        <ProgramSwitcher />
        {/* Sélecteur de langue — desktop uniquement : sur téléphone il encombrait la barre pour
            une action rarissime en situation de consultation (la langue se choisit au login). */}
        <span className="hidden sm:block">
          <LanguageSwitcher />
        </span>
        <div className="relative" ref={alertsRef}>
          <button
            onClick={() => setAlertsOpen((open) => !open)}
            className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black sm:h-[34px] sm:w-[34px]"
            aria-label={`${t("topbar.alerts")} (${alertCount})`}
            aria-expanded={alertsOpen}
          >
            <Bell size={14} />
            {alertCount > 0 && (
              <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-bp-coral px-1 text-[9px] font-bold text-white">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
          </button>
          {alertsOpen && (
            <div className="absolute right-0 top-10 z-30 w-[calc(100vw-1rem)] max-w-[340px] overflow-hidden rounded-lg border border-border bg-white shadow-xl">
              <div className="border-b border-border px-4 py-3 text-xs font-bold text-primary">
                {t("shared.topbar.notificationsToProcess", "Notifications à traiter · {n}").replace(
                  "{n}",
                  String(alertCount)
                )}
              </div>
              <div className="max-h-[360px] overflow-y-auto">
                {alerts.length === 0 &&
                approvalQueue.length === 0 &&
                milestoneApprovalQueue.length === 0 &&
                realizedApprovalQueue.length === 0 &&
                deletionQueue.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-tertiary">
                    {t("shared.topbar.noNotifications", "Aucune notification à traiter.")}
                  </p>
                ) : (
                  alerts.map((alert) => (
                    <button
                      key={alert.id}
                      type="button"
                      onClick={async () => {
                        // Bloc de notifications = navigation vers /levers/detail. On protège de
                        // la même manière que la sidebar : si l'utilisateur a une modif en cours,
                        // on lui demande avant d'ouvrir le levier.
                        const proceed = await confirmDiscard();
                        if (!proceed) return;
                        setAlertsOpen(false);
                        onAlertClick(alert);
                      }}
                      className="block w-full border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-neutral-50"
                    >
                      <span className="block text-xs font-semibold text-primary">
                        {alertTitle(t, alert)}
                      </span>
                      <span className="mt-1 block line-clamp-2 text-[11px] text-secondary">
                        {alertDesc(t, alert)}
                      </span>
                      <span className="mt-1.5 block text-[10px] font-semibold uppercase text-tertiary">
                        {alert.source === "auto"
                          ? t("shared.topbar.sourceAuto", "Automatique")
                          : t("shared.topbar.sourceManual", "Manuelle")}{" "}
                        {/* Les alertes du Plan Performance portent un id de levier lisible
                            (`L###`) ; celles du Plan Stratégique référencent des ids générés
                            (`CH-…`, `IND-…`) et fournissent donc un libellé humain. */}
                        · {alert.scopeLabel ?? alert.scope}
                      </span>
                    </button>
                  ))
                )}
                {/* Section distincte "Validations en attente" — leviers dont la demande de
                    validation (sponsor OU cto) attend l'utilisateur courant, voir
                    lib/hooks/useApprovalQueue.ts. Séparation visuelle claire (bordure + sous-titre)
                    plutôt qu'un onglet : le dropdown n'a pas de structure à onglets existante.
                    Liste courte (badge de notification) — la page /validation offre la vue
                    complète avec actions inline. */}
                {realizedApprovalQueue.length > 0 && (
                  <div className="border-t-2 border-border">
                    <div className="bg-neutral-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-tertiary">
                      {t("validation.realized.title", "Réalisés à valider")}
                    </div>
                    {realizedApprovalQueue.map(({ lever, impact }) => (
                      <button
                        key={`${lever.id}-${impact.id}`}
                        type="button"
                        onClick={async () => {
                          const proceed = await confirmDiscard();
                          if (!proceed) return;
                          setAlertsOpen(false);
                          router.push("/validation");
                        }}
                        className="block w-full border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-neutral-50"
                      >
                        <span className="block text-xs font-semibold text-primary">
                          {lever.name}
                        </span>
                        <span className="mt-1 block text-[11px] text-secondary">
                          {impact.label}
                        </span>
                        <span className="mt-1.5 block text-[10px] font-semibold uppercase text-tertiary">
                          {t(
                            "shared.topbar.realizedPending",
                            "Réalisé à valider · {amount}"
                          ).replace("{amount}", fmtCurr(impact.amount))}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {deletionQueue.length > 0 && (
                  <div className="border-t-2 border-border">
                    <div className="bg-neutral-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-tertiary">
                      {t("validation.deletion.title", "Suppressions à confirmer")}
                    </div>
                    {deletionQueue.map((lever) => (
                      <button
                        key={lever.id}
                        type="button"
                        onClick={async () => {
                          const proceed = await confirmDiscard();
                          if (!proceed) return;
                          setAlertsOpen(false);
                          router.push("/validation");
                        }}
                        className="block w-full border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-neutral-50"
                      >
                        <span className="block text-xs font-semibold text-primary">
                          {lever.name}
                        </span>
                        <span className="mt-1.5 block text-[10px] font-semibold uppercase text-tertiary">
                          {t(
                            "shared.topbar.deletionPending",
                            "Suppression demandée par {name}"
                          ).replace("{name}", lever.deletionRequest?.requestedByName ?? "")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {approvalQueue.length > 0 && (
                  <div className="border-t-2 border-border">
                    <div className="bg-neutral-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-tertiary">
                      {t("shared.topbar.pendingApprovals", "Validations en attente")}
                    </div>
                    {approvalQueue.map((lever) => (
                      <button
                        key={lever.id}
                        type="button"
                        onClick={async () => {
                          // Même garde-fou que les alertes ci-dessus : ne pas perdre une saisie en
                          // cours en naviguant vers la fiche détail du levier.
                          const proceed = await confirmDiscard();
                          if (!proceed) return;
                          setAlertsOpen(false);
                          router.push(`/levers/detail?id=${lever.id}`);
                        }}
                        className="block w-full border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-neutral-50"
                      >
                        <span className="block text-xs font-semibold text-primary">
                          {lever.name}
                        </span>
                        <span className="mt-1.5 block text-[10px] font-semibold uppercase text-tertiary">
                          {t(
                            "shared.topbar.approvalPending",
                            "En attente · commanditaire ou CTO · {stage}"
                          ).replace(
                            "{stage}",
                            lever.approval ? STATUS_SHORT_LABEL[lever.approval.targetStatus] : ""
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {/* Pendant Plan Stratégique de la section ci-dessus (round "jalon validation
                    gate") : projets en attente de validation de jalon, voir le doc-comment de
                    `milestoneApprovalQueue` plus haut. Même structure visuelle (bordure + sous-
                    titre), navigue vers la fiche projet plutôt que la fiche levier. */}
                {milestoneApprovalQueue.length > 0 && (
                  <div className="border-t-2 border-border">
                    <div className="bg-neutral-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-tertiary">
                      {t("shared.topbar.pendingApprovals", "Validations en attente")}
                    </div>
                    {milestoneApprovalQueue.map(({ action, chantier }) => (
                      <button
                        key={action.id}
                        type="button"
                        onClick={async () => {
                          const proceed = await confirmDiscard();
                          if (!proceed) return;
                          setAlertsOpen(false);
                          router.push(`/levers?chantier=${chantier.id}&action=${action.id}`);
                        }}
                        className="block w-full border-b border-border px-4 py-3 text-left transition last:border-0 hover:bg-neutral-50"
                      >
                        <span className="block text-xs font-semibold text-primary">
                          {action.name}
                        </span>
                        <span className="mt-1.5 block text-[10px] font-semibold uppercase text-tertiary">
                          {t(
                            "shared.topbar.milestoneApprovalPending",
                            "En attente · pilote stratégique · jalon {milestone}"
                          ).replace(
                            "{milestone}",
                            action.milestoneApproval
                              ? displayMilestoneId(action.milestoneApproval.targetMilestone)
                              : ""
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={async () => {
            // La déconnexion perdra tout le travail non enregistré — on demande confirmation.
            const proceed = await confirmDiscard();
            if (!proceed) return;
            logout();
            router.push("/login");
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black sm:h-[34px] sm:w-[34px]"
          aria-label={t("topbar.logout")}
          title={t("topbar.logout")}
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
