"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { displayMilestoneId } from "@/lib/axisLogic";
import { MILESTONE_CHECKLISTS, MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { MilestoneCustomAction, MilestoneId } from "@/types";

/**
 * Aperçu J0→J4 affiché au moment de la CRÉATION d'un projet (round "aperçu jalons création" —
 * retour PO : « la structure J0…J4 est déjà pré-remplie, c'est bien, mais les actions concrètes
 * changent d'un projet à l'autre, je veux pouvoir les ajuster AVANT de valider la création »).
 *
 * Mêmes items FIXES que `MilestoneChecklistPanel.tsx` (`MILESTONE_CHECKLISTS`, libellés i18n) —
 * mais rendus en pure lecture seule ici : aucune saisie de progression n'a de sens tant que le
 * projet n'existe pas (elle se fait ensuite sur la fiche du projet créé, via ce même panneau).
 * Deux actions possibles ici, sur deux brouillons INDÉPENDANTS :
 *  - ajouter/retirer des actions PERSONNALISÉES par jalon (`MilestoneCustomAction`, voir
 *    `types/index.ts`) — mêmes id/style que `MilestoneChecklistPanel.tsx`, dupliqués ici plutôt
 *    qu'importés (ce composant n'a pas la fusion progressPct/canPassMilestone à gérer, un rendu
 *    bien plus simple) ;
 *  - EXCLURE un item FIXE du référentiel pour CE projet (round "exclusion jalons création" — retour
 *    PO : « il faut pouvoir retirer des actions déjà présentes dans les jalons J, aujourd'hui on ne
 *    peut qu'en ajouter »), brouillon séparé `excludedValue`/`onExcludedChange` qui devient
 *    `ChantierAction.excludedMilestoneItems` à la création (voir son doc-comment,
 *    `types/index.ts`). Un item exclu n'est pas simplement masqué : il bascule dans une mini-liste
 *    "actions exclues" en bas de jalon (barré, muet) avec un bouton pour le réintégrer avant la
 *    validation finale du formulaire — jamais de suppression silencieuse et définitive à l'aveugle.
 *
 * Portée VOLONTAIREMENT limitée à la création : ce composant ne gère aucune ré-inclusion après coup
 * une fois le projet créé — `MilestoneChecklistPanel.tsx` (fiche du projet réel) lit
 * `excludedMilestoneItems` en lecture seule, aucune UI d'édition n'y est ajoutée ce round.
 *
 * Entièrement CONTRÔLÉ, état 100% en mémoire (`value`/`onChange`) — même parti pris que
 * `StaffingDraftTable.tsx` (round 29) : le projet n'existe pas encore, rien n'est jamais écrit
 * directement en Firestore par ce composant. L'appelant (`ChantierActionForm`) bufferise ce
 * brouillon jusqu'au submit, exactement comme `staffingDraft`.
 *
 * Accordéon replié par défaut (5 jalons × plusieurs items = beaucoup de hauteur si tout déplié),
 * SAUF J0 déplié d'entrée (premier jalon, le plus probable à ajuster tout de suite) — même esprit
 * que `AxisChantierProjetAccordion.tsx` (tout replié par défaut), état de pli local et volatile,
 * pas besoin de le faire survivre à un re-montage.
 */

const INPUT_CLASS =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";

function newCustomActionId(): string {
  return `CUSTOM-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function MilestonePreviewEditor({
  value,
  onChange,
  excludedValue,
  onExcludedChange,
}: {
  /** Brouillon courant, PAR jalon — clé absente = aucune action personnalisée ajoutée pour ce
   *  jalon (même convention `Partial` que `ChantierAction.customMilestoneActions`, dont ce
   *  brouillon prend directement la forme une fois le projet créé). */
  value: Partial<Record<MilestoneId, MilestoneCustomAction[]>>;
  onChange: (next: Partial<Record<MilestoneId, MilestoneCustomAction[]>>) => void;
  /** Brouillon courant des items FIXES exclus, PAR jalon — clé absente = aucune exclusion pour ce
   *  jalon (même convention `Partial` que `ChantierAction.excludedMilestoneItems`, dont ce
   *  brouillon prend directement la forme une fois le projet créé). Chaque valeur est un `itemId`
   *  de `MILESTONE_CHECKLISTS[jalon]`, jamais un id d'action personnalisée. */
  excludedValue: Partial<Record<MilestoneId, string[]>>;
  onExcludedChange: (next: Partial<Record<MilestoneId, string[]>>) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<MilestoneId>>(() => new Set<MilestoneId>(["E0"]));
  const [draftLabel, setDraftLabel] = useState<Partial<Record<MilestoneId, string>>>({});

  const toggle = (milestoneId: MilestoneId) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(milestoneId)) next.delete(milestoneId);
      else next.add(milestoneId);
      return next;
    });

  const addCustomAction = (milestoneId: MilestoneId) => {
    const label = (draftLabel[milestoneId] ?? "").trim();
    if (!label) return;
    const existing = value[milestoneId] ?? [];
    onChange({
      ...value,
      [milestoneId]: [...existing, { id: newCustomActionId(), label }],
    });
    setDraftLabel((prev) => ({ ...prev, [milestoneId]: "" }));
  };

  const removeCustomAction = (milestoneId: MilestoneId, id: string) => {
    const remaining = (value[milestoneId] ?? []).filter((a) => a.id !== id);
    const next = { ...value };
    if (remaining.length > 0) next[milestoneId] = remaining;
    else delete next[milestoneId];
    onChange(next);
  };

  const excludeItem = (milestoneId: MilestoneId, itemId: string) => {
    const existing = excludedValue[milestoneId] ?? [];
    if (existing.includes(itemId)) return;
    onExcludedChange({ ...excludedValue, [milestoneId]: [...existing, itemId] });
  };

  const restoreItem = (milestoneId: MilestoneId, itemId: string) => {
    const remaining = (excludedValue[milestoneId] ?? []).filter((id) => id !== itemId);
    const next = { ...excludedValue };
    if (remaining.length > 0) next[milestoneId] = remaining;
    else delete next[milestoneId];
    onExcludedChange(next);
  };

  return (
    <div>
      <span className="text-xs font-medium text-secondary">
        {t("strategicChantierDetail.milestones.preview.title")}
      </span>
      <p className="mt-0.5 text-[11px] text-tertiary">
        {t("strategicChantierDetail.milestones.preview.hint")}
      </p>

      <div className="mt-2 space-y-1.5">
        {MILESTONE_ORDER.map((milestoneId) => {
          const defs = MILESTONE_CHECKLISTS[milestoneId];
          const custom = value[milestoneId] ?? [];
          const excluded = excludedValue[milestoneId] ?? [];
          const visibleDefs = defs.filter((def) => !excluded.includes(def.itemId));
          const open = expanded.has(milestoneId);
          const Chevron = open ? ChevronDown : ChevronRight;

          return (
            <div
              key={milestoneId}
              className="overflow-hidden rounded-md border border-border bg-white"
            >
              <button
                type="button"
                onClick={() => toggle(milestoneId)}
                aria-expanded={open}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left transition hover:bg-neutral-50 focus:outline-none"
              >
                <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-primary">
                  <Chevron size={14} className="shrink-0 text-tertiary" aria-hidden />
                  {displayMilestoneId(milestoneId)}
                </span>
                <span className="shrink-0 rounded-full border border-border bg-neutral-50 px-2 py-px text-[10px] font-semibold text-tertiary">
                  {t("strategicChantierDetail.milestones.preview.itemsCount").replace(
                    "{n}",
                    String(visibleDefs.length + custom.length)
                  )}
                </span>
              </button>

              {open && (
                <div className="space-y-2 border-t border-border p-3">
                  <ul className="space-y-1.5">
                    {visibleDefs.map((def) => (
                      <li
                        key={def.itemId}
                        className="flex items-center gap-2 text-[12px] text-secondary"
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300"
                        />
                        <span className="min-w-0 flex-1">{t(def.i18nKey)}</span>
                        <button
                          type="button"
                          onClick={() => excludeItem(milestoneId, def.itemId)}
                          aria-label={t("strategicChantierDetail.milestones.preview.excludeItem")}
                          title={t("strategicChantierDetail.milestones.preview.excludeItem")}
                          className="shrink-0 rounded p-1 text-tertiary transition hover:bg-neutral-100 hover:text-bp-coral"
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                    {custom.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-[12px] text-primary">
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-bp-coral"
                        />
                        <span className="min-w-0 flex-1">{c.label}</span>
                        <button
                          type="button"
                          onClick={() => removeCustomAction(milestoneId, c.id)}
                          aria-label={t("strategicChantierDetail.milestones.customActions.remove")}
                          title={t("strategicChantierDetail.milestones.customActions.remove")}
                          className="shrink-0 rounded p-1 text-tertiary transition hover:bg-neutral-100 hover:text-bp-coral"
                        >
                          <Trash2 size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>

                  {excluded.length > 0 && (
                    <div className="space-y-1 rounded-md border border-dashed border-border bg-neutral-50 p-2">
                      <span className="text-[10.5px] font-medium text-tertiary">
                        {t("strategicChantierDetail.milestones.preview.excludedTitle")}
                      </span>
                      <ul className="space-y-1">
                        {excluded.flatMap((itemId) => {
                          const def = defs.find((d) => d.itemId === itemId);
                          if (!def) return [];
                          return [
                            <li
                              key={itemId}
                              className="flex items-center gap-2 text-[12px] text-tertiary"
                            >
                              <span className="min-w-0 flex-1 line-through">{t(def.i18nKey)}</span>
                              <button
                                type="button"
                                onClick={() => restoreItem(milestoneId, itemId)}
                                className="shrink-0 text-[10.5px] font-medium text-bp-coral underline-offset-2 hover:underline"
                              >
                                {t("strategicChantierDetail.milestones.preview.restoreItem")}
                              </button>
                            </li>,
                          ];
                        })}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      value={draftLabel[milestoneId] ?? ""}
                      onChange={(e) =>
                        setDraftLabel((prev) => ({ ...prev, [milestoneId]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomAction(milestoneId);
                        }
                      }}
                      placeholder={t(
                        "strategicChantierDetail.milestones.customActions.placeholder"
                      )}
                      aria-label={t("strategicChantierDetail.milestones.customActions.placeholder")}
                      className={INPUT_CLASS}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => addCustomAction(milestoneId)}
                      disabled={(draftLabel[milestoneId] ?? "").trim().length === 0}
                    >
                      <Plus size={12} /> {t("strategicChantierDetail.milestones.customActions.add")}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
