"use client";

import { Modal } from "@/components/shared/Modal";
import { formatFte } from "@/components/strategic/ChantierStaffingEditor";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Une ligne de staffing "brute" (pas agrégée), prête à afficher — construite par l'appelant
 *  (`StaffingPeriodBreakdown.detailRows`) à partir de `ChantierStaffing` + des lookups déjà
 *  disponibles côté page (noms de chantier, d'axe, de levier). */
export type StaffingDetailRow = {
  id: string;
  chantierName: string;
  function: string;
  axisNames: string;
  fte: number;
  periodLabel: string;
  lever: string;
  note: string;
};

/**
 * Modale de détail « exploitable » pour `StaffingPeriodBreakdown` — round 26, demande PO : au
 * survol d'une barre/entrée de légende, le tooltip ("aperçu commercial, 1 ETP, marketing…") ne
 * permet ni de lire confortablement une liste un peu longue, ni — le point précis remonté par
 * l'utilisateur — de copier-coller les données. Modelée sur `components/finance/
 * CostDrilldownModal.tsx` et `components/shared/MovementDrilldownModal.tsx` : un vrai `<table>`
 * HTML (texte nativement sélectionnable, pas besoin d'un bouton "copier" dédié), aucun calcul
 * métier ici — les lignes sont déjà préparées par l'appelant.
 *
 * Remplace l'ancien panneau "période épinglée" inline de `StaffingPeriodBreakdown` (rows en prose
 * dans un `<p>`, ni triable ni copiable proprement) plutôt que de s'y ajouter — les deux montraient
 * la même information, la garder aurait été redondant.
 */
export function StaffingDetailModal({
  open,
  onOpenChange,
  title,
  rows,
  totalFte,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  rows: StaffingDetailRow[];
  totalFte: number;
}) {
  const { t } = useTranslation();

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} maxWidth="760px">
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-tertiary">
          {t("staffingPeriod.detailModal.empty")}
        </p>
      ) : (
        <div>
          <p className="mb-3 text-[12px] text-tertiary">
            {t("staffing.total")} :{" "}
            <strong className="text-primary">
              {formatFte(totalFte)} {t("staffing.fteUnit")}
            </strong>
            {" · "}
            {t("staffingPeriod.detailModal.rowsCount").replace("{n}", String(rows.length))}
          </p>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[680px] text-left text-[12px]">
              <thead className="bg-neutral-50 text-[11px] font-semibold uppercase tracking-wide text-secondary">
                <tr>
                  <th className="px-3 py-2">{t("effectifs.byChantierLabel")}</th>
                  <th className="px-3 py-2">{t("staffing.function")}</th>
                  <th className="px-3 py-2">{t("staffingPeriod.detailModal.columnAxis")}</th>
                  <th className="px-3 py-2 text-right">{t("etp.column.fte")}</th>
                  <th className="px-3 py-2">{t("staffingPeriod.detailModal.columnPeriod")}</th>
                  <th className="px-3 py-2">{t("staffingPeriod.detailModal.columnLever")}</th>
                  <th className="px-3 py-2">{t("staffing.note")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id} className="text-primary">
                    <td className="px-3 py-2 font-medium">{row.chantierName}</td>
                    <td className="px-3 py-2">{row.function}</td>
                    <td className="px-3 py-2 text-tertiary">{row.axisNames}</td>
                    <td className="px-3 py-2 text-right font-semibold">{formatFte(row.fte)}</td>
                    <td className="px-3 py-2 text-tertiary">{row.periodLabel}</td>
                    <td className="px-3 py-2 text-tertiary">{row.lever}</td>
                    <td className="px-3 py-2 text-tertiary">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
