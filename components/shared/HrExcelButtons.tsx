"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Download, Upload } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { normalizeHeaderKey } from "@/lib/excelParse";
import { readSpreadsheetFile } from "@/lib/excelFileRead";
import { formatImportIssue, type ImportIssue } from "@/lib/importIssue";
import {
  HR_EMPLOYEE_HEADERS,
  HR_EMPLOYEE_SHEET,
  HR_IMPORT_ISSUES,
  HR_MOVEMENT_HEADERS,
  HR_MOVEMENT_SHEET,
  buildHrImportPlan,
  employeeToExcelRow,
  movementToExcelRow,
  type HrImportPlan,
  type ProgramRef,
} from "@/lib/hrExcel";
import type { useBeTrackData } from "@/lib/hooks/useStorage";
import type { Employee, WorkforceMovement } from "@/types";

type Preview = { fileName: string; plan: HrImportPlan };

function localDateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Export/Import Excel de la base ETP — workbook à deux feuilles ("Base ETP" + "Mouvements"),
 * ré-importable tel quel. L'import (voir `lib/hrExcel.ts::buildHrImportPlan`) patche les employés
 * par matricule et les mouvements par id (id vide = création), après prévisualisation, puis écrit
 * le tout en UNE écriture attendue (`importWorkforce`) — un échec affiche une erreur.
 *
 * `employees`/`movements` (facultatifs) : périmètre exporté — la page passe ses listes FILTRÉES
 * pour que l'export respecte les filtres affichés. `programs` : résolution des noms de programme.
 */
