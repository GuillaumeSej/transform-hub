"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Upload } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";
import { parseLeverExcelRow, type LeverImportInput } from "@/lib/leverExcel";
import type { useBeTrackData } from "@/lib/hooks/useStorage";

type PreviewRow = { rowNumber: number; values: LeverImportInput | null; warnings: string[] };

/**
 * Import Excel — lit un fichier généré par ExportButton (mêmes en-têtes de colonnes), prévisualise
 * les lignes valides / en erreur, puis upsert par "Code" via lib/storage.ts.
 */
export function ExcelUploadButton({ data }: { data: ReturnType<typeof useBeTrackData> }) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [fileName, setFileName] = useState("");

  const handleFile = async (file: File) => {
    // Le CSV est un format texte : le lire comme tel (UTF-8 via File.text()) plutôt que comme
    // tableau d'octets binaire, sous peine de corrompre les caractères accentués.
    const workbook = file.name.toLowerCase().endsWith(".csv")
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

    const parsed = rows.map((row, i) => {
      const { values, warnings } = parseLeverExcelRow(row, data, i + 2); // +2 : ligne 1 = en-têtes
      return { rowNumber: i + 2, values, warnings };
    });

    setFileName(file.name);
    setPreview(parsed);
  };

  const validRows = preview?.filter((r) => r.values !== null) ?? [];
  const invalidRows = preview?.filter((r) => r.values === null) ?? [];
  const warningCount = preview?.reduce((s, r) => s + r.warnings.length, 0) ?? 0;

  const confirmImport = () => {
    let created = 0;
    let updated = 0;
    validRows.forEach((row) => {
      const { created: wasCreated } = data.upsertLeverByCode(row.values as LeverImportInput);
      if (wasCreated) created += 1;
      else updated += 1;
    });
    showToast(
      "Import Excel terminé",
      `${created} créé(s), ${updated} mis à jour, ${invalidRows.length} ignoré(s)`,
      "success"
    );
    setPreview(null);
    setFileName("");
  };

  return (
    <>
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
        title={`Prévisualisation de l'import — ${fileName}`}
        maxWidth="640px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Annuler
            </Button>
            <Button variant="primary" disabled={validRows.length === 0} onClick={confirmImport}>
              Confirmer l&apos;import ({validRows.length})
            </Button>
          </>
        }
      >
        <div className="mb-3 flex gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{validRows.length}</strong> ligne(s) valide(s)
          </span>
          <span>
            <strong className="text-rag-red">{invalidRows.length}</strong> ligne(s) ignorée(s)
          </span>
          <span>
            <strong className="text-rag-amber">{warningCount}</strong> avertissement(s)
          </span>
        </div>
        <div className="max-h-[320px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {preview?.every((r) => r.warnings.length === 0) ? (
            <p className="text-tertiary">Aucune anomalie détectée.</p>
          ) : (
            preview
              ?.flatMap((r) => r.warnings)
              .map((w, i) => (
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
