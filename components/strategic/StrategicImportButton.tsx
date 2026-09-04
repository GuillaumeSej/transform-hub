"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Upload } from "lucide-react";
import {
  STRATEGIC_ACTION_EXAMPLE_ROW,
  STRATEGIC_ACTION_IMPORT_HEADERS,
  STRATEGIC_AXIS_EXAMPLE_ROW,
  STRATEGIC_AXIS_IMPORT_HEADERS,
  STRATEGIC_CHANTIER_EXAMPLE_ROWS,
  STRATEGIC_CHANTIER_IMPORT_HEADERS,
  STRATEGIC_DELIVERABLE_EXAMPLE_ROW,
  STRATEGIC_DELIVERABLE_IMPORT_HEADERS,
  STRATEGIC_IMPORT_SHEET_NAMES,
  STRATEGIC_INDICATOR_EXAMPLE_ROW,
  STRATEGIC_INDICATOR_IMPORT_HEADERS,
  validateStrategicImportRows,
  type StrategicImportExistingData,
  type StrategicImportPreview,
  type StrategicImportRawSheets,
} from "@/lib/strategicExcelImport";
import type { MaturityStageConfig } from "@/types";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Trouve une feuille par nom insensible à la casse — même tolérance que
 *  `LeverImportButton.findSheet` : un utilisateur qui renomme légèrement un onglet ("axes" au lieu
 *  de "Axes") ne doit pas être bloqué. */
function findSheet(workbook: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase());
  if (!sheetName) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], {
    defval: "",
  });
}

/**
 * Bouton "Modèle Excel" (classeur 5 feuilles vierge, avec exemple) + bouton "Importer un fichier"
 * (aperçu/confirmation) pour l'import Excel d'un plan stratégique complet — voir
 * `lib/strategicExcelImport.ts` pour le format exact et la logique de validation/résolution des
 * clés étrangères. Mirror structurel de `components/shared/LeverImportButton.tsx`.
 *
 * PAS ENCORE MONTÉ : ce composant est livré prêt à l'emploi mais n'est branché nulle part — une
 * passe d'intégration ultérieure l'ajoute à la barre d'outils de `StrategicAxesView.tsx` (voir
 * plan round 4, section "Découpage en agents parallèles" — fichier disputé, un agent porteur
 * unique). `onImport` reste volontairement abstrait : c'est l'appelant qui écrit les entités
 * (`toCreate.axes/chantiers/actions/indicators`) via les `save*` de
 * `lib/firestore/{strategicAxes,chantiers,chantierActions,indicators}.ts`, en boucle, après
 * confirmation — cette librairie/ce composant ne font AUCUN appel Firestore.
 */
