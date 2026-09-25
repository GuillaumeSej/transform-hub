"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { PAGE_ROUTES, getDisplayRoleDefinition, resolveUserNav } from "@/lib/nav-config";
import { assetPath, cn } from "@/lib/utils";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { Avatar } from "@/components/shared/Avatar";
import { GuardedLink } from "@/components/shared/GuardedLink";
import { useRole } from "@/lib/hooks/useRole";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Clé de traduction du libellé de séparateur pour chaque valeur de `NavItem.section` (voir
 *  types/index.ts) — `"decision"` (ex. "validation", entre le pilotage courant et les données de
 *  référence) et `"reference"` (ex. "hr-etp"/"admin-history", données de référence). Repli sur la
 *  valeur brute de `section` si une nouvelle valeur venait à être ajoutée sans entrée ici. */
const SECTION_LABEL_KEYS: Record<string, string> = {
  decision: "nav.sectionDecision",
  reference: "nav.sectionReferenceData",
};

/** Sidebar noire fixe — brand BearingPoint : wordmark officiel blanc sur noir, item actif
 * marqué par un filet rouge (accent graphique) avec texte blanc (jamais de texte coloré).
 *
 * Réutilisée telle quelle à l'intérieur du drawer mobile (voir AppShell.tsx) — `onNavigate` est
 * fourni dans ce contexte pour refermer le drawer au clic sur un lien de nav ; `className` permet
 * au drawer de remplacer `h-screen` par `h-full` (hauteur du panneau, pas du viewport).
 *
 * Desktop uniquement : `collapsed` réduit la sidebar à un rail d'icônes (64px — logo réduit au
 * symbole, libellés en infobulle, en-têtes de section masqués, avatar seul) et `onToggleCollapsed`
 * affiche le bouton de bascule. Le drawer mobile ne fournit ni l'un ni l'autre : rendu inchangé. */
