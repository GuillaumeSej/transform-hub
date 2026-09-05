"use client";

import { Button } from "@/components/shared/Button";
import { UserPicker } from "@/components/strategic/UserPicker";
import { canPassMilestone } from "@/lib/axisLogic";
import { MILESTONE_CHECKLISTS } from "@/lib/milestoneChecklist";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser, ChecklistFlag, MilestoneChecklistItem, MilestoneId } from "@/types";

/**
 * Panneau de check-list du jalon COURANT d'un chantier (round 5) — pièce centrale de la méthode
 * E0→E4. Le CONTENU des items (libellés, sections, quels items sont automatiques) vient de
 * `MILESTONE_CHECKLISTS` (lib/milestoneChecklist.ts, en dur) ; seules les RÉPONSES manuelles sont
 * portées par `items` (le contenu stocké côté chantier, voir `Chantier.milestones`).
 *
 * Les items `auto` (voir `ChecklistItemDef.auto`) ne sont JAMAIS lus depuis `items` — leur feu est
 * TOUJOURS le calcul live fourni par l'appelant via `autoFlags` (résultat de
 * `resolveMilestoneAutoFlags`, qui a besoin de `allChantiers`/`allActions`, hors de portée ici) :
 * un feu automatique stocké serait de toute façon obsolète dès qu'une des données sous-jacentes
 * (dépendances, effort, oranges du jalon précédent) change.
 */

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";
const SMALL_INPUT_CLASS =
  "mt-0.5 block rounded-md border border-border bg-white px-2 py-1 text-[12px] text-primary outline-none focus:border-bp-coral";

const FLAGS: ChecklistFlag[] = ["green", "orange", "red"];

const FLAG_SELECTED_CLASS: Record<ChecklistFlag, string> = {
  green: "border-rag-green bg-rag-green-light text-rag-green-dark",
  orange: "border-rag-amber bg-rag-amber-light text-rag-amber",
  red: "border-rag-red bg-rag-red-light text-rag-red",
};

const FLAG_DOT_CLASS: Record<ChecklistFlag, string> = {
  green: "bg-rag-green",
  orange: "bg-rag-amber",
  red: "bg-rag-red",
};

const SECTIONS: Array<"A" | "B" | "C"> = ["A", "B", "C"];

/**
 * Reconstruit un item PROPRE — jamais de clé à `undefined` (piège `saveChantier` : le document est
 * réécrit en entier via `setDoc`, voir `types/index.ts::MilestoneChecklistItem`). `actionPlan` et
 * `resolved` ne sont écrits que si `flag === "orange"`, et `actionPlan` seulement s'il porte un
 * contenu réel (description/owner/dueDate) — un item qu'on vient de passer en orange sans encore
 * rien saisir n'écrit aucun `actionPlan`.
 */
function cleanChecklistItem(item: MilestoneChecklistItem): MilestoneChecklistItem {
  const cleaned: MilestoneChecklistItem = { itemId: item.itemId };
  if (item.flag) cleaned.flag = item.flag;
  if (item.flag === "orange") {
    const description = item.actionPlan?.description?.trim() ?? "";
    const owner = item.actionPlan?.owner;
    const dueDate = item.actionPlan?.dueDate;
    if (description || owner || dueDate) {
      const actionPlan: NonNullable<MilestoneChecklistItem["actionPlan"]> = { description };
      if (owner) actionPlan.owner = owner;
      if (dueDate) actionPlan.dueDate = dueDate;
      cleaned.actionPlan = actionPlan;
    }
    if (item.resolved) cleaned.resolved = true;
  }
  return cleaned;
}

