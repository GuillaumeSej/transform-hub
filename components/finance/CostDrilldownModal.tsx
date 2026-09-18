"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/shared/Modal";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { WorkstreamCostGroup } from "@/lib/financeCosts";

/**
 * Modal de drill-down commune aux graphiques cliquables du module Finance
 * (`CostEngagedVsUpcomingChart`, `CostByHierarchyChart`, `CostCommitmentTimelineChart`) : montant
 * total du segment/de la période cliquée → décomposition par
 * workstream (`Lever.ws`) → sous-vue liste des leviers de ce workstream → clic sur un levier =
 * navigation vers sa fiche détail (`/levers/detail?id=...`).
 *
 * Reçoit les groupes déjà calculés (`groupCostsByWorkstream`, lib/financeCosts.ts) — ce composant
 * ne fait AUCUN calcul métier, uniquement la navigation à deux niveaux + la mise en forme.
 */
export function CostDrilldownModal({
  open,
  onOpenChange,
  title,
  groups,
  formatValue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  groups: WorkstreamCostGroup[];
  formatValue: (value: number) => string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [selectedWsId, setSelectedWsId] = useState<string | null>(null);

  const selectedGroup = useMemo(
    () => groups.find((g) => g.wsId === selectedWsId) ?? null,
    [groups, selectedWsId]
  );

  // Revient toujours à la liste des workstreams quand la modale se referme, pour ne pas rouvrir
  // sur la sous-vue levier la fois suivante.
  const handleOpenChange = (next: boolean) => {
    if (!next) setSelectedWsId(null);
    onOpenChange(next);
  };

  const total = groups.reduce((sum, g) => sum + g.amount, 0);

  return (
    <Modal open={open} onOpenChange={handleOpenChange} title={title} maxWidth="520px">
      {!selectedGroup ? (
        <div>
          <p className="mb-3 text-[12px] text-tertiary">
            {t("finance.drilldown.totalLabel", "Total")} : <strong>{formatValue(total)}</strong>
          </p>
          {groups.length === 0 ? (
            <p className="py-6 text-center text-sm text-tertiary">
              {t("finance.drilldown.empty", "Aucun levier ne contribue à ce montant.")}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {groups.map((g) => (
                <li key={g.wsId}>
                  <button
                    type="button"
                    onClick={() => setSelectedWsId(g.wsId)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:bg-neutral-50"
                  >
                    <span className="flex items-center gap-2 text-[13px] font-semibold text-primary">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: g.color }}
                      />
                      {g.wsName}
                    </span>
                    <span className="flex items-center gap-1.5 text-[13px] text-secondary">
                      {formatValue(g.amount)}
                      <ChevronRight size={14} className="text-tertiary" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setSelectedWsId(null)}
            className="mb-3 flex items-center gap-1 text-[12px] font-semibold text-secondary hover:text-primary"
          >
            <ChevronLeft size={14} />
            {t("finance.drilldown.back", "Retour aux workstreams")}
          </button>
          <p className="mb-3 flex items-center gap-2 text-[12px] text-tertiary">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: selectedGroup.color }}
            />
            {selectedGroup.wsName} — <strong>{formatValue(selectedGroup.amount)}</strong>
          </p>
          <ul className="divide-y divide-border">
            {selectedGroup.levers.map((lever) => (
              <li key={lever.leverId}>
                <button
                  type="button"
                  onClick={() => router.push(`/levers/detail?id=${lever.leverId}`)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:bg-neutral-50"
                >
                  <span className="text-[13px] font-semibold text-primary">
                    {lever.leverCode} — {lever.leverName}
                  </span>
                  <span className="flex items-center gap-1.5 text-[13px] text-secondary">
                    {formatValue(lever.amount)}
                    <ChevronRight size={14} className="text-tertiary" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
