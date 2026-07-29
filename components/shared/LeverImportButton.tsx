"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Upload } from "lucide-react";
import {
  ACTION_IMPORT_HEADERS,
  IMPACT_IMPORT_HEADERS,
  LEVER_IMPORT_HEADERS,
  validateLeverImportRows,
  type LeverImportPreview,
} from "@/lib/leverExcelImport";
import type { BeTrackData } from "@/types";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";

const SHEET_NAMES = { leviers: "Leviers", actions: "Actions", impacts: "Impacts" } as const;

/** Trouve une feuille par nom insensible à la casse — un utilisateur qui renomme légèrement
 *  l'onglet ("leviers" au lieu de "Leviers") ne doit pas être bloqué. */
function findSheet(workbook: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase());
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
  });
}

/**
 * Bouton "Template Excel" (classeur 3 feuilles vierge, avec exemple) + bouton "Importer un
 * fichier" (aperçu/confirmation) pour l'import Excel leviers + actions + impacts — voir
 * `lib/leverExcelImport.ts` pour le format exact et la logique de validation. Affiché à côté de
 * `ExportButton` sur la page Leviers.
 */
export function LeverImportButton({
  data,
  companyId,
  onImport,
}: {
  data: Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">;
  companyId?: string | null;
  onImport: (rows: LeverImportPreview["toUpsert"]) => {
    createdCount: number;
    updatedCount: number;
  };
}) {
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<LeverImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    const leversExample = [
      [
        "PROC-001",
        "Sourcing & Achats",
        "Optimisation achats indirects",
        "Achats & Supply Chain",
        "Marc Dubois",
        "MD",
        "Isabelle Roy",
        "IR",
        "Europe",
        "France",
        "Acme France SAS",
        "Procurement",
        "CC-PROC-001",
        "GA",
        "2026-01-15",
        "2026-12-31",
        "En cours d'exécution",
        40,
        2.5,
        2.1,
        -1,
        120,
        0.3,
        0.4,
        0.1,
        "",
        "Exemple — à remplacer ou supprimer avant import",
      ],
    ];
    const leversSheet = XLSX.utils.aoa_to_sheet([[...LEVER_IMPORT_HEADERS], ...leversExample]);
    XLSX.utils.book_append_sheet(wb, leversSheet, SHEET_NAMES.leviers);

    const actionsExample = [
      [
        "PROC-001",
        "Renégocier contrats fournisseurs classe A",
        "Marc Dubois",
        "2026-01-15",
        "2026-04-30",
        "En cours",
        15,
      ],
    ];
    const actionsSheet = XLSX.utils.aoa_to_sheet([[...ACTION_IMPORT_HEADERS], ...actionsExample]);
    XLSX.utils.book_append_sheet(wb, actionsSheet, SHEET_NAMES.actions);

    const impactsExample = [
      [
        "PROC-001",
        "Renégocier contrats fournisseurs classe A",
        "Gain",
        "",
        1.2,
        "",
        "Réduction de coût",
        "",
        "01/07/2026",
        "",
        "",
        "",
        "",
        "Exemple — à remplacer ou supprimer avant import",
      ],
    ];
    const impactsSheet = XLSX.utils.aoa_to_sheet([[...IMPACT_IMPORT_HEADERS], ...impactsExample]);
    XLSX.utils.book_append_sheet(wb, impactsSheet, SHEET_NAMES.impacts);

    XLSX.writeFile(wb, "template_leviers.xlsx");
    showToast(
      "Template téléchargé",
      "3 feuilles : Leviers (Code = clé), Actions (Code Levier = FK), Impacts (Code Levier + Nom de l'action = FK). Supprimez la ligne d'exemple avant de remplir.",
      "success"
    );
  };

  const handleImportFile = async (file: File) => {
    const workbook = file.name.toLowerCase().endsWith(".csv")
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });

    const sheets = {
      leviers: findSheet(workbook, SHEET_NAMES.leviers),
      actions: findSheet(workbook, SHEET_NAMES.actions),
      impacts: findSheet(workbook, SHEET_NAMES.impacts),
    };

    const result = validateLeverImportRows(sheets, data, companyId);
    setFileName(file.name);
    setPreview(result);
  };

  const confirmImport = () => {
    if (!preview || preview.toUpsert.length === 0) return;
    setImporting(true);
    try {
      const { createdCount, updatedCount } = onImport(preview.toUpsert);
      showToast(
        "Import Excel terminé",
        `${createdCount} levier(s) créé(s) · ${updatedCount} mis à jour${preview.errors.length > 0 ? ` · ${preview.errors.length} ligne(s) ignorée(s)` : ""}`,
        "success"
      );
      setPreview(null);
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={downloadTemplate}>
        <Download size={13} /> Template Excel
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
      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
        <Upload size={13} /> Importer un fichier
      </Button>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={`Prévisualisation de l'import — ${fileName}`}
        maxWidth="720px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Annuler
            </Button>
            <Button
              variant="primary"
              disabled={importing || (preview?.toUpsert.length ?? 0) === 0}
              onClick={confirmImport}
            >
              Confirmer l&apos;import
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{preview?.createCount ?? 0}</strong> levier(s) à
            créer
          </span>
          <span>
            <strong className="text-bp-coral">{preview?.updateCount ?? 0}</strong> levier(s) à
            mettre à jour
          </span>
          <span>
            <strong className="text-rag-red">{preview?.errors.length ?? 0}</strong> ligne(s) en
            erreur
          </span>
        </div>
        <div className="max-h-[360px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {preview?.errors.length === 0 ? (
            <p className="text-tertiary">Aucune anomalie détectée.</p>
          ) : (
            preview?.errors.map((e, i) => (
              <div key={i} className="text-secondary">
                [{e.sheet}] Ligne {e.rowNumber} : {e.reason}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
