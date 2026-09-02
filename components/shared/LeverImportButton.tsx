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
import type { BeTrackData, Workstream } from "@/types";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";

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
  programs = [],
  onImport,
  onCreateWorkstreams,
}: {
  data: Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">;
  companyId?: string | null;
  /** Programmes de l'entreprise, pour résoudre la colonne optionnelle "Programme" — voir
   *  lib/leverExcelImport.ts (contrairement au Workstream, un Programme inconnu est une erreur de
   *  ligne, pas une auto-création : il doit déjà exister, créé dans Admin > Programmes). */
  programs?: { id: string; name: string }[];
  onImport: (rows: LeverImportPreview["toUpsert"]) => {
    createdCount: number;
    updatedCount: number;
  };
  /** Persiste les workstreams auto-créés (voir LeverImportPreview.toCreateWorkstreams) — appelé
   *  AVANT onImport pour que les leviers importés référencent des workstreams déjà enregistrés. */
  onCreateWorkstreams: (workstreams: Workstream[]) => void;
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
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
        "",
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
      t("shared.excelIO.templateDownloadedTitle", "Template téléchargé"),
      t(
        "shared.leverImportButton.templateDownloadedBody",
        "3 feuilles : Leviers (Code = clé), Actions (Code Levier = FK), Impacts (Code Levier + Nom de l'action = FK). Supprimez la ligne d'exemple avant de remplir."
      ),
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

    const result = validateLeverImportRows(sheets, data, companyId, programs);
    setFileName(file.name);
    setPreview(result);
  };

  const confirmImport = () => {
    if (!preview || preview.toUpsert.length === 0) return;
    setImporting(true);
    try {
      if (preview.toCreateWorkstreams.length > 0) {
        onCreateWorkstreams(preview.toCreateWorkstreams);
      }
      const { createdCount, updatedCount } = onImport(preview.toUpsert);
      const wsNote =
        preview.toCreateWorkstreams.length > 0
          ? ` · ${t("shared.leverImportButton.workstreamsCreatedNote", "{n} workstream(s) créé(s)").replace("{n}", String(preview.toCreateWorkstreams.length))}`
          : "";
      const errNote =
        preview.errors.length > 0
          ? ` · ${t("shared.leverImportButton.ignoredRowsNote", "{n} ligne(s) ignorée(s)").replace("{n}", String(preview.errors.length))}`
          : "";
      showToast(
        t("shared.excelIO.importDoneTitle", "Import Excel terminé"),
        t(
          "shared.leverImportButton.importDoneBody",
          "{created} levier(s) créé(s) · {updated} mis à jour"
        )
          .replace("{created}", String(createdCount))
          .replace("{updated}", String(updatedCount)) +
          wsNote +
          errNote,
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
        <Download size={13} /> {t("shared.excelIO.templateButton", "Template Excel")}
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
        <Upload size={13} /> {t("shared.leverImportButton.importButton", "Importer un fichier")}
      </Button>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={t("shared.excelIO.previewTitle", "Prévisualisation de l'import — {file}").replace(
          "{file}",
          fileName
        )}
        maxWidth="720px"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button
              variant="primary"
              disabled={importing || (preview?.toUpsert.length ?? 0) === 0}
              onClick={confirmImport}
            >
              {t("shared.excelIO.confirmImportButton", "Confirmer l'import")}
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{preview?.createCount ?? 0}</strong>{" "}
            {t("shared.leverImportButton.createCountLabel", "levier(s) à créer")}
          </span>
          <span>
            <strong className="text-bp-coral">{preview?.updateCount ?? 0}</strong>{" "}
            {t("shared.leverImportButton.updateCountLabel", "levier(s) à mettre à jour")}
          </span>
          <span>
            <strong className="text-rag-red">{preview?.errors.length ?? 0}</strong>{" "}
            {t("shared.leverImportButton.errorRowsLabel", "ligne(s) en erreur")}
          </span>
        </div>
        {preview && preview.toCreateWorkstreams.length > 0 && (
          <div className="mb-3 rounded-md border border-bp-coral/30 bg-bp-coral/5 p-2.5 text-xs text-secondary">
            <strong className="text-primary">{preview.toCreateWorkstreams.length}</strong>{" "}
            {t(
              "shared.leverImportButton.workstreamsNoteIntro",
              "workstream(s) référencé(s) dans le fichier n'existe(nt) pas encore pour cette entreprise et"
            )}{" "}
            {preview.toCreateWorkstreams.length > 1
              ? t("shared.leverImportButton.willBeCreatedPlural", "seront créés")
              : t("shared.leverImportButton.willBeCreatedSingular", "sera créé")}{" "}
            {t(
              "shared.leverImportButton.workstreamsNoteOutro",
              "automatiquement : {names}."
            ).replace("{names}", preview.toCreateWorkstreams.map((w) => w.name).join(", "))}
          </div>
        )}
        <div className="max-h-[360px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {preview?.errors.length === 0 ? (
            <p className="text-tertiary">
              {t("shared.excelIO.noAnomalies", "Aucune anomalie détectée.")}
            </p>
          ) : (
            preview?.errors.map((e, i) => (
              <div key={i} className="text-secondary">
                [{e.sheet}] {t("shared.leverImportButton.lineLabel", "Ligne")} {e.rowNumber} :{" "}
                {e.reason}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
