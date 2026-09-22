"use client";

import { useState, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { UserPicker } from "@/components/strategic/UserPicker";
import {
  canPassMilestone,
  mergeMilestoneChecklistItems,
  progressBucket,
  type ProgressBucket,
} from "@/lib/axisLogic";
import { MILESTONE_CHECKLISTS } from "@/lib/milestoneChecklist";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type {
  AuthUser,
  ChantierMilestoneApproval,
  MilestoneChecklistItem,
  MilestoneCustomAction,
  MilestoneId,
} from "@/types";

/**
 * Panneau de check-list du jalon COURANT d'un chantier (round 5) — pièce centrale de la méthode
 * E0→E4. Le CONTENU des items (libellés, quels items sont automatiques) vient de
 * `MILESTONE_CHECKLISTS` (lib/milestoneChecklist.ts, en dur) ; seules les RÉPONSES manuelles sont
 * portées par `items` (le contenu stocké côté chantier, voir `Chantier.milestones`).
 *
 * Round 26 : rendu en UNE liste plate et NON groupée — l'ancien regroupement visuel en 3 sections
 * lettrées A/B/C (avec en-tête "Préalable"/"Réalisation"/"Conclusion") a été retiré ; tous les items
 * d'un jalon (manuels et automatiques) s'affichent désormais à la suite, dans l'ordre de
 * `MILESTONE_CHECKLISTS`, sans distinction visuelle de groupe (un item `auto` reste identifiable
 * par sa présentation en lecture seule, comme avant). Le verrou de passage est aussi devenu plus
 * strict ce round : voir `canPassMilestone` (lib/axisLogic.ts), qui exige maintenant que CHAQUE
 * item soit à 100 (le bouton "Valider le jalon" ci-dessous reste désactivé + le message d'aide
 * listant les items manquants reste affiché tant que ce n'est pas le cas).
 *
 * Les items `auto` (voir `ChecklistItemDef.auto`) ne sont JAMAIS lus depuis `items` — leur valeur
 * est TOUJOURS le calcul live fourni par l'appelant via `autoFlags` (résultat de
 * `resolveMilestoneAutoFlags`, qui a besoin de `allChantiers`/`allActions`, hors de portée ici) :
 * une valeur automatique stockée serait de toute façon obsolète dès qu'une des données sous-jacentes
 * (dépendances, effort) change.
 *
 * Round 12 : le feu discret à 3 niveaux (`ChecklistFlag`) est remplacé par un pourcentage déclaré
 * `MilestoneChecklistItem.progressPct` (0-100, `undefined` = pas encore déclaré). L'indicateur
 * visuel reste à 3 teintes (même esprit qu'avant, saisie plus fine) via le même bucketing partout :
 * `undefined` → neutre, `0` → rouge, `100` → vert, toute valeur strictement entre les deux → un
 * unique ton orange (jamais de dégradé) — ce ton orange reste affiché tel quel round 26, seule sa
 * conséquence sur `canPassMilestone` a changé (il bloque désormais, comme le rouge).
 *
 * Round "jalon validation gate" : le bouton "Valider le jalon" (activé dès que `canPassMilestone`
 * l'autorise) ne fait plus avancer le jalon directement — il SOUMET une demande de validation
 * (`onRequestApproval`, voir `lib/axisLogic.ts::requestMilestoneApproval`), qu'un `strategic_lead`
 * (ou un admin) doit ensuite approuver (`onApproveMilestone`) avant que le jalon n'avance réellement
 * — mirroir exact du modèle de porte de validation du Plan Performance
 * (`lib/leversLogic.ts::requestLeverApproval`/`approveLeverGate`), adapté à un SEUL rôle
 * approbateur. Même mirroir que `LeverDetailClientPerformance.tsx` (pas de raccourci "un seul clic"
 * même quand l'utilisateur courant EST le `strategic_lead` habilité à approuver sa propre demande :
 * il voit le bouton "Valider le jalon" comme n'importe quel propriétaire de projet, PUIS — dès que
 * `milestoneApproval` est posé — les boutons Approuver/Rejeter, exactement comme sur la fiche levier
 * de Performance).
 */

const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-primary outline-none focus:border-bp-coral";
const SMALL_INPUT_CLASS =
  "mt-0.5 block rounded-md border border-border bg-white px-2 py-1 text-[12px] text-primary outline-none focus:border-bp-coral";

/** Bucketing d'affichage d'un `progressPct` (voir le commentaire de tête) — jamais de dégradé
 *  continu, seulement ces 3 teintes discrètes (+ le neutre `empty`), même pour un item auto
 *  (toujours 0 ou 100, jamais `amber`). Logique extraite (round 14) dans `lib/axisLogic.ts`
 *  (`progressBucket`) — seule source de vérité, partagée avec d'autres écrans. */
const BUCKET_DOT_CLASS: Record<ProgressBucket, string> = {
  empty: "bg-neutral-300",
  red: "bg-rag-red",
  amber: "bg-rag-amber",
  green: "bg-rag-green",
};

const BUCKET_INPUT_CLASS: Record<ProgressBucket, string> = {
  empty: "border-border bg-white text-primary",
  red: "border-rag-red bg-rag-red-light text-rag-red",
  amber: "border-rag-amber bg-rag-amber-light text-rag-amber",
  green: "border-rag-green bg-rag-green-light text-rag-green-dark",
};

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
  customActions,
  users,
  onChange,
  onAddCustomAction,
  onRemoveCustomAction,
  milestoneApproval,
  canSubmitApproval,
  canApproveMilestone,
  canRejectMilestoneApproval,
  onRequestApproval,
  onApproveMilestone,
  onRejectMilestoneApproval,
}: {
  milestoneId: MilestoneId;
  /** Réponses manuelles STOCKÉES du chantier pour ce jalon (les items `auto` n'y sont jamais lus,
   *  voir le commentaire de tête). */
  items: MilestoneChecklistItem[];
  /** Valeurs (0 ou 100, jamais entre les deux) des items automatiques, calculées LIVE par
   *  l'appelant (`resolveMilestoneAutoFlags`, round 12 : renvoie un nombre plutôt qu'un
   *  `ChecklistFlag`). */
  autoFlags: Record<string, number>;
  /** Actions personnalisées AJOUTÉES par le pilote du projet pour CE jalon (round "actions clés du
   *  jalon", voir `MilestoneCustomAction`, types/index.ts) — typiquement
   *  `action.customMilestoneActions?.[milestoneId] ?? []`. Rendues dans le MÊME style qu'un item
   *  fixe manuel (barre de progression 0-100), mais avec un libellé LIBRE (`custom.label`, jamais
   *  une clé i18n) et un bouton de suppression. */
  customActions: MilestoneCustomAction[];
  users: AuthUser[];
  onChange: (nextItems: MilestoneChecklistItem[]) => void;
  /** Ajoute une action personnalisée à CE jalon (libellé libre) — n'est rendu appelable (voir
   *  `canSubmitApproval` ci-dessous) qu'au propriétaire du projet ou à un admin, cohérent avec qui
   *  contrôle déjà les autres saisies de ce panneau. */
  onAddCustomAction: (label: string) => void;
  /** Retire une action personnalisée de CE jalon (par id) — même habilitation que
   *  `onAddCustomAction`. */
  onRemoveCustomAction: (id: string) => void;
  /** Demande de validation en cours sur CE projet, quel que soit son jalon cible (voir
   *  `ChantierAction.milestoneApproval`) — `undefined` = pas de demande en cours. */
  milestoneApproval?: ChantierMilestoneApproval;
  /** Propriétaire du projet ou admin (voir `requestMilestoneApproval`, lib/axisLogic.ts) : seul cas
   *  où le bouton "Valider le jalon" est rendu (mirroir du `canSubmitApproval` de
   *  `LeverDetailClientPerformance.tsx`, qui masque de même le bouton "Soumettre pour validation"
   *  plutôt que de le désactiver pour un non-habilité). Réutilisé pour gater l'ajout/la suppression
   *  d'actions personnalisées : seul qui pourrait soumettre le jalon peut aussi en modifier la
   *  liste d'actions clés. */
  canSubmitApproval: boolean;
  /** `strategic_lead` du chantier parent ou admin (voir `approveMilestoneGate`) — affiche le bouton
   *  "Approuver" sur une demande en cours. */
  canApproveMilestone: boolean;
  /** `strategic_lead` du chantier parent, admin, OU le propriétaire du projet lui-même (voir
   *  `rejectMilestoneApproval`) — affiche le bouton "Rejeter" sur une demande en cours. */
  canRejectMilestoneApproval: boolean;
  onRequestApproval: () => void;
  onApproveMilestone: () => void;
  onRejectMilestoneApproval: () => void;
}) {
  const { t } = useTranslation();
  const defs = MILESTONE_CHECKLISTS[milestoneId];
  const [newCustomLabel, setNewCustomLabel] = useState("");

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

  const handleAddCustomAction = () => {
    const label = newCustomLabel.trim();
    if (!label) return;
    onAddCustomAction(label);
    setNewCustomLabel("");
  };

  // Fusion défs + valeurs live (auto) / valeurs stockées (manuel) / actions personnalisées — c'est
  // CE tableau qu'on passe à `canPassMilestone`, jamais `items` brut (qui ignore les items auto et
  // personnalisés). Extrait dans `lib/axisLogic.ts` (round "jalon validation gate") :
  // `requestMilestoneApproval` doit appliquer EXACTEMENT la même fusion pour que le bouton
  // ci-dessous et le verrou serveur ne divergent jamais.
  const mergedItems = mergeMilestoneChecklistItems(milestoneId, items, autoFlags, customActions);

  const { canPass, reasons } = canPassMilestone(milestoneId, mergedItems);

  /** Rendu d'UN item manuel éditable (0-100 + plan d'action si partiel) — factorisé pour être
   *  partagé entre les items FIXES (`defs`, libellé i18n) et les actions PERSONNALISÉES (libellé
   *  libre + bouton de suppression optionnel). `label` est déjà résolu par l'appelant (soit
   *  `t(def.i18nKey)`, soit `custom.label` tel quel — jamais traduit, voir `MilestoneCustomAction`). */
  const renderManualItemRow = (itemId: string, label: ReactNode, onRemove?: () => void) => {
    const stored = findStored(itemId);
    const pct = stored?.progressPct;
    const bucket = progressBucket(pct);
    const isPartial = bucket === "amber";

    const patchActionPlan = (
      fieldPatch: Partial<NonNullable<MilestoneChecklistItem["actionPlan"]>>
    ) =>
      patchManualItem(itemId, {
        actionPlan: {
          description: stored?.actionPlan?.description ?? "",
          ...stored?.actionPlan,
          ...fieldPatch,
        },
      });

    const handlePctChange = (raw: string) => {
      if (raw.trim() === "") {
        patchManualItem(itemId, { progressPct: undefined });
        return;
      }
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) return;
      patchManualItem(itemId, { progressPct: Math.max(0, Math.min(100, parsed)) });
    };

    return (
      <div key={itemId} className="space-y-2">
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-primary sm:flex-1">
            <span className="min-w-0 flex-1">{label}</span>
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                aria-label={t("strategicChantierDetail.milestones.customActions.remove")}
                title={t("strategicChantierDetail.milestones.customActions.remove")}
                className="shrink-0 rounded p-1 text-tertiary transition hover:bg-neutral-100 hover:text-bp-coral"
              >
                <Trash2 size={12} />
              </button>
            )}
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
              aria-label={t("strategicChantierDetail.milestones.actionPlan.progressAriaLabel")}
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
                  id={`milestone-owner-${itemId}`}
                />
              </div>
              <div>
                <label
                  className="text-xs font-medium text-text-secondary"
                  htmlFor={`milestone-due-${itemId}`}
                >
                  {t("strategicChantierDetail.milestones.actionPlan.dueDate")}
                </label>
                <input
                  id={`milestone-due-${itemId}`}
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
                  patchManualItem(itemId, {
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
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {defs.map((def) => {
          if (def.auto) {
            const pct = autoFlags[def.itemId];
            const bucket = progressBucket(pct);
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

          return renderManualItemRow(def.itemId, t(def.i18nKey));
        })}

        {/* ── Actions personnalisées de CE jalon (round "actions clés du jalon") — même rendu
          qu'un item fixe manuel ci-dessus, seul le libellé (libre, jamais i18n) et le bouton de
          suppression diffèrent. Le bouton de suppression n'apparaît que pour qui pourrait aussi
          soumettre le jalon (`canSubmitApproval`), la saisie de progression reste ouverte à tous
          comme pour les items fixes (ce panneau ne gate déjà aucune autre saisie). ─────────── */}
        {customActions.map((custom) =>
          renderManualItemRow(
            custom.id,
            custom.label,
            canSubmitApproval ? () => onRemoveCustomAction(custom.id) : undefined
          )
        )}

        {canSubmitApproval && (
          <div className="flex items-center gap-2 pt-1">
            <input
              value={newCustomLabel}
              onChange={(e) => setNewCustomLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddCustomAction();
                }
              }}
              placeholder={t("strategicChantierDetail.milestones.customActions.placeholder")}
              aria-label={t("strategicChantierDetail.milestones.customActions.placeholder")}
              className={`${SMALL_INPUT_CLASS} mt-0 flex-1`}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddCustomAction}
              disabled={newCustomLabel.trim().length === 0}
            >
              <Plus size={12} /> {t("strategicChantierDetail.milestones.customActions.add")}
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3">
        {milestoneApproval ? (
          <div className="space-y-2">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-rag-amber-light px-2.5 py-1 text-[11px] font-semibold text-rag-amber">
              {t("strategicChantierDetail.milestones.approval.pendingBadge")}
            </div>
            <p className="text-[11px] text-tertiary">
              {t("strategicChantierDetail.milestones.approval.requestedMeta")
                .replace("{user}", milestoneApproval.requestedBy)
                .replace("{date}", new Date(milestoneApproval.requestedAt).toLocaleDateString())}
            </p>
            {(canApproveMilestone || canRejectMilestoneApproval) && (
              <div className="flex items-center gap-2">
                {canApproveMilestone && (
                  <Button variant="primary" size="sm" onClick={onApproveMilestone}>
                    {t("strategicChantierDetail.milestones.approval.approve")}
                  </Button>
                )}
                {canRejectMilestoneApproval && (
                  <Button variant="ghost" size="sm" onClick={onRejectMilestoneApproval}>
                    {t("strategicChantierDetail.milestones.approval.reject")}
                  </Button>
                )}
              </div>
            )}
          </div>
        ) : (
          canSubmitApproval && (
            <>
              <Button variant="primary" size="sm" onClick={onRequestApproval} disabled={!canPass}>
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
            </>
          )
        )}
      </div>
    </div>
  );
}
