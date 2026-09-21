"use client";

import { useEffect, type RefObject } from "react";

/**
 * Ferme un popover/menu ouvert sur clic/toucher hors de `ref` (pointerdown au document, phase
 * capture) ou touche Échap. À utiliser avec un `ref` posé sur le conteneur bouton + panneau.
 */
export function useDismissable(
  open: boolean,
  onClose: () => void,
  ref: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent | MouseEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ref]);
}
