"use client";

import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { Copy, Download, Upload } from "lucide-react";
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
import type { AuthUser, MaturityStageConfig, Role } from "@/types";
import { Button } from "@/components/shared/Button";
import { Modal } from "@/components/shared/Modal";
import { isFirebaseErrorCode, usernameToSyntheticEmail } from "@/lib/auth";
import { withSecondaryAuth } from "@/lib/firebase";
import { saveUser } from "@/lib/firestore/admin";
import { useCompanyUsers } from "@/lib/hooks/useCompanyUsers";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { matchLeverOwner, type OwnerMatchCandidate } from "@/lib/leverOwnerReconciliation";

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

/** Un « projet » = une ligne de la feuille `ChantierAction` dont le nom d'`owner`/`sponsor` (ou le
 *  `pilote` d'un chantier, ou l'`owner` d'un axe) ne correspond à AUCUN compte existant de
 *  l'entreprise — candidat à la création d'un compte BeTrack, proposée dans l'aperçu (round 27,
 *  voir doc-comment de tête du composant, section "Création de comptes"). `key` = username dérivé
 *  du nom (voir `usernameFromName` ci-dessous), sert aussi de clé de dédoublonnage ET de React key. */
type PersonToCreate = {
  key: string;
  name: string;
  username: string;
  role: Role;
  /** Décoché par l'utilisateur dans l'aperçu = exclu de la création au moment de la confirmation,
   *  mais l'entité qui le référence (axe/chantier/projet) est quand même importée normalement. */
  include: boolean;
};

/** Résultat de la tentative de création d'UN compte, affiché dans l'écran de résultat post-import
 *  (voir doc-comment de tête du composant). */
type PersonCreationResult = {
  name: string;
  username: string;
  status: "créé" | "déjà existant (compte conservé)" | "échec";
  /** Mot de passe temporaire en clair, affiché UNE SEULE FOIS (voir doc-comment de tête du
   *  composant) — `null` si non créé (déjà existant ou échec) : jamais persisté nulle part au-delà
   *  du champ `password` du document `adminUsers` lui-même (même convention que
   *  `scripts/bulk-create-lever-owners.js`). */
  tempPassword: string | null;
};

/** Rôles proposés pour un compte créé depuis l'import (sous-ensemble de `STRATEGIC_ROLES`,
 *  `types/index.ts`) — mêmes libellés que `STRATEGIC_ROLE_OPTIONS` dans
 *  `components/admin/UsersPanel.tsx` (dupliqué plutôt qu'importé : ce fichier n'exporte pas cette
 *  liste, voir la convention "chaque fichier reste autonome" de `lib/strategicExcelImport.ts`).
 *  `chantier_contributor` ("Responsable projet") en premier = rôle par défaut proposé pour une
 *  personne simplement référencée comme owner/pilote/sponsor dans le fichier importé. */
const PERSON_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "chantier_contributor", label: "Responsable projet" },
  { value: "chantier_owner", label: "Responsable de chantier" },
  { value: "axis_sponsor", label: "Sponsor d'axe" },
  { value: "internal_comm", label: "Communication interne" },
  { value: "budget_control", label: "Contrôle de gestion" },
  { value: "strategic_lead", label: "Pilote du plan stratégique" },
];

/** Retire les accents d'une chaîne — même technique que `lib/leverOwnerReconciliation.ts::normalize`
 *  (dupliquée : ce composant ne dépend pas de ce module pour cette seule fonction). */
function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Dérive prénom/nom/username d'un nom complet en texte libre ("Marc Dubois" -> "marc.dubois") —
 *  PORT EXACT de `usernameFromName` dans `scripts/bulk-create-lever-owners.js` (même règle : le
 *  dernier "mot" est le nom de famille, tout ce qui précède est le prénom composé), adapté en
 *  TypeScript navigateur pour ce composant (le script original tourne en Node, hors périmètre
 *  d'un import côté navigateur — voir doc-comment de tête du composant). */
function usernameFromName(fullName: string): {
  firstName: string;
  lastName: string;
  username: string;
} {
  const parts = fullName.trim().split(/\s+/);
  const lastName = parts.pop() ?? "";
  const firstName = parts.join(" ");
  const slug = (s: string) =>
    stripAccents(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return { firstName, lastName, username: `${slug(firstName)}.${slug(lastName)}` };
}

/** Mot de passe temporaire aléatoire, 12 caractères alphanumériques lisibles (sans 0/O/1/l
 *  ambigus) — même alphabet que `randomPassword` dans `scripts/bulk-create-lever-owners.js`, mais
 *  généré via `crypto.getRandomValues` (Web Crypto, disponible dans le navigateur) plutôt que le
 *  module `crypto` Node du script original. */
function randomTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => alphabet[b % alphabet.length])
    .join("");
}

