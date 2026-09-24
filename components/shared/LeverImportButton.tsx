"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Upload } from "lucide-react";
import {
  ACTION_IMPORT_HEADERS,
  IMPACT_IMPORT_HEADERS,
  LEVER_IMPORT_HEADERS,
  leverImportTemplateRows,
  validateLeverImportRows,
  type LeverImportPreview,
} from "@/lib/leverExcelImport";
import type { BeTrackData, LifecycleStage, Workstream } from "@/types";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import {
  LeverOwnerReconciliationDialog,
  buildReconciliationQueue,
  type OwnerReconciliationDecision,
  type PendingReconciliationItem,
} from "@/components/shared/LeverOwnerReconciliationDialog";
import { useCompanyUsers } from "@/lib/hooks/useCompanyUsers";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";

const SHEET_NAMES = { leviers: "Leviers", actions: "Actions", impacts: "Impacts" } as const;

/** Trouve une feuille par nom insensible à la casse — un utilisateur qui renomme légèrement
 *  l'onglet ("leviers" au lieu de "Leviers") ne doit pas être bloqué. */
/** `null` quand la feuille est absente du fichier (≠ feuille présente mais vide) — voir
 *  `LeverImportRawSheets` : une feuille Actions absente ne doit pas vider les plans d'action. */
