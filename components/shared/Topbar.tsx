"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";

import { roles } from "@/lib/nav-config";
import { ResetDemoButton } from "@/components/shared/ResetDemoButton";
import { ProgramSwitcher } from "@/components/shared/ProgramSwitcher";
import { Avatar } from "@/components/shared/Avatar";
import type { Alert, Company, Role } from "@/types";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/locales";

const CRUMBS: Record<string, string> = {
  "/dashboard": "nav.executiveDashboard",
  "/levers": "nav.leverLibrary",
  "/kpi": "nav.kpi",
  "/workstreams": "nav.workstreamDashboard",
  "/finance": "nav.financeModule",
  "/hr": "nav.hrDashboard",
  "/hr/etp": "nav.hrEtp",
  "/operations": "nav.operationsModule",
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
 * pas seulement admin. Ferme au clic extérieur via `onBlur` (délai pour laisser le clic sur une
 * option s'exécuter avant la fermeture). */
function LanguageSwitcher() {
  const { locale, setLocale, t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
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

/** Barre supérieure — porté depuis `.topbar` du prototype legacy. Le profil est verrouillé pour
 * la session (choisi sur /login) : plus de sélecteur, seulement un bouton de déconnexion. */
export function Topbar({
  alertCount,
  role,
  onReset,
  onMenuClick,
  alerts,
  onAlertClick,
}: {
  alertCount: number;
  role: Role;
  onReset: () => void;
  onMenuClick: () => void;
  alerts: Alert[];
  onAlertClick: (alert: Alert) => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(false);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies);
    return unsub;
  }, []);

  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useRole();
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

  const displayName = user?.name ?? t(roles[role].label);
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
        {/* Sélecteur de programme actif — contrairement au sélecteur de langue, il reste visible
            sur téléphone : le programme actif pilote désormais la nav entière (voir
            ProgramSwitcher), c'est un contrôle de contexte, pas un réglage. Il s'efface de
            lui-même quand l'utilisateur n'a qu'un seul programme. */}
        <ProgramSwitcher />
        {/* Sélecteur de langue — desktop uniquement : sur téléphone il encombrait la barre pour
            une action rarissime en situation de consultation (la langue se choisit au login). */}
        <span className="hidden sm:block">
          <LanguageSwitcher />
        </span>
        <div className="relative">
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
                {alerts.length === 0 ? (
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
                        {alert.title}
                      </span>
                      <span className="mt-1 block line-clamp-2 text-[11px] text-secondary">
                        {alert.desc}
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
              </div>
            </div>
          )}
        </div>
        {/* Réservé au global admin : ce bouton réinitialise TOUTES les entreprises, pas
            seulement celle de l'utilisateur courant — le rendre visible à tous les rôles était
            un oubli (voir composant CompanyDatabasePanel pour l'équivalent scopé à une seule
            entreprise, réservé lui aussi à l'admin global). */}
        {role === "admin" && <ResetDemoButton onReset={onReset} />}
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
