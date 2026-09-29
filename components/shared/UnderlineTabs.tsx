"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type UnderlineTabItem<T extends string> = {
  id: T;
  label: string;
  /** Compteur affiché en petit carré à droite du libellé (absent = pas de compteur, ex. chargement). */
  count?: number;
};

/** Id DOM d'un onglet — à passer en `aria-labelledby` du `role="tabpanel"` associé. */
export function underlineTabId(panelId: string, id: string): string {
  return `${panelId}-tab-${id}`;
}

/**
 * Barre d'onglets soulignée — navigation entre VUES d'une page (≠ `SegmentedControl`, réservé aux
 * bascules de valeur courtes). Onglets texte sur un filet gris, onglet actif à l'encre avec un
 * soulignement coral de 2 px, compteur en petit carré discret (jamais de pastille arrondie).
 * `actions` (filtre, bouton…) se place à droite sur la même ligne ; sur mobile, il passe au-dessus
 * et les onglets défilent horizontalement.
 *
 * Accessibilité : `role="tablist"` / `role="tab"` + `aria-selected`, focus itinérant (seul l'onglet
 * actif est tabulable), flèches gauche/droite, Début / Fin. Le contenu associé doit être rendu dans
 * un `role="tabpanel"` d'id `panelId`, `aria-labelledby={underlineTabId(panelId, value)}`.
 */
export function UnderlineTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  panelId,
  actions,
  className,
}: {
  /** Libellé accessible du groupe d'onglets. */
  label: string;
  items: UnderlineTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  panelId: string;
  actions?: ReactNode;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const select = (index: number) => {
    const i = (index + items.length) % items.length;
    onChange(items[i].id);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        select(index + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        select(index - 1);
        break;
      case "Home":
        e.preventDefault();
        select(0);
        break;
      case "End":
        e.preventDefault();
        select(items.length - 1);
        break;
    }
  };

  return (
    <div
      className={cn(
        "mb-4 flex flex-col-reverse gap-2 border-b border-border sm:flex-row sm:items-end sm:justify-between sm:gap-4",
        className
      )}
    >
      <div
        role="tablist"
        aria-label={label}
        className="-mb-px flex min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item, index) => {
          const active = item.id === value;
          return (
            <button
              key={item.id}
              ref={(el) => {
                refs.current[index] = el;
              }}
              id={underlineTabId(panelId, item.id)}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={active ? panelId : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(item.id)}
              onKeyDown={(e) => onKeyDown(e, index)}
              className={cn(
                "flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-semibold transition-colors first:pl-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bp-coral",
                active
                  ? "border-bp-coral text-primary"
                  : "border-transparent text-tertiary hover:border-neutral-300 hover:text-primary"
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span
                  className={cn(
                    "min-w-[20px] px-1.5 py-px text-center text-[11px] font-semibold tabular-nums leading-4",
                    active ? "bg-neutral-900 text-white" : "bg-neutral-100 text-tertiary"
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:pb-2">{actions}</div>
      )}
    </div>
  );
}
