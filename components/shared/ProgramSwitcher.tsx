"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, FolderKanban } from "lucide-react";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useRole } from "@/lib/hooks/useRole";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { resolveProgramType } from "@/lib/axisLogic";
import { getAuthorizedPrograms } from "@/lib/roleProfiles";

/**
 * Sélecteur de PROGRAMME ACTIF dans le Topbar — même pattern de dropdown que le sélecteur de
 * langue voisin (bouton + panneau, fermeture au `onBlur` du conteneur).
 *
 * Round multi-profils : ne liste QUE les programmes que l'utilisateur est autorisé à voir
 * (`getAuthorizedPrograms`, lib/roleProfiles.ts) — un admin (global ou entreprise) voit tous les
 * programmes de l'entreprise, un utilisateur "normal" voit ceux couverts par ses profils (ex. un
 * CTO avec un profil Plan Performance ET un profil Plan Stratégique peut basculer entre les deux ;
 * un utilisateur mono-profil ne voit que les programmes de son type). Ne s'affiche jamais pour un
 * admin GLOBAL (pas de `companyId`, pas de contexte "entreprise" cohérent — voir
 * `useActiveProgram`, qui ne lui attribue déjà aucun `activeProgram` par défaut pour la même
 * raison), ni quand il n'y a qu'un seul programme autorisé (rien à choisir).
 */
export function ProgramSwitcher() {
  const { programs, activeProgram, activeProgramId, setActiveProgramId } = useActiveProgram();
  const { t } = useTranslation();
  const { user } = useRole();
  const { confirmDiscard } = useUnsavedChanges();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const authorizedPrograms = getAuthorizedPrograms(user, programs);

  if (!user?.companyId) return null;
  if (authorizedPrograms.length < 2) return null;

  const select = async (id: string) => {
    // Navigation potentiellement destructrice (édition en cours) — même garde que les liens de nav
    // et la cloche de notifications.
    const proceed = await confirmDiscard();
    if (!proceed) return;

    setActiveProgramId(id);
    setOpen(false);
    // Le dashboard exécutif porte SON scope dans l'URL (`?program=`, pour rester partageable) et
    // se réaligne sur ce paramètre. Changer de programme depuis le Topbar en étant sur cette page
    // doit donc aussi mettre le paramètre à jour, sinon la page continuerait d'afficher l'ancien
    // programme. `window.location.search` plutôt que `useSearchParams()` : ce hook forcerait une
    // frontière Suspense sur TOUTES les pages du groupe (app) au build statique, alors qu'ici la
    // lecture n'a lieu qu'au clic.
    if (pathname === "/dashboard") {
      const params = new URLSearchParams(window.location.search);
      params.set("program", id);
      router.replace(`/dashboard?${params.toString()}`);
    }
  };

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t("topbar.program")}
        aria-expanded={open}
        title={`${t("topbar.program")} · ${activeProgram?.name ?? ""}`}
        className="flex h-[34px] max-w-[130px] items-center gap-1.5 rounded-full border border-border bg-white px-2.5 text-xs font-semibold text-secondary transition hover:border-black sm:max-w-[220px]"
      >
        <FolderKanban size={13} className="flex-shrink-0" />
        <span className="truncate">{activeProgram?.name ?? t("topbar.program")}</span>
        <ChevronDown size={12} className="flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-[38px] z-30 max-h-[320px] min-w-[240px] overflow-y-auto rounded-md border border-border bg-white py-1 shadow-md">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
            {t("topbar.program")}
          </div>
          {authorizedPrograms.map((p) => {
            const active = p.id === activeProgramId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => void select(p.id)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs font-medium transition hover:bg-neutral-50 ${
                  active ? "font-semibold text-primary" : "text-secondary"
                }`}
              >
                <span className="truncate">{p.name}</span>
                {/* Le type est rappelé ici parce qu'il change la navigation entière — sans ce
                    repère, basculer de programme ferait « disparaître » des pages sans raison
                    visible. */}
                <span className="flex-shrink-0 text-[10px] font-semibold uppercase text-tertiary">
                  {t(`programType.${resolveProgramType(p)}`)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
