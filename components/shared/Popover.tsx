"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Popover CLIC-pour-ouvrir — se ferme au clic extérieur ou à l'Échap. Distinct de `Tooltip.tsx`
 * (hover-only, purement informatif) : celui-ci porte un contenu potentiellement cliquable/scrollable
 * (ex. liste d'indicateurs à risque), ce qu'un survol ne permet pas de consulter confortablement
 * (voir round 4, point 2).
 *
 * API "trigger + children" façon render-prop — le déclencheur reçoit `{ open, toggle }` pour piloter
 * son propre style actif/pressed, sans imposer de composant `Button` particulier à l'appelant (qui
 * a souvent besoin d'un badge/pastille comme déclencheur, pas d'un bouton standard). Contrairement à
 * `Modal.tsx` (ouverture pilotée par l'appelant via `open`/`onOpenChange`), l'état d'ouverture est
 * géré ICI : un popover est un détail d'interaction locale à un badge, jamais partagé entre plusieurs
 * déclencheurs ni piloté depuis l'extérieur.
 *
 * Pas de portal/positionnement JS (contrairement à un vrai popover Radix) : positionnement CSS
 * `absolute` simple ancré sur le conteneur `relative` du déclencheur, dans l'esprit de `Tooltip.tsx`
 * — largement suffisant pour un badge de carte, pas de gestion de débordement d'écran avancée.
 *
 * Usage :
 * ```tsx
 * <Popover trigger={({ toggle }) => (
 *   <button onClick={(e) => { e.stopPropagation(); toggle(); }}>3 à risque</button>
 * )}>
 *   <MyPopoverContent />
 * </Popover>
 * ```
 */
export function Popover({
  trigger,
  children,
  align = "start",
  className,
  panelClassName,
}: {
  /** Rendu du déclencheur — reçoit l'état d'ouverture courant pour un style pressed/actif éventuel.
   *  L'appelant est responsable d'appeler `e.stopPropagation()` sur son propre `onClick` avant
   *  `toggle()` s'il est monté à l'intérieur d'un élément cliquable parent (ex. une carte). */
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: ReactNode;
  /** Alignement horizontal du panneau par rapport au déclencheur. */
  align?: "start" | "end";
  /** Classes sur le conteneur racine (`relative inline-block` par défaut). */
  className?: string;
  /** Classes additionnelles sur le panneau flottant. */
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative inline-block", className)}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="dialog"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "absolute z-40 mt-1.5 min-w-[220px] max-w-[320px] rounded-md border border-border bg-white p-2.5 text-left shadow-lg",
            align === "end" ? "right-0" : "left-0",
            panelClassName
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
