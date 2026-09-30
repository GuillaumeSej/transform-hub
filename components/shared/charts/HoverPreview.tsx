"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Aperçu au survol des graphiques du tableau de bord (retour PO) — rendu dans un PORTAIL sur
 * `document.body`, en position fixe, pour ne jamais être rogné par la carte du graphique
 * (`overflow: hidden`) ni recouvert par le widget voisin. La position suit la souris et se
 * recale pour rester ENTIÈREMENT dans la fenêtre : bascule à gauche du curseur près du bord droit,
 * au-dessus près du bas, et jamais au-delà d'une marge de 8 px.
 *
 * Usage :
 *   <ChartHoverArea>            ← enveloppe le graphique, suit la souris
 *     ...graphique...
 *     {hovered && <FloatingPreview>{contenu}</FloatingPreview>}
 *   </ChartHoverArea>
 * Avec Recharts : `<Tooltip wrapperStyle={HIDDEN_TOOLTIP_WRAPPER} content={(p) => p.active ?
 * <FloatingPreview>…</FloatingPreview> : null} />` — le conteneur natif du Tooltip reste monté
 * mais invisible, seul le portail s'affiche (voir `SCurveChart`).
 */

type Point = { x: number; y: number } | null;

type PointerStore = {
  get: () => Point;
  set: (p: Point) => void;
  subscribe: (cb: () => void) => () => void;
};

function createPointerStore(): PointerStore {
  let point: Point = null;
  const listeners = new Set<() => void>();
  return {
    get: () => point,
    set: (p) => {
      point = p;
      listeners.forEach((l) => l());
    },
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

const PointerContext = createContext<PointerStore | null>(null);

/** Style du conteneur natif du `Tooltip` Recharts quand son contenu est rendu via
 *  `FloatingPreview` : le conteneur reste monté (sinon Recharts ne rend pas le contenu) mais
 *  n'occupe aucune place et ne capte pas la souris. */
export const HIDDEN_TOOLTIP_WRAPPER = {
  outline: "none",
  pointerEvents: "none" as const,
  width: 0,
  height: 0,
  overflow: "visible",
  visibility: "visible" as const,
};

/** Enveloppe un graphique : mémorise la position de la souris (sans re-rendre le graphique) pour
 *  les `FloatingPreview` qu'il contient. */
export function ChartHoverArea({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const storeRef = useRef<PointerStore | null>(null);
  if (!storeRef.current) storeRef.current = createPointerStore();
  const store = storeRef.current;
  return (
    <PointerContext.Provider value={store}>
      <div
        className={className ?? "relative"}
        onMouseMove={(e) => store.set({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => store.set(null)}
      >
        {children}
      </div>
    </PointerContext.Provider>
  );
}

const OFFSET = 16;
const MARGIN = 8;

/** Calcule la position (coin haut-gauche) d'une boîte `w`×`h` près du curseur, entièrement
 *  visible dans une fenêtre `vw`×`vh`. Exportée pour les tests. */
export function placePreview(
  cursor: { x: number; y: number },
  size: { w: number; h: number },
  viewport: { w: number; h: number }
): { left: number; top: number } {
  let left = cursor.x + OFFSET;
  if (left + size.w > viewport.w - MARGIN) left = cursor.x - OFFSET - size.w;
  left = Math.max(MARGIN, Math.min(left, viewport.w - MARGIN - size.w));
  let top = cursor.y + OFFSET;
  if (top + size.h > viewport.h - MARGIN) top = cursor.y - OFFSET - size.h;
  top = Math.max(MARGIN, Math.min(top, viewport.h - MARGIN - size.h));
  return { left, top };
}

/** Pop-up d'aperçu rendue au-dessus de la page, près du curseur, toujours entièrement visible.
 *  Ne capte jamais la souris (le clic atteint le graphique en dessous). */
export function FloatingPreview({ children }: { children: ReactNode }) {
  const store = useContext(PointerContext);
  const subscribe = useCallback(
    (cb: () => void) => (store ? store.subscribe(cb) : () => {}),
    [store]
  );
  const cursor = useSyncExternalStore(
    subscribe,
    () => store?.get() ?? null,
    () => null
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // Mesure la pop-up à chaque changement de contenu (ou apparition) pour la recaler dans la
  // fenêtre ; `setSize` ne déclenche un rendu que si la taille change réellement.
  const visible = cursor !== null;
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
  }, [children, visible]);
  if (!cursor || typeof document === "undefined") return null;
  const pos = size
    ? placePreview(cursor, size, { w: window.innerWidth, h: window.innerHeight })
    : { left: cursor.x + OFFSET, top: cursor.y + OFFSET };
  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      className="pointer-events-none fixed z-[1000]"
      style={{ left: pos.left, top: pos.top, visibility: size ? "visible" : "hidden" }}
    >
      {children}
    </div>,
    document.body
  );
}
