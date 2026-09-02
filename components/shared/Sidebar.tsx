"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { PAGE_ROUTES, roles } from "@/lib/nav-config";
import { assetPath, cn } from "@/lib/utils";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { Avatar } from "@/components/shared/Avatar";
import { GuardedLink } from "@/components/shared/GuardedLink";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
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
  const { programType } = useActiveProgram();
  // Nav filtrée par TYPE de programme actif : un item sans `programTypes` reste visible partout
  // (comportement historique — c'est le cas de tous les items Performance existants), un item
  // restreint n'apparaît que pour les types listés. `programType` vaut "performance" tant qu'aucun
  // programme stratégique n'est actif (voir useActiveProgram), donc la nav d'un utilisateur
  // Performance est strictement identique à ce qu'elle était avant.
  const nav = roles[role].nav.filter(
    (item) => !item.programTypes || item.programTypes.includes(programType)
  );

  return (
    <aside
      className={cn(
        // `h-dvh` (et non `h-screen`/100vh) pour matcher exactement la hauteur du conteneur
        // racine de l'AppShell (`<div className="flex h-dvh">`, voir AppShell.tsx) : sur mobile,
        // 100vh ignore les barres d'outils dynamiques du navigateur alors que 100dvh s'y adapte —
        // un écart entre les deux faisait déborder la sidebar de son conteneur flex, rendait le
        // <body> scrollable, et un simple scroll molette au-dessus du menu décalait alors TOUTE
        // la page (topbar + sidebar comprises) au lieu de rester sans effet. `overflow-hidden`
        // en garde-fou pour qu'aucun contenu interne ne puisse à son tour dépasser cette hauteur.
        "flex h-dvh w-[248px] min-w-[248px] flex-col overflow-hidden bg-black text-white",
        className
      )}
    >
      <div className="border-b border-white/[0.12] px-[18px] pb-4 pt-5">
        <Image
          src={assetPath("/brand/logo-wordmark-white.png")}
          alt="BearingPoint"
          width={150}
          height={26}
          priority
          className="h-[22px] w-auto"
        />
        <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
          {t("login.tagline", "BeTrack · Transformation")}
        </div>
      </div>

      {/* `overscroll-contain` : même si la liste de nav devait un jour dépasser sa hauteur
          disponible, le scroll wheel ne doit jamais "chaîner" vers le body derrière une fois la
          fin de la liste atteinte (cause typique d'un décalage visuel de toute la page). */}
      <nav className="flex-1 overflow-y-auto overscroll-contain px-2.5 py-3">
        <div className="px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
          {t("nav.sectionLabel")}
        </div>
        {nav.map((item) => {
          const Icon = ICON_REGISTRY[item.icon];
          const href = PAGE_ROUTES[item.id] ?? "/dashboard";
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <GuardedLink
              key={item.id}
              href={href}
              onClick={onNavigate}
              className={cn(
                "my-0.5 flex items-center gap-2.5 border-l-2 border-transparent px-3 py-2.5 text-[13px] font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white",
                active && "border-bp-coral bg-white/[0.08] font-semibold text-white"
              )}
            >
              {Icon && <Icon size={15} className="w-4 text-center" />}
              {/* Libellé alternatif selon le type de programme actif (ex. « Bibliothèque des
                  leviers » → « Axes stratégiques » sur la même route /levers) — repli sur `label`
                  quand aucune surcharge n'est définie pour ce type. */}
              <span>{t(item.labelByProgramType?.[programType] ?? item.label)}</span>
              {item.badge === "alerts" && alertCount > 0 && (
                <span className="ml-auto rounded-full bg-bp-coral px-1.5 py-px text-[10px] font-semibold text-white">
                  {alertCount}
                </span>
              )}
            </GuardedLink>
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
