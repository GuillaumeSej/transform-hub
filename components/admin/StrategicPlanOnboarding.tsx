"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, PencilLine, X } from "lucide-react";
import type { MaturityStageConfig } from "@/types";
import { Button } from "@/components/shared/Button";
import {
  StrategicImportButton,
  downloadStrategicImportTemplate,
} from "@/components/strategic/StrategicImportButton";
import type { StrategicImportWrites } from "@/lib/strategicExcelImport";
import { saveProgram } from "@/lib/firestore/admin";
import {
  DEFAULT_MATURITY_STAGES,
  ensureDefaultMaturityStages,
} from "@/lib/firestore/maturityStageConfigs";
import { writeStrategicImport } from "@/lib/firestore/strategicImportWrite";
import { useTranslation } from "@/lib/i18n/useTranslation";

/**
 * Étape proposée juste après la création d'une entreprise (`/admin/companies` -> redirection vers
 * `/admin/companies/detail?id=...&onboarding=strategic`) : démarrer le plan stratégique de la
 * nouvelle entreprise.
 *
 *  - Option PRIMAIRE "Importer mon plan depuis Excel" : réutilise tel quel `StrategicImportButton`
 *    (parsing, aperçu avec compteurs axes/chantiers/projets/indicateurs + erreurs ligne par ligne,
 *    proposition de création de comptes, confirmation) — seul `onImport` est propre à ce parcours.
 *    L'import cible explicitement `companyId` (l'entreprise tout juste créée) et un programme
 *    stratégique dont l'id est PRÉ-ALLOUÉ ici : le programme n'est écrit en base (avec son jeu
 *    d'étapes de maturité par défaut, même `ensureDefaultMaturityStages` que `ProgramsPanel`)
 *    qu'à la confirmation de l'import, jamais sur une simple prévisualisation. Contourne au passage
 *    la limite documentée de `ProgramsPanel.goToStrategicImport` (un admin global n'a pas de
 *    `companyId` propre, `/levers` ne peut donc pas cibler l'entreprise créée).
 *  - Option secondaire "Saisir manuellement" : `onManual`, qui ramène l'appelant sur le parcours
 *    existant (onglet Programmes -> nouveau programme -> axes/indicateurs saisis à la main).
 *  - Lien "Télécharger le modèle Excel" : même générateur que le bouton "Télécharger le modèle" de
 *    l'écran Axes stratégiques (`downloadStrategicImportTemplate`).
 */
