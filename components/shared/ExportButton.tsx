"use client";

import { FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { leverToExcelRow } from "@/lib/leverExcel";
import type { BeTrackData } from "@/types";

/**
 * Export Excel réel des leviers (via `data`), utilisé sur la page Leviers.
 * L'export PowerPoint du dashboard exécutif vit désormais dans son propre composant
 * `DashboardExportButton` (capture DOM des widgets + génération .pptx via pptxgenjs), distinct de
 * celui-ci car sa logique n'a rien à voir avec l'export Excel tabulaire.
 */
export function ExportButton({ data }: { data: BeTrackData }) {
  const { showToast } = useToast();

  const exportExcel = (d: BeTrackData) => {
    const rows = d.levers.map((l) => leverToExcelRow(l, d));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Leviers");

    XLSX.writeFile(
      workbook,
      `leviers_${d.program.id}_${new Date().toISOString().slice(0, 10)}.xlsx`
    );
    showToast("Export Excel généré", `${rows.length} leviers exportés`, "success");
  };

  return (
    <Button variant="outline" onClick={() => exportExcel(data)}>
      <FileSpreadsheet size={13} /> Export Excel
    </Button>
  );
}