/**
 * Bouton "Modèle Excel" (classeur 5 feuilles vierge, avec exemple) + bouton "Importer un fichier"
 * (aperçu/confirmation) pour l'import Excel d'un plan stratégique complet — voir
 * `lib/strategicExcelImport.ts` pour le format exact et la logique de validation/résolution des
 * clés étrangères. Mirror structurel de `components/shared/LeverImportButton.tsx`. Monté dans la
 * barre d'outils de `components/strategic/StrategicAxesView.tsx`. `onImport` reste volontairement
 * abstrait : c'est l'appelant qui écrit les entités (`toCreate.axes/chantiers/actions/indicators`)
 * via les `save*` de `lib/firestore/{strategicAxes,chantiers,chantierActions,indicators}.ts`, en
 * boucle, après confirmation — cette librairie/ce composant ne font AUCUN appel Firestore pour CES
 * entités-là.
 *
 * Round 27, section "Création de comptes" : le fichier importé référence souvent des personnes
 * (`StrategicAxis.owner`, `Chantier.pilote`, `ChantierAction.owner`/`.sponsor`) qui n'ont pas
 * encore de compte BeTrack. Ce composant calcule, dès le parsing du fichier (`computePeopleToCreate`
 * ci-dessous), la liste des noms distincts qui NE correspondent à AUCUN compte existant de
 * l'entreprise (même rapprochement que `lib/leverOwnerReconciliation.ts::matchLeverOwner`, réutilisé
 * tel quel) et les propose dans l'aperçu, AVANT toute écriture Firestore — l'utilisateur peut
 * décocher une personne ou changer son rôle proposé (voir `PERSON_ROLE_OPTIONS`). Cette section
 * n'est affichée qu'aux comptes admin (global ou d'entreprise, seuls habilités par
 * `firestore.rules` à créer un document `adminUsers`), et est purement additive : décocher tout le
 * monde n'empêche jamais l'import des axes/chantiers/projets/indicateurs eux-mêmes.
 *
 * Mécanique de création de compte : PORT navigateur de `scripts/bulk-create-lever-owners.js`
 * (même dérivation username/prénom/nom, même e-mail synthétique `usernameToSyntheticEmail`, même
 * mot de passe temporaire aléatoire, même document `adminUsers/{accountSlug}`) mais via le SDK
 * client Firebase plutôt que `firebase-admin` (indisponible côté navigateur) — même pattern que
 * `UsersPanel.tsx::createAuthAccount` : `withSecondaryAuth` + `createUserWithEmailAndPassword` sur
 * une instance Auth SECONDAIRE (jamais l'instance principale, qui connecterait le navigateur en
 * tant que la personne nouvellement créée et déconnecterait l'admin de sa propre session), puis
 * `saveUser()` (écriture Firestore normale, warrantée par `firestore.rules`). Un e-mail déjà
 * utilisé (`auth/email-already-in-use`) n'est PAS traité comme un échec : le compte existant n'est
 * ni recréé ni modifié (mot de passe INCHANGÉ, document Firestore NON réécrit — plus prudent que le
 * script d'origine, qui réécrit le document Firestore même sur un compte déjà existant ; voir
 * `createPersonAccount`). Le mot de passe temporaire généré n'est JAMAIS persisté ailleurs que dans
 * le champ `password` du document `adminUsers` lui-même (même exposition que tout compte créé via
 * `UsersPanel.tsx` — pas une régression introduite ici) : côté UI, il n'est affiché qu'UNE SEULE
 * FOIS dans l'écran de résultat post-import (`creationResult`), avec un bouton copier et un
 * avertissement explicite, jamais réécrit en base au-delà de ce champ (contrairement au script CLI
 * qui, en plus, l'écrit dans un CSV local gitignored — inapplicable ici, il n'y a pas de disque
 * local côté navigateur pertinent pour cet usage).
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
  const { isGlobalAdmin, isCompanyAdmin } = useRole();
  // Comptes de l'entreprise CIBLÉE par cet import (pas nécessairement celle de l'utilisateur
  // connecté s'il est admin global — mais `companyId` est déjà la bonne portée ici, voir le prop) :
  // sert de base de rapprochement pour `computePeopleToCreate` ci-dessous, même source que
  // `LeverOwnerReconciliationDialog`/`LeverForm` (voir `useCompanyUsers`).
  const companyUsers = useCompanyUsers(companyId ?? null);
  // Seuls les admins (habilités par `firestore.rules` à créer un document `adminUsers`) voient et
  // déclenchent la section "Création de comptes" — voir doc-comment de tête du composant.
  const canCreateAccounts = isGlobalAdmin || isCompanyAdmin;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<StrategicImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [peopleToCreate, setPeopleToCreate] = useState<PersonToCreate[]>([]);
  const [creationResult, setCreationResult] = useState<PersonCreationResult[] | null>(null);

  /** Calcule, à partir d'un aperçu fraîchement validé, la liste dédoublonnée des personnes
   *  référencées (owner d'axe, pilote de chantier, owner/sponsor de projet) qui ne correspondent à
   *  AUCUN compte existant de l'entreprise — voir doc-comment de tête du composant. Snapshot pris au
   *  moment du parsing du fichier (pas un `useMemo` recalculé à chaque rendu) : les cases
   *  cochées/rôles choisis par l'utilisateur dans l'aperçu ne doivent pas être réinitialisés par un
   *  rafraîchissement `onSnapshot` de `companyUsers` pendant qu'il relit l'aperçu. */
  const computePeopleToCreate = (result: StrategicImportPreview): PersonToCreate[] => {
    const rawNames = [
      ...result.toCreate.axes.map((a) => a.owner),
      ...result.toCreate.axes.map((a) => a.sponsorName),
      ...result.toCreate.chantiers.map((c) => c.pilote),
      ...result.toCreate.actions.map((a) => a.owner),
      ...result.toCreate.actions.map((a) => a.sponsor),
    ].filter((n): n is string => !!n && n.trim() !== "");

    const candidates: OwnerMatchCandidate[] = companyUsers.map((u) => ({
      username: u.username,
      name: u.name,
    }));

    const seen = new Map<string, PersonToCreate>();
    for (const raw of rawNames) {
      const name = raw.trim();
      // "unique" ou "homonyms" -> au moins un compte existant porte déjà ce nom, rien à créer ;
      // seul "none" désigne une personne réellement absente de l'entreprise.
      if (matchLeverOwner(name, candidates).kind !== "none") continue;
      const { username } = usernameFromName(name);
      const key = username.toLowerCase();
      if (!seen.has(key)) {
        seen.set(key, { key, name, username, role: "chantier_contributor", include: true });
      }
    }
    return Array.from(seen.values());
  };

  /** Crée le compte Firebase Auth + le document `adminUsers` d'UNE personne — voir doc-comment de
   *  tête du composant pour la mécanique complète et sa provenance (`scripts/bulk-create-lever-
   *  owners.js`, adapté au SDK client). Ne lève JAMAIS : toute erreur devient un statut "échec" dans
   *  le résultat retourné, pour qu'un échec individuel n'interrompe ni les autres créations, ni le
   *  reste de l'import (axes/chantiers/projets/indicateurs) — voir doc-comment "Handle the 'email
   *  already exists' case" du round. */
  async function createPersonAccount(person: PersonToCreate): Promise<PersonCreationResult> {
    const tempPassword = randomTempPassword();
    try {
      let alreadyExists = false;
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
      if (alreadyExists) {
        // Compte déjà existant : ni mot de passe ni document Firestore ne sont touchés (voir
        // doc-comment de tête du composant) — on ne connaît pas l'état actuel de ce compte, le
        // modifier à l'aveugle depuis un import serait risqué.
        return {
          name: person.name,
          username: person.username,
          status: "déjà existant (compte conservé)",
          tempPassword: null,
        };
      }

      const { firstName, lastName } = usernameFromName(person.name);
      const newUser: AuthUser = {
        username: person.username,
        password: tempPassword,
        profiles: [{ role: person.role, ...(programId ? { programId } : {}) }],
        isGlobalAdmin: false,
        isCompanyAdmin: false,
        firstName,
        lastName,
        name: person.name,
        companyId: companyId ?? null,
        confidentialityClearance: "all",
      };
      await saveUser(newUser);
      return { name: person.name, username: person.username, status: "créé", tempPassword };
    } catch {
      return { name: person.name, username: person.username, status: "échec", tempPassword: null };
    }
  }

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
        "5 feuilles : Axes (Code = clé), Chantiers (Codes Axes séparés par ; = FK, accepte plusieurs axes), Projets (Code Chantier = FK), Livrables (Code Projet = FK, optionnelle), Indicateurs (Code Axe OU Code Chantier = FK). Supprimez les lignes d'exemple avant de remplir."
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
    setCreationResult(null);
    setPeopleToCreate(canCreateAccounts ? computePeopleToCreate(result) : []);
  };

  const toggleInclude = (key: string) =>
    setPeopleToCreate((list) =>
      list.map((p) => (p.key === key ? { ...p, include: !p.include } : p))
    );

  const setPersonRole = (key: string, role: Role) =>
    setPeopleToCreate((list) => list.map((p) => (p.key === key ? { ...p, role } : p)));

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
      // Comptes AVANT le reste de l'import (voir doc-comment de tête du composant) : chaque
      // création est individuellement défensive (`createPersonAccount` n'échoue jamais elle-même),
      // un échec ou un compte déjà existant n'interrompt donc jamais la suite.
      const included = canCreateAccounts ? peopleToCreate.filter((p) => p.include) : [];
      const results: PersonCreationResult[] = [];
      for (const person of included) {
        results.push(await createPersonAccount(person));
      }

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
      if (results.length > 0) {
        // Laisse la modale ouverte pour afficher les identifiants créés (voir doc-comment de tête
        // du composant) — fermeture manuelle uniquement (bouton "Fermer" de l'écran de résultat).
        setCreationResult(results);
      } else {
        setPreview(null);
      }
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

  const closeModal = () => {
    setPreview(null);
    setPeopleToCreate([]);
    setCreationResult(null);
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
        onOpenChange={(open) => !open && closeModal()}
        title={
          creationResult
            ? t("strategicImport.accountsResultTitle", "Comptes créés")
            : t("strategicImport.previewTitle", "Prévisualisation de l'import — {file}").replace(
                "{file}",
                fileName
              )
        }
        maxWidth="720px"
        footer={
          creationResult ? (
            <Button variant="primary" onClick={closeModal}>
              {t("common.close", "Fermer")}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={closeModal}>
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
          )
        }
      >
        {creationResult ? (
          <div className="space-y-3">
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              {t(
                "strategicImport.tempPasswordWarning",
                "Mots de passe temporaires à transmettre à la personne concernée, non récupérables ensuite — notez-les maintenant."
              )}
            </p>
            <div className="max-h-[360px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
              {creationResult.map((r) => (
                <div
                  key={r.username}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-1.5 last:border-0"
                >
                  <span>
                    <strong>{r.name}</strong> ({r.username}) —{" "}
                    <span
                      className={
                        r.status === "créé"
                          ? "text-rag-green-dark"
                          : r.status === "échec"
                            ? "text-rag-red"
                            : "text-tertiary"
                      }
                    >
                      {r.status}
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
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-4 text-[13px]">
              <span>
                <strong className="text-rag-green-dark">
                  {preview?.toCreate.axes.length ?? 0}
                </strong>{" "}
                {t("strategicImport.axesCountLabel", "axe(s) à créer")}
              </span>
              <span>
                <strong className="text-rag-green-dark">
                  {preview?.toCreate.chantiers.length ?? 0}
                </strong>{" "}
                {t("strategicImport.chantiersCountLabel", "chantier(s) à créer")}
              </span>
              <span>
                <strong className="text-rag-green-dark">
                  {preview?.toCreate.actions.length ?? 0}
                </strong>{" "}
                {t("strategicImport.actionsCountLabel", "projet(s) à créer")}
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
            <div className="max-h-[240px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-neutral-50 p-3 text-xs">
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
                      </span>
                      <select
                        value={p.role}
                        disabled={!p.include}
                        onChange={(e) => setPersonRole(p.key, e.target.value as Role)}
                        className="ml-auto rounded-md border border-border bg-white px-1.5 py-0.5 text-xs disabled:opacity-50"
                      >
                        {PERSON_ROLE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
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
