"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Bloc de section repliable — même style de titre que l'ancien OverviewSectionTitle (trait
 *  coral + libellé capitalé) mais cliquable, avec un chevron qui pivote. Ouvert par défaut pour
 *  ne rien cacher à l'arrivée sur la page ; replier est un choix de lecture, pas l'état initial. */
export function Collapsible({
  title,
  defaultOpen = true,
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-3 flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span className="inline-block h-[2px] w-6 rounded-full bg-bp-coral" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-secondary">
          {title}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            "ml-auto text-tertiary transition-transform duration-150",
            open ? "rotate-180" : "rotate-0"
          )}
        />
      </button>
      {open && children}
    </div>
  );
}
