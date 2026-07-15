"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";
import {
  employeeToExcelRow,
  movementToExcelRow,
  parseEmployeeRow,
  parseMovementRow,
} from "@/lib/hrExcel";
import type { useBeTrackData } from "@/lib/hooks/useStorage";
import type { Employee, WorkforceMovement } from "@/types";

type Preview = {
  fileName: string;
  employees: Employee[];
  movements: WorkforceMovement[];
  warnings: string[];
  ignored: number;
};

/**
 * Export/Import Excel de la base ETP — workbook à deux feuilles ("Base ETP" + "Mouvements"),
 * ré-importable tel quel. L'import upsert les employés par matricule et les mouvements par id
 * (id vide = création), après prévisualisation.
 */
export function HrExcelButtons({ data }: { data: ReturnType<typeof useBeTrackData> }) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(data.workforce.employees.map(employeeToExcelRow)),
      "Base ETP"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(data.workforce.movements.map((m) => movementToExcelRow(m, data))),
      "Mouvements"
    );
    XLSX.writeFile(wb, `base_etp_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showToast(
      "Export Excel généré",
      `${data.workforce.employees.length} employés · ${data.workforce.movements.length} mouvements`,
      "success"
    );
  };

  const handleFile = async (file: File) => {
    const workbook = file.name.toLowerCase().endsWith(".csv")
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });

    const employees: Employee[] = [];
    const movements: WorkforceMovement[] = [];
    const warnings: string[] = [];
    let ignored = 0;

    const empSheetName =
      workbook.SheetNames.find((n) => n.toLowerCase().includes("etp")) ?? workbook.SheetNames[0];
    const empRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[empSheetName],
      { defval: "" }
    );
    empRows.forEach((row, i) => {
      const parsed = parseEmployeeRow(row, data, i + 2);
      warnings.push(...parsed.warnings);
      if (parsed.values) employees.push(parsed.values);
      else ignored += 1;
    });

    const movSheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes("mouvement"));
    if (movSheetName) {
      const movRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[movSheetName],
        { defval: "" }
      );
      movRows.forEach((row, i) => {
        const parsed = parseMovementRow(row, data, i + 2);
        warnings.push(...parsed.warnings);
        if (parsed.values) movements.push(parsed.values);
        else ignored += 1;
      });
    }

    setPreview({ fileName: file.name, employees, movements, warnings, ignored });
  };

  const confirmImport = () => {
    if (!preview) return;
    let empCount = 0;
    preview.employees.forEach((e) => {
      data.upsertEmployee(e);
      empCount += 1;
    });
    let movCreated = 0;
    let movUpdated = 0;
    preview.movements.forEach((m) => {
      const exists = m.id && data.workforce.movements.some((existing) => existing.id === m.id);
      if (exists) {
        data.updateWorkforceMovement(m.id, m);
        movUpdated += 1;
      } else {
        const input: Partial<WorkforceMovement> = { ...m };
        delete input.id;
        data.createWorkforceMovement(input as Omit<WorkforceMovement, "id">);
        movCreated += 1;
      }
    });
    showToast(
      "Import Excel terminé",
      `${empCount} employé(s) · ${movCreated} mouvement(s) créé(s), ${movUpdated} mis à jour`,
      "success"
    );
    setPreview(null);
  };

  return (
    <>
      <Button variant="outline" onClick={exportExcel}>
        <FileSpreadsheet size={13} /> Exporter Excel
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
        <Upload size={13} /> Importer Excel
      </Button>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={`Prévisualisation de l'import — ${preview?.fileName ?? ""}`}
        maxWidth="640px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={(preview?.employees.length ?? 0) + (preview?.movements.length ?? 0) === 0}
              onClick={confirmImport}
            >
              Confirmer l&apos;import
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{preview?.employees.length ?? 0}</strong>{" "}
            employé(s)
          </span>
          <span>
            <strong className="text-rag-green-dark">{preview?.movements.length ?? 0}</strong>{" "}
            mouvement(s)
          </span>
          <span>
            <strong className="text-rag-red">{preview?.ignored ?? 0}</strong> ligne(s) ignorée(s)
          </span>
          <span>
            <strong className="text-rag-amber">{preview?.warnings.length ?? 0}</strong>{" "}
            avertissement(s)
          </span>
        </div>
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {preview?.warnings.length === 0 ? (
            <p className="text-tertiary">Aucune anomalie détectée.</p>
          ) : (
            preview?.warnings.map((w, i) => (
              <div key={i} className="text-secondary">
                {w}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
