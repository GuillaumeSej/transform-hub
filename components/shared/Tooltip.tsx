"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Tooltip stylé — fond sombre, flèche, apparition progressive après 300ms de hover.
 *  Entièrement CSS (pas de portals ni de JS de positionnement), réutilisable partout.
 *
 *  Usage :
 *  ```tsx
 *  <Tooltip text="Explication au survol">
 *    <button>Élément survolé</button>
 *  </Tooltip>
 *  ``` */
export function Tooltip({
  text,
  position = "top",
  children,
}: {
  text: string;
  position?: "top" | "bottom";
  children: ReactNode;
}) {
  if (!text) return <>{children}</>;
  return (
    <span className="group/tip relative inline-flex">
      {children}
      <span
        className={cn(
          // Base
          "pointer-events-none invisible absolute z-50 w-max max-w-[240px] rounded-md bg-neutral-800 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-white opacity-0 shadow-lg",
          // Animation with delay
          "transition-all duration-150 group-hover/tip:visible group-hover/tip:opacity-100 group-hover/tip:delay-300",
          // Position
          position === "top" && "bottom-full left-1/2 mb-2 -translate-x-1/2",
          position === "bottom" && "top-full left-1/2 mt-2 -translate-x-1/2"
        )}
        role="tooltip"
      >
        {text}
        {/* Arrow */}
        <span
          className={cn(
            "absolute left-1/2 -translate-x-1/2 border-[5px] border-transparent",
            position === "top" && "top-full border-t-neutral-800",
            position === "bottom" && "bottom-full border-b-neutral-800"
          )}
        />
      </span>
    </span>
  );
}
