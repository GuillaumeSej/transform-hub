"use client";

import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/shared/Modal";
import { MovementNetBalanceSummary } from "@/components/shared/MovementNetBalanceSummary";
import { movementNetBalance } from "@/lib/hrMovementBalance";
import { etpMovementDeepLink } from "@/lib/hrMovementLink";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { movementStatusLabel, movementTypeLabel } from "@/lib/hrMovementLabels";
import type { WorkforceMovement } from "@/types";

/**
 * Modale de drill-down générique pour les graphiques RH agrégés qui n'ont pas de vue de détail
 * dédiée — "Mouvements prévus par {dimension}" (`DepartmentMovementsChart`), "Statut des
 * mouvements par type" (`MovementStatusByTypeChart`) et "Détail mensuel des mouvements et cumul
 * net" (`MovementRhythmChart`). Modelée sur `components/finance/CostDrilldownModal.tsx` : reçoit
 * la liste déjà calculée des `WorkforceMovement[]` derrière la barre/segment cliqué et se contente
 * de les afficher — AUCUN calcul métier ici, tout est déjà agrégé par l'appelant (voir les champs
 * `movements`/`movementsByStatus` ajoutés à `lib/hrEngine.ts::movementBreakdownByDimension`,
 * `lib/hrExecution.ts::movementStatusByType` et `lib/hrTimeSeries.ts::movementRhythmSeries`).
 *
 * Le clic sur un mouvement, ou sur le lien groupé quand il y en a ≥2, réutilise le mécanisme
 * unique de navigation vers un mouvement précis (`etpMovementDeepLink`, lib/hrMovementLink.ts) —
 * même mécanisme que la matrice de statut et le drill-down de la waterfall ETP dans
 * `app/(app)/hr/page.tsx`.
 */
export function MovementDrilldownModal({
  open,
  onOpenChange,
  title,
  movements,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  movements: WorkforceMovement[];
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const goToEtp = (ids: string[]) => {
    onOpenChange(false);
    router.push(etpMovementDeepLink(ids));
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} maxWidth="560px">
      {movements.length === 0 ? (
        <p className="py-6 text-center text-sm text-tertiary">
          {t("hr.noMovementsPeriod", "Aucun mouvement sur cette période.")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <MovementNetBalanceSummary balance={movementNetBalance(movements)} />
          {movements.length >= 2 && (
            <button
              type="button"
              onClick={() => goToEtp(movements.map((m) => m.id))}
              className="inline-flex w-fit items-center gap-1.5 rounded-md border border-bp-coral/40 bg-bp-coral/5 px-3 py-1.5 text-[12px] font-semibold text-bp-coral transition hover:border-bp-coral hover:bg-bp-coral/10"
            >
              {t("hr.drilldown.seeAllInEtp", "Voir ces {n} mouvements dans la Base ETP").replace(
                "{n}",
                String(movements.length)
              )}
              <ArrowUpRight size={13} />
            </button>
          )}
          <div className="space-y-1.5">
            {movements.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => goToEtp([m.id])}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-neutral-50 px-3 py-2 text-left transition hover:border-bp-coral hover:bg-white"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-semibold text-primary">
                    {movementTypeLabel(t, m.type)} · {m.label}
                  </span>
                  <span className="text-[11px] text-tertiary">
                    {m.plannedDate} · {movementStatusLabel(t, m.status)}
                    {m.hrValidated ? " ✓RH" : ""} · {m.fte} {t("etp.column.fte", "ETP")}
                  </span>
                </span>
                <ArrowUpRight size={14} className="shrink-0 text-tertiary" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
