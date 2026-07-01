"use client";

import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { RoleSwitcher } from "@/components/shared/RoleSwitcher";
import { ResetDemoButton } from "@/components/shared/ResetDemoButton";

const CRUMBS: Record<string, string> = {
  "/dashboard": "Executive Dashboard",
  "/levers": "Lever Library",
  "/workstreams": "Workstreams",
  "/scenarios": "Scenarios",
  "/reporting": "Reporting",
  "/finance": "Finance Module",
  "/hr": "HR Module",
  "/operations": "Operations Module",
  "/governance": "Risks & Alerts",
};

/** Barre supérieure — porté depuis `.topbar` du prototype legacy. */
export function Topbar({ alertCount, onReset }: { alertCount: number; onReset: () => void }) {
  const pathname = usePathname();
  const isLeverDetail = pathname.startsWith("/levers/") && pathname !== "/levers";
  const label = isLeverDetail ? "Détail du levier" : (CRUMBS[pathname] ?? "BeTrack");

  return (
    <header className="flex h-[60px] min-h-[60px] items-center justify-between border-b border-border bg-white px-6">
      <div className="flex items-center gap-2 text-xs text-secondary">
        <strong className="font-semibold text-primary">{label}</strong>
      </div>
      <div className="flex items-center gap-2">
        <RoleSwitcher />
        <button
          className="relative flex h-[34px] w-[34px] items-center justify-center rounded-full border border-border bg-white text-secondary transition hover:border-bp-coral hover:text-bp-coral"
          aria-label="Alertes"
        >
          <Bell size={14} />
          {alertCount > 0 && (
            <span className="absolute right-1.5 top-1.5 h-[7px] w-[7px] rounded-full border-2 border-white bg-bp-coral" />
          )}
        </button>
        <ResetDemoButton onReset={onReset} />
      </div>
    </header>
  );
}
