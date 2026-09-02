"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Download, Upload } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
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
 * (id vide = création), après prévisualisation. Inclut aussi le téléchargement d'un template vide.
 */
export function HrExcelButtons({ data }: { data: ReturnType<typeof useBeTrackData> }) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  const EMP_HEADERS = [
    "Matricule",
    "Nom",
    "Département",
    "Direction",
    "RH local",
    "Région",
    "Pays",
    "Fonction",
    "Équipe",
    "BU",
    "Entité",
    "Niveau",
    "ETP",
    "Salaire brut annuel (€)",
    "Date d'entrée",
    "Départ retraite",
  ];
  const MOV_HEADERS = [
    "ID mouvement",
    "Matricule",
    "Employé / Poste",
    "Type",
    "ETP concernés",
    "Département",
    "Département d'arrivée",
    "Pays",
    "RH local",
    "Levier (code)",
    "Programme",
    "Owner Initiative",
    "Date planifiée",
    "Date réalisée",
    "Statut",
    "Validé RH",
    "Dispositif social",
    "PSE",
    "Impact masse salariale (€/an)",
    "Économies (€)",
    "Coût one-off (€)",
    "Commentaire",
  ];

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
      t("shared.excelIO.exportSuccessTitle", "Export Excel généré"),
      t("shared.hrExcelButtons.exportSuccessBody", "{emp} employés · {mov} mouvements")
        .replace("{emp}", String(data.workforce.employees.length))
        .replace("{mov}", String(data.workforce.movements.length)),
      "success"
    );
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const empSheet = XLSX.utils.aoa_to_sheet([EMP_HEADERS]);
    XLSX.utils.book_append_sheet(wb, empSheet, "Base ETP");
    const movSheet = XLSX.utils.aoa_to_sheet([MOV_HEADERS]);
    XLSX.utils.book_append_sheet(wb, movSheet, "Mouvements");
    XLSX.writeFile(wb, `template_base_etp.xlsx`);
    showToast(
      t("shared.excelIO.templateDownloadedTitle", "Template téléchargé"),
      t(
        "shared.hrExcelButtons.templateDownloadedBody",
        "Remplissez les colonnes puis importez le fichier"
      ),
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
      t("shared.excelIO.importDoneTitle", "Import Excel terminé"),
      t(
        "shared.hrExcelButtons.importDoneBody",
        "{emp} employé(s) · {created} mouvement(s) créé(s), {updated} mis à jour"
      )
        .replace("{emp}", String(empCount))
        .replace("{created}", String(movCreated))
        .replace("{updated}", String(movUpdated)),
      "success"
    );
    setPreview(null);
  };

  return (
    <>
      <Button variant="outline" onClick={downloadTemplate}>
        <Download size={13} /> {t("shared.excelIO.templateButton", "Template Excel")}
      </Button>
      <Button variant="outline" onClick={exportExcel}>
        <FileSpreadsheet size={13} /> {t("shared.hrExcelButtons.exportButton", "Exporter Excel")}
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
        <Upload size={13} /> {t("shared.hrExcelButtons.importButton", "Importer Excel")}
      </Button>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={t("shared.excelIO.previewTitle", "Prévisualisation de l'import — {file}").replace(
          "{file}",
          preview?.fileName ?? ""
        )}
        maxWidth="640px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button
              variant="primary"
              disabled={(preview?.employees.length ?? 0) + (preview?.movements.length ?? 0) === 0}
              onClick={confirmImport}
            >
              {t("shared.excelIO.confirmImportButton", "Confirmer l'import")}
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{preview?.employees.length ?? 0}</strong>{" "}
            {t("shared.hrExcelButtons.employeesUnit", "employé(s)")}
          </span>
          <span>
            <strong className="text-rag-green-dark">{preview?.movements.length ?? 0}</strong>{" "}
            {t("shared.hrExcelButtons.movementsUnit", "mouvement(s)")}
          </span>
          <span>
            <strong className="text-rag-red">{preview?.ignored ?? 0}</strong>{" "}
            {t("shared.hrExcelButtons.ignoredRowsUnit", "ligne(s) ignorée(s)")}
          </span>
          <span>
            <strong className="text-rag-amber">{preview?.warnings.length ?? 0}</strong>{" "}
            {t("shared.hrExcelButtons.warningsUnit", "avertissement(s)")}
          </span>
        </div>
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {preview?.warnings.length === 0 ? (
            <p className="text-tertiary">
              {t("shared.excelIO.noAnomalies", "Aucune anomalie détectée.")}
            </p>
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
