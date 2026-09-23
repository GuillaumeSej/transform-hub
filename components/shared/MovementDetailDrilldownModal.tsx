"use client";

import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/shared/Modal";
import { MovementNetBalanceSummary } from "@/components/shared/MovementNetBalanceSummary";
import { movementNetBalance } from "@/lib/hrMovementBalance";
import {
  MOVEMENT_PROGRESS_COLORS,
  movementProgressStatusLabel,
} from "@/components/shared/charts/MovementProgressByDimensionChart";
import { classifyMovementExecution } from "@/lib/hrExecution";
import { etpMovementDeepLink } from "@/lib/hrMovementLink";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { movementTypeLabel } from "@/lib/hrMovementLabels";
import type { WorkforceMovement } from "@/types";

/**
 * Variante DÉTAILLÉE ("qui a fait quoi") de `MovementDrilldownModal` pour le widget
 * "Avancement des mouvements par {dimension}" : même Modal, même lien groupé/unitaire vers la Base
 * ETP (`etpMovementDeepLink`), mais un tableau avec qui / type / programme / département / pays /
 * date prévue / date réelle / statut au lieu d'une simple liste. Aucun calcul métier : l'appelant
 * fournit la liste des mouvements déjà filtrée (segment ou groupe cliqué). Le statut affiché est
 * le statut d'exécution (`classifyMovementExecution`), cohérent avec les segments du graphique.
 */
export function MovementDetailDrilldownModal({
  open,
  onOpenChange,
  title,
  movements,
  programLabels = {},
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  movements: WorkforceMovement[];
  programLabels?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const goToEtp = (ids: string[]) => {
    onOpenChange(false);
    router.push(etpMovementDeepLink(ids));
  };

  const sorted = [...movements].sort(
    (a, b) => a.plannedDate.localeCompare(b.plannedDate) || a.label.localeCompare(b.label, "fr")
  );
  const dash = "—";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} maxWidth="1040px">
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-tertiary">
          {t("hr.noMovementsPeriod", "Aucun mouvement sur cette période.")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <MovementNetBalanceSummary balance={movementNetBalance(sorted)} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-secondary">
              {t("hr.movementProgress.count", "{n} mouvement(s)").replace(
                "{n}",
                String(sorted.length)
              )}
            </span>
            {sorted.length >= 2 && (
              <button
                type="button"
                onClick={() => goToEtp(sorted.map((m) => m.id))}
                className="inline-flex w-fit items-center gap-1.5 rounded-md border border-bp-coral/40 bg-bp-coral/5 px-3 py-1.5 text-[12px] font-semibold text-bp-coral transition hover:border-bp-coral hover:bg-bp-coral/10"
              >
                {t("hr.drilldown.seeAllInEtp", "Voir ces {n} mouvements dans la Base ETP").replace(
                  "{n}",
                  String(sorted.length)
                )}
                <ArrowUpRight size={13} />
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
              <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-tertiary">
                <tr>
                  <th className="px-3 py-2 font-semibold">
                    {t("hr.movementProgress.col.who", "Qui")}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t("hr.movementProgress.col.type", "Type")}
                  </th>
                  <th className="px-3 py-2 font-semibold">{t("dashboard.program", "Programme")}</th>
                  <th className="px-3 py-2 font-semibold">{t("hr.department", "Département")}</th>
                  <th className="px-3 py-2 font-semibold">{t("dashboard.country", "Pays")}</th>
                  <th className="px-3 py-2 font-semibold">
                    {t("hr.movementProgress.col.plannedDate", "Date prévue")}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t("hr.movementProgress.col.actualDate", "Date réelle")}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {t("hr.movementProgress.col.status", "Statut")}
                  </th>
                  <th className="w-8 px-2 py-2" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const execution = classifyMovementExecution(m);
                  return (
                    <tr
                      key={m.id}
                      onClick={() => goToEtp([m.id])}
                      className="cursor-pointer border-t border-border transition hover:bg-neutral-50"
                      title={t("hr.movementProgress.openInEtp", "Ouvrir dans la Base ETP")}
                    >
                      <td className="px-3 py-2 font-semibold text-primary">{m.label || dash}</td>
                      <td className="px-3 py-2 text-secondary">
                        {movementTypeLabel(t, m.type)}
                        {m.toDepartment && m.toDepartment !== m.department
                          ? ` → ${m.toDepartment}`
                          : ""}
                      </td>
                      <td className="px-3 py-2 text-secondary">
                        {m.programId ? (programLabels[m.programId] ?? m.programId) : dash}
                      </td>
                      <td className="px-3 py-2 text-secondary">{m.department || dash}</td>
                      <td className="px-3 py-2 text-secondary">{m.country || dash}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-secondary">
                        {m.plannedDate || dash}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-secondary">
                        {m.actualDate || dash}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-primary">
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 rounded-[2px]"
                            style={{ backgroundColor: MOVEMENT_PROGRESS_COLORS[execution] }}
                          />
                          {movementProgressStatusLabel(t, execution)}
                          {m.hrValidated ? " ✓RH" : ""}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-tertiary">
                        <ArrowUpRight size={14} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
