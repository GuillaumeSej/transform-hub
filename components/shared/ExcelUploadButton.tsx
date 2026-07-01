"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import { Upload } from "lucide-react";

/**
 * Bouton d'import Excel — visible mais désactivé en V1.
 *
 * TODO V2 — IMPORT EXCEL
 *
 * Bibliothèque : SheetJS (xlsx).
 *
 * Flux attendu :
 * 1. Clic → file picker (accept=".xlsx,.xls,.csv")
 * 2. Lecture du fichier via FileReader + SheetJS parse
 * 3. Mapping colonnes Excel → types TypeScript (validation + rapport d'erreurs)
 * 4. Modal de prévisualisation : X lignes importées, Y erreurs détectées
 * 5. Confirmation → appel aux mutateurs de lib/storage.ts (upsert par ID ou clé naturelle)
 * 6. Rapport final : X créées, Y mises à jour, Z ignorées (erreurs)
 *
 * Templates Excel à fournir (bouton "Télécharger le template") :
 * template_leviers.xlsx, template_pl_baseline.xlsx, template_etp_baseline.xlsx, template_kpi_baseline.xlsx
 * Chaque template : onglet "Instructions", onglet "Données", onglet "Référentiels".
 */
export function ExcelUploadButton() {
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            disabled
            className="inline-flex cursor-not-allowed items-center gap-1.5 whitespace-nowrap rounded-md border border-border-strong bg-neutral-100 px-4 py-2 text-[13px] font-semibold text-tertiary"
          >
            <Upload size={13} /> Importer Excel
            <span className="ml-1 rounded-full bg-neutral-200 px-1.5 py-px text-[9px] font-bold uppercase text-secondary">
              Bientôt
            </span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="max-w-[240px] rounded-md bg-neutral-900 px-2.5 py-1.5 text-[11px] text-white"
            sideOffset={6}
          >
            Import Excel — Disponible en V2. Les données peuvent être saisies manuellement dans les
            tableaux ci-dessous.
            <Tooltip.Arrow className="fill-neutral-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
