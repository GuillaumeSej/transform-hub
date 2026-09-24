"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ProgressBar } from "@/components/shared/ProgressBar";
import { actionProgressPct, leverProgressPct, workstreamProgressPct } from "@/lib/engine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Lever, LeverAction, Workstream } from "@/types";

/**
 * 3ᵉ vue de la bibliothèque des leviers (round <n>, fondations RBAC déclaratives) — accordéon à 4
 * niveaux Chantier → Type → Levier → Action, modelé sur le pattern de
 * `components/strategic/AxisChantierProjetAccordion.tsx` (tout replié par défaut, `Set<string>`
 * par niveau, clés composites pour un niveau qui peut apparaître sous plusieurs parents).
 *
 * Contrairement à l'accordéon stratégique, ici un levier n'a QU'UN seul workstream (`Lever.ws`) et
 * QU'UN seul type (`Lever.type`) — pas de multi-appartenance, donc pas besoin de clé composite pour
 * le niveau Type ou Levier (un simple id suffit, chaque nœud n'a qu'un seul parent possible).
 *
 * Navigation (voir le rapport de livraison pour le détail des routes disponibles/absentes) :
 *  - Workstream : AUCUNE fiche dédiée n'existe dans le code actuel (`/workstreams` est un dashboard
 *    global tous workstreams confondus, pas une fiche par id) — le clic sur ce niveau ne fait donc
 *    QUE déplier/replier, pas de navigation.
 *  - Type : pas de route dédiée non plus, mais le filtre `f_type` de la vue Table (même page) EST
 *    l'équivalent le plus proche d'une "vue filtrée par type" — `onTypeClick` y bascule.
 *  - Levier : `/levers/detail?id=<id>`, route existante.
 *  - Action : même fiche levier, onglet "Plan d'action", avec `?action=<id>` pour cibler l'action
 *    précise (voir le support ajouté dans `LeverDetailClientPerformance.tsx`).
 */
/** Tag "responsable" avec infobulle (titre natif) — toujours présent, même si non renseigné. */
function OwnerTag({
  label,
  value,
  emptyLabel,
}: {
  label: string;
  value?: string;
  emptyLabel: string;
}) {
  const filled = !!value?.trim();
  return (
    <span
      title={filled ? `${label} : ${value}` : emptyLabel}
      className={
        "max-w-[160px] shrink-0 truncate rounded-full border px-1.5 py-px text-[10px] font-semibold " +
        (filled
          ? "border-border bg-white text-secondary"
          : "border-dashed border-border bg-neutral-50 text-tertiary")
      }
    >
      {filled ? value : "—"}
    </span>
  );
}

/** Progression compacte (barre + %) — voir engine.leverProgressPct / workstreamProgressPct. */
function Progress({ pct }: { pct: number }) {
  return (
    <span className="w-[120px] shrink-0" title={`Progression : ${pct}%`}>
      <ProgressBar pct={pct} />
    </span>
  );
}

