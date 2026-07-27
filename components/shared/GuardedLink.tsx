"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";

type GuardedLinkProps = Omit<LinkProps, "href"> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
    children?: ReactNode;
  };

/**
 * Wrapper autour de `next/link` qui intercepte le clic pour demander confirmation si des
 * modifications ne sont pas enregistrées (voir `UnsavedChangesProvider`).
 *
 * Comportement :
 *  - Si l'utilisateur tient Ctrl/Cmd/Shift/Alt ou clique avec un autre bouton que gauche
 *    (nouvel onglet/téléchargement/etc.), on laisse `next/link` faire — pas de garde.
 *  - Si la destination = page courante (même pathname), on ne bloque pas non plus (mise à jour
 *    de query params par ex., utilisée pour la persistance des filtres).
 */
export const GuardedLink = forwardRef<HTMLAnchorElement, GuardedLinkProps>(function GuardedLink(
  { href, onClick, ...rest },
  ref
) {
  const router = useRouter();
  const pathname = usePathname();
  const { confirmDiscard, isAnyDirty } = useUnsavedChanges();

  const handleClick = async (event: MouseEvent<HTMLAnchorElement>) => {
    // Laisser filer les clics "spéciaux" : nouvel onglet, télécharger, ctrl-clic, etc.
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      onClick?.(event);
      return;
    }
    if (!isAnyDirty) {
      onClick?.(event);
      return;
    }
    // Extrait le pathname de la cible pour ignorer les navigations "mêmes-pathname" (filtres).
    const targetPathname = href.split(/[?#]/)[0];
    if (targetPathname === pathname) {
      onClick?.(event);
      return;
    }
    event.preventDefault();
    const proceed = await confirmDiscard();
    if (proceed) {
      onClick?.(event);
      router.push(href);
    }
  };

  return <Link ref={ref} href={href} onClick={handleClick} {...rest} />;
});
