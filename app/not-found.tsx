"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { trailingSlashRedirectTarget } from "@/lib/notFoundRedirect";
import { assetPath } from "@/lib/utils";

/**
 * Page 404 (exportée en out/404.html, servie par GitHub Pages pour toute URL inconnue).
 *
 * Rattrapage du slash final : `/transform-hub/login/` est une 404 sur GitHub Pages alors que
 * `/transform-hub/login` existe (voir lib/notFoundRedirect.ts). Si l'URL se termine par « / » et
 * que la même URL sans slash répond, on y redirige (requête + ancre conservées, basePath inclus
 * puisqu'il fait partie de `location.pathname`) ; sinon on affiche « Page introuvable ».
 */
export default function NotFound() {
  const { t } = useTranslation();
  // "checking" tant qu'une redirection est envisagée : évite le flash « Page introuvable ».
  const [state, setState] = useState<"checking" | "notFound">("checking");

  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const target = trailingSlashRedirectTarget(
      pathname,
      search,
      hash,
      process.env.NEXT_PUBLIC_BASE_PATH ?? ""
    );
    if (!target) {
      setState("notFound");
      return;
    }
    let cancelled = false;
    // Vérifie que la route sans slash existe (sinon : 404 directe, pas de redirection inutile).
    const pathOnly = target.replace(/[?#].*$/, "");
    fetch(pathOnly, { method: "HEAD", cache: "no-store" })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) window.location.replace(target);
        else setState("notFound");
      })
      .catch(() => {
        // Vérification impossible (hors ligne…) : la redirection reste sûre (l'URL cible n'a
        // plus de slash final, donc aucune boucle possible).
        if (!cancelled) window.location.replace(target);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") return <div className="min-h-screen bg-black" />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-6 py-10">
      <div className="w-full max-w-sm">
        <Image
          src={assetPath("/brand/logo-wordmark-white.png")}
          alt="BearingPoint"
          width={210}
          height={36}
          priority
          className="h-[30px] w-auto"
        />
        <div className="mt-8 bp-overline !text-white/50">404</div>
        <h1 className="mt-2 text-3xl font-bold leading-[1.05] tracking-tight text-white">
          {t("notFound.title", "Page introuvable")}
        </h1>
        <p className="mt-3 text-sm text-white/70">
          {t(
            "notFound.message",
            "La page demandée n'existe pas ou a été déplacée. Vérifiez l'adresse ou revenez à l'accueil."
          )}
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-sm bg-white px-3 py-2.5 text-sm font-bold text-black transition hover:bg-neutral-200"
        >
          {t("notFound.home", "Retour à l'accueil")}
        </Link>
      </div>
    </div>
  );
}