export function MilestoneChecklistPanel({
  milestoneId,
  items,
  autoFlags,
  users,
  onChange,
  onValidateMilestone,
}: {
  milestoneId: MilestoneId;
  /** Réponses manuelles STOCKÉES du chantier pour ce jalon (les items `auto` n'y sont jamais lus,
   *  voir le commentaire de tête). */
  items: MilestoneChecklistItem[];
  /** Feux des items automatiques, calculés LIVE par l'appelant (`resolveMilestoneAutoFlags`). */
  autoFlags: Record<string, ChecklistFlag>;
  users: AuthUser[];
  onChange: (nextItems: MilestoneChecklistItem[]) => void;
  onValidateMilestone: () => void;
}) {
  const { t } = useTranslation();
  const defs = MILESTONE_CHECKLISTS[milestoneId];

  const findStored = (itemId: string) => items.find((i) => i.itemId === itemId);

  const patchManualItem = (itemId: string, patch: Partial<MilestoneChecklistItem>) => {
    const existingIndex = items.findIndex((i) => i.itemId === itemId);
    const base: MilestoneChecklistItem = existingIndex >= 0 ? items[existingIndex] : { itemId };
    const merged = cleanChecklistItem({ ...base, ...patch, itemId });
    const next =
      existingIndex >= 0
        ? items.map((it, idx) => (idx === existingIndex ? merged : it))
        : [...items, merged];
    onChange(next);
  };

  // Fusion défs + feux live (auto) / feux stockés (manuel) — c'est CE tableau qu'on passe à
  // `canPassMilestone`, jamais `items` brut (qui ignore les items auto).
  const mergedItems: MilestoneChecklistItem[] = defs.map((def) =>
    def.auto
      ? autoFlags[def.itemId]
        ? { itemId: def.itemId, flag: autoFlags[def.itemId] }
        : { itemId: def.itemId }
      : (findStored(def.itemId) ?? { itemId: def.itemId })
  );

  const { canPass, reasons } = canPassMilestone(milestoneId, mergedItems);

  const groups = SECTIONS.map((section) => ({
    section,
    defs: defs.filter((d) => d.section === section),
  })).filter((g) => g.defs.length > 0);

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.section} className="space-y-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-tertiary">
            {group.section}
          </div>

          {group.defs.map((def) => {
            if (def.auto) {
              const flag = autoFlags[def.itemId];
              return (
                <div
                  key={def.itemId}
                  className="flex items-center gap-2 text-[12.5px] text-secondary"
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${
                      flag ? FLAG_DOT_CLASS[flag] : "bg-neutral-300"
                    }`}
                  />
                  <span className="flex-1">{t(def.i18nKey)}</span>
                  <span className="shrink-0 text-[10.5px] text-tertiary">
                    {t("strategicChantierDetail.milestones.actionPlan.autoResolvedHint")}
                  </span>
                </div>
              );
            }

            const stored = findStored(def.itemId);
            const flag = stored?.flag;
            const isOrange = flag === "orange";

            const patchActionPlan = (
              fieldPatch: Partial<NonNullable<MilestoneChecklistItem["actionPlan"]>>
            ) =>
              patchManualItem(def.itemId, {
                flag: "orange",
                actionPlan: {
                  description: stored?.actionPlan?.description ?? "",
                  ...stored?.actionPlan,
                  ...fieldPatch,
                },
              });

            return (
              <div key={def.itemId} className="space-y-2">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-[12.5px] font-medium text-primary sm:flex-1">
                    {t(def.i18nKey)}
                  </span>
                  <div className="flex overflow-hidden rounded-md border border-border sm:w-56 sm:shrink-0">
                    {FLAGS.map((candidate) => {
                      const isSelected = flag === candidate;
                      return (
                        <button
                          key={candidate}
                          type="button"
                          aria-pressed={isSelected}
                          onClick={() => patchManualItem(def.itemId, { flag: candidate })}
                          className={`flex-1 px-2 py-1.5 text-center text-[10.5px] font-semibold leading-tight transition ${
                            isSelected
                              ? FLAG_SELECTED_CLASS[candidate]
                              : "bg-white text-secondary hover:text-primary"
                          }`}
                        >
                          {t(`strategicChantierDetail.milestones.flag.${candidate}`)}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {isOrange && (
                  <div className="space-y-2 rounded-md border border-rag-amber-light bg-rag-amber-light/20 p-3">
                    <div>
                      <label className="text-xs font-medium text-text-secondary">
                        {t("strategicChantierDetail.milestones.actionPlan.description")}
                      </label>
                      <textarea
                        rows={2}
                        value={stored?.actionPlan?.description ?? ""}
                        onChange={(e) => patchActionPlan({ description: e.target.value })}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="sm:flex-1">
                        <UserPicker
                          users={users}
                          value={stored?.actionPlan?.owner}
                          onChange={(username) => patchActionPlan({ owner: username })}
                          label={t("strategicChantierDetail.milestones.actionPlan.owner")}
                          id={`milestone-owner-${def.itemId}`}
                        />
                      </div>
                      <div>
                        <label
                          className="text-xs font-medium text-text-secondary"
                          htmlFor={`milestone-due-${def.itemId}`}
                        >
                          {t("strategicChantierDetail.milestones.actionPlan.dueDate")}
                        </label>
                        <input
                          id={`milestone-due-${def.itemId}`}
                          type="date"
                          value={stored?.actionPlan?.dueDate ?? ""}
                          onChange={(e) => patchActionPlan({ dueDate: e.target.value })}
                          className={SMALL_INPUT_CLASS}
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-secondary">
                      <input
                        type="checkbox"
                        checked={stored?.resolved ?? false}
                        onChange={(e) =>
                          patchManualItem(def.itemId, {
                            flag: "orange",
                            resolved: e.target.checked,
                          })
                        }
                      />
                      {t("strategicChantierDetail.milestones.actionPlan.markResolved")}
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="border-t border-border pt-3">
        <Button variant="primary" size="sm" onClick={onValidateMilestone} disabled={!canPass}>
          {t("strategicChantierDetail.milestones.actionPlan.validate")}
        </Button>
        {!canPass && (
          <div className="mt-1.5 text-[11px] text-tertiary">
            <p>{t("strategicChantierDetail.milestones.actionPlan.missingHint")}</p>
            {reasons.length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {reasons.map((reason, i) => (
                  // eslint-disable-next-line react/no-array-index-key -- liste dérivée, pas de clé stable disponible
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