export function StrategicPlanOnboarding({
  companyId,
  onManual,
  onOpenProgram,
  onDismiss,
}: {
  companyId: string;
  onManual: () => void;
  onOpenProgram: (programId: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  // Id alloué une fois pour toutes (même format que `ProgramsPanel.save`) : les entités prévisualisées
  // portent déjà ce `programId`, qui doit donc rester stable entre l'aperçu et la confirmation.
  const [programId] = useState(() => `p${Date.now()}`);
  const [programName, setProgramName] = useState(
    t("strategicOnboarding.defaultProgramName", "Plan stratégique")
  );
  const [imported, setImported] = useState(false);
  // Paramètres du programme créé à la confirmation (auparavant codés en dur 2026-01/2026-12/€M) :
  // valeurs par défaut = année civile en cours, "€M".
  const [fyStart, setFyStart] = useState(() => `${new Date().getFullYear()}-01`);
  const [fyEnd, setFyEnd] = useState(() => `${new Date().getFullYear()}-12`);
  const [currency, setCurrency] = useState("€M");
  const periodInvalid =
    !/^\d{4}-\d{2}$/.test(fyStart) || !/^\d{4}-\d{2}$/.test(fyEnd) || fyStart > fyEnd;

  // Étapes par défaut que recevra le programme à sa création — l'aperçu résout les colonnes
  // "Étape de maturité" contre ce même référentiel.
  const stages = useMemo<MaturityStageConfig[]>(
    () => DEFAULT_MATURITY_STAGES.map((stage) => ({ ...stage, programId, companyId })),
    [programId, companyId]
  );

  const handleImport = async (writes: StrategicImportWrites) => {
    if (periodInvalid) {
      throw new Error(
        t(
          "strategicOnboarding.periodInvalid",
          "Période du programme invalide : le début doit précéder ou égaler la fin (AAAA-MM)."
        )
      );
    }
    await saveProgram({
      id: programId,
      companyId,
      name: programName.trim() || t("strategicOnboarding.defaultProgramName", "Plan stratégique"),
      currency: currency.trim() || "€M",
      fyStart,
      fyEnd,
      baselineEBIT: 0,
      revenue: 0,
      createdAt: new Date().toISOString().slice(0, 10),
      type: "strategic",
    });
    await ensureDefaultMaturityStages(companyId, programId);
    // Même écriture que `StrategicAxesView.handleImport` (writeBatch, atomique jusqu'à 450 écritures).
    await writeStrategicImport(writes);
    setImported(true);
  };

  return (
    <div className="relative rounded-xl border border-border bg-bg-elevated p-5">
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 text-text-secondary hover:text-text-primary"
        aria-label={t("common.close", "Fermer")}
      >
        <X size={16} />
      </button>

      <div className="space-y-4">
        {imported ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <CheckCircle2 size={18} className="text-rag-green-dark" />
              {t("strategicOnboarding.doneTitle", "Plan stratégique importé")}
            </div>
            <p className="text-xs text-text-secondary">
              {t(
                "strategicOnboarding.doneBody",
                "Le programme « {name} » a été créé pour cette entreprise avec ses axes, chantiers, projets et indicateurs."
              ).replace("{name}", programName)}
            </p>
            <Button variant="primary" onClick={() => onOpenProgram(programId)}>
              {t("strategicOnboarding.openProgram", "Ouvrir le programme")}
            </Button>
          </div>
        ) : (
          <>
            <div>
              <div className="text-sm font-semibold text-text-primary">
                {t("strategicOnboarding.title", "Démarrer le plan stratégique de l'entreprise")}
              </div>
              <p className="mt-1 text-xs text-text-secondary">
                {t(
                  "strategicOnboarding.body",
                  "Importez votre plan complet (axes, chantiers, projets, livrables, indicateurs) depuis le modèle Excel, ou saisissez-le étape par étape."
                )}
              </p>
            </div>

            <label className="block max-w-sm text-xs font-medium text-text-secondary">
              {t("strategicOnboarding.programNameLabel", "Nom du programme")}
              <input
                value={programName}
                onChange={(e) => setProgramName(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text-primary"
              />
            </label>

            <div className="flex flex-wrap gap-3">
              <label className="block text-xs font-medium text-text-secondary">
                {t("strategicOnboarding.fyStartLabel", "Début de période")}
                <input
                  type="month"
                  value={fyStart}
                  onChange={(e) => setFyStart(e.target.value)}
                  className="mt-1 block rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text-primary"
                />
              </label>
              <label className="block text-xs font-medium text-text-secondary">
                {t("strategicOnboarding.fyEndLabel", "Fin de période")}
                <input
                  type="month"
                  value={fyEnd}
                  onChange={(e) => setFyEnd(e.target.value)}
                  className="mt-1 block rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text-primary"
                />
              </label>
              <label className="block text-xs font-medium text-text-secondary">
                {t("strategicOnboarding.currencyLabel", "Unité monétaire")}
                <input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-1 block w-24 rounded-md border border-border bg-white px-2.5 py-1.5 text-sm text-text-primary"
                />
              </label>
            </div>
            {periodInvalid && (
              <p className="text-xs text-rag-red">
                {t(
                  "strategicOnboarding.periodInvalid",
                  "Période du programme invalide : le début doit précéder ou égaler la fin (AAAA-MM)."
                )}
              </p>
            )}
          </>
        )}

        {/* `StrategicImportButton` reste monté APRÈS l'import (bouton simplement masqué) : sa modale
            porte l'écran des comptes créés et de leurs mots de passe temporaires, affiché après
            la résolution de `onImport` — le démonter ferait perdre ces identifiants. */}
        <div className={imported ? "hidden" : "flex flex-wrap items-center gap-2"}>
          <StrategicImportButton
            data={{ axes: [], chantiers: [], actions: [], indicators: [] }}
            companyId={companyId}
            programId={programId}
            maturityStages={stages}
            onImport={handleImport}
            showTemplateButton={false}
            uploadVariant="primary"
            uploadLabel={t("strategicOnboarding.importButton", "Importer mon plan depuis Excel")}
            disabled={imported || periodInvalid}
          />
          <Button variant="outline" onClick={onManual}>
            <PencilLine size={13} /> {t("strategicOnboarding.manualButton", "Saisir manuellement")}
          </Button>
        </div>

        {!imported && (
          <button
            type="button"
            onClick={downloadStrategicImportTemplate}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary underline-offset-2 hover:text-bp-coral hover:underline"
          >
            <FileSpreadsheet size={13} />
            {t("strategicOnboarding.templateLink", "Télécharger le modèle Excel")}
            <Download size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