export function Sidebar({
  alertCount,
  pendingApprovalCount = 0,
  onNavigate,
  className,
  collapsed = false,
  onToggleCollapsed,
}: {
  alertCount: number;
  /** Demandes de validation stratégique à traiter (badge de l'item "Validation"). */
  pendingApprovalCount?: number;
  onNavigate?: () => void;
  className?: string;
  /** Rail d'icônes (desktop) — voir le commentaire du composant. */
  collapsed?: boolean;
  /** Bascule réduit/déplié ; bouton absent si non fourni (drawer mobile). */
  onToggleCollapsed?: () => void;
}) {
  const pathname = usePathname();
  const { user, profiles, isGlobalAdmin, isCompanyAdmin } = useRole();
  const { t } = useTranslation();
  const { programType } = useActiveProgram();
  // Nav filtrée par TYPE de programme actif : un item sans `programTypes` reste visible partout
  // (comportement historique — c'est le cas de tous les items Performance existants), un item
  // restreint n'apparaît que pour les types listés. `programType` vaut "performance" tant qu'aucun
  // programme stratégique n'est actif (voir useActiveProgram), donc la nav d'un utilisateur
  // Performance est strictement identique à ce qu'elle était avant. `resolveUserNav` fait l'union
  // dédupliquée des nav de tous les profils/habilitations de l'utilisateur (round multi-profils).
  const nav = resolveUserNav({ profiles, isGlobalAdmin, isCompanyAdmin }).filter(
    (item) => !item.programTypes || item.programTypes.includes(programType)
  );
  // Libellé/avatar affichés : profil Plan Performance, puis Plan Stratégique, puis admin — sinon
  // repli sur le nom de l'utilisateur (cas théorique d'un compte sans profil ni habilitation).
  const displayRole = getDisplayRoleDefinition({ profiles, isGlobalAdmin, isCompanyAdmin });
  const toggleLabel = collapsed
    ? t("nav.expandSidebar", "Déplier le menu")
    : t("nav.collapseSidebar", "Réduire le menu");

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
        "flex h-dvh flex-col overflow-hidden bg-black text-white transition-[width,min-width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-16 min-w-16" : "w-[248px] min-w-[248px]",
        className
      )}
    >
      {collapsed ? (
        <div className="flex justify-center border-b border-white/[0.12] pb-4 pt-5">
          <Image
            src={assetPath("/brand/logo-symbol-white.png")}
            alt="BearingPoint"
            width={26}
            height={24}
            priority
            className="h-[22px] w-auto"
          />
        </div>
      ) : (
        <div className="border-b border-white/[0.12] px-[18px] pb-4 pt-5">
          <Image
            src={assetPath("/brand/logo-wordmark-white.png")}
            alt="BearingPoint"
            width={150}
            height={26}
            priority
            className="h-[22px] w-auto"
          />
          <div className="mt-2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.14em] text-white/50">
            {t("login.tagline", "BeTrack · Transformation")}
          </div>
        </div>
      )}

      {/* `overscroll-contain` : même si la liste de nav devait un jour dépasser sa hauteur
          disponible, le scroll wheel ne doit jamais "chaîner" vers le body derrière une fois la
          fin de la liste atteinte (cause typique d'un décalage visuel de toute la page). */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-3",
          collapsed ? "px-2" : "px-2.5"
        )}
      >
        {!collapsed && (
          <div className="whitespace-nowrap px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
            {t("nav.sectionLabel")}
          </div>
        )}
        {nav.map((item, index) => {
          const Icon = ICON_REGISTRY[item.icon];
          const href = PAGE_ROUTES[item.id] ?? "/dashboard";
          const active = pathname === href || pathname.startsWith(`${href}/`);
          // Rupture de section optionnelle (ex. séparer "Base ETP", une donnée de référence,
          // du pilotage courant) — n'affiche un séparateur que si cet item déclare une
          // `section` différente de l'item précédent ; sans `section` sur aucun item d'un rôle,
          // la liste reste strictement plate comme avant (comportement historique inchangé).
          const showSectionDivider = !!item.section && item.section !== nav[index - 1]?.section;
          // Libellé alternatif selon le type de programme actif (ex. « Bibliothèque des leviers »
          // → « Feuille de route » sur la même route /levers) — repli sur `label` quand aucune
          // surcharge n'est définie pour ce type.
          const label = t(item.labelByProgramType?.[programType] ?? item.label);
          const approvalsBadge =
            (item.badge === "approvals" || item.id === "validation") &&
            programType === "strategic" &&
            pendingApprovalCount > 0;
          const alertsBadge = item.badge === "alerts" && alertCount > 0;
          return (
            <div key={item.id}>
              {showSectionDivider &&
                item.section &&
                (collapsed ? (
                  // Rail réduit : simple filet de séparation, sans le libellé de section.
                  <div className="mx-1 mt-2 border-t border-white/[0.12] pt-2" />
                ) : (
                  <div className="mt-2 whitespace-nowrap border-t border-white/[0.12] px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/40">
                    {t(SECTION_LABEL_KEYS[item.section] ?? item.section)}
                  </div>
                ))}
              <GuardedLink
                href={href}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
                className={cn(
                  "relative my-0.5 flex items-center border-l-2 border-transparent py-2.5 text-[13px] font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white",
                  collapsed ? "justify-center px-0" : "gap-2.5 px-3",
                  active && "border-bp-coral bg-white/[0.08] font-semibold text-white"
                )}
              >
                {Icon && <Icon size={15} className="w-4 shrink-0 text-center" />}
                {collapsed ? (
                  // Rail réduit : pastille sans chiffre à la place du badge compteur.
                  (approvalsBadge || alertsBadge) && (
                    <span
                      aria-hidden="true"
                      className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-bp-coral"
                    />
                  )
                ) : (
                  <>
                    <span className="whitespace-nowrap">{label}</span>
                    {approvalsBadge && (
                      <span className="ml-auto rounded-full bg-bp-coral px-1.5 py-px text-[10px] font-semibold text-white">
                        {pendingApprovalCount}
                      </span>
                    )}
                    {alertsBadge && (
                      <span className="ml-auto rounded-full bg-bp-coral px-1.5 py-px text-[10px] font-semibold text-white">
                        {alertCount}
                      </span>
                    )}
                  </>
                )}
              </GuardedLink>
            </div>
          );
        })}
      </nav>

      {onToggleCollapsed && (
        <div className={cn("border-t border-white/[0.08] py-2", collapsed ? "px-2" : "px-2.5")}>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={toggleLabel}
            title={toggleLabel}
            className={cn(
              "flex w-full items-center py-2 text-xs font-medium text-white/60 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white",
              collapsed ? "justify-center px-0" : "gap-2.5 px-3"
            )}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} aria-hidden="true" className="shrink-0" />
            ) : (
              <>
                <PanelLeftClose size={16} aria-hidden="true" className="shrink-0" />
                <span className="whitespace-nowrap">{toggleLabel}</span>
              </>
            )}
          </button>
        </div>
      )}

      <div
        className={cn(
          "flex items-center border-t border-white/[0.08] py-3.5",
          collapsed ? "justify-center px-0" : "gap-2.5 px-4"
        )}
        title={
          collapsed
            ? [user?.name, displayRole ? t(displayRole.label) : null].filter(Boolean).join(" · ")
            : undefined
        }
      >
        <Avatar
          initials={(displayRole ? t(displayRole.short) : (user?.name ?? "?"))
            .slice(0, 2)
            .toUpperCase()}
          variant="coral"
        />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-white">{user?.name ?? "—"}</div>
            {displayRole && (
              <div className="truncate text-[10px] text-white/50">{t(displayRole.label)}</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
