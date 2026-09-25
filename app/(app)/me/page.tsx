"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/lib/hooks/useRole";
import { useMyWorkspace } from "@/lib/hooks/useMyWorkspace";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { SegmentedControl } from "@/components/shared/SegmentedControl";
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
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useRole();
  const { workspace, loading } = useMyWorkspace();
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

  const navigate = (href: string) => router.push(href);

  // Au changement de filtre : amène le bloc ciblé dans la vue (sans masquer la barre si possible).
  useEffect(() => {
    if (!active) return;
    const ref = active === "upcoming" ? upcomingRef : active === "blocked" ? blockedRef : todoRef;
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [active]);

  const firstName = greetingName(user);
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
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("nav.myWorkspace", "Mon espace")}
          </h1>
          <p className="mt-3 text-[14px] font-semibold text-primary">
            {firstName
              ? t("me.greeting", "Bonjour {name}").replace("{name}", firstName)
              : t("me.greetingAnonymous", "Bonjour")}
          </p>
          {!loading && (
            <p className="mt-0.5 text-[13px] text-secondary">{summarySentence(counts, t)}</p>
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
              { value: "performance", label: t("me.plan.performance", "Transfo") },
            ]}
          />
        )}
      </div>

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
