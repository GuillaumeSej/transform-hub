"use client";

import { FileSpreadsheet } from "lucide-react";
import { useMemo } from "react";
import * as XLSX from "xlsx";
import { generateAlerts } from "@/lib/alertEngine";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { leverActionsToExcelRows, leverToExcelRow } from "@/lib/leverExcel";
import { ACTION_IMPORT_HEADERS } from "@/lib/leverExcelImport";
import type { BeTrackData, Company, Lever } from "@/types";

/**
 * Export Excel réel des leviers (via `data`), utilisé sur la page Leviers.
 * L'export PowerPoint du dashboard exécutif vit désormais dans son propre composant
 * `DashboardExportButton` (capture DOM des widgets + génération .pptx via pptxgenjs), distinct de
 * celui-ci car sa logique n'a rien à voir avec l'export Excel tabulaire.
 */
export function ExportButton({
  data,
  riskThresholds,
  programs = [],
  levers,
}: {
  data: BeTrackData;
  /** Leviers à exporter — ceux réellement affichés à l'écran (programme, habilitation, filtres,
   *  recherche). Sans ce prop : tous les leviers de `data` (comportement historique, qui
   *  exportait toute l'entreprise quels que soient le rôle, la confidentialité et les filtres). */
  levers?: Lever[];
  /** Seuils de risque de l'entreprise courante (voir engine.computeLeverRisk) — seuils par défaut
   *  si non fournis. */
  riskThresholds?: Company["riskThresholds"];
  /** Programmes de l'entreprise, pour résoudre la colonne "Programme" de l'export — voir
   *  `lib/leverExcel.ts`. Sans elle, la colonne serait absente et le fichier ré-exporté
   *  deviendrait non ré-importable dès que l'entreprise a plusieurs programmes. */
  programs?: { id: string; name: string }[];
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const alerts = useMemo(() => generateAlerts(data), [data]);

  const exportExcel = (d: BeTrackData) => {
    const leversToExport = levers ?? d.levers;
    const rows = leversToExport.map((l) =>
      leverToExcelRow(l, d, alerts, riskThresholds, undefined, programs)
    );
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Leviers");
    // Feuille "Actions" au format de l'import : un export ré-importé tel quel ne doit pas vider
    // les plans d'action (voir lib/leverExcelImport.ts, fusion des actions par nom).
    const actionsSheet = XLSX.utils.json_to_sheet(leversToExport.flatMap(leverActionsToExcelRows), {
      header: [...ACTION_IMPORT_HEADERS],
    });
    XLSX.utils.book_append_sheet(workbook, actionsSheet, "Actions");

    XLSX.writeFile(
      workbook,
      `leviers_${d.program.id}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    showToast(
      t("shared.excelIO.exportSuccessTitle", "Export Excel généré"),
      t("shared.exportButton.successBody", "{n} leviers exportés").replace(
        "{n}",
        String(rows.length)
      ),
      "success"
    );
  };

  return (
    <Button variant="outline" onClick={() => exportExcel(data)}>
      <FileSpreadsheet size={13} /> Export Excel
    </Button>
  );
}