export function StrategicImportButton({
  data,
  companyId,
  programId,
  maturityStages,
  onImport,
}: {
  /** Entités déjà en base — sert de repli de résolution des clés étrangères (voir doc-comment de
   *  `validateStrategicImportRows`) pour un import complémentaire qui référence un axe/chantier/
   *  action déjà créé plutôt que de tout réimporter. */
  data: StrategicImportExistingData;
  companyId?: string | null;
  programId?: string | null;
  /** Référentiel de cycle de maturité ACTIF du programme (voir `useMaturityStages`) — colonnes
   *  "Étape de maturité" des feuilles Axes/Chantiers/Actions résolues contre celui-ci. */
  maturityStages: MaturityStageConfig[];
  /** Écrit les entités prêtes à créer (appelant = `save*` en boucle) — voir doc-comment du
   *  composant. Peut lever : les erreurs d'écriture sont laissées à la charge de l'appelant. */
  onImport: (toCreate: StrategicImportPreview["toCreate"]) => Promise<void>;
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<StrategicImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    const axesSheet = XLSX.utils.aoa_to_sheet([
      [...STRATEGIC_AXIS_IMPORT_HEADERS],
      STRATEGIC_AXIS_EXAMPLE_ROW,
    ]);
    XLSX.utils.book_append_sheet(wb, axesSheet, STRATEGIC_IMPORT_SHEET_NAMES.axes);

    const chantiersSheet = XLSX.utils.aoa_to_sheet([
      [...STRATEGIC_CHANTIER_IMPORT_HEADERS],
      ...STRATEGIC_CHANTIER_EXAMPLE_ROWS,
    ]);
    XLSX.utils.book_append_sheet(wb, chantiersSheet, STRATEGIC_IMPORT_SHEET_NAMES.chantiers);

    const actionsSheet = XLSX.utils.aoa_to_sheet([
      [...STRATEGIC_ACTION_IMPORT_HEADERS],
      STRATEGIC_ACTION_EXAMPLE_ROW,
    ]);
    XLSX.utils.book_append_sheet(wb, actionsSheet, STRATEGIC_IMPORT_SHEET_NAMES.actions);

    const livrablesSheet = XLSX.utils.aoa_to_sheet([
      [...STRATEGIC_DELIVERABLE_IMPORT_HEADERS],
      STRATEGIC_DELIVERABLE_EXAMPLE_ROW,
    ]);
    XLSX.utils.book_append_sheet(wb, livrablesSheet, STRATEGIC_IMPORT_SHEET_NAMES.livrables);

    const indicateursSheet = XLSX.utils.aoa_to_sheet([
      [...STRATEGIC_INDICATOR_IMPORT_HEADERS],
      STRATEGIC_INDICATOR_EXAMPLE_ROW,
    ]);
    XLSX.utils.book_append_sheet(wb, indicateursSheet, STRATEGIC_IMPORT_SHEET_NAMES.indicateurs);

    XLSX.writeFile(wb, "modele_plan_strategique.xlsx");
    showToast(
      t("strategicImport.templateDownloadedTitle", "Modèle téléchargé"),
      t(
        "strategicImport.templateDownloadedBody",
        "5 feuilles : Axes (Code = clé), Chantiers (Code Axe = FK), Actions (Code Chantier = FK), Livrables (Code Action = FK, optionnelle), Indicateurs (Code Axe OU Code Chantier = FK). Supprimez les lignes d'exemple avant de remplir."
      ),
      "success"
    );
  };

  const handleImportFile = async (file: File) => {
    const workbook = file.name.toLowerCase().endsWith(".csv")
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });

    const sheets: StrategicImportRawSheets = {
      axes: findSheet(workbook, STRATEGIC_IMPORT_SHEET_NAMES.axes),
      chantiers: findSheet(workbook, STRATEGIC_IMPORT_SHEET_NAMES.chantiers),
      actions: findSheet(workbook, STRATEGIC_IMPORT_SHEET_NAMES.actions),
      livrables: findSheet(workbook, STRATEGIC_IMPORT_SHEET_NAMES.livrables),
      indicateurs: findSheet(workbook, STRATEGIC_IMPORT_SHEET_NAMES.indicateurs),
    };

    const result = validateStrategicImportRows(sheets, data, companyId, programId, maturityStages);
    setFileName(file.name);
    setPreview(result);
  };

  const totalToCreate = (p: StrategicImportPreview | null) =>
    p
      ? p.toCreate.axes.length +
        p.toCreate.chantiers.length +
        p.toCreate.actions.length +
        p.toCreate.indicators.length
      : 0;

  const confirmImport = async () => {
    if (!preview || totalToCreate(preview) === 0) return;
    setImporting(true);
    try {
      await onImport(preview.toCreate);
      const errNote =
        preview.errors.length > 0
          ? ` · ${t("strategicImport.ignoredRowsNote", "{n} ligne(s) ignorée(s)").replace("{n}", String(preview.errors.length))}`
          : "";
      showToast(
        t("strategicImport.successMessage", "Import terminé"),
        t(
          "strategicImport.importDoneBody",
          "{axes} axe(s) · {chantiers} chantier(s) · {actions} action(s) · {indicators} indicateur(s) créé(s)"
        )
          .replace("{axes}", String(preview.toCreate.axes.length))
          .replace("{chantiers}", String(preview.toCreate.chantiers.length))
          .replace("{actions}", String(preview.toCreate.actions.length))
          .replace("{indicators}", String(preview.toCreate.indicators.length)) + errNote,
        "success"
      );
      setPreview(null);
    } catch (err) {
      showToast(
        t("strategicImport.errorTitle", "Échec de l'import"),
        err instanceof Error ? err.message : String(err),
        "error"
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Button variant="outline" onClick={downloadTemplate}>
        <Download size={13} /> {t("strategicImport.templateButton", "Télécharger le modèle")}
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
        <Upload size={13} /> {t("strategicImport.uploadButton", "Importer un fichier")}
      </Button>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && setPreview(null)}
        title={t("strategicImport.previewTitle", "Prévisualisation de l'import — {file}").replace(
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
              disabled={importing || totalToCreate(preview) === 0}
              onClick={() => void confirmImport()}
            >
              {t("strategicImport.confirmButton", "Confirmer l'import")}
            </Button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
          <span>
            <strong className="text-rag-green-dark">{preview?.toCreate.axes.length ?? 0}</strong>{" "}
            {t("strategicImport.axesCountLabel", "axe(s) à créer")}
          </span>
          <span>
            <strong className="text-rag-green-dark">
              {preview?.toCreate.chantiers.length ?? 0}
            </strong>{" "}
            {t("strategicImport.chantiersCountLabel", "chantier(s) à créer")}
          </span>
          <span>
            <strong className="text-rag-green-dark">{preview?.toCreate.actions.length ?? 0}</strong>{" "}
            {t("strategicImport.actionsCountLabel", "action(s) à créer")}
          </span>
          <span>
            <strong className="text-rag-green-dark">
              {preview?.toCreate.indicators.length ?? 0}
            </strong>{" "}
            {t("strategicImport.indicatorsCountLabel", "indicateur(s) à créer")}
          </span>
          <span>
            <strong className="text-rag-red">{preview?.errors.length ?? 0}</strong>{" "}
            {t("strategicImport.errorRow", "ligne(s) en erreur")}
          </span>
        </div>
        <div className="max-h-[360px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
          {preview?.errors.length === 0 ? (
            <p className="text-tertiary">
              {t("shared.excelIO.noAnomalies", "Aucune anomalie détectée.")}
            </p>
          ) : (
            preview?.errors.map((e, i) => (
              <div key={i} className="text-secondary">
                [{e.sheet}] {t("strategicImport.lineLabel", "Ligne")} {e.rowNumber} : {e.reason}
              </div>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
