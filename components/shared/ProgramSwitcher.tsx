"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, FolderKanban, LayoutGrid } from "lucide-react";
import { CONSOLIDATED_PROGRAM_ID, useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useRole } from "@/lib/hooks/useRole";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { resolveProgramType } from "@/lib/axisLogic";
import { getConsolidatedPerformancePrograms } from "@/lib/consolidatedProgramAccess";
import { getAuthorizedPrograms, hasRole } from "@/lib/roleProfiles";

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
 * raison), ni quand il n'y a ni au moins deux programmes autorisés à sélectionner un à un, ni
 * aucune vue consolidée disponible (rien à choisir dans les deux cas).
 *
 * Vue consolidée (fondation chantier CTO multi-programmes) : une entrée "Vue consolidée" apparaît
 * en tête de liste dès que `getConsolidatedPerformancePrograms` (lib/consolidatedProgramAccess.ts)
 * renvoie AU MOINS UN programme pour l'utilisateur courant — y compris un seul. Décision produit
 * volontaire : même avec un unique programme Performance aujourd'hui, l'option reste proposée pour
 * la cohérence de l'UX (un CTO doit toujours pouvoir choisir "vue consolidée" en tant que telle) et
 * pour éviter que l'apparition/disparition de l'option au 2e programme ne force l'utilisateur à
 * réapprendre l'interface. Son libellé s'adapte au rôle : un
 * `cto` voit "tous les programmes de l'entreprise", un `program_sponsor`/`program_owner` voit "tous
 * mes programmes" (son périmètre est nécessairement plus étroit, voir la doc de
 * `getConsolidatedPerformancePrograms`). La sélectionner appelle
 * `setActiveProgramId(CONSOLIDATED_PROGRAM_ID)`, qui bascule `useActiveProgram` en mode
 * `isConsolidatedView`.
 */
export function ProgramSwitcher() {
  const { programs, activeProgram, activeProgramId, isConsolidatedView, setActiveProgramId } =
    useActiveProgram();
  const { t } = useTranslation();
  const { user } = useRole();
  const { confirmDiscard } = useUnsavedChanges();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const authorizedPrograms = getAuthorizedPrograms(user, programs);
  const consolidatedPrograms = getConsolidatedPerformancePrograms(user, programs);
  const canConsolidate = consolidatedPrograms.length >= 1;

  if (!user?.companyId) return null;
  // Le switcher s'affiche dès qu'il y a un choix réel à faire : soit au moins deux programmes
  // sélectionnables un à un, soit une vue consolidée disponible (même avec un seul programme
  // consolidé — voir la doc-comment ci-dessus).
  if (authorizedPrograms.length < 2 && !canConsolidate) return null;

  // Libellé adapté au rôle : un CTO consolide "l'entreprise", un sponsor/owner de programme
  // consolide "ses" programmes (périmètre plus étroit, voir la doc-comment ci-dessus).
  const consolidatedLabel = hasRole(user, "cto")
    ? t("topbar.consolidatedViewCompany", "Vue consolidée — tous les programmes de l'entreprise")
    : t("topbar.consolidatedViewMine", "Vue consolidée — tous mes programmes Performance");

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
    // lecture n'a lieu qu'au clic. Pas de mise à jour `?program=` pour la sélection "vue
    // consolidée" : le dashboard exécutif lit `isConsolidatedView`/`consolidatedPrograms` du
    // contexte directement, pas ce paramètre (un lot ultérieur de la page dashboard décidera si
    // elle veut, elle aussi, un paramètre d'URL dédié partageable).
    if (pathname === "/dashboard" && id !== CONSOLIDATED_PROGRAM_ID) {
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
        title={`${t("topbar.program")} · ${isConsolidatedView ? consolidatedLabel : (activeProgram?.name ?? "")}`}
        className="flex h-[34px] max-w-[130px] items-center gap-1.5 rounded-full border border-border bg-white px-2.5 text-xs font-semibold text-secondary transition hover:border-black sm:max-w-[220px]"
      >
        {isConsolidatedView ? (
          <LayoutGrid size={13} className="flex-shrink-0" />
        ) : (
          <FolderKanban size={13} className="flex-shrink-0" />
        )}
        <span className="truncate">
          {isConsolidatedView
            ? t("topbar.consolidatedViewShort", "Vue consolidée")
            : (activeProgram?.name ?? t("topbar.program"))}
        </span>
        <ChevronDown size={12} className="flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-[38px] z-30 max-h-[320px] min-w-[240px] overflow-y-auto rounded-md border border-border bg-white py-1 shadow-md">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-tertiary">
            {t("topbar.program")}
          </div>
          {canConsolidate && (
            <button
              type="button"
              onClick={() => void select(CONSOLIDATED_PROGRAM_ID)}
              className={`flex w-full items-center gap-1.5 border-b border-border px-3 py-1.5 text-left text-xs font-medium transition hover:bg-neutral-50 ${
                isConsolidatedView ? "font-semibold text-primary" : "text-secondary"
              }`}
            >
              <LayoutGrid size={12} className="flex-shrink-0" />
              <span className="truncate">{consolidatedLabel}</span>
            </button>
          )}
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
