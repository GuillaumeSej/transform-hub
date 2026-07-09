"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PAGE_ROUTES, roles } from "@/lib/nav-config";
import { cn } from "@/lib/utils";
import { ICON_REGISTRY } from "@/components/shared/icon-registry";
import { Avatar } from "@/components/shared/Avatar";
import { useRole } from "@/lib/hooks/useRole";
import type { Role } from "@/types";

/** Sidebar noire fixe — porté depuis `.sidebar` du prototype legacy. */
export function Sidebar({ alertCount, role }: { alertCount: number; role: Role }) {
  const pathname = usePathname();
  const { user } = useRole();
  const nav = roles[role].nav;

  return (
    <aside className="flex h-screen w-[248px] min-w-[248px] flex-col bg-neutral-900 text-white">
      <div className="flex items-center gap-2.5 border-b-[3px] border-bp-coral px-[18px] py-4">
        <div className="flex h-[34px] w-[34px] items-center justify-center border-2 border-bp-coral bg-black text-sm font-black text-bp-coral">
          BT
        </div>
        <div className="text-[11px] uppercase tracking-wide text-white/40">
          <strong className="block text-[15px] font-bold normal-case tracking-tight text-white">
            BeTrack
          </strong>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 py-3">
        <div className="px-2.5 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-widest text-white/40">
          Navigation
        </div>
        {nav.map((item) => {
          const Icon = ICON_REGISTRY[item.icon];
          const href = PAGE_ROUTES[item.id] ?? "/dashboard";
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={item.id}
              href={href}
              className={cn(
                "my-0.5 flex items-center gap-2.5 rounded-sm border-l-[3px] border-transparent px-3 py-2.5 text-[13px] font-medium text-white/70 transition hover:bg-white/[0.06] hover:text-white",
                active && "border-bp-coral bg-bp-coral/[0.12] text-bp-coral"
              )}
            >
              {Icon && <Icon size={15} className="w-4 text-center" />}
              <span>{item.label}</span>
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
        <Avatar initials={roles[role].short.slice(0, 2).toUpperCase()} variant="coral" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-white">
            {user?.name ?? roles[role].label}
          </div>
          <div className="text-[10px] text-white/50">{roles[role].label}</div>
        </div>
      </div>
    </aside>
  );
}
