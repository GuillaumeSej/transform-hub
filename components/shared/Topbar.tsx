"use client";

import { usePathname, useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Menu } from "lucide-react";
import { useEffect, useState } from "react";
import { useRole } from "@/lib/hooks/useRole";

import { roles } from "@/lib/nav-config";
import { ResetDemoButton } from "@/components/shared/ResetDemoButton";
import { Avatar } from "@/components/shared/Avatar";
import type { Company, Role } from "@/types";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/locales";

const CRUMBS: Record<string, string> = {
  "/dashboard": "nav.executiveDashboard",
  "/levers": "nav.leverLibrary",
  "/workstreams": "nav.workstreamDashboard",
  "/finance": "nav.financeModule",
  "/hr": "nav.hrDashboard",
  "/hr/etp": "nav.hrEtp",
  "/operations": "nav.operationsModule",
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
}: {
  alertCount: number;
  role: Role;
  onReset: () => void;
  onMenuClick: () => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies);
    return unsub;
  }, []);

  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useRole();
  const { t } = useTranslation();
  const isLeverDetail = pathname.startsWith("/levers/") && pathname !== "/levers";
  const label = isLeverDetail ? t("topbar.leverDetail") : t(CRUMBS[pathname] ?? "", "BeTrack");

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
    <header className="flex h-[60px] min-h-[60px] items-center justify-between gap-2 border-b border-border bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 text-xs text-secondary">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={t("topbar.menu")}
          className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black lg:hidden"
        >
          <Menu size={16} />
        </button>
        <strong className="truncate font-semibold text-primary">{label}</strong>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <span className="hidden rounded-md border border-border bg-neutral-50 px-3 py-1.5 text-xs font-medium text-primary sm:inline-block">
          {displayName} · {companyLabel}
        </span>
        <span className="sm:hidden" title={`${displayName} · ${companyLabel}`}>
          <Avatar initials={initials || "?"} size="sm" />
        </span>
        <LanguageSwitcher />
        <button
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black"
          aria-label={t("topbar.alerts")}
        >
          <Bell size={14} />
          {alertCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full border-2 border-white bg-bp-coral" />
          )}
        </button>
        {/* Réservé au global admin : ce bouton réinitialise TOUTES les entreprises, pas
            seulement celle de l'utilisateur courant — le rendre visible à tous les rôles était
            un oubli (voir composant CompanyDatabasePanel pour l'équivalent scopé à une seule
            entreprise, réservé lui aussi à l'admin global). */}
        {role === "admin" && <ResetDemoButton onReset={onReset} />}
        <button
          onClick={() => {
            logout();
            router.push("/login");
          }}
          className="flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-black"
          aria-label={t("topbar.logout")}
          title={t("topbar.logout")}
        >
          <LogOut size={14} />
        </button>
      </div>
    </header>
  );
}