function findSheet(workbook: XLSX.WorkBook, name: string): Record<string, unknown>[] | null {
  const sheetName = workbook.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase());
  if (!sheetName) return null;
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
  defaultProgramId,
  lifecycleStages,
  onImport,
  onCreateWorkstreams,
}: {
  data: Pick<BeTrackData, "levers" | "workstreams" | "pnlAccounts">;
  companyId?: string | null;
  /** Programmes de l'entreprise, pour résoudre la colonne optionnelle "Programme" — voir
   *  lib/leverExcelImport.ts (contrairement au Workstream, un Programme inconnu est une erreur de
   *  ligne, pas une auto-création : il doit déjà exister, créé dans Admin > Programmes). */
  programs?: { id: string; name: string }[];
  /** Programme sélectionné dans l'app : cible des lignes sans colonne "Programme" renseignée, et
   *  valeur pré-remplie de cette colonne dans le modèle téléchargé. */
  defaultProgramId?: string | null;
  /** Cycle de vie du programme sélectionné : ses libellés sont acceptés dans la colonne
   *  « Statut » et utilisés dans les messages d'erreur (mêmes libellés qu'à l'écran). */
  lifecycleStages?: LifecycleStage[];
  /** Asynchrone : doit être rejetée si l'écriture échoue (le toast de succès n'est affiché
   *  qu'une fois la promesse résolue). */
  onImport: (rows: LeverImportPreview["toUpsert"]) => Promise<{
    createdCount: number;
    updatedCount: number;
  }>;
  /** Persiste les workstreams auto-créés (voir LeverImportPreview.toCreateWorkstreams) — appelé
   *  AVANT onImport pour que les leviers importés référencent des workstreams déjà enregistrés. */
  onCreateWorkstreams: (workstreams: Workstream[]) => Promise<void>;
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<LeverImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  // Réconciliation propriétaire (round "ownership réel", voir lib/leverOwnerReconciliation.ts) :
  // file d'attente affichée par LeverOwnerReconciliationDialog, construite au clic sur "Confirmer
  // l'import" (voir confirmImport) — non-null pendant que ce second dialogue est ouvert.
  const [reconciliationQueue, setReconciliationQueue] = useState<
    PendingReconciliationItem[] | null
  >(null);
  const companyUsers = useCompanyUsers(companyId);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    const defaultProgram = programs.find((p) => p.id === defaultProgramId);
    const example = leverImportTemplateRows(defaultProgram?.name ?? "", data.workstreams[0]?.name);
    const leversSheet = XLSX.utils.aoa_to_sheet([[...LEVER_IMPORT_HEADERS], ...example.leviers]);
    XLSX.utils.book_append_sheet(wb, leversSheet, SHEET_NAMES.leviers);
    const actionsSheet = XLSX.utils.aoa_to_sheet([[...ACTION_IMPORT_HEADERS], ...example.actions]);
    XLSX.utils.book_append_sheet(wb, actionsSheet, SHEET_NAMES.actions);
    const impactsSheet = XLSX.utils.aoa_to_sheet([[...IMPACT_IMPORT_HEADERS], ...example.impacts]);
    XLSX.utils.book_append_sheet(wb, impactsSheet, SHEET_NAMES.impacts);

    XLSX.writeFile(wb, "template_leviers.xlsx");
    showToast(
      t("shared.excelIO.templateDownloadedTitle", "Modèle téléchargé"),
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
      leviers: findSheet(workbook, SHEET_NAMES.leviers) ?? [],
      actions: findSheet(workbook, SHEET_NAMES.actions),
      impacts: findSheet(workbook, SHEET_NAMES.impacts),
    };

    const result = validateLeverImportRows(
      sheets,
      data,
      companyId,
      programs,
      lifecycleStages,
      defaultProgramId
    );
    setFileName(file.name);
    setPreview(result);
  };

  /** Écriture effective (workstreams auto-créés puis leviers) — appelée soit directement depuis
   *  `confirmImport` (aucun levier à réconcilier), soit après résolution du dialogue de
   *  réconciliation propriétaire (voir `resolveReconciliation` plus bas). */
  const writeImport = async (rowsToUpsert: LeverImportPreview["toUpsert"]) => {
    if (!preview) return;
    setImporting(true);
    try {
      if (preview.toCreateWorkstreams.length > 0) {
        await onCreateWorkstreams(preview.toCreateWorkstreams);
      }
      const { createdCount, updatedCount } = await onImport(rowsToUpsert);
      const wsNote =
        preview.toCreateWorkstreams.length > 0
          ? ` · ${t("shared.leverImportButton.workstreamsCreatedNote", "{n} chantier(s) créé(s)").replace("{n}", String(preview.toCreateWorkstreams.length))}`
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
      setReconciliationQueue(null);
    } catch (err) {
      // L'aperçu reste ouvert : l'utilisateur peut corriger (droits, connexion) et réessayer.
      console.error("[betrack] import leviers :", err);
      setReconciliationQueue(null);
      showToast(
        t("shared.leverImportButton.importFailedTitle", "Échec de l'import"),
        t(
          "shared.leverImportButton.importFailedBody",
          "Aucun levier n'a été enregistré. Vérifiez vos droits sur l'entreprise et réessayez."
        ),
        "error"
      );
    } finally {
      setImporting(false);
    }
  };

  /** Déclenché par "Confirmer l'import" : insère l'étape de réconciliation propriétaire (round
   *  "ownership réel", voir `lib/leverOwnerReconciliation.ts`) AVANT l'écriture — un levier de
   *  l'aperçu dont l'"Owner" texte libre est non vide doit être rapproché d'un compte réel. Aucun
   *  levier à réconcilier (colonne "Owner" vide partout, ou aucun candidat trouvé n'étant pas géré
   *  ici — voir le dialogue) : écriture immédiate, comportement inchangé. */
  const confirmImport = () => {
    if (!preview || preview.toUpsert.length === 0) return;
    const queue = buildReconciliationQueue(preview.toUpsert, companyUsers);
    if (queue.length === 0) {
      void writeImport(preview.toUpsert);
      return;
    }
    setReconciliationQueue(queue);
  };

  const resolveReconciliation = (decisions: Map<string, OwnerReconciliationDecision>) => {
    if (!preview) return;
    const resolvedRows = preview.toUpsert.map((row) => {
      const decision = decisions.get(row.code);
      if (!decision) return row;
      return { ...row, owner: decision.owner, ownerUsername: decision.ownerUsername };
    });
    void writeImport(resolvedRows);
  };

  return (
    <>
      <Button variant="outline" onClick={downloadTemplate}>
        <Download size={13} /> {t("shared.excelIO.templateButton", "Modèle Excel")}
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
              "chantier(s) référencé(s) dans le fichier n'existe(nt) pas encore pour cette entreprise et"
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
        {preview && preview.actionsRemoved.length > 0 && (
          <div className="mb-3 rounded-md border border-rag-red/40 bg-rag-red/5 p-2.5 text-xs text-secondary">
            <strong className="text-rag-red">
              {t(
                "shared.leverImportButton.actionsRemovedTitle",
                "{n} action(s) existante(s) seront supprimée(s)"
              ).replace("{n}", String(preview.actionsRemoved.reduce((sum, r) => sum + r.count, 0)))}
            </strong>{" "}
            {t(
              "shared.leverImportButton.actionsRemovedBody",
              "car absentes de la feuille Actions du fichier : {list}."
            ).replace(
              "{list}",
              preview.actionsRemoved.map((r) => `${r.code} (${r.count})`).join(", ")
            )}
          </div>
        )}
        {preview && !preview.actionsSheetPresent && preview.updateCount > 0 && (
          <div className="mb-3 rounded-md border border-border bg-neutral-50 p-2.5 text-xs text-tertiary">
            {t(
              "shared.leverImportButton.noActionsSheet",
              "Pas de feuille « Actions » dans ce fichier : les plans d'action existants sont conservés."
            )}
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

      <LeverOwnerReconciliationDialog
        open={reconciliationQueue !== null}
        queue={reconciliationQueue ?? []}
        companyUsers={companyUsers}
        onCancel={() => setReconciliationQueue(null)}
        onConfirm={resolveReconciliation}
      />
    </>
  );
}
