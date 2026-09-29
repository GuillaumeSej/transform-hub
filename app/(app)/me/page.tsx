"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { useMyWorkspace } from "@/lib/hooks/useMyWorkspace";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { programSwitchForLink } from "@/lib/activeProgramSelection";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { SegmentedControl } from "@/components/shared/SegmentedControl";
import { formatDate } from "@/lib/format";
import {
  categoryLabel,
  effectiveCategory,
  filterWorkspaceByPlan,
  greetingName,
  presentPlans,
  summarySentence,
  visibleSections,
  workspaceCounts,
  type PlanFilter,
  type WorkspaceCategory,
} from "@/components/workspace/workspaceView";
import {
  BlockedSection,
  PerimeterSection,
  TodoSection,
  UpcomingSection,
  WorkspaceBreakdown,
  WorkspaceSkeleton,
} from "@/components/workspace/WorkspaceSections";

/** Route `/me` — « Mon espace » : portail personnel COMMUN aux deux plans (Stratégique et
 *  Transfo/Performance), V1 en lecture seule et sans messagerie. La page ne fait qu'afficher le
 *  `MyWorkspace` agrégé par `useMyWorkspace()` (contrat : `lib/myWorkspaceTypes.ts`) ; chaque ligne
 *  renvoie vers l'écran existant où l'action se traite (`item.href`).
 *
 *  Mise en page : mobile = une colonne (À faire → Bloqué → À venir → Périmètre, ordre du DOM) ;
 *  desktop = À faire + Bloqué sur les 2/3 gauches, À venir + Périmètre sur le 1/3 droit.
 *  En tête, la barre de répartition (`WorkspaceBreakdown`) : un clic sur une catégorie filtre la
 *  page sur le seul bloc correspondant (colonne principale, surligné, puce « Filtre : … ✕ »). */