export function LeverLibraryTree({
  levers,
  progressLevers,
  workstreams,
  onTypeClick,
  onLeverClick,
  onActionClick,
}: {
  /** Leviers à afficher (déjà filtrés/scopés par l'appelant, même ensemble que les vues Table et
   *  Kanban de cette page). */
  levers: Lever[];
  /** Univers de leviers pour le calcul du badge % de chaque workstream (`engine.workstreamProgressPct`)
   *  — voir le même paramètre sur `components/shared/Kanban.tsx` pour la raison de le distinguer
   *  de `levers`. */
  progressLevers: Lever[];
  workstreams: Workstream[];
  onTypeClick: (type: string) => void;
  onLeverClick: (leverId: string) => void;
  onActionClick: (leverId: string, actionId: string) => void;
}) {
  const { t } = useTranslation();
  const [expandedWsIds, setExpandedWsIds] = useState<Set<string>>(new Set());
  const [expandedTypeKeys, setExpandedTypeKeys] = useState<Set<string>>(new Set());
  const [expandedLeverIds, setExpandedLeverIds] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, setter: (next: Set<string>) => void, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  const knownWsIds = new Set(workstreams.map((w) => w.id));
  const otherLevers = levers.filter((l) => !knownWsIds.has(l.ws));
  // "Autres" (leviers sans workstream connu) apparaît comme une pseudo-swimlane en fin de liste,
  // même filet de sécurité que `components/shared/Kanban.tsx`.
  const groups: { id: string; name: string; color?: string; levers: Lever[] }[] = [
    ...workstreams.map((ws) => ({
      id: ws.id,
      name: ws.name,
      color: ws.color,
      levers: levers.filter((l) => l.ws === ws.id),
    })),
    ...(otherLevers.length > 0
      ? [
          {
            id: "__other__",
            name: t("shared.kanban.otherWorkstream", "Autres"),
            levers: otherLevers,
          },
        ]
      : []),
  ];

  if (levers.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-tertiary">
        {t("levers.tree.empty", "Aucun levier à afficher.")}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const wsOpen = expandedWsIds.has(group.id);
        const wsSponsor = workstreams.find((w) => w.id === group.id)?.sponsor;
        // Avancement du chantier : même formule que le Kanban et la page Workstreams
        // (`workstreamProgressPct`, pondérée par la valeur des leviers non abandonnés).
        const wsPct = workstreamProgressPct(progressLevers, group.id) ?? 0;
        // Un levier abandonné ne doit jamais être compté ni mélangé aux leviers actifs — écarté de
        // l'arborescence Chantier → Type → Levier, regroupé à part en fin de swimlane, grisé
        // (même principe que Kanban.tsx CancelledLeversStrip).
        const activeGroupLevers = group.levers.filter((l) => l.status !== "cancelled");
        const cancelledGroupLevers = group.levers.filter((l) => l.status === "cancelled");
        // Types présents dans CE groupe, dans l'ordre de première apparition (pas de référentiel
        // "types" trié séparément — `Lever.type` est une catégorie libre, voir doc-comment
        // `types/index.ts`).
        const typesInGroup = Array.from(new Set(activeGroupLevers.map((l) => l.type)));

        return (
          <div key={group.id} className="overflow-hidden rounded-lg border border-border bg-white">
            <button
              type="button"
              onClick={() => toggle(expandedWsIds, setExpandedWsIds, group.id)}
              aria-expanded={wsOpen}
              className="flex w-full items-center gap-2 bg-neutral-50 px-3.5 py-2.5 text-left transition hover:bg-neutral-100"
              style={{ borderLeft: `4px solid ${group.color ?? "var(--bp-warm-taupe)"}` }}
            >
              {wsOpen ? (
                <ChevronDown size={14} className="shrink-0 text-tertiary" aria-hidden />
              ) : (
                <ChevronRight size={14} className="shrink-0 text-tertiary" aria-hidden />
              )}
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color ?? "var(--bp-warm-taupe)" }}
              />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-primary">
                {group.name}
              </span>
              <span className="shrink-0 rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-tertiary">
                {activeGroupLevers.length}
              </span>
              {group.id !== "__other__" && (
                <OwnerTag
                  label={t("levers.tree.wsLead", "Responsable de chantier")}
                  value={wsSponsor}
                  emptyLabel={t("levers.tree.wsLeadEmpty", "Responsable de chantier non renseigné")}
                />
              )}
              <Progress pct={wsPct} />
            </button>

            {wsOpen && (
              <div className="divide-y divide-border border-t border-border">
                {typesInGroup.length === 0 ? (
                  <p className="px-4 py-3 text-center text-[12px] text-tertiary">
                    {t("levers.tree.wsNoLever", "Aucun levier dans ce chantier.")}
                  </p>
                ) : (
                  typesInGroup.map((type) => {
                    const typeKey = `${group.id}:${type}`;
                    const typeOpen = expandedTypeKeys.has(typeKey);
                    const typeLevers = activeGroupLevers.filter((l) => l.type === type);
                    return (
                      <div key={typeKey}>
                        <div className="flex w-full items-center gap-2 py-2.5 pl-8 pr-3.5 text-left transition hover:bg-neutral-50">
                          <button
                            type="button"
                            onClick={() => toggle(expandedTypeKeys, setExpandedTypeKeys, typeKey)}
                            aria-expanded={typeOpen}
                            className="flex min-w-0 flex-1 items-center gap-2"
                          >
                            {typeOpen ? (
                              <ChevronDown
                                size={13}
                                className="shrink-0 text-tertiary"
                                aria-hidden
                              />
                            ) : (
                              <ChevronRight
                                size={13}
                                className="shrink-0 text-tertiary"
                                aria-hidden
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-secondary">
                              {type || t("levers.tree.noType", "(Sans type)")}
                            </span>
                            <span className="shrink-0 rounded-full border border-border bg-white px-1.5 py-px text-[10px] font-semibold text-tertiary">
                              {typeLevers.length}
                            </span>
                          </button>
                          {/* Round <n> : pas de route "fiche type" dédiée — bascule sur la vue
                              Table filtrée par ce type (`f_type`, voir doc-comment de tête). */}
                          <button
                            type="button"
                            onClick={() => onTypeClick(type)}
                            className="shrink-0 text-[10.5px] font-semibold text-bp-coral hover:underline"
                          >
                            {t("levers.tree.filterByType", "Filtrer")}
                          </button>
                        </div>

                        {typeOpen && (
                          <div className="space-y-1.5 bg-neutral-50/70 py-2 pl-14 pr-3.5">
                            {typeLevers.map((lever) => {
                              const leverOpen = expandedLeverIds.has(lever.id);
                              const leverPct = leverProgressPct(lever);
                              const actions = lever.actions ?? [];
                              return (
                                <div
                                  key={lever.id}
                                  className="rounded-md border border-border bg-white"
                                >
                                  <div className="flex w-full items-center gap-2 px-2.5 py-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        toggle(expandedLeverIds, setExpandedLeverIds, lever.id)
                                      }
                                      aria-expanded={leverOpen}
                                      className="flex min-w-0 flex-1 items-center gap-1.5"
                                    >
                                      {leverOpen ? (
                                        <ChevronDown
                                          size={12}
                                          className="shrink-0 text-tertiary"
                                          aria-hidden
                                        />
                                      ) : (
                                        <ChevronRight
                                          size={12}
                                          className="shrink-0 text-tertiary"
                                          aria-hidden
                                        />
                                      )}
                                      <span className="min-w-0 flex-1 truncate text-left text-[11.5px] font-medium text-primary">
                                        {lever.code} · {lever.name}
                                      </span>
                                      <span className="shrink-0 rounded-full border border-border bg-neutral-50 px-1.5 py-px text-[10px] font-semibold text-tertiary">
                                        {actions.length}
                                      </span>
                                    </button>
                                    <OwnerTag
                                      label={t("levers.tree.leverOwner", "Responsable de levier")}
                                      value={lever.owner}
                                      emptyLabel={t(
                                        "levers.tree.leverOwnerEmpty",
                                        "Responsable de levier non renseigné"
                                      )}
                                    />
                                    <Progress pct={leverPct} />
                                    <button
                                      type="button"
                                      onClick={() => onLeverClick(lever.id)}
                                      className="shrink-0 text-[10.5px] font-semibold text-bp-coral hover:underline"
                                    >
                                      {t("levers.tree.openLever", "Ouvrir")}
                                    </button>
                                  </div>

                                  {leverOpen && (
                                    <div className="space-y-1 border-t border-border bg-neutral-50/60 px-2.5 py-1.5 pl-8">
                                      {actions.length === 0 ? (
                                        <p className="py-1 text-[11px] text-tertiary">
                                          {t(
                                            "levers.tree.leverNoAction",
                                            "Aucune action sur ce levier."
                                          )}
                                        </p>
                                      ) : (
                                        actions.map((action: LeverAction) => (
                                          <button
                                            key={action.id}
                                            type="button"
                                            onClick={() => onActionClick(lever.id, action.id)}
                                            className="flex w-full items-center gap-2 rounded-sm border border-border bg-white px-2 py-1 text-left transition hover:border-black hover:shadow-sm"
                                          >
                                            <span className="min-w-0 flex-1 truncate text-[11px] text-primary">
                                              {action.name}
                                            </span>
                                            <span className="shrink-0 text-[10.5px] font-semibold text-secondary">
                                              {actionProgressPct(action)}%
                                            </span>
                                          </button>
                                        ))
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {cancelledGroupLevers.length > 0 && (
                  <div className="bg-neutral-100/70 px-4 py-2.5">
                    <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-wide text-tertiary">
                      {t("shared.kanban.cancelled", "Abandonnés")} ({cancelledGroupLevers.length})
                    </div>
                    <div className="space-y-1">
                      {cancelledGroupLevers.map((lever) => (
                        <button
                          key={lever.id}
                          type="button"
                          onClick={() => onLeverClick(lever.id)}
                          className="flex w-full items-center gap-2 rounded-md border border-border bg-neutral-50 px-2.5 py-1.5 text-left opacity-60 grayscale transition hover:opacity-80"
                        >
                          <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-secondary line-through">
                            {lever.code} · {lever.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
