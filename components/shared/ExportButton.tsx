"use client";

import { FileSpreadsheet, FileText } from "lucide-react";
import * as XLSX from "xlsx";
import { Button } from "@/components/shared/Button";
import { useToast } from "@/lib/hooks/useToast";
import { leverToExcelRow, subLeverToExcelRow } from "@/lib/leverExcel";
import type { BeTrackData } from "@/types";

/**
 * Export Excel réel pour les leviers (via `data`) ; reste un stub avec toast pour "Export COPIL
 * deck" (PPTX), non couvert par cette passe.
 */
export function ExportButton({
  type = "excel",
  data,
}: {
  type?: "excel" | "pptx";
  data?: BeTrackData;
}) {
  const { showToast } = useToast();
  const label = type === "excel" ? "Export Excel" : "Export COPIL deck";
  const Icon = type === "excel" ? FileSpreadsheet : FileText;

  const exportExcel = (d: BeTrackData) => {
    const rows = d.levers.map((l) => leverToExcelRow(l, d));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Leviers");

    const subLeverRows: Record<string, string | number>[] = [];
    d.levers.forEach((l) => {
      const subs = d.subLevers.filter((s) => s.leverId === l.id);
      subs.forEach((s) => {
        subLeverRows.push(subLeverToExcelRow(s, l.code, d));
      });
    });
    if (subLeverRows.length > 0) {
      const slSheet = XLSX.utils.json_to_sheet(subLeverRows);
      XLSX.utils.book_append_sheet(workbook, slSheet, "Sous-leviers");
    }

    XLSX.writeFile(workbook, `leviers_${d.program.id}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast("Export Excel généré", `${rows.length} leviers${subLeverRows.length > 0 ? ` · ${subLeverRows.length} sous-leviers` : ""} exportés`, "success");
  };

  return (
    <Button
      variant="outline"
      onClick={() => {
        if (type === "excel" && data) {
          exportExcel(data);
          return;
        }
        showToast(
          "Export en cours de préparation",
          type === "excel"
            ? "Génération du fichier Excel..."
            : "Génération du support PowerPoint..."
        );
      }}
    >
      <Icon size={13} /> {label}
    </Button>
  );
}