export default function MyWorkspacePage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const { user } = useRole();
  const { workspace, loading } = useMyWorkspace();
  const {
    activeProgramId,
    authorizedPrograms,
    isConsolidatedView,
    consolidatedPrograms,
    setActiveProgramId,
  } = useActiveProgram();
  const [plan, setPlan] = useState<PlanFilter>("all");
  // Filtre de catégorie (barre de répartition) : `null` = tous les blocs.
  const [category, setCategory] = useState<WorkspaceCategory | null>(null);
  // Figé au montage : sert au regroupement « À venir » par semaine calendaire.
  const [today] = useState(() => new Date());

  const todoRef = useRef<HTMLDivElement>(null);
  const upcomingRef = useRef<HTMLDivElement>(null);
  const blockedRef = useRef<HTMLDivElement>(null);

  const plans = useMemo(() => presentPlans(workspace), [workspace]);
  const showPlanFilter = plans.length > 1;
  const view = useMemo(
    () => filterWorkspaceByPlan(workspace, showPlanFilter ? plan : "all"),
    [workspace, plan, showPlanFilter]
  );
  const counts = useMemo(() => workspaceCounts(view), [view]);
  const active = effectiveCategory(category, view);
  const sections = visibleSections(active, view);
  const filterLabel = active ? categoryLabel(active, t) : null;
  const clearFilter = () => setCategory(null);

  // Programme actif UNIQUE (décision PO, audit fix #1) : les éléments du portail peuvent venir
  // d'un autre programme que celui du Topbar (ex. projets stratégiques listés alors qu'un Plan
  // Performance est actif — `useMyWorkspace` charge alors le 1er programme stratégique autorisé).
  // Approche retenue (la plus simple qui reste correcte) : chaque lien porte son `programId`, qu'on
  // ACTIVE juste avant `router.push` — les deux mises à jour sont regroupées dans le même rendu,
  // la page cible s'affiche donc directement sur le bon programme (et le bon type de nav).
  const navigate = (href: string, programId?: string) => {
    const switchTo = programSwitchForLink({
      targetProgramId: programId,
      activeProgramId,
      isConsolidatedView,
      consolidatedProgramIds: consolidatedPrograms.map((p) => p.id),
      selectableProgramIds: authorizedPrograms.map((p) => p.id),
    });
    if (switchTo) setActiveProgramId(switchTo);
    router.push(href);
  };

  // Au changement de filtre : amène le bloc ciblé dans la vue (sans masquer la barre si possible).
  useEffect(() => {
    if (!active) return;
    const ref = active === "upcoming" ? upcomingRef : active === "blocked" ? blockedRef : todoRef;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  const firstName = greetingName(user);
  // Date du jour en toutes lettres (« Mardi 29 septembre »), dans la langue de l'interface.
  const todayLabel = useMemo(() => {
    const s = formatDate(today, { weekday: "long", day: "numeric", month: "long" }, locale);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }, [today, locale]);
  const upcomingBlock = (
    <div ref={upcomingRef} className="scroll-mt-4">
      <UpcomingSection
        items={view.upcoming}
        today={today}
        navigate={navigate}
        t={t}
        filterLabel={active === "upcoming" ? filterLabel : null}
        onClearFilter={clearFilter}
      />
    </div>
  );

  return (
    <div className="animate-fade-up">
      {/* En-tête : sur-titre discret (nom de la page · date du jour), salutation en titre de page
          (même filet coral que les autres écrans), puis la phrase de synthèse. */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
            {t("nav.myWorkspace", "Mon espace")}
            <span aria-hidden className="mx-1.5 text-neutral-300">
              ·
            </span>
            <time
              dateTime={today.toISOString().slice(0, 10)}
              className="normal-case tracking-normal"
            >
              {todayLabel}
            </time>
          </p>
          <h1 className="relative mt-1.5 pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {firstName
              ? t("me.greeting", "Bonjour {name}").replace("{name}", firstName)
              : t("me.greetingAnonymous", "Bonjour")}
          </h1>
          {loading ? (
            <span
              aria-hidden
              className="mt-3 block h-4 w-72 max-w-full animate-pulse bg-neutral-100"
            />
          ) : (
            <p className="mt-3 text-[13px] leading-relaxed text-secondary">
              {summarySentence(counts, t)}
            </p>
          )}
        </div>
        {showPlanFilter && !loading && (
          <SegmentedControl<PlanFilter>
            label={t("me.planFilter", "Plan")}
            value={plan}
            onChange={setPlan}
            options={[
              { value: "all", label: t("me.plan.all", "Tous") },
              { value: "strategic", label: t("me.plan.strategic", "Stratégique") },
              { value: "performance", label: t("me.plan.performance", "Performance") },
            ]}
          />
        )}
      </header>

      {loading ? (
        <WorkspaceSkeleton label={t("me.loading", "Chargement de votre espace…")} />
      ) : (
        <>
          <WorkspaceBreakdown workspace={view} active={active} onSelect={setCategory} t={t} />
          <div className="grid gap-x-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              {sections.includes("todo") && (
                <div ref={todoRef} className="scroll-mt-4">
                  <TodoSection
                    items={view.todo}
                    category={active === "overdue" || active === "toHandle" ? active : null}
                    navigate={navigate}
                    t={t}
                    filterLabel={filterLabel}
                    onClearFilter={clearFilter}
                  />
                </div>
              )}
              {sections.includes("blocked") && (
                <div ref={blockedRef} className="scroll-mt-4">
                  <BlockedSection
                    items={view.blocked}
                    navigate={navigate}
                    t={t}
                    filterLabel={active === "blocked" ? filterLabel : null}
                    onClearFilter={clearFilter}
                  />
                </div>
              )}
              {/* Filtré sur « À venir » : le bloc passe dans la colonne principale. */}
              {active === "upcoming" && upcomingBlock}
            </div>
            <div className="min-w-0">
              {active === null && upcomingBlock}
              <PerimeterSection
                entries={view.perimeter}
                pilotView={view.pilotView}
                navigate={navigate}
                t={t}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
