"use client";

import { useRef, useState } from "react";
import { Copy, Download, FileDown, Upload } from "lucide-react";
import {
  STRATEGIC_IMPORT_MESSAGES,
  applyPeopleMapping,
  buildStrategicImportTemplateWorkbook,
  buildStrategicPlanExportWorkbook,
  combineStrategicImportWrites,
  countStrategicImportWrites,
  formatStrategicImportMessage,
  parseStrategicImportWorkbook,
  validateStrategicImportRows,
  type StrategicImportError,
  type StrategicImportExistingData,
  type StrategicImportPreview,
  type StrategicImportWrites,
} from "@/lib/strategicExcelImport";
import { readSpreadsheetFile } from "@/lib/excelFileRead";
import type { AuthUser, MaturityStageConfig, Role } from "@/types";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { isFirebaseErrorCode, usernameToSyntheticEmail } from "@/lib/auth";
import { withSecondaryAuth } from "@/lib/firebase";
import { saveUser } from "@/lib/firestore/admin";
import { StrategicImportWriteError } from "@/lib/firestore/strategicImportWrite";
import { useCompanyUsers } from "@/lib/hooks/useCompanyUsers";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Génère et télécharge le modèle Excel vierge (feuille "Lisez-moi" + 6 feuilles d'exemple) —
 *  réutilisé par `components/admin/StrategicPlanOnboarding.tsx`. SheetJS chargé au clic
 *  (`await import("xlsx")`), jamais importé statiquement par ce composant ni par la librairie. */
export async function downloadStrategicImportTemplate(): Promise<void> {
  const XLSX = await import("xlsx");
  XLSX.writeFile(buildStrategicImportTemplateWorkbook(XLSX), "modele_plan_strategique.xlsx");
}

/** Personne référencée dans le fichier, sans compte, proposée à la création (voir
 *  `StrategicImportPerson` dans `lib/strategicExcelImport.ts`). */
type PersonToCreate = {
  key: string;
  name: string;
  username: string;
  firstName: string;
  lastName: string;
  role: Role;
  collisionWith?: string;
  /** Décoché = pas de compte ; les entités gardent alors le texte saisi (avertissement). */
  include: boolean;
};

type PersonCreationStatus = "created" | "existing" | "failed" | "orphan";

type PersonCreationResult = {
  key: string;
  name: string;
  username: string;
  status: PersonCreationStatus;
  /** Mot de passe temporaire affiché UNE SEULE FOIS ("created", ou "orphan" : compte Auth créé
   *  mais profil non enregistré — à compléter dans Admin > Utilisateurs). */
  tempPassword: string | null;
};

type ImportOutcome = {
  accounts: PersonCreationResult[];
  /** Message d'échec de l'écriture du plan (les comptes créés restent listés). */
  importError?: string;
};

const PERSON_ROLE_OPTIONS: { value: Role; labelKey: string; label: string }[] = [
  {
    value: "chantier_contributor",
    labelKey: "roles.chantierContributor.label",
    label: "Responsable projet",
  },
  {
    value: "projet_contributor",
    labelKey: "roles.projetContributor.label",
    label: "Contributeur projet",
  },
  {
    value: "chantier_owner",
    labelKey: "roles.chantierOwner.label",
    label: "Sponsor de chantier",
  },
  { value: "axis_sponsor", labelKey: "roles.axisSponsor.label", label: "Sponsor d'axe" },
  { value: "comex_member", labelKey: "roles.comexMember.label", label: "Membre du COMEX" },
  { value: "hr", labelKey: "roles.hr.label", label: "Directeur RH" },
  {
    value: "strategic_lead",
    labelKey: "roles.strategicLead.label",
    label: "Pilote du plan stratégique",
  },
];

const CREATION_STATUS: Record<PersonCreationStatus, { key: string; label: string; cls: string }> = {
  created: {
    key: "strategicImport.accountStatusCreated",
    label: "créé",
    cls: "text-rag-green-dark",
  },
  existing: {
    key: "strategicImport.accountStatusExisting",
    label: "déjà existant (compte conservé)",
    cls: "text-tertiary",
  },
  failed: { key: "strategicImport.accountStatusFailed", label: "échec", cls: "text-rag-red" },
  orphan: {
    key: "strategicImport.accountStatusOrphan",
    label:
      "compte de connexion créé mais profil non enregistré — à compléter dans Admin > Utilisateurs",
    cls: "text-rag-red",
  },
};

/** Mot de passe temporaire aléatoire (12 caractères lisibles, Web Crypto). */
function randomTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

/**
 * Boutons "Télécharger le modèle" / "Exporter le plan" / "Importer un fichier" du plan
 * stratégique — voir `lib/strategicExcelImport.ts` pour le format, l'upsert et le rapprochement
 * des personnes. `onImport` reçoit les créations + mises à jour (Owner/Pilote/Sponsor déjà
 * réécrits en usernames, y compris pour les comptes créés ici) et les écrit
 * (`writeStrategicImport`).
 *
 * Création de comptes (admins uniquement) : les personnes référencées sans compte, de type
 * "Prénom Nom", sont proposées dans l'aperçu (décochables, rôle au choix). Compte Firebase Auth
 * créé sur une instance SECONDAIRE (`withSecondaryAuth`, jamais la session de l'admin) puis profil
 * `saveUser`. Un e-mail déjà utilisé n'est pas un échec (compte conservé, non modifié). Un profil
 * qui échoue APRÈS la création Auth est listé comme compte orphelin. L'écran de résultat (mots de
 * passe temporaires, affichés une seule fois) s'affiche TOUJOURS dès qu'un compte a été traité,
 * même si l'écriture du plan échoue ensuite.
 */
export function StrategicImportButton({
  data,
  companyId,
  programId,
  maturityStages,
  onImport,
  showTemplateButton = true,
  showExportButton,
  uploadLabel,
  uploadVariant = "outline",
  disabled = false,
}: {
  /** Plan déjà en base (programme ciblé) — rapprochement upsert + export. `measurements` et
   *  `staffing` facultatifs (sans eux : pas de baseline ajoutée à un KPI existant, lignes ETP
   *  toujours créées). */
  data: StrategicImportExistingData;
  companyId?: string | null;
  programId?: string | null;
  maturityStages: MaturityStageConfig[];
  /** Écrit créations + mises à jour. Peut lever : l'erreur est affichée dans l'écran de résultat. */
  onImport: (writes: StrategicImportWrites) => Promise<void>;
  showTemplateButton?: boolean;
  /** Par défaut : affiché avec le bouton modèle, dès que le plan contient au moins un axe. */
  showExportButton?: boolean;
  uploadLabel?: string;
  uploadVariant?: "outline" | "primary";
  disabled?: boolean;
}) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { user, isGlobalAdmin, isCompanyAdmin } = useRole();
  const companyUsers = useCompanyUsers(companyId ?? null);
  const canCreateAccounts = isGlobalAdmin || isCompanyAdmin;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<StrategicImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [peopleToCreate, setPeopleToCreate] = useState<PersonToCreate[]>([]);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  const formatIssue = (e: StrategicImportError) =>
    formatStrategicImportMessage(
      t(`strategicImport.msg.${e.code}`, STRATEGIC_IMPORT_MESSAGES[e.code]),
      e.vars
    );

  /** Compte Auth + profil d'UNE personne. Ne lève jamais (statut dans le résultat). */
  async function createPersonAccount(person: PersonToCreate): Promise<PersonCreationResult> {
    const base = { key: person.key, name: person.name, username: person.username };
    const tempPassword = randomTempPassword();
    let alreadyExists = false;
    try {
      await withSecondaryAuth(async (secondaryAuth) => {
        const { createUserWithEmailAndPassword } = await import("firebase/auth");
        try {
          await createUserWithEmailAndPassword(
            secondaryAuth,
            usernameToSyntheticEmail(person.username, companyId ?? null),
            tempPassword
          );
        } catch (err) {
          if (isFirebaseErrorCode(err, "auth/email-already-in-use")) {
            alreadyExists = true;
            return;
          }
          throw err;
        }
      });
    } catch {
      return { ...base, status: "failed", tempPassword: null };
    }
    if (alreadyExists) return { ...base, status: "existing", tempPassword: null };

    const newUser: AuthUser = {
      username: person.username,
      password: tempPassword,
      profiles: [{ role: person.role, ...(programId ? { programId } : {}) }],
      isGlobalAdmin: false,
      isCompanyAdmin: false,
      firstName: person.firstName,
      lastName: person.lastName,
      name: person.name,
      companyId: companyId ?? null,
      confidentialityClearance: "all",
    };
    try {
      await saveUser(newUser);
      return { ...base, status: "created", tempPassword };
    } catch {
      // Compte Auth créé mais profil absent : listé (avec son mot de passe) pour être complété.
      return { ...base, status: "orphan", tempPassword };
    }
  }

  const downloadTemplate = async () => {
    await downloadStrategicImportTemplate();
    showToast(
      t("strategicImport.templateDownloadedTitle", "Modèle téléchargé"),
      t(
        "strategicImport.templateDownloadedBody",
        'Lisez-moi (guide) + 6 feuilles : Axes (Code = clé), Chantiers (Codes Axes séparés par ; = FK, accepte plusieurs axes), Projets (Code Chantier = FK, "Étape de maturité" facultative), Livrables (Code Projet = FK, facultative), Indicateurs (Code Axe OU Code Chantier = FK, "Valeur initiale" facultative), ETP (facultative, Code Chantier = FK). Supprimez les lignes d\'exemple avant de remplir.'
      ),
      "success"
    );
  };

  const exportPlan = async () => {
    const XLSX = await import("xlsx");
    const wb = buildStrategicPlanExportWorkbook(data, maturityStages, XLSX);
    const d = new Date();
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    XLSX.writeFile(wb, `plan_strategique_${stamp}.xlsx`);
    showToast(
      t("strategicImport.exportDoneTitle", "Plan exporté"),
      t(
        "strategicImport.exportDoneBody",
        "Même format que le modèle : modifiez le fichier puis réimportez-le pour mettre à jour le plan."
      ),
      "success"
    );
  };

  const handleImportFile = async (file: File) => {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      showToast(
        t("strategicImport.readErrorTitle", "Fichier illisible"),
        t(
          "strategicImport.wrongFormatBody",
          "Format non pris en charge : utilisez un classeur Excel (.xlsx ou .xls)."
        ),
        "error"
      );
      return;
    }
    let result: StrategicImportPreview;
    try {
      // Point d'entrée unique de lecture (lib/excelFileRead.ts) ; SheetJS chargé au clic.
      const [workbook, XLSX] = await Promise.all([readSpreadsheetFile(file), import("xlsx")]);
      result = validateStrategicImportRows(
        parseStrategicImportWorkbook(workbook, XLSX),
        data,
        companyId,
        programId,
        maturityStages,
        user?.username,
        { users: companyUsers.map((u) => ({ username: u.username, name: u.name })) }
      );
    } catch (err) {
      showToast(
        t("strategicImport.readErrorTitle", "Fichier illisible"),
        `${t(
          "strategicImport.readErrorBody",
          "Le fichier n'a pas pu être lu : vérifiez qu'il s'agit d'un classeur Excel non corrompu."
        )} (${err instanceof Error ? err.message : String(err)})`,
        "error"
      );
      return;
    }
    setFileName(file.name);
    setPreview(result);
    setOutcome(null);
    setPeopleToCreate(
      canCreateAccounts
        ? result.people
            .filter((p) => p.kind === "proposable" && p.username)
            .map((p) => ({
              key: p.key,
              name: p.name,
              username: p.username!,
              firstName: p.firstName ?? "",
              lastName: p.lastName ?? p.name,
              role: "chantier_contributor" as Role,
              collisionWith: p.collisionWith,
              include: true,
            }))
        : []
    );
  };

  const toggleInclude = (key: string) =>
    setPeopleToCreate((list) =>
      list.map((p) => (p.key === key ? { ...p, include: !p.include } : p))
    );

  const setPersonRole = (key: string, role: Role) =>
    setPeopleToCreate((list) => list.map((p) => (p.key === key ? { ...p, role } : p)));

  const totalWrites = (p: StrategicImportPreview | null) =>
    p ? countStrategicImportWrites(combineStrategicImportWrites(p)) : 0;

  const describeImportError = (err: unknown): string => {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof StrategicImportWriteError) {
      const w = err.written;
      const writtenTotal = Object.values(w).reduce((a, b) => a + b, 0);
      if (writtenTotal === 0) {
        return `${message} — ${t("strategicImport.nothingWritten", "rien n'a été écrit, le plan est inchangé.")}`;
      }
      return `${message} — ${t(
        "strategicImport.partialWrite",
        "écriture partielle ({written}/{total}) : {axes} axe(s), {chantiers} chantier(s), {actions} projet(s), {indicators} indicateur(s), {measurements} mesure(s), {staffing} ligne(s) ETP déjà enregistrés. Réimportez le même fichier pour compléter (les lignes déjà écrites seront reconnues)."
      )
        .replace("{written}", String(writtenTotal))
        .replace("{total}", String(err.total))
        .replace("{axes}", String(w.axes))
        .replace("{chantiers}", String(w.chantiers))
        .replace("{actions}", String(w.actions))
        .replace("{indicators}", String(w.indicators))
        .replace("{measurements}", String(w.measurements))
        .replace("{staffing}", String(w.staffing))}`;
    }
    return message;
  };

  const confirmImport = async () => {
    if (!preview || totalWrites(preview) === 0) return;
    setImporting(true);
    const accounts: PersonCreationResult[] = [];
    let importError: string | undefined;
    try {
      const included = canCreateAccounts ? peopleToCreate.filter((p) => p.include) : [];
      for (const person of included) {
        accounts.push(await createPersonAccount(person));
      }
      // Owner/Pilote/Sponsor : texte → username des comptes créés (ou déjà existants).
      const mapping = new Map<string, string>();
      for (const r of accounts) {
        if (r.status === "created" || r.status === "existing") mapping.set(r.key, r.username);
      }
      const writes = applyPeopleMapping(combineStrategicImportWrites(preview), mapping);
      await onImport(writes);

      const created = countStrategicImportWrites(preview.toCreate);
      const updated = countStrategicImportWrites(preview.toUpdate);
      const errNote =
        preview.errors.length > 0
          ? ` · ${t("strategicImport.ignoredRowsNote", "{n} ligne(s) ignorée(s)").replace("{n}", String(preview.errors.length))}`
          : "";
      showToast(
        t("strategicImport.successMessage", "Import terminé"),
        t(
          "strategicImport.importDoneSummary",
          "{created} élément(s) créé(s) · {updated} mis à jour"
        )
          .replace("{created}", String(created))
          .replace("{updated}", String(updated)) + errNote,
        "success"
      );
    } catch (err) {
      importError = describeImportError(err);
      showToast(t("strategicImport.errorTitle", "Échec de l'import"), importError, "error");
    } finally {
      setImporting(false);
      // Toujours afficher les comptes traités (mots de passe non récupérables ensuite), même si
      // l'écriture du plan a échoué.
      if (accounts.length > 0 || importError) setOutcome({ accounts, importError });
      else setPreview(null);
    }
  };

  const closeModal = () => {
    setPreview(null);
    setPeopleToCreate([]);
    setOutcome(null);
  };

  const exportVisible = (showExportButton ?? showTemplateButton) && data.axes.length > 0;

  const countRows: { label: string; created: number; updated: number; unchanged?: number }[] =
    preview
      ? [
          {
            label: t("strategicImport.rowAxes", "Axes"),
            created: preview.toCreate.axes.length,
            updated: preview.toUpdate.axes.length,
            unchanged: preview.unchanged.axes,
          },
          {
            label: t("strategicImport.rowChantiers", "Chantiers"),
            created: preview.toCreate.chantiers.length,
            updated: preview.toUpdate.chantiers.length,
            unchanged: preview.unchanged.chantiers,
          },
          {
            label: t("strategicImport.rowProjects", "Projets"),
            created: preview.toCreate.actions.length,
            updated: preview.toUpdate.actions.length,
            unchanged: preview.unchanged.actions,
          },
          {
            label: t("strategicImport.rowIndicators", "Indicateurs"),
            created: preview.toCreate.indicators.length,
            updated: preview.toUpdate.indicators.length,
            unchanged: preview.unchanged.indicators,
          },
          {
            label: t("strategicImport.rowMeasurements", "Mesures de référence"),
            created: preview.toCreate.measurements.length,
            updated: 0,
          },
          {
            label: t("strategicImport.rowStaffing", "Lignes ETP"),
            created: preview.toCreate.staffing.length,
            updated: preview.toUpdate.staffing.length,
            unchanged: preview.unchanged.staffing,
          },
        ]
      : [];

  return (
    <>
      {showTemplateButton && (
        <Button variant="outline" onClick={() => void downloadTemplate()}>
          <Download size={13} /> {t("strategicImport.templateButton", "Télécharger le modèle")}
        </Button>
      )}
      {exportVisible && (
        <Button variant="outline" onClick={() => void exportPlan()}>
          <FileDown size={13} /> {t("strategicImport.exportButton", "Exporter le plan")}
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleImportFile(file);
        }}
      />
      <Button
        variant={uploadVariant}
        disabled={disabled}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload size={13} />{" "}
        {uploadLabel ?? t("strategicImport.uploadButton", "Importer un fichier")}
      </Button>

      <Modal
        open={preview !== null}
        onOpenChange={(open) => !open && !importing && closeModal()}
        title={
          outcome
            ? outcome.importError
              ? t("strategicImport.errorTitle", "Échec de l'import")
              : t("strategicImport.accountsResultTitle", "Comptes créés")
            : t("strategicImport.previewTitle", "Prévisualisation de l'import — {file}").replace(
                "{file}",
                fileName
              )
        }
        maxWidth="760px"
        footer={
          outcome ? (
            <Button variant="primary" onClick={closeModal}>
              {t("common.close", "Fermer")}
            </Button>
          ) : (
            <>
              <Button variant="ghost" disabled={importing} onClick={closeModal}>
                {t("common.cancel", "Annuler")}
              </Button>
              <Button
                variant="primary"
                disabled={importing || totalWrites(preview) === 0}
                onClick={() => void confirmImport()}
              >
                {t("strategicImport.confirmButton", "Confirmer l'import")}
              </Button>
            </>
          )
        }
      >
        {outcome ? (
          <div className="space-y-3">
            {outcome.importError && (
              <p className="rounded-md border border-rag-red/40 bg-rag-red/5 p-2.5 text-xs text-rag-red">
                {outcome.importError}
              </p>
            )}
            {outcome.accounts.length > 0 && (
              <>
                <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
                  {t(
                    "strategicImport.tempPasswordWarning",
                    "Mots de passe temporaires à transmettre à la personne concernée, non récupérables ensuite — notez-les maintenant."
                  )}
                </p>
                <div className="max-h-[360px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
                  {outcome.accounts.map((r) => (
                    <div
                      key={r.username}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0"
                    >
                      <span>
                        <strong>{r.name}</strong> ({r.username}) —{" "}
                        <span className={CREATION_STATUS[r.status].cls}>
                          {t(CREATION_STATUS[r.status].key, CREATION_STATUS[r.status].label)}
                        </span>
                      </span>
                      {r.tempPassword && (
                        <span className="flex items-center gap-1.5 rounded border border-border bg-white px-2 py-1 font-mono">
                          {r.tempPassword}
                          <button
                            type="button"
                            title={t("strategicImport.copyPassword", "Copier le mot de passe")}
                            onClick={() => void navigator.clipboard.writeText(r.tempPassword ?? "")}
                            className="text-tertiary hover:text-primary"
                          >
                            <Copy size={12} />
                          </button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <table className="mb-3 w-full text-[13px]">
              <thead>
                <tr className="text-left text-xs text-tertiary">
                  <th className="py-1 font-medium" />
                  <th className="py-1 font-medium">{t("strategicImport.colCreate", "À créer")}</th>
                  <th className="py-1 font-medium">
                    {t("strategicImport.colUpdate", "À mettre à jour")}
                  </th>
                  <th className="py-1 font-medium">
                    {t("strategicImport.colUnchanged", "Inchangés")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {countRows.map((r) => (
                  <tr key={r.label} className="border-t border-border/60">
                    <td className="py-1">{r.label}</td>
                    <td className="py-1 font-semibold text-rag-green-dark">{r.created}</td>
                    <td className="py-1 font-semibold text-primary">{r.updated}</td>
                    <td className="py-1 text-tertiary">{r.unchanged ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className="mb-1.5 text-[13px]">
              <strong className="text-rag-red">{preview?.errors.length ?? 0}</strong>{" "}
              {t("strategicImport.errorRow", "ligne(s) en erreur")}
            </p>
            <div className="max-h-[200px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
              {preview?.errors.length === 0 ? (
                <p className="text-tertiary">
                  {t("shared.excelIO.noAnomalies", "Aucune anomalie détectée.")}
                </p>
              ) : (
                preview?.errors.map((e, i) => (
                  <div key={i} className="text-secondary">
                    [{e.sheet}] {t("strategicImport.lineLabel", "Ligne")} {e.rowNumber} :{" "}
                    {formatIssue(e)}
                  </div>
                ))
              )}
            </div>

            {!!preview?.warnings.length && (
              <div className="mt-3">
                <p className="mb-1.5 text-[13px] font-semibold text-amber-900">
                  {t("strategicImport.warningsTitle", "{n} avertissement(s)").replace(
                    "{n}",
                    String(preview.warnings.length)
                  )}
                </p>
                <div className="max-h-[160px] space-y-1.5 overflow-y-auto rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  {preview.warnings.map((w, i) => (
                    <div key={i}>
                      [{w.sheet}] {t("strategicImport.lineLabel", "Ligne")} {w.rowNumber} :{" "}
                      {formatIssue(w)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {canCreateAccounts && peopleToCreate.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-[13px] font-semibold text-primary">
                  {t(
                    "strategicImport.newPeopleTitle",
                    "{n} nouvelle(s) personne(s) seront créées avec un accès"
                  ).replace("{n}", String(peopleToCreate.filter((p) => p.include).length))}
                </p>
                <div className="max-h-[220px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
                  {peopleToCreate.map((p) => (
                    <div key={p.key} className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.include}
                        onChange={() => toggleInclude(p.key)}
                        aria-label={t("strategicImport.includePerson", "Créer ce compte")}
                      />
                      <span className={p.include ? "" : "text-tertiary line-through"}>
                        {p.name} <span className="text-tertiary">({p.username})</span>
                        {p.collisionWith && (
                          <span className="ml-1 text-amber-700">
                            {t(
                              "strategicImport.usernameCollision",
                              "identifiant « {username} » déjà pris : suffixé"
                            ).replace("{username}", p.collisionWith)}
                          </span>
                        )}
                      </span>
                      <select
                        value={p.role}
                        disabled={!p.include}
                        onChange={(e) => setPersonRole(p.key, e.target.value as Role)}
                        className="ml-auto rounded-md border border-border bg-white px-1.5 py-0.5 text-xs disabled:opacity-50"
                      >
                        {PERSON_ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {t(opt.labelKey, opt.label)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
