"use client";

import { FileSpreadsheet } from "lucide-react";
import { useMemo } from "react";
import * as XLSX from "xlsx";
import { generateAlerts } from "@/lib/alertEngine";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  EXCEL_CELL_MAX_LENGTH,
  IMPACT_EXPORT_HEADERS,
  leverActionsToExcelRows,
  leverImpactsToExcelRows,
  leverToExcelRow,
} from "@/lib/leverExcel";
import { ACTION_IMPORT_HEADERS } from "@/lib/leverExcelImport";
import type { BeTrackData, Company, Lever, LifecycleStage } from "@/types";

/** Segment de nom de fichier sûr (sans accents ni caractères spéciaux). */
function fileSlug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "programme"
  );
}

/**
 * Export Excel réel des leviers (via `data`), utilisé sur la page Leviers : feuilles Leviers,
 * Actions et Impacts, au format de l'import (un export ré-importé tel quel ne change rien).
 * L'export PowerPoint du dashboard exécutif vit dans `DashboardExportButton`.
 */
export function ExportButton({
  data,
  riskThresholds,
  programs = [],
  levers,
  lifecycleStages,
  selectedProgramId,
}: {
  data: BeTrackData;
  /** Leviers à exporter — ceux réellement affichés à l'écran (programme, habilitation, filtres,
   *  recherche). Sans ce prop : tous les leviers de `data`. */
  levers?: Lever[];
  /** Seuils de risque de l'entreprise courante — mêmes que l'écran (colonne "Risque"). */
  riskThresholds?: Company["riskThresholds"];
  /** Programmes de l'entreprise, pour résoudre la colonne "Programme" de l'export. */
  programs?: { id: string; name: string }[];
  /** Cycle de vie du programme affiché : la colonne "Statut" reprend les libellés de l'écran. */
  lifecycleStages?: LifecycleStage[];
  /** Programme sélectionné : utilisé pour nommer le fichier. */
  selectedProgramId?: string | null;
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const alerts = useMemo(() => generateAlerts(data), [data]);

  const exportExcel = (d: BeTrackData) => {
    const leversToExport = levers ?? d.levers;
    const rows = leversToExport.map((l) =>
      leverToExcelRow(l, d, alerts, riskThresholds, lifecycleStages, programs)
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
    // Feuille "Impacts" (libellé compris) : le ré-import rapproche chaque ligne de l'impact
    // existant et conserve id, commentaires et validation finance.
    const impactsSheet = XLSX.utils.json_to_sheet(leversToExport.flatMap(leverImpactsToExcelRows), {
      header: IMPACT_EXPORT_HEADERS,
    });
    XLSX.utils.book_append_sheet(workbook, impactsSheet, "Impacts");

    const program = programs.find((p) => p.id === selectedProgramId);
    const programPart = fileSlug(program?.name ?? selectedProgramId ?? "leviers");
    XLSX.writeFile(
      workbook,
      `leviers_${programPart}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );

    const truncated = leversToExport.filter(
      (l) => (l.description ?? "").length > EXCEL_CELL_MAX_LENGTH
    );
    showToast(
      t("shared.excelIO.exportSuccessTitle", "Export Excel généré"),
      t("shared.exportButton.successBody", "{n} leviers exportés").replace(
        "{n}",
        String(rows.length)
      ),
      "success"
    );
    if (truncated.length > 0) {
      showToast(
        t("shared.exportButton.truncatedTitle", "Descriptions tronquées"),
        t(
          "shared.exportButton.truncatedBody",
          "{n} description(s) dépassent la limite d'une cellule Excel ({max} caractères) et ont été tronquées dans le fichier : {codes}. Un ré-import conserve la description complète."
        )
          .replace("{n}", String(truncated.length))
          .replace("{max}", String(EXCEL_CELL_MAX_LENGTH))
          .replace("{codes}", truncated.map((l) => l.code).join(", ")),
        "default"
      );
    }
  };

  return (
    <Button variant="outline" onClick={() => exportExcel(data)}>
      <FileSpreadsheet size={13} /> Export Excel
    </Button>
  );
}
