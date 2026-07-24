"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { PAGE_ROUTES, roles } from "@/lib/nav-config";
import { cn } from "@/lib/utils";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { Avatar } from "@/components/shared/Avatar";
import { useRole } from "@/lib/hooks/useRole";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Role } from "@/types";

/** Sidebar noire fixe — brand BearingPoint : wordmark officiel blanc sur noir, item actif
 * marqué par un filet rouge (accent graphique) avec texte blanc (jamais de texte coloré).
 *
 * Réutilisée telle quelle à l'intérieur du drawer mobile (voir AppShell.tsx) — `onNavigate` est
 * fourni dans ce contexte pour refermer le drawer au clic sur un lien de nav ; `className` permet
 * au drawer de remplacer `h-screen` par `h-full` (hauteur du panneau, pas du viewport). */
export function Sidebar({
  alertCount,
  role,
  onNavigate,
  className,
}: {
  alertCount: number;
  role: Role;
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const { user } = useRole();
  const { t } = useTranslation();
  const nav = roles[role].nav;

  return (
    <aside
      className={cn(
        "flex h-screen w-[248px] min-w-[248px] flex-col bg-black text-white",
        className
      )}
    >
      <div className="border-b border-white/[0.12] px-[18px] pb-4 pt-5">
        <Image
          src="/brand/logo-wordmark-white.png"
          alt="BearingPoint"
          width={150}
          height={26}
          priority
          className="h-[22px] w-auto"
        />
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
          BeTrack · Transformation
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
          {t("nav.sectionLabel")}
        </div>
        {nav.map((item) => {
          const Icon = ICON_REGISTRY[item.icon];
          const href = PAGE_ROUTES[item.id] ?? "/dashboard";
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={item.id}
              href={href}
              onClick={onNavigate}
              className={cn(
                "my-0.5 flex items-center gap-2.5 border-l-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white",
                active && "border-bp-coral bg-white/[0.08] font-semibold text-white"
              )}
            >
              {Icon && <Icon size={15} className="w-4 text-center" />}
              <span>{t(item.label)}</span>
              {item.badge === "alerts" && alertCount > 0 && (
                <span className="ml-auto rounded-full bg-bp-coral px-1.5 py-px text-[10px] font-semibold text-white">
                  {alertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-2.5 border-t border-white/[0.08] px-4 py-3.5">
        <Avatar initials={t(roles[role].short).slice(0, 2).toUpperCase()} variant="coral" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-white">
            {user?.name ?? t(roles[role].label)}
          </div>
          <div className="text-[10px] text-white/50">{t(roles[role].label)}</div>
        </div>
      </div>
    </aside>
  );
}