export function HrExcelButtons({
  data,
  employees,
  movements,
  programs,
  filtered = false,
}: {
  data: ReturnType<typeof useBeTrackData>;
  employees?: Employee[];
  movements?: WorkforceMovement[];
  programs?: ProgramRef[];
  /** true = l'export porte sur une sélection filtrée (mentionné dans le nom de fichier). */
  filtered?: boolean;
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importing, setImporting] = useState(false);

  const exportExcel = () => {
    const empList = employees ?? data.workforce.employees;
    const movList = movements ?? data.workforce.movements;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      empList.length > 0
        ? XLSX.utils.json_to_sheet(empList.map(employeeToExcelRow), {
            header: [...HR_EMPLOYEE_HEADERS],
          })
        : XLSX.utils.aoa_to_sheet([[...HR_EMPLOYEE_HEADERS]]),
      HR_EMPLOYEE_SHEET
    );
    XLSX.utils.book_append_sheet(
      wb,
      movList.length > 0
        ? XLSX.utils.json_to_sheet(
            movList.map((m) => movementToExcelRow(m, data, programs)),
            { header: [...HR_MOVEMENT_HEADERS] }
          )
        : XLSX.utils.aoa_to_sheet([[...HR_MOVEMENT_HEADERS]]),
      HR_MOVEMENT_SHEET
    );
    XLSX.writeFile(wb, `base_etp_${filtered ? "filtre_" : ""}${localDateStamp()}.xlsx`);
    showToast(
      t("shared.excelIO.exportSuccessTitle", "Export Excel généré"),
      t("shared.hrExcelButtons.exportSuccessBody", "{emp} employés · {mov} mouvements")
        .replace("{emp}", String(empList.length))
        .replace("{mov}", String(movList.length)) +
        (filtered ? t("hrImport.exportFilteredSuffix", " (filtres appliqués)") : ""),
      "success"
    );
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[...HR_EMPLOYEE_HEADERS]]),
      HR_EMPLOYEE_SHEET
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[...HR_MOVEMENT_HEADERS]]),
      HR_MOVEMENT_SHEET
    );
    XLSX.writeFile(wb, `template_base_etp.xlsx`);
    showToast(
      t("shared.excelIO.templateDownloadedTitle", "Modèle téléchargé"),
      t(
        "shared.hrExcelButtons.templateDownloadedBody",
        "Remplissez les colonnes puis importez le fichier"
      ),
      "success"
    );
  };

  const handleFile = async (file: File) => {
    try {
      // CSV décodé UTF-8 / Windows-1252 + raw : accents et "€" corrects, "0,5"/"01/03/2026"
      // gardés en texte puis lus au format français (lib/excelFileRead.ts, lib/excelParse.ts).
      const workbook = await readSpreadsheetFile(file);
      const names = workbook.SheetNames;
      const movSheetName = names.find((n) => /mouvement|movement/.test(normalizeHeaderKey(n)));
      const empSheetName =
        names.find((n) => normalizeHeaderKey(n).includes("etp")) ??
        names.find((n) => n !== movSheetName) ??
        names[0];
      const rowsOf = (name: string | undefined) =>
        name
          ? XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], {
              defval: "",
            })
          : [];
      const plan = buildHrImportPlan(
        { employeeRows: rowsOf(empSheetName), movementRows: rowsOf(movSheetName) },
        data,
        programs
      );
      setPreview({ fileName: file.name, plan });
    } catch (err) {
      showToast(
        t("hrImport.readFailedTitle", "Fichier illisible"),
        err instanceof Error ? err.message : String(err),
        "error"
      );
    }
  };

  const confirmImport = async () => {
    if (!preview) return;
    const { plan } = preview;
    setImporting(true);
    try {
      await data.importWorkforce(plan.employees, plan.movements);
      showToast(
        t("shared.excelIO.importDoneTitle", "Import Excel terminé"),
        t(
          "shared.hrExcelButtons.importDoneBody",
          "{emp} employé(s) · {created} mouvement(s) créé(s), {updated} mis à jour"
        )
          .replace("{emp}", String(plan.employees.length))
          .replace("{created}", String(plan.createdMovements))
          .replace("{updated}", String(plan.updatedMovements)),
        "success"
      );
      setPreview(null);
    } catch (err) {
      console.error("[betrack] import Excel RH :", err);
      showToast(
        t("hrImport.importFailedTitle", "Échec de l'import"),
        t("hrImport.importFailedBody", "Aucune donnée n'a été enregistrée : {error}").replace(
          "{error}",
          err instanceof Error ? err.message : String(err)
        ),
        "error"
      );
    } finally {
      setImporting(false);
    }
  };

  const issueLine = (issue: ImportIssue) => {
    const prefix =
      issue.rowNumber > 0
        ? t("hrImport.rowPrefix", "{sheet} · ligne {row} :")
            .replace("{sheet}", issue.sheet ?? "")
            .replace("{row}", String(issue.rowNumber))
        : t("hrImport.filePrefix", "{sheet} :").replace("{sheet}", issue.sheet ?? "");
    return `${prefix} ${formatImportIssue(t, "hrImport.issue", HR_IMPORT_ISSUES, issue)}`;
  };

  const plan = preview?.plan;
  const errors = plan?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = plan?.issues.filter((i) => i.severity === "warning") ?? [];
  const toWrite = (plan?.employees.length ?? 0) + (plan?.movements.length ?? 0);

  const counts = (created: number, updated: number, unchanged: number) =>
    `${created} ${t("hrImport.createdUnit", "créé(s)")} · ${updated} ${t(
      "hrImport.updatedUnit",
      "mis à jour"
    )} · ${unchanged} ${t("hrImport.unchangedUnit", "inchangé(s)")}`;

  return (
    <>
      <Button variant="outline" onClick={downloadTemplate}>
        <Download size={13} /> {t("shared.excelIO.templateButton", "Modèle Excel")}
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
        onOpenChange={(open) => !open && !importing && setPreview(null)}
        title={t("shared.excelIO.previewTitle", "Prévisualisation de l'import — {file}").replace(
          "{file}",
          preview?.fileName ?? ""
        )}
        maxWidth="720px"
        footer={
          <>
            <Button variant="ghost" disabled={importing} onClick={() => setPreview(null)}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button
              variant="primary"
              disabled={importing || toWrite === 0}
              onClick={() => void confirmImport()}
            >
              {importing
                ? t("hrImport.importing", "Import en cours…")
                : t("shared.excelIO.confirmImportButton", "Confirmer l'import")}
            </Button>
          </>
        }
      >
        <div className="mb-3 space-y-1 text-[13px]">
          <div>
            <strong>{t("shared.hrExcelButtons.employeesUnit", "employé(s)")}</strong> :{" "}
            {counts(
              plan?.createdEmployees ?? 0,
              plan?.updatedEmployees ?? 0,
              plan?.unchangedEmployees ?? 0
            )}
          </div>
          <div>
            <strong>{t("shared.hrExcelButtons.movementsUnit", "mouvement(s)")}</strong> :{" "}
            {counts(
              plan?.createdMovements ?? 0,
              plan?.updatedMovements ?? 0,
              plan?.unchangedMovements ?? 0
            )}
          </div>
          <div className="flex flex-wrap gap-4">
            <span>
              <strong className="text-rag-red">{plan?.rejectedRows ?? 0}</strong>{" "}
              {t("shared.hrExcelButtons.ignoredRowsUnit", "ligne(s) ignorée(s)")}
            </span>
            <span>
              <strong className="text-rag-amber">{warnings.length}</strong>{" "}
              {t("shared.hrExcelButtons.warningsUnit", "avertissement(s)")}
            </span>
          </div>
        </div>
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {errors.length + warnings.length === 0 ? (
            <p className="text-tertiary">
              {t("shared.excelIO.noAnomalies", "Aucune anomalie détectée.")}
            </p>
          ) : (
            <>
              {errors.map((issue, i) => (
                <div key={`e${i}`} className="text-rag-red">
                  {issueLine(issue)}
                </div>
              ))}
              {warnings.map((issue, i) => (
                <div key={`w${i}`} className="text-secondary">
                  {issueLine(issue)}
                </div>
              ))}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
