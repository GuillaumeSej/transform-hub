"use client";

import { Button } from "@/components/shared/Button";
import { UserPicker } from "@/components/strategic/UserPicker";
import { canPassMilestone } from "@/lib/axisLogic";
import { MILESTONE_CHECKLISTS } from "@/lib/milestoneChecklist";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { AuthUser, MilestoneChecklistItem, MilestoneId } from "@/types";

/**
 * Panneau de check-list du jalon COURANT d'un chantier (round 5) — pièce centrale de la méthode
 * E0→E4. Le CONTENU des items (libellés, sections, quels items sont automatiques) vient de
 * `MILESTONE_CHECKLISTS` (lib/milestoneChecklist.ts, en dur) ; seules les RÉPONSES manuelles sont
 * portées par `items` (le contenu stocké côté chantier, voir `Chantier.milestones`).
 *
 * Les items `auto` (voir `ChecklistItemDef.auto`) ne sont JAMAIS lus depuis `items` — leur valeur
 * est TOUJOURS le calcul live fourni par l'appelant via `autoFlags` (résultat de
 * `resolveMilestoneAutoFlags`, qui a besoin de `allChantiers`/`allActions`, hors de portée ici) :
 * une valeur automatique stockée serait de toute façon obsolète dès qu'une des données sous-jacentes
 * (dépendances, effort, oranges du jalon précédent) change.
 *
 * Round 12 : le feu discret à 3 niveaux (`ChecklistFlag`) est remplacé par un pourcentage déclaré
 * `MilestoneChecklistItem.progressPct` (0-100, `undefined` = pas encore déclaré). L'indicateur
 * visuel reste à 3 teintes (même esprit qu'avant, saisie plus fine) via le même bucketing partout :
 * `undefined` → neutre, `0` → rouge, `100` → vert, toute valeur strictement entre les deux → un
 * unique ton orange (jamais de dégradé).
 */

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";
const SMALL_INPUT_CLASS =
  "mt-0.5 block rounded-md border border-border bg-white px-2 py-1 text-[12px] text-primary outline-none focus:border-bp-coral";

/** Un des 3 buckets d'affichage d'un `progressPct` (voir le commentaire de tête) — jamais de
 *  dégradé continu, seulement ces 3 teintes discrètes, même pour un item auto (toujours 0 ou 100,
 *  jamais `partial`). */
type ProgressBucket = "unanswered" | "red" | "partial" | "green";

function bucketForPct(pct: number | undefined): ProgressBucket {
  if (pct === undefined) return "unanswered";
  if (pct <= 0) return "red";
  if (pct >= 100) return "green";
  return "partial";
}

const BUCKET_DOT_CLASS: Record<ProgressBucket, string> = {
  unanswered: "bg-neutral-300",
  red: "bg-rag-red",
  partial: "bg-rag-amber",
  green: "bg-rag-green",
};

const BUCKET_INPUT_CLASS: Record<ProgressBucket, string> = {
  unanswered: "border-border bg-white text-primary",
  red: "border-rag-red bg-rag-red-light text-rag-red",
  partial: "border-rag-amber bg-rag-amber-light text-rag-amber",
  green: "border-rag-green bg-rag-green-light text-rag-green-dark",
};

const SECTIONS: Array<"A" | "B" | "C"> = ["A", "B", "C"];

/**
 * Reconstruit un item PROPRE — jamais de clé à `undefined` (piège `saveChantier` : le document est
 * réécrit en entier via `setDoc`, voir `types/index.ts::MilestoneChecklistItem`). `actionPlan` et
 * `resolved` ne sont écrits que si `progressPct` est strictement entre 0 et 100 (équivalent de
 * l'ancien `flag === "orange"`), et `actionPlan` seulement s'il porte un contenu réel
 * (description/owner/dueDate) — un item qu'on vient de passer en partiel sans encore rien saisir
 * n'écrit aucun `actionPlan`.
 */
function cleanChecklistItem(item: MilestoneChecklistItem): MilestoneChecklistItem {
  const cleaned: MilestoneChecklistItem = { itemId: item.itemId };
  if (item.progressPct !== undefined) cleaned.progressPct = item.progressPct;
  const isPartial =
    item.progressPct !== undefined && item.progressPct > 0 && item.progressPct < 100;
  if (isPartial) {
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
  /** Valeurs (0 ou 100, jamais entre les deux) des items automatiques, calculées LIVE par
   *  l'appelant (`resolveMilestoneAutoFlags`, round 12 : renvoie un nombre plutôt qu'un
   *  `ChecklistFlag`). */
  autoFlags: Record<string, number>;
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

  // Fusion défs + valeurs live (auto) / valeurs stockées (manuel) — c'est CE tableau qu'on passe à
  // `canPassMilestone`, jamais `items` brut (qui ignore les items auto).
  const mergedItems: MilestoneChecklistItem[] = defs.map((def) =>
    def.auto
      ? autoFlags[def.itemId] !== undefined
        ? { itemId: def.itemId, progressPct: autoFlags[def.itemId] }
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
              const pct = autoFlags[def.itemId];
              const bucket = bucketForPct(pct);
              return (
                <div
                  key={def.itemId}
                  className="flex items-center gap-2 text-[12.5px] text-secondary"
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full ${BUCKET_DOT_CLASS[bucket]}`}
                  />
                  <span className="flex-1">{t(def.i18nKey)}</span>
                  <span className="shrink-0 text-[10.5px] text-tertiary">
                    {t("strategicChantierDetail.milestones.actionPlan.autoResolvedHint")}
                  </span>
                </div>
              );
            }

            const stored = findStored(def.itemId);
            const pct = stored?.progressPct;
            const bucket = bucketForPct(pct);
            const isPartial = bucket === "partial";

            const patchActionPlan = (
              fieldPatch: Partial<NonNullable<MilestoneChecklistItem["actionPlan"]>>
            ) =>
              patchManualItem(def.itemId, {
                actionPlan: {
                  description: stored?.actionPlan?.description ?? "",
                  ...stored?.actionPlan,
                  ...fieldPatch,
                },
              });

            const handlePctChange = (raw: string) => {
              if (raw.trim() === "") {
                patchManualItem(def.itemId, { progressPct: undefined });
                return;
              }
              const parsed = Number(raw);
              if (Number.isNaN(parsed)) return;
              patchManualItem(def.itemId, { progressPct: Math.max(0, Math.min(100, parsed)) });
            };

            return (
              <div key={def.itemId} className="space-y-2">
                <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                  <span className="text-[12.5px] font-medium text-primary sm:flex-1">
                    {t(def.i18nKey)}
                  </span>
                  <div className="flex items-center gap-2 sm:w-56 sm:shrink-0">
                    <span
                      aria-hidden
                      className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full ${BUCKET_DOT_CLASS[bucket]}`}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={5}
                      inputMode="numeric"
                      value={pct ?? ""}
                      onChange={(e) => handlePctChange(e.target.value)}
                      placeholder="—"
                      aria-label={t(
                        "strategicChantierDetail.milestones.actionPlan.progressAriaLabel"
                      )}
                      className={`w-20 flex-1 rounded-md border-2 px-2 py-1.5 text-center text-[12.5px] font-semibold outline-none transition focus:border-bp-coral ${BUCKET_INPUT_CLASS[bucket]}`}
                    />
                    <span className="shrink-0 text-[11px] text-tertiary">%</span>
                  </div>
                </div>

                {isPartial && (
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
