"use client";

import { Check, Lock } from "lucide-react";
import { MILESTONE_ORDER } from "@/lib/milestoneChecklist";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { MilestoneId } from "@/types";

/**
 * Stepper de jalons E0→E4 (round 5) — affiché dans l'en-tête de la fiche chantier.
 *
 * À NE PAS confondre avec le stepper d'étape de maturité de `AxisDetailClient.tsx` (saut libre à
 * n'importe quelle étape, purement informatif) : ici c'est une VRAIE porte bloquante — seul le
 * jalon COURANT est cliquable (ouvre la check-list, voir `MilestoneChecklistPanel` + le verrou réel
 * `canPassMilestone` dans `lib/axisLogic.ts`) :
 *  - jalons FRANCHIS (`passedMilestones`) : historique verrouillé, verts, jamais cliquables — on ne
 *    revient pas en arrière sur un jalon déjà validé ;
 *  - jalon COURANT : visuellement actif (noir), cliquable si `onSelectCurrent` est fourni — c'est
 *    au parent de décider ce que "sélectionner" signifie (ex. faire défiler jusqu'au panneau de
 *    check-list) ;
 *  - jalons FUTURS (après le courant dans `MILESTONE_ORDER`) : grisés et désactivés, avec une
 *    infobulle expliquant qu'ils se débloquent une fois le jalon courant validé.
 */
export function MilestoneStepper({
  currentMilestone,
  passedMilestones,
  onSelectCurrent,
  currentMilestoneProgressPct,
}: {
  currentMilestone: MilestoneId;
  passedMilestones: MilestoneId[];
  onSelectCurrent?: () => void;
  /** Moyenne (0-100) des `progressPct` déclarés des items du jalon COURANT (round 14) — alimente
   *  une barre de remplissage fine au bas de la case du jalon courant, pour donner un signal de
   *  progression À L'INTÉRIEUR du jalon actif (jusqu'ici "courant" ne disait que oui/non, jamais
   *  "à quel point"). Optionnel et sans effet sur les jalons franchis/futurs : un appelant qui ne
   *  le fournit pas retrouve exactement le rendu d'avant (aucune barre). */
  currentMilestoneProgressPct?: number;
}) {
  const { t } = useTranslation();
  const currentIndex = MILESTONE_ORDER.indexOf(currentMilestone);
  const lockedTooltip = t("strategicChantierDetail.milestones.stepper.lockedTooltip");

  return (
    <div className="rounded-lg border border-border bg-white px-4 py-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
        {t("strategicChantierDetail.milestones.stepper.title")}
      </div>
      <div className="flex items-center gap-1.5">
        {MILESTONE_ORDER.map((milestoneId, i) => {
          const isPassed = passedMilestones.includes(milestoneId);
          const isCurrent = milestoneId === currentMilestone;
          const isFuture = !isPassed && !isCurrent && i > currentIndex;
          const clickable = isCurrent && !!onSelectCurrent;

          return (
            <button
              key={milestoneId}
              type="button"
              disabled={!clickable}
              onClick={clickable ? onSelectCurrent : undefined}
              title={isFuture ? lockedTooltip : undefined}
              aria-label={
                isPassed
                  ? `${t("strategicChantierDetail.milestones.stepper.passedLabel")} ${milestoneId}`
                  : isCurrent
                    ? `${t("strategicChantierDetail.milestones.stepper.currentLabel")} ${milestoneId}`
                    : `${milestoneId} — ${lockedTooltip}`
              }
              className={`relative flex flex-1 items-center justify-center gap-1 overflow-hidden rounded-md border px-3 py-2 text-[12px] font-bold transition ${
                // `isPassed` a priorité sur `isCurrent` : un dernier jalon (E4) validé reste
                // `currentMilestone` (pas de jalon suivant) tout en rejoignant `passedMilestones` —
                // sans cette priorité il s'afficherait "courant" (noir) plutôt que "franchi" (vert),
                // ce qui laisserait croire à tort qu'il reste actif après validation.
                isPassed
                  ? "cursor-default border-rag-green bg-rag-green-light text-rag-green-dark"
                  : isCurrent
                    ? "cursor-pointer border-bp-coral bg-black text-white hover:border-black"
                    : "cursor-default border-border bg-neutral-50 text-tertiary opacity-60"
              }`}
            >
              {isPassed && <Check size={10} className="shrink-0" />}
              {isFuture && <Lock size={10} className="shrink-0" />}
              {milestoneId}
              {isCurrent && currentMilestoneProgressPct !== undefined && (
                // Remplissage progressif du jalon COURANT uniquement (round 14) — barre fine
                // ancrée en bas de la case, largeur proportionnelle à la moyenne déclarée du
                // jalon (voir le commentaire du prop ci-dessus). Piste semi-transparente pour que
                // la barre reste lisible même à 0 %, remplissage plein blanc pour contraster sur
                // le fond noir du jalon actif.
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
                  <span
                    className="block h-full bg-white transition-[width]"
                    style={{
                      width: `${Math.max(0, Math.min(100, currentMilestoneProgressPct))}%`,
                    }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
