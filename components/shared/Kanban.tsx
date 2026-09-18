"use client";

import { cn } from "@/lib/utils";
import { Avatar } from "@/components/shared/Avatar";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { DeclaredProgressBadge } from "@/components/shared/DeclaredProgressBadge";
import { displayedProgressPct, fmtCurr } from "@/lib/engine";
import { STATUS_CYCLE, STATUS_LABEL } from "@/lib/status-config";
import { workstreamDeclaredProgress } from "@/lib/workstreamLogic";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Lever, LeverStatus, Workstream } from "@/types";

/** Grille de colonnes par statut (le corps historique du Kanban, round <n> : extrait de `Kanban`
 *  ci-dessous pour être répété une fois par swimlane workstream sans dupliquer le rendu carte). */
function StatusColumns({
  levers,
  onCardClick,
  stageOrder,
  stageLabel,
}: {
  levers: Lever[];
  onCardClick: (id: string) => void;
  stageOrder: LeverStatus[];
  stageLabel: (status: LeverStatus) => string;
}) {
  const { t } = useTranslation();
  const COLUMNS: { status: LeverStatus; label: string }[] = stageOrder.map((status) => ({
    status,
    label: stageLabel(status),
  }));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 min-[1101px]:grid-cols-5">
      {COLUMNS.map((col) => {
        const list = levers.filter((l) => l.status === col.status);
        return (
          <div
            key={col.status}
            className="min-h-[200px] rounded-lg border border-border bg-neutral-50 p-2.5"
          >
            <div className="flex items-center justify-between px-2 pb-2.5 pt-1">
              <div className="text-[11.5px] font-bold uppercase tracking-wide text-primary">
                {col.label}
              </div>
              <div className="rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-secondary">
                {list.length}
              </div>
            </div>
            {list.length === 0 && (
              <div className="py-5 text-center text-[11px] text-tertiary">
                {t("shared.kanban.noItems", "Aucun")}
              </div>
            )}
            {list.map((l) => (
              <button
                key={l.id}
                onClick={() => onCardClick(l.id)}
                className={cn(
                  "mb-2 block w-full rounded-sm border border-border bg-white p-2.5 text-left transition hover:-translate-y-px hover:border-black hover:shadow-sm"
                )}
              >
                <div className="mb-1.5 text-xs font-semibold text-primary">{l.name}</div>
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-secondary">
                    {l.code}
                  </span>
                  <span className="text-[12.5px] font-bold text-primary">
                    {fmtCurr(l.netSavings)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <ProgressBar pct={displayedProgressPct(l)} showLabel={false} className="flex-1" />
                  <Avatar initials={l.ownerInit} size="sm" />
                </div>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/** Bandeau des leviers abandonnés d'un groupe (workstream ou "Autres") — jamais mélangés aux
 *  colonnes de statut actif (principe : un levier abandonné ne doit jamais être compté ni
 *  affiché dans le même ensemble qu'un levier actif), toujours en dernier, grisé. */
function CancelledLeversStrip({
  levers,
  onCardClick,
}: {
  levers: Lever[];
  onCardClick: (id: string) => void;
}) {
  const { t } = useTranslation();
  if (levers.length === 0) return null;
  return (
    <div className="mt-3 border-t border-dashed border-border pt-2.5">
      <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-tertiary">
        {t("shared.kanban.cancelled", "Abandonnés")} ({levers.length})
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 min-[1101px]:grid-cols-5">
        {levers.map((l) => (
          <button
            key={l.id}
            onClick={() => onCardClick(l.id)}
            className="block w-full rounded-sm border border-border bg-neutral-100 p-2.5 text-left opacity-60 grayscale transition hover:opacity-80"
          >
            <div className="mb-1.5 text-xs font-semibold text-secondary line-through">{l.name}</div>
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold text-tertiary">
                {l.code}
              </span>
              <span className="text-[12.5px] font-bold text-tertiary">{fmtCurr(l.netSavings)}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Vue kanban du pipeline de leviers par statut — porté depuis `.kanban`/`.kcard` du prototype legacy.
 * `stageOrder`/`stageLabel` permettent de refléter le référentiel de cycle de vie de l'entreprise
 * (via `useLifecycleLabels`) ; par défaut, retombe sur le cycle et les libellés codés en dur.
 *
 * Round <n> (fondations RBAC déclaratives) : swimlanes par workstream, une section par workstream
 * (couleur + nom, même langage visuel que les sections d'axe de `StrategicAxesView.tsx`) contenant
 * la même grille de colonnes par statut qu'avant ce round — pas de refonte du pipeline lui-même,
 * juste un regroupement visuel supplémentaire. `workstreams` est optionnel : omis (ou vide), le
 * comportement historique (une seule grille plate, sans swimlane) est préservé à l'identique —
 * défaut rétro-compatible pour tout appelant qui ne l'a pas encore branché. */
export function Kanban({
  levers,
  onCardClick,
  stageOrder = STATUS_CYCLE,
  stageLabel = (status: LeverStatus) => STATUS_LABEL[status],
  workstreams = [],
  /** Univers de leviers sur lequel calculer le badge % d'avancement déclaratif de chaque
   *  swimlane (`workstreamDeclaredProgress`) — volontairement DISTINCT de `levers` (les cartes
   *  affichées, potentiellement déjà filtrées par la barre de filtres de la page) : l'avancement
   *  déclaratif d'un workstream doit refléter TOUS ses leviers, pas seulement ceux qui matchent le
   *  filtre courant. Défaut = `levers`, pour les appelants qui n'ont qu'un seul ensemble sous la main. */
  progressLevers = levers,
}: {
  levers: Lever[];
  onCardClick: (id: string) => void;
  stageOrder?: LeverStatus[];
  stageLabel?: (status: LeverStatus) => string;
  workstreams?: Workstream[];
  progressLevers?: Lever[];
}) {
  const { t } = useTranslation();

  if (workstreams.length === 0) {
    const activeLevers = levers.filter((l) => l.status !== "cancelled");
    const cancelledLevers = levers.filter((l) => l.status === "cancelled");
    return (
      <div>
        <StatusColumns
          levers={activeLevers}
          onCardClick={onCardClick}
          stageOrder={stageOrder}
          stageLabel={stageLabel}
        />
        <CancelledLeversStrip levers={cancelledLevers} onCardClick={onCardClick} />
      </div>
    );
  }

  // Un levier dont `ws` ne correspond à AUCUN workstream connu (donnée legacy/désynchronisée) reste
  // visible plutôt que silencieusement perdu — regroupé dans une swimlane "Autres" en fin de liste.
  const knownIds = new Set(workstreams.map((w) => w.id));
  const otherLevers = levers.filter((l) => !knownIds.has(l.ws));
  const otherActiveLevers = otherLevers.filter((l) => l.status !== "cancelled");
  const otherCancelledLevers = otherLevers.filter((l) => l.status === "cancelled");

  return (
    <div className="space-y-4">
      {workstreams.map((ws) => {
        // Un levier abandonné ne doit jamais être compté (badge) ni mélangé aux colonnes de
        // statut actif — voir CancelledLeversStrip ci-dessus.
        const wsLevers = levers.filter((l) => l.ws === ws.id);
        const activeWsLevers = wsLevers.filter((l) => l.status !== "cancelled");
        const cancelledWsLevers = wsLevers.filter((l) => l.status === "cancelled");
        const declaredPct = workstreamDeclaredProgress(progressLevers, ws.id);
        return (
          <div key={ws.id} className="overflow-hidden rounded-lg border border-border bg-white">
            <div
              className="flex flex-wrap items-center gap-2 border-b border-border bg-neutral-50 px-3.5 py-2.5"
              style={{ borderLeft: `4px solid ${ws.color ?? "var(--bp-warm-taupe)"}` }}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: ws.color ?? "var(--bp-warm-taupe)" }}
              />
              <span className="text-[12.5px] font-bold text-primary">{ws.name}</span>
              <span className="rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-tertiary">
                {activeWsLevers.length}
              </span>
              <DeclaredProgressBadge pct={declaredPct} className="ml-auto" />
            </div>
            <div className="p-3">
              {activeWsLevers.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-tertiary">
                  {t("shared.kanban.noItems", "Aucun")}
                </p>
              ) : (
                <StatusColumns
                  levers={activeWsLevers}
                  onCardClick={onCardClick}
                  stageOrder={stageOrder}
                  stageLabel={stageLabel}
                />
              )}
              <CancelledLeversStrip levers={cancelledWsLevers} onCardClick={onCardClick} />
            </div>
          </div>
        );
      })}
      {otherLevers.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-white">
          <div className="flex items-center gap-2 border-b border-border bg-neutral-50 px-3.5 py-2.5">
            <span className="text-[12.5px] font-bold text-primary">
              {t("shared.kanban.otherWorkstream", "Autres")}
            </span>
            <span className="rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-tertiary">
              {otherActiveLevers.length}
            </span>
          </div>
          <div className="p-3">
            <StatusColumns
              levers={otherActiveLevers}
              onCardClick={onCardClick}
              stageOrder={stageOrder}
              stageLabel={stageLabel}
            />
            <CancelledLeversStrip levers={otherCancelledLevers} onCardClick={onCardClick} />
          </div>
        </div>
      )}
    </div>
  );
}
