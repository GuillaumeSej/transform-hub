"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Upload } from "lucide-react";
import {
  STAFFING_IMPORT_EXAMPLE_ROWS,
  STAFFING_IMPORT_HEADERS,
  STAFFING_IMPORT_SHEET_NAME,
  validateStaffingImportRows,
  type StaffingImportPreview,
} from "@/lib/staffingExcelImport";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { Chantier, ChantierAction, ChantierStaffing } from "@/types";

/** Trouve la feuille "ETP" insensible à la casse, avec repli sur la PREMIÈRE feuille du classeur —
 *  contrairement à `StrategicImportButton.findSheet` (plusieurs feuilles optionnelles, un nom qui
 *  ne matche renvoie simplement une liste vide), cet import n'a qu'UNE feuille attendue : un CSV
 *  importé porte presque toujours un nom de feuille arbitraire ("Sheet1"), le repli évite de
 *  bloquer un fichier valide pour un simple renommage d'onglet. */
function findStaffingSheet(workbook: XLSX.WorkBook): Record<string, unknown>[] {
  const wanted = workbook.SheetNames.find(
    (n) => n.toLowerCase() === STAFFING_IMPORT_SHEET_NAME.toLowerCase()
  );
  const sheetName = wanted ?? workbook.SheetNames[0];
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
  });
}

/**
 * Bouton "Modèle Excel" + bouton "Importer un fichier" (aperçu/confirmation) pour l'import Excel
 * des lignes de staffing (`ChantierStaffing`) d'un programme — voir `lib/staffingExcelImport.ts`
 * pour le format exact et la logique d'upsert. Mirror structurel de `StrategicImportButton.tsx`.
 *
 * `onImport` reste volontairement abstrait (même discipline que `StrategicImportButton`) : c'est
 * l'appelant (`EffectifsPageClient.tsx`) qui écrit chaque entrée via `saveChantierStaffing`
 * (upsert par id) en boucle, après confirmation — cette librairie/ce composant ne font AUCUN appel
 * Firestore.
 */
export function StaffingImportButton({
  companyId,
  programId,
  chantiers,
  chantierActions,
  staffing,
  knownDepartments,
  onImport,
}: {
  companyId?: string | null;
  programId?: string | null;
  /** Chantiers du programme actif — univers de résolution de la colonne "Chantier" (par nom). */
  chantiers: Chantier[];
  /** Leviers du programme actif — univers de résolution de la colonne optionnelle "Levier" (par
   *  nom, restreint au chantier résolu de la même ligne). */
  chantierActions: ChantierAction[];
  /** Lignes de staffing déjà en base (programme actif) — sert de repli de résolution de la clé
   *  d'upsert (voir doc-comment de `validateStaffingImportRows`). */
  staffing: ChantierStaffing[];
  /** Noms d'équipe réels de la base ETP entreprise (round 13 — remplace l'ancienne union fermée à
   *  9 valeurs) : la colonne "Fonction" de l'import doit matcher l'un de ces noms. */
  knownDepartments: string[];
  /** Écrit les entrées prêtes à upserter (appelant = `saveChantierStaffing` en boucle). Peut
   *  lever : les erreurs d'écriture sont laissées à la charge de l'appelant. */
  onImport: (entries: ChantierStaffing[]) => Promise<void>;
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<StaffingImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [...STAFFING_IMPORT_HEADERS],
      ...STAFFING_IMPORT_EXAMPLE_ROWS,
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, STAFFING_IMPORT_SHEET_NAME);
    XLSX.writeFile(wb, "modele_effectifs.xlsx");
    showToast(
      t("staffingImport.templateDownloadedTitle"),
      t("staffingImport.templateDownloadedBody"),
      "success"
    );
  };

  const handleImportFile = async (file: File) => {
    const workbook = file.name.toLowerCase().endsWith(".csv")
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });

    const rawRows = findStaffingSheet(workbook);
    const result = validateStaffingImportRows(
      rawRows,
      companyId,
      programId,
      chantiers,
      chantierActions,
      staffing,
      knownDepartments
    );
    setFileName(file.name);
    setPreview(result);
  };

  const createCount = (p: StaffingImportPreview | null) =>
    p ? p.rows.filter((r) => !r.isUpdate).length : 0;
  const updateCount = (p: StaffingImportPreview | null) =>
    p ? p.rows.filter((r) => r.isUpdate).length : 0;

  const confirmImport = async () => {
    if (!preview || preview.rows.length === 0) return;
    setImporting(true);
    try {
      await onImport(preview.rows.map((r) => r.entry));
      showToast(
        t("staffingImport.successMessage"),
        t("staffingImport.importDoneBody")
          .replace("{created}", String(createCount(preview)))
          .replace("{updated}", String(updateCount(preview))),
        "success"
      );
      setPreview(null);
    } catch (err) {
      showToast(
        t("staffingImport.errorTitle"),
        err instanceof Error ? err.message : String(err),
        "error"
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={downloadTemplate}>
        <Download size={13} /> {t("staffingImport.templateButton")}
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleImportFile(file);
        }}
      />
      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
        <Upload size={13} /> {t("staffingImport.uploadButton")}
      </Button>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={t("staffingImport.previewTitle").replace("{file}", fileName)}
        maxWidth="720px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={importing || !preview || preview.rows.length === 0}
              onClick={() => void confirmImport()}
            >
              {t("staffingImport.confirmButton")}
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{createCount(preview)}</strong>{" "}
            {t("staffingImport.toCreateLabel")}
          </span>
          <span>
            <strong className="text-rag-amber">{updateCount(preview)}</strong>{" "}
            {t("staffingImport.toUpdateLabel")}
          </span>
          <span>
            <strong className="text-rag-red">{preview?.errors.length ?? 0}</strong>{" "}
            {t("staffingImport.errorRow")}
          </span>
        </div>
        <div className="max-h-[360px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {preview?.errors.length === 0 ? (
            <p className="text-tertiary">{t("shared.excelIO.noAnomalies")}</p>
          ) : (
            preview?.errors.map((e, i) => (
              <div key={i} className="text-secondary">
                {t("staffingImport.lineLabel")} {e.rowNumber} : {e.reason}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
