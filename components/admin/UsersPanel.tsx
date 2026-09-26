"use client";

import { MultiSelect } from "@/components/shared/MultiSelect";
import { matchesFilter } from "@/lib/filterUtils";
import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2, KeyRound, Power, Copy, Mail } from "lucide-react";
import type { AuthUser, Role, Company, Program, ProfileAssignment } from "@/types";
import {
  subscribeUsers,
  saveUser,
  subscribeCompanies,
  subscribePrograms,
  setUserDisabledFlag,
} from "@/lib/firestore/admin";
import { isFirebaseErrorCode, usernameToSyntheticEmail } from "@/lib/auth";
import { withSecondaryAuth, getAuthInstance } from "@/lib/firebase";
import {
  renameUser,
  deleteUserAccount,
  setUserDisabled,
  generatePasswordResetLink,
  AdminApiError,
} from "@/lib/adminApi";
import {
  isValidContactEmail,
  disableBlockReason,
  filterUsersByStatus,
  buildPasswordResetMailto,
  generateRandomPassword,
  type UserStatusFilter,
} from "@/lib/userAccountAdmin";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import {
  isAnyAdmin,
  isCrossTrackRole,
  isStrategicRole,
  assertValidProfiles,
} from "@/lib/roleProfiles";
import { resolveProgramType } from "@/lib/axisLogic";
import { normalizeClearanceLevel } from "@/lib/confidentiality";
import { inheritedRoleLevel } from "@/lib/confidentialityAdmin";

/** Longueur minimale du mot de passe — DOIT rester alignée sur la politique de Firebase Auth
 *  (aucune autre règle par défaut ; un mot de passe plus court est rejeté avec `auth/weak-password`
 *  à la création du compte). Utilisée à la fois pour la validation temps réel du formulaire et pour
 *  le message affiché quand Firebase Auth rejette lui-même le mot de passe côté serveur. */
export const MIN_PASSWORD_LENGTH = 6;

const PASSWORD_TOO_SHORT_MESSAGE = "Le mot de passe doit contenir au moins {n} caractères.";

/** Clé i18n de chacun des libellés (français, testés tels quels) renvoyés par
 *  `missingRequiredFields` — traduits au moment de l'affichage du toast. */
const MISSING_FIELD_KEYS: Record<string, string> = {
  Identifiant: "adminUsers.fieldUsername",
  "Nom affiché (ou Prénom + Nom)": "adminUsers.fieldDisplayNameOrFull",
  "Mot de passe": "adminUsers.fieldPassword",
  Entreprise: "adminUsers.fieldCompany",
};

/** Libellés FR des 6 rôles du Plan Performance (round historique) — cet écran d'admin n'est pas
 *  traduit, mêmes libellés littéraux que les rôles du Plan Stratégique ci-dessous. */
const PERFORMANCE_ROLE_OPTIONS: { value: Role; labelKey: string; label: string }[] = [
  { value: "cto", labelKey: "roles.cto.short", label: "CTO" },
  // Libellé "Responsable de chantier" (renommage du libellé affiché — la clé technique `sponsor` reste
  // inchangée, toujours scopée WORKSTREAM, voir types/index.ts).
  { value: "sponsor", labelKey: "roles.sponsor.label", label: "Responsable de chantier" },
  { value: "lever", labelKey: "roles.lever.label", label: "Responsable de levier" },
  { value: "finance", labelKey: "roles.finance.label", label: "Contrôleur financier" },
  // `hr` (Directeur RH) est désormais transverse : voir CROSS_TRACK_ROLE_OPTIONS.
  { value: "ops", labelKey: "roles.ops.label", label: "Responsable Opérations" },
  // Fondation vue consolidée multi-programmes (voir types/index.ts) : deux rôles Plan Performance
  // scopés PROGRAMME (pas workstream) — même visualisation qu'un CTO, mais restreints à leur
  // périmètre de programmes (sponsor/owner), voir lib/consolidatedProgramAccess.ts.
  {
    value: "program_sponsor",
    labelKey: "roles.programSponsor.label",
    label: "Commanditaire du programme",
  },
  {
    value: "program_owner",
    labelKey: "roles.programOwner.label",
    label: "Responsable du programme",
  },
];

/** Libellés FR des profils du Plan Stratégique (pilote > sponsor d'axe > sponsor de chantier >
 *  responsable projet > contributeur projet, voir lib/strategicHierarchy.ts) — les clés i18n
 *  `roles.*` correspondantes existent séparément pour la sidebar/topbar. */
const STRATEGIC_ROLE_OPTIONS: { value: Role; labelKey: string; label: string }[] = [
  {
    value: "strategic_lead",
    labelKey: "roles.strategicLead.label",
    label: "Pilote du plan stratégique",
  },
  { value: "axis_sponsor", labelKey: "roles.axisSponsor.label", label: "Sponsor d'axe" },
  {
    value: "chantier_owner",
    labelKey: "roles.chantierOwner.label",
    label: "Sponsor de chantier",
  },
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
];

/** Rôle transverse (round 25) : contrairement aux 12 rôles ci-dessus, chacun strictement mono-
 *  piste, `comex_member` est valide aussi bien comme profil Plan Performance que Plan Stratégique
 *  (voir `PERFORMANCE_ROLES`/`STRATEGIC_ROLES` dans types/index.ts). Rassemblé dans SON PROPRE
 *  optgroup plutôt que dupliqué dans les deux listes ci-dessus : la valeur soumise par un
 *  `<option>` HTML ne porte que le `Role`, pas l'optgroup d'origine — un doublon dans les deux
 *  listes produirait deux entrées de menu identiques et indiscernables l'une de l'autre. */
const CROSS_TRACK_ROLE_OPTIONS: { value: Role; labelKey: string; label: string }[] = [
  { value: "comex_member", labelKey: "roles.comexMember.label", label: "Membre du COMEX" },
  { value: "hr", labelKey: "roles.hr.label", label: "Directeur RH" },
];

/** Réunion des trois listes ci-dessus — sert uniquement à retrouver le libellé d'un `Role` donné
 *  (table des utilisateurs). */
const ALL_ROLE_OPTIONS = [
  ...PERFORMANCE_ROLE_OPTIONS,
  ...STRATEGIC_ROLE_OPTIONS,
  ...CROSS_TRACK_ROLE_OPTIONS,
];

/** Les 4 états sémantiques de AuthUser.confidentialityClearance (voir types/index.ts) : */
type ClearanceMode = "inherit" | "none" | "custom" | "all";

function clearanceModeOf(clearance: AuthUser["confidentialityClearance"]): ClearanceMode {
  if (clearance === undefined) return "inherit";
  if (clearance === "all") return "all";
  return clearance.length === 0 ? "none" : "custom";
}

/** Niveau unique (hiérarchique) de l'override individuel, pour pré-remplir le formulaire — un
 *  tableau legacy est normalisé vers son niveau de plus haut accès (voir lib/confidentiality.ts). */
function clearanceLevelOf(
  clearance: AuthUser["confidentialityClearance"],
  orderedLevels: string[]
): string {
  if (clearance === undefined || clearance === "all") return "";
  return normalizeClearanceLevel(clearance, orderedLevels) ?? "";
}

/**
 * Traduit le contrôle 4-états du formulaire en le patch à fusionner sur AuthUser avant
 * saveUser(). Fonction pure (testable sans React/Firestore) — extraite pour deux raisons :
 *  1. Un admin (global ou entreprise) a un accès total, ce contrôle n'a pas d'effet pour lui —
 *     d'où le paramètre `isAdmin` (voir `lib/roleProfiles.ts::isAnyAdmin`), qui remplace l'ancien
 *     test `role === "admin" || role === "admin_entreprise"` du modèle à rôle scalaire.
 *  2. En mode "inherit", la clé `confidentialityClearance` est OMISE (jamais mise à `undefined`) :
 *     Firestore setDoc() rejette toute valeur de champ explicitement `undefined`. L'omettre
 *     produit le même résultat sémantique (repli sur Company.roleClearance[role]) tout en étant
 *     accepté par setDoc, qui remplace le document entier — donc repasser en "Hérite du rôle"
 *     efface bien un override individuel précédemment enregistré.
 */
export function buildClearancePatch(
  isAdmin: boolean,
  clearanceMode: ClearanceMode,
  /** UN seul niveau (hiérarchique : donne aussi accès aux niveaux inférieurs). "" = aucun. */
  clearanceLevel: string
): Pick<AuthUser, "confidentialityClearance"> | Record<string, never> {
  if (isAdmin) return {};
  if (clearanceMode === "all") return { confidentialityClearance: "all" };
  if (clearanceMode === "none") return { confidentialityClearance: [] };
  if (clearanceMode === "custom") {
    return { confidentialityClearance: clearanceLevel ? clearanceLevel : [] };
  }
  return {};
}

export type UserFormInput = {
  username: string;
  firstName: string;
  lastName: string;
  name: string;
  password: string;
  /** Remplace l'ancien `role: Role` pour la logique d'obligation de l'entreprise : un compte
   *  admin global n'a jamais de `companyId` (voir round multi-profils, `AuthUser.isGlobalAdmin`). */
  isGlobalAdmin: boolean;
  companyId: string;
  /** Mot de passe exigé ? Vrai par défaut (compatibilité) ; UsersPanel passe `false` sauf en
   *  création avec « Définir un mot de passe initial » — en édition le mot de passe n'est plus
   *  jamais affiché ni saisi par l'admin, et en création par lien l'utilisateur le définit
   *  lui-même (voir save()). */
  requirePassword?: boolean;
};

/**
 * Détermine les libellés des champs obligatoires manquants du formulaire utilisateur — à vérifier
 * AVANT tout appel Firebase Auth/Firestore dans save(). Fonction pure (testable sans
 * React/Firestore), même logique d'extraction que buildClearancePatch ci-dessus.
 *  - Identifiant : toujours requis.
 *  - Nom affiché OU Prénom + Nom : l'un des deux doit être renseigné (le second sert de repli à
 *    l'écriture du champ `name`, voir save()).
 *  - Mot de passe : requis seulement si `requirePassword` (défaut true) — création avec mot de
 *    passe initial saisi par l'admin.
 *  - Entreprise : requise seulement quand le champ est affiché, càd compte non-admin-global ET
 *    aucun `fixedCompanyId` imposé par le contexte (scope du hub `/admin/companies/detail`, ou
 *    admin_entreprise limité à sa propre entreprise sur la page globale).
 *  Les profils métier (Plan Performance / Plan Stratégique) n'apparaissent jamais dans le
 *  résultat : la liste de profils est toujours optionnelle (0 à N entrées).
 */
export function missingRequiredFields(
  form: UserFormInput,
  fixedCompanyId: string | undefined
): string[] {
  const missing: string[] = [];
  if (!form.username.trim()) missing.push("Identifiant");
  if (!form.name.trim() && !`${form.firstName} ${form.lastName}`.trim()) {
    missing.push("Nom affiché (ou Prénom + Nom)");
  }
  if (form.requirePassword !== false && !form.password.trim()) missing.push("Mot de passe");
  if (!form.isGlobalAdmin && !fixedCompanyId && !form.companyId.trim()) {
    missing.push("Entreprise");
  }
  return missing;
}

/**
 * Gestion des utilisateurs — extrait de `admin/users/page.tsx` pour être réutilisable tel quel
 * par le hub `/admin/companies/detail` (onglet Utilisateurs), pré-filtré sur une entreprise donnée
 * via `scopeCompanyId`. Sans ce prop, se comporte exactement comme avant (page globale
 * `/admin/users`, avec son propre filtre entreprise et sa scop admin_entreprise). Seule source de
 * vérité pour ce CRUD — ne pas dupliquer la logique ailleurs.
 */
export function UsersPanel({
  scopeCompanyId,
  createCompanyAdminSignal = 0,
}: {
  scopeCompanyId?: string;
  /** Incrémenter pour ouvrir le formulaire de création avec « Admin entreprise » pré-coché
   *  (étape 2 de la mise en place, bouton de CompanyDetailClient). */
  createCompanyAdminSignal?: number;
} = {}) {
  const { t } = useTranslation();
  const { isCompanyAdmin: viewerIsCompanyAdmin, user } = useRole();
  const { showToast } = useToast();
  const isEntAdmin = !!viewerIsCompanyAdmin;
  // companyId effectif imposé à ce panneau : soit le scope explicite du hub (global admin gérant
  // une entreprise précise), soit — sans scope — celui d'un admin_entreprise limité à sa propre
  // entreprise (comportement historique de la page globale).
  const fixedCompanyId =
    scopeCompanyId ?? (isEntAdmin ? (user?.companyId ?? undefined) : undefined);
  // Un admin d'entreprise (ou tout écran scopé à une entreprise précise) ne peut jamais créer/
  // promouvoir un compte admin GLOBAL — ce profil n'a par définition aucune entreprise. Réservé à
  // un admin global travaillant sur la page non-scopée.
  const canAssignGlobalAdmin = !isEntAdmin && !fixedCompanyId;
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies, fixedCompanyId ?? null);
    return unsub;
  }, [fixedCompanyId]);

  useEffect(() => {
    const unsub = subscribeUsers((list) => {
      setUsers(fixedCompanyId ? list.filter((u) => u.companyId === fixedCompanyId) : list);
    }, fixedCompanyId ?? null);
    return unsub;
  }, [fixedCompanyId]);

  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState({
    username: "",
    firstName: "",
    lastName: "",
    name: "",
    // Profils métier — round multi-profils multi-programmes : liste répétable de {role,
    // programId?}, au lieu de l'ancien `role: Role` unique puis des deux pickers fixes
    // (performanceRole/strategicRole) du round précédent. Un utilisateur peut désormais cumuler
    // plusieurs profils d'une même piste, chacun sur un programme distinct (voir
    // lib/roleProfiles.ts::assertValidProfiles, filet de sécurité appelé dans save()).
    profiles: [] as ProfileAssignment[],
    isGlobalAdmin: false,
    isCompanyAdmin: false,
    companyId: "",
    /** Création uniquement, et seulement en mode "manual" — jamais pré-rempli avec le mot de
     *  passe d'un compte existant, jamais enregistré dans Firestore (voir save()). */
    password: "",
    /** Création : "link" (recommandé) = compte créé avec un mot de passe aléatoire jamais
     *  affiché, puis lien de réinitialisation à transmettre ; "manual" = mot de passe initial
     *  temporaire saisi par l'admin (démo / admin-api indisponible). */
    passwordMode: "link" as "link" | "manual",
    /** E-mail de contact RÉEL (optionnel) — distinct de l'e-mail synthétique Firebase Auth. */
    email: "",
    clearanceMode: "inherit" as ClearanceMode,
    clearanceLevel: "",
    /** Direction/service métier de rattachement (round 4, filtres Plan Stratégique) — contrainte
     *  au `Company.directions` de l'entreprise sélectionnée, jamais du texte libre (voir
     *  `AuthUser.direction`). "" = non renseigné, toujours optionnel : ne JAMAIS entrer dans
     *  `missingRequiredFields`/`UserFormInput`, volontairement absent de ce type. */
    direction: "",
  });
  const [showForm, setShowForm] = useState(false);

  // Programmes de l'entreprise actuellement sélectionnée dans le formulaire (ou imposée par le
  // scope) — sert uniquement à peupler les pickers de programme optionnels des deux profils
  // métier ci-dessous. Non filtré côté serveur par type : le tri performance/stratégique se fait
  // ici via `resolveProgramType`.
  const formCompanyId = fixedCompanyId ?? form.companyId;
  useEffect(() => {
    if (!formCompanyId) {
      setPrograms([]);
      return;
    }
    const unsub = subscribePrograms((all) => {
      setPrograms(all.filter((p) => p.companyId === formCompanyId));
    }, formCompanyId);
    return unsub;
  }, [formCompanyId]);
  const performancePrograms = programs.filter((p) => resolveProgramType(p) === "performance");
  const strategicPrograms = programs.filter((p) => resolveProgramType(p) === "strategic");

  // Snapshot pris à l'ouverture du formulaire d'édition — permet à save() de savoir si
  // l'identifiant a RÉELLEMENT été modifié pendant cette session d'édition (pas juste comparé à
  // l'état courant du formulaire, qui ne dit rien sur ce qui a changé). `null` en mode création.
  const [originalUsername, setOriginalUsername] = useState<string | null>(null);
  // Flag `disabled` du compte en cours d'édition : saveUser() fait un setDoc du document ENTIER,
  // il faut donc le reporter pour qu'une simple édition ne réactive pas un compte désactivé.
  const [editingDisabled, setEditingDisabled] = useState(false);
  // Un admin d'ENTREPRISE (non global) ne peut ni retirer l'habilitation d'un AUTRE admin
  // d'entreprise, ni le désactiver/supprimer (firestore.rules : `keepsPeerCompanyAdmin`) — ces
  // actions sont réservées à un admin global. Libre sur son propre compte et les non-admins.
  const isPeerCompanyAdmin = (u: Pick<AuthUser, "username" | "isCompanyAdmin">) =>
    !user?.isGlobalAdmin && !!u.isCompanyAdmin && u.username !== user?.username;
  const [editingPeerAdmin, setEditingPeerAdmin] = useState(false);
  // Le mot de passe n'est plus éditable ici (ni affiché) : un changement passe par l'action
  // « Réinitialiser le mot de passe » (lien à usage unique, l'admin ne voit jamais le mot de passe).

  // Filtre par statut (actif / désactivé) de la table.
  const [statusFilter, setStatusFilter] = useState<UserStatusFilter>("all");
  // Lien de réinitialisation généré par admin-api, affiché dans une modale (copie / mailto).
  const [resetLinkDialog, setResetLinkDialog] = useState<{
    username: string;
    displayName: string;
    email?: string;
    link: string;
    isNewAccount: boolean;
  } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  // Confirmation avant désactivation / réactivation.
  const [disableConfirm, setDisableConfirm] = useState<{
    user: AuthUser;
    disabled: boolean;
  } | null>(null);

  // Erreurs "prominentes" (mot de passe invalide, profils invalides, échec de renommage/suppression
  // côté backend) — affichées dans une modale centrée plutôt qu'un simple toast, pour qu'un admin
  // ne puisse pas les manquer.
  const [errorDialog, setErrorDialog] = useState<{ title: string; messages: string[] } | null>(
    null
  );
  // Confirmation obligatoire avant un renommage (save() la déclenche puis attend confirmRename()).
  const [renameConfirm, setRenameConfirm] = useState<{
    newUser: AuthUser;
    oldUsername: string;
  } | null>(null);
  // Confirmation obligatoire avant une suppression (déclenchée par le bouton corbeille).
  const [deleteConfirm, setDeleteConfirm] = useState<{
    username: string;
    companyId: string | null;
  } | null>(null);

  // Validation temps réel du mot de passe — recalculée à chaque frappe, affichée sous le champ ET
  // utilisée pour désactiver le bouton Enregistrer tant qu'elle échoue.
  const passwordTooShortMessage = t(
    "adminUsers.passwordTooShort",
    PASSWORD_TOO_SHORT_MESSAGE
  ).replace("{n}", String(MIN_PASSWORD_LENGTH));
  const unknownError = t("adminUsers.unknownError", "Erreur inconnue");
  // Seul cas où l'admin saisit un mot de passe : création en mode « mot de passe initial ».
  const passwordRequired = editIdx === null && form.passwordMode === "manual";
  const passwordError =
    passwordRequired && (form.password ?? "").length < MIN_PASSWORD_LENGTH
      ? passwordTooShortMessage
      : null;
  const emailError = isValidContactEmail(form.email)
    ? null
    : t("adminUsers.emailInvalid", "Adresse e-mail invalide (ex. prenom.nom@entreprise.com).");

  // Le formulaire utilisateur est "dirty" dès qu'il est ouvert avec au moins un champ utile
  // rempli. En mode édition (editIdx != null), il est dirty tant qu'il est ouvert — on n'a pas
  // ici de snapshot facile de "l'état initial", et fermer le formulaire annule les changements.
  const userFormDirty =
    showForm &&
    (editIdx !== null ||
      form.username.trim() !== "" ||
      form.firstName.trim() !== "" ||
      form.lastName.trim() !== "" ||
      form.name.trim() !== "");
  useRegisterUnsavedChanges(`admin:users:${fixedCompanyId ?? "global"}`, userFormDirty);

  const startCreate = (preset?: { isCompanyAdmin?: boolean }) => {
    setEditIdx(null);
    setOriginalUsername(null);
    setEditingDisabled(false);
    setEditingPeerAdmin(false);
    setForm({
      username: "",
      firstName: "",
      lastName: "",
      name: "",
      profiles: [],
      isGlobalAdmin: false,
      isCompanyAdmin: preset?.isCompanyAdmin ?? false,
      companyId: fixedCompanyId ?? companies[0]?.id ?? "",
      password: "",
      passwordMode: "link",
      email: "",
      clearanceMode: "inherit",
      clearanceLevel: "",
      direction: "",
    });
    setShowForm(true);
  };
  useEffect(() => {
    if (createCompanyAdminSignal > 0) startCreate({ isCompanyAdmin: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché par le seul signal
  }, [createCompanyAdminSignal]);

  const startEdit = (u: AuthUser, idx: number) => {
    setEditIdx(idx);
    setOriginalUsername(u.username);
    setEditingDisabled(u.disabled === true);
    setEditingPeerAdmin(isPeerCompanyAdmin(u));
    setForm({
      username: u.username,
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      name: u.name,
      profiles: u.profiles ?? [],
      isGlobalAdmin: !!u.isGlobalAdmin,
      isCompanyAdmin: !!u.isCompanyAdmin,
      companyId: u.companyId ?? companies[0]?.id ?? "",
      // Jamais pré-rempli avec le mot de passe (legacy, en clair) du compte existant.
      password: "",
      passwordMode: "link",
      email: u.email ?? "",
      clearanceMode: clearanceModeOf(u.confidentialityClearance),
      clearanceLevel: clearanceLevelOf(
        u.confidentialityClearance,
        companies.find((c) => c.id === u.companyId)?.confidentialityLevels ?? []
      ),
      direction: u.direction ?? "",
    });
    setShowForm(true);
  };

  const save = async () => {
    const missing = missingRequiredFields(
      {
        username: form.username,
        firstName: form.firstName,
        lastName: form.lastName,
        name: form.name,
        password: form.password,
        isGlobalAdmin: form.isGlobalAdmin,
        companyId: form.companyId,
        requirePassword: passwordRequired,
      },
      fixedCompanyId
    );
    if (missing.length > 0) {
      showToast(
        t("adminUsers.missingFieldsTitle", "Champs obligatoires manquants"),
        t("adminUsers.missingFieldsBody", "Merci de renseigner : {fields}.").replace(
          "{fields}",
          missing.map((m) => (MISSING_FIELD_KEYS[m] ? t(MISSING_FIELD_KEYS[m], m) : m)).join(", ")
        ),
        "error"
      );
      return;
    }
    // Le mot de passe est déjà couvert par missingRequiredFields (vide) ; ici on bloque en plus
    // un mot de passe non-vide mais trop court — affiché en temps réel sous le champ, et rappelé
    // ici dans une modale impossible à manquer si l'admin a quand même cliqué Enregistrer.
    if (passwordError) {
      setErrorDialog({
        title: t("adminUsers.invalidPasswordTitle", "Mot de passe invalide"),
        messages: [passwordError],
      });
      return;
    }
    if (emailError) {
      setErrorDialog({
        title: t("adminUsers.emailInvalidTitle", "E-mail invalide"),
        messages: [emailError],
      });
      return;
    }

    // Profils métier saisis via la liste répétable ci-dessous — filtrer les lignes en cours de
    // saisie sans rôle choisi (une ligne vide ajoutée par "+ Ajouter" mais pas encore remplie ne
    // doit pas être enregistrée). `assertValidProfiles` reste appelée comme filet de sécurité
    // avant tout enregistrement (voir lib/roleProfiles.ts).
    const profiles: ProfileAssignment[] = form.profiles.filter((p) => p.role);
    try {
      assertValidProfiles(
        profiles,
        Object.fromEntries(programs.map((p) => [p.id, resolveProgramType(p)]))
      );
    } catch (err) {
      setErrorDialog({
        title: t("adminUsers.invalidProfilesTitle", "Profils invalides"),
        messages: [err instanceof Error ? err.message : unknownError],
      });
      return;
    }

    const normalizedUsername = form.username.trim().toLowerCase();
    const companyId = form.isGlobalAdmin ? null : (fixedCompanyId ?? form.companyId);
    const newUser: AuthUser = {
      username: normalizedUsername,
      // Le mot de passe vit exclusivement dans Firebase Auth : plus jamais recopié en clair dans
      // le document Firestore (champ legacy `AuthUser.password`, vidé au prochain enregistrement —
      // aucun flux de connexion ne le lit, voir lib/auth.ts:signInUser).
      password: "",
      profiles,
      isGlobalAdmin: form.isGlobalAdmin,
      isCompanyAdmin: form.isCompanyAdmin,
      firstName: form.firstName,
      lastName: form.lastName,
      name: form.name || `${form.firstName} ${form.lastName}`.trim(),
      companyId,
      ...buildClearancePatch(
        isAnyAdmin({ isGlobalAdmin: form.isGlobalAdmin, isCompanyAdmin: form.isCompanyAdmin }),
        form.clearanceMode,
        form.clearanceLevel
      ),
      // "" (non renseigné) omet la clé plutôt que de la mettre à `undefined` — même précaution que
      // buildClearancePatch en mode "inherit" : Firestore setDoc() rejette toute valeur de champ
      // explicitement `undefined`, et setDoc remplace le document entier, donc omettre la clé ici
      // efface bien un `direction` précédemment enregistré si l'admin repasse à "Non renseigné".
      ...(form.direction.trim() !== "" ? { direction: form.direction.trim() } : {}),
      // Même précaution (clé omise si vide) pour l'e-mail de contact et le flag de désactivation,
      // ce dernier reporté depuis le compte édité (setDoc remplace le document entier).
      ...(form.email.trim() !== "" ? { email: form.email.trim() } : {}),
      ...(editIdx !== null && editingDisabled ? { disabled: true } : {}),
    };

    const isEditingExisting = editIdx !== null && originalUsername !== null;
    const usernameChanged = isEditingExisting && normalizedUsername !== originalUsername;

    // Renommer un utilisateur existant touche Firebase Auth (l'identifiant technique en dépend,
    // voir usernameToSyntheticEmail) : ça ne peut pas être un simple setDoc Firestore, ça doit
    // passer par le backend admin — et ça exige une confirmation explicite avant d'agir (voir
    // renameConfirm plus bas, résolu par confirmRename()/l'annulation de la modale). Le mot de
    // passe, lui, ne se change plus ici : action « Réinitialiser le mot de passe » (lien à usage
    // unique, qui crée aussi le compte Auth des "owners" créés par script sans compte de connexion).
    if (isEditingExisting && usernameChanged) {
      setRenameConfirm({ newUser, oldUsername: originalUsername! });
      return;
    }

    if (isEditingExisting) {
      // Édition d'un champ simple (profils, entreprise, habilitation...) sans changement
      // d'identifiant : reste un setDoc Firestore direct, comme avant. Ne JAMAIS appeler
      // createAuthAccount ici — aucun nouveau compte Firebase Auth ne doit être créé/touché pour
      // une édition qui ne renomme pas le compte.
      try {
        await saveUser(newUser);
        setShowForm(false);
      } catch (err) {
        showToast(
          t("adminUsers.saveFailed", "Échec de l'enregistrement"),
          err instanceof Error ? err.message : unknownError,
          "error"
        );
      }
      return;
    }

    // Création d'un nouvel utilisateur.
    try {
      // Crée le compte Firebase Auth correspondant AVANT d'écrire le profil Firestore — sur une
      // instance Auth SECONDAIRE (voir withSecondaryAuth dans lib/firebase.ts), jamais sur
      // l'instance principale : createUserWithEmailAndPassword connecte automatiquement le
      // navigateur en tant que ce nouvel utilisateur, ce qui déconnecterait l'admin de sa propre
      // session s'il l'appelait sur l'instance principale.
      // Mode "link" (par défaut) : mot de passe aléatoire jamais affiché ni communiqué, puis lien
      // de réinitialisation immédiatement proposé à l'admin — l'utilisateur définit lui-même son
      // mot de passe. Mode "manual" : mot de passe initial temporaire saisi par l'admin (démo, ou
      // admin-api indisponible), jamais stocké dans Firestore.
      const initialPassword =
        form.passwordMode === "manual" ? form.password : generateRandomPassword();
      await createAuthAccount(normalizedUsername, initialPassword, newUser.companyId ?? null);
      await saveUser(newUser);
      setShowForm(false);
      if (form.passwordMode === "link") {
        await openResetLink(newUser, true);
      } else {
        showToast(
          t("adminUsers.createdTitle", "Utilisateur créé"),
          t(
            "adminUsers.createdManualBody",
            "Le compte « {username} » a été créé avec le mot de passe initial saisi. Invitez l'utilisateur à le changer depuis « Mon profil »."
          ).replace("{username}", normalizedUsername),
          "success"
        );
      }
    } catch (err) {
      if (isFirebaseErrorCode(err, "auth/weak-password")) {
        setErrorDialog({
          title: t("adminUsers.invalidPasswordTitle", "Mot de passe invalide"),
          messages: [passwordTooShortMessage],
        });
        return;
      }
      showToast(
        t("adminUsers.saveFailed", "Échec de l'enregistrement"),
        err instanceof Error ? err.message : unknownError,
        "error"
      );
    }
  };

  /** Message d'erreur lisible à partir d'une erreur du backend admin (AdminApiError, dont
   *  `.message` est déjà une chaîne française prête à afficher) ou de toute autre exception. */
  function adminApiErrorMessage(err: unknown): string {
    if (err instanceof AdminApiError) return err.message;
    return err instanceof Error ? err.message : unknownError;
  }

  /** Récupère le jeton d'ID de l'admin CONNECTÉ (session principale, jamais l'auth secondaire
   *  utilisée pour créer des comptes — voir withSecondaryAuth) : ce sont bien les appels du backend
   *  admin qui doivent s'authentifier comme l'admin agissant, pas comme l'utilisateur ciblé. */
  async function getAdminIdToken(): Promise<string> {
    const current = getAuthInstance().currentUser;
    if (!current) {
      throw new AdminApiError(
        "unauthenticated",
        t(
          "adminUsers.sessionExpired",
          "Session administrateur expirée — merci de vous reconnecter."
        )
      );
    }
    return current.getIdToken();
  }

  const confirmRename = async () => {
    if (!renameConfirm) return;
    const { newUser, oldUsername } = renameConfirm;
    setRenameConfirm(null);
    try {
      const idToken = await getAdminIdToken();
      await renameUser(idToken, {
        oldUsername,
        newUsername: newUser.username,
        companyId: newUser.companyId ?? null,
      });
      // subscribeUsers() est un onSnapshot Firestore : le renommage écrit par le backend admin
      // (nouveau document, ancien supprimé) redéclenche l'abonnement tout seul — rien à refaire ici.
      setShowForm(false);
      showToast(
        t("adminUsers.renamedTitle", "Utilisateur renommé"),
        t("adminUsers.renamedBody", "Le compte « {old} » a été renommé en « {new} ».")
          .replace("{old}", oldUsername)
          .replace("{new}", newUser.username),
        "success"
      );
    } catch (err) {
      setErrorDialog({
        title: t("adminUsers.renameFailed", "Échec du renommage"),
        messages: [adminApiErrorMessage(err)],
      });
    }
  };

  /**
   * Demande à admin-api un lien de réinitialisation À USAGE UNIQUE et l'affiche dans une modale
   * (copie / mailto) — l'admin ne voit ni ne choisit jamais le mot de passe. Pourquoi pas un envoi
   * par Firebase : les e-mails Firebase Auth sont SYNTHÉTIQUES (`…@betrack.local`, voir
   * lib/auth.ts:usernameToSyntheticEmail) et ne reçoivent aucun courrier ; le lien est donc remis
   * à l'admin, qui le transmet (mailto vers l'e-mail de contact réel s'il est renseigné).
   * `isNewAccount` : appelé juste après une création en mode "link".
   */
  async function openResetLink(u: AuthUser, isNewAccount = false): Promise<void> {
    try {
      const idToken = await getAdminIdToken();
      const link = await generatePasswordResetLink(idToken, {
        username: u.username,
        companyId: u.companyId ?? null,
      });
      setLinkCopied(false);
      setResetLinkDialog({
        username: u.username,
        displayName: u.name,
        email: u.email,
        link,
        isNewAccount,
      });
    } catch (err) {
      setErrorDialog({
        title: t("adminUsers.resetLinkFailed", "Échec de la génération du lien"),
        messages: [
          adminApiErrorMessage(err),
          ...(isNewAccount
            ? [
                t(
                  "adminUsers.resetLinkFailedNewAccount",
                  "Le compte a bien été créé. Générez le lien plus tard avec l'action « Réinitialiser le mot de passe »."
                ),
              ]
            : []),
        ],
      });
    }
  }

  const copyResetLink = async () => {
    if (!resetLinkDialog) return;
    try {
      await navigator.clipboard.writeText(resetLinkDialog.link);
      setLinkCopied(true);
    } catch {
      showToast(
        t("adminUsers.copyFailed", "Copie impossible"),
        t("adminUsers.copyFailedBody", "Sélectionnez le lien et copiez-le manuellement."),
        "error"
      );
    }
  };

  /** Clic sur l'action désactiver/réactiver : garde-fous (soi-même, dernier admin d'entreprise
   *  actif) vérifiés ici pour l'UI, puis confirmation. admin-api refait ces contrôles. */
  const requestToggleDisabled = (u: AuthUser) => {
    const disabling = u.disabled !== true;
    if (disabling) {
      const reason = disableBlockReason(u, users, user);
      if (reason) {
        setErrorDialog({
          title: t("adminUsers.disableBlockedTitle", "Désactivation impossible"),
          messages: [
            reason === "self"
              ? t(
                  "adminUsers.disableBlockedSelf",
                  "Vous ne pouvez pas désactiver votre propre compte."
                )
              : t(
                  "adminUsers.disableBlockedLastAdmin",
                  "Impossible de désactiver le dernier administrateur actif de l'entreprise. Désignez d'abord un autre administrateur."
                ),
          ],
        });
        return;
      }
    }
    setDisableConfirm({ user: u, disabled: disabling });
  };

  const confirmToggleDisabled = async () => {
    if (!disableConfirm) return;
    const { user: target, disabled } = disableConfirm;
    setDisableConfirm(null);
    const params = { username: target.username, companyId: target.companyId ?? null, disabled };
    try {
      try {
        // Voie normale : admin-api met à jour Firebase Auth ET Firestore, et journalise.
        const idToken = await getAdminIdToken();
        await setUserDisabled(idToken, params);
      } catch (err) {
        // admin-api injoignable / non configuré : on pose quand même le flag Firestore, qui suffit
        // à bloquer la connexion (lib/auth.ts:resolveAuthUserProfile) — avec un avertissement.
        // Toute autre erreur (droits, dernier admin...) est un refus métier : on n'écrit rien.
        if (
          err instanceof AdminApiError &&
          (err.code === "network_error" || err.code === "not_configured")
        ) {
          await setUserDisabledFlag(params.username, params.companyId, disabled);
          showToast(
            t("adminUsers.disablePartialTitle", "Statut mis à jour partiellement"),
            t(
              "adminUsers.disablePartialBody",
              "Le statut a été enregistré dans l'application, mais le compte de connexion n'a pas pu être synchronisé ({error}). Réessayez plus tard."
            ).replace("{error}", err.message),
            "error"
          );
          return;
        }
        throw err;
      }
      showToast(
        disabled
          ? t("adminUsers.disabledTitle", "Utilisateur désactivé")
          : t("adminUsers.enabledTitle", "Utilisateur réactivé"),
        (disabled
          ? t("adminUsers.disabledBody", "Le compte « {username} » ne peut plus se connecter.")
          : t("adminUsers.enabledBody", "Le compte « {username} » peut de nouveau se connecter.")
        ).replace("{username}", target.username),
        "success"
      );
    } catch (err) {
      setErrorDialog({
        title: disabled
          ? t("adminUsers.disableFailed", "Échec de la désactivation")
          : t("adminUsers.enableFailed", "Échec de la réactivation"),
        messages: [adminApiErrorMessage(err)],
      });
    }
  };

  /**
   * Crée le compte Firebase Auth d'un utilisateur (e-mail synthétique dérivé du username saisi
   * ET de son entreprise — voir usernameToSyntheticEmail dans lib/auth.ts). `companyId` DOIT être
   * celui du nouvel utilisateur (`newUser.companyId`, déjà calculé par save() : null pour un
   * admin, l'entreprise ciblée sinon) — PAS un simple usernameToSyntheticEmail(username) à un seul
   * argument, qui construirait l'e-mail du compte ADMIN GLOBAL de ce username (round 5 : un même
   * username peut désormais avoir un compte Firebase Auth distinct par entreprise, il ne faut donc
   * jamais créer/toucher le mauvais des deux).
   * 'auth/email-already-in-use' est explicitement toléré et n'interrompt pas le formulaire : soit
   * l'admin modifie un profil existant (compte Firebase déjà là), soit le compte a été créé lors
   * d'une tentative précédente sans que le profil Firestore ait suivi — dans les deux cas on
   * procède quand même à l'écriture/mise à jour du profil Firestore.
   */
  async function createAuthAccount(
    username: string,
    password: string,
    companyId: string | null
  ): Promise<void> {
    await withSecondaryAuth(async (secondaryAuth) => {
      const { createUserWithEmailAndPassword } = await import("firebase/auth");
      try {
        await createUserWithEmailAndPassword(
          secondaryAuth,
          usernameToSyntheticEmail(username, companyId),
          password
        );
      } catch (err) {
        if (isFirebaseErrorCode(err, "auth/email-already-in-use")) return;
        throw err;
      }
    });
  }

  // Contrôle affiché seulement si l'entreprise ciblée a activé une échelle de confidentialité et
  // que le compte n'est pas admin (global ou entreprise, accès total, contrôle sans effet).
  const formCompany = companies.find((c) => c.id === form.companyId);
  const eligibleForClearance = !isAnyAdmin({
    isGlobalAdmin: form.isGlobalAdmin,
    isCompanyAdmin: form.isCompanyAdmin,
  });
  const companyHasLevels = (formCompany?.confidentialityLevels?.length ?? 0) > 0;
  const showClearanceControl = eligibleForClearance && companyHasLevels;
  const showClearanceHint = eligibleForClearance && !companyHasLevels;

  // Suppression destructrice : passe désormais par le backend admin (supprime le compte Firebase
  // Auth ET le profil Firestore, contrairement à l'ancien deleteUser() Firestore-only) et exige une
  // confirmation explicite avant d'agir — déclenchée par le bouton corbeille, résolue par
  // confirmDelete()/l'annulation de la modale.
  const remove = (username: string, companyId: string | null) => {
    setDeleteConfirm({ username, companyId });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { username, companyId } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      const idToken = await getAdminIdToken();
      await deleteUserAccount(idToken, { username, companyId });
      // Même remarque que confirmRename() : subscribeUsers() se met à jour tout seul une fois le
      // document Firestore supprimé côté backend.
      showToast(
        t("adminUsers.deletedTitle", "Utilisateur supprimé"),
        t("adminUsers.deletedBody", "Le compte « {username} » a été supprimé.").replace(
          "{username}",
          username
        ),
        "success"
      );
    } catch (err) {
      setErrorDialog({
        title: t("adminUsers.deleteFailed", "Échec de la suppression"),
        messages: [adminApiErrorMessage(err)],
      });
    }
  };

  /** Résumé compact des profils/habilitations d'un utilisateur pour la colonne "Profils" du
   *  tableau : libellés des profils métier séparés par des virgules, puis badges "Admin" /
   *  "Admin entreprise" quand les flags additifs sont actifs. Vide ("—") si aucun des deux. */
  function profilesSummary(u: AuthUser): {
    profileLabels: string[];
    badges: string[];
    legacyHr: boolean;
  } {
    const profileLabels = (u.profiles ?? []).map((p) => {
      const opt = ALL_ROLE_OPTIONS.find((r) => r.value === p.role);
      return opt ? t(opt.labelKey, opt.label) : p.role;
    });
    const badges: string[] = [];
    if (u.isGlobalAdmin) badges.push(t("adminUsers.badgeAdmin", "Admin"));
    if (u.isCompanyAdmin) badges.push(t("adminUsers.badgeCompanyAdmin", "Admin entreprise"));
    // Profil Directeur RH legacy SANS programme (antérieur à la règle « un programme précis ») :
    // toujours opérant en lecture (lu comme « tous programmes », voir lib/roleProfiles.ts), mais
    // l'enregistrement est refusé tant qu'un programme n'est pas choisi — on le signale.
    const legacyHr = (u.profiles ?? []).some((p) => p.role === "hr" && !p.programId);
    return { profileLabels, badges, legacyHr };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={22} className="text-bp-coral" />
          <h1 className="text-xl font-bold text-text-primary">
            {t("adminUsers.title", "Gestion des Utilisateurs")}
          </h1>
        </div>
        <button
          onClick={() => startCreate()}
          className="flex items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
        >
          <Plus size={14} /> {t("common.add", "Ajouter")}
        </button>
      </div>

      <Modal
        open={showForm}
        onOpenChange={(open) => {
          if (!open) setShowForm(false);
        }}
        title={
          editIdx !== null
            ? t("adminUsers.editTitle", "Modifier l'utilisateur")
            : t("adminUsers.newTitle", "Nouvel utilisateur")
        }
        maxWidth="640px"
        footer={
          <>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
            >
              {t("common.cancel", "Annuler")}
            </button>
            <button
              onClick={save}
              disabled={passwordError !== null || emailError !== null}
              className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("common.save", "Enregistrer")}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          {/* `grid-flow-row-dense` : le bloc mot de passe (pleine largeur, création uniquement) ne
              laisse pas de trou à côté du champ e-mail. */}
          <div className="grid grid-flow-row-dense grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminUsers.fieldUsername", "Identifiant")}{" "}
                <span className="text-rag-red">*</span>
              </label>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder={t("adminUsers.usernamePlaceholder", "prenom.nom")}
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminUsers.fieldFirstName", "Prénom")}
              </label>
              <input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder={t("adminUsers.fieldFirstName", "Prénom")}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminUsers.fieldLastName", "Nom")}
              </label>
              <input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder={t("adminUsers.fieldLastName", "Nom")}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminUsers.fieldDisplayName", "Nom affiché")}{" "}
                <span className="text-rag-red">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder={t("adminUsers.displayNamePlaceholder", "Prénom Nom")}
                required={!form.firstName.trim() && !form.lastName.trim()}
              />
            </div>
            <div className="col-span-2 -mt-2">
              <p className="text-xs text-text-secondary">
                <span className="text-rag-red">*</span>{" "}
                {t(
                  "adminUsers.displayNameHint",
                  "Nom affiché requis, sauf si Prénom et Nom sont tous les deux renseignés."
                )}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminUsers.fieldEmail", "E-mail de contact (optionnel)")}
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className={`mt-1 w-full rounded-lg border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral ${
                  emailError ? "border-rag-red" : "border-border"
                }`}
                placeholder={t("adminUsers.emailPlaceholder", "prenom.nom@entreprise.com")}
                aria-invalid={emailError !== null}
              />
              {emailError && <p className="mt-1 text-xs text-rag-red">{emailError}</p>}
            </div>
            {/* Mot de passe : jamais affiché ni modifiable pour un compte existant (action
                « Réinitialiser le mot de passe » dans la table). En création, lien d'activation
                par défaut ; mot de passe initial temporaire en option (démo / admin-api absent). */}
            {editIdx === null && (
              <div className="col-span-2 rounded-lg border border-border bg-bg-surface p-3">
                <span className="text-xs font-medium text-text-secondary">
                  {t("adminUsers.fieldPassword", "Mot de passe")}
                </span>
                <div className="mt-1.5 space-y-1.5">
                  <label className="flex items-start gap-1.5 text-xs text-text-primary">
                    <input
                      type="radio"
                      name="user-password-mode"
                      checked={form.passwordMode === "link"}
                      onChange={() =>
                        setForm((f) => ({ ...f, passwordMode: "link", password: "" }))
                      }
                    />
                    <span>
                      {t(
                        "adminUsers.passwordModeLink",
                        "Générer un lien pour que l'utilisateur définisse son mot de passe (recommandé)"
                      )}
                    </span>
                  </label>
                  <label className="flex items-start gap-1.5 text-xs text-text-primary">
                    <input
                      type="radio"
                      name="user-password-mode"
                      checked={form.passwordMode === "manual"}
                      onChange={() => setForm((f) => ({ ...f, passwordMode: "manual" }))}
                    />
                    <span>
                      {t(
                        "adminUsers.passwordModeManual",
                        "Définir un mot de passe initial temporaire"
                      )}
                    </span>
                  </label>
                </div>
                {form.passwordMode === "manual" && (
                  <div className="mt-2">
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={form.password}
                      onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                      className={`w-full rounded-lg border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral ${
                        passwordError ? "border-rag-red" : "border-border"
                      }`}
                      aria-label={t("adminUsers.fieldPassword", "Mot de passe")}
                      required
                      aria-invalid={passwordError !== null}
                    />
                    {passwordError && <p className="mt-1 text-xs text-rag-red">{passwordError}</p>}
                  </div>
                )}
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-text-secondary">
                {t("adminUsers.directionLabel", "Direction / service (optionnel)")}
              </label>
              <select
                value={form.direction}
                onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              >
                <option value="">{t("adminUsers.directionUnassigned", "Non renseigné")}</option>
                {(formCompany?.directions ?? []).map((direction) => (
                  <option key={direction} value={direction}>
                    {direction}
                  </option>
                ))}
              </select>
            </div>
            {!form.isGlobalAdmin && !fixedCompanyId && (
              <div>
                <label className="text-xs font-medium text-text-secondary">
                  {t("adminUsers.fieldCompany", "Entreprise")}{" "}
                  <span className="text-rag-red">*</span>
                </label>
                <select
                  value={form.companyId}
                  onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                  required
                >
                  <option value="" disabled>
                    {t("adminUsers.selectCompany", "Sélectionner une entreprise")}
                  </option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Profils métier — round multi-profils multi-programmes : liste répétable, un
              utilisateur peut désormais cumuler plusieurs profils d'une même piste (Plan
              Performance ou Plan Stratégique) tant qu'ils portent sur des programmes distincts
              (voir assertValidProfiles, appelée comme filet de sécurité dans save()). */}
          <div className="rounded-lg border border-border bg-bg-surface p-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">
                {t("adminUsers.profilesLabel", "Profils métier")}
              </label>
              <button
                type="button"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    profiles: [
                      ...f.profiles,
                      { role: "" as unknown as Role, programId: undefined },
                    ],
                  }))
                }
                className="rounded-sm bg-bp-coral/10 px-2 py-0.5 text-xs font-semibold text-bp-coral transition hover:bg-bp-coral/20"
              >
                {t("adminUsers.addProfile", "+ Ajouter un profil")}
              </button>
            </div>
            {form.profiles.length === 0 && (
              <p className="mt-2 text-xs text-text-secondary">
                {t(
                  "adminUsers.noProfiles",
                  "Aucun profil métier — utilisateur purement admin, ou compte de type picker (ex. référence pour un champ owner/sponsor)."
                )}
              </p>
            )}
            <div className="mt-2 space-y-2">
              {form.profiles.map((profile, idx) => {
                // `comex_member` est le seul rôle transverse aux deux pistes (voir
                // CROSS_TRACK_ROLE_OPTIONS ci-dessus) : son picker de programme propose la
                // réunion des programmes Performance ET Stratégique de l'entreprise, plutôt que
                // de retomber arbitrairement sur une seule des deux listes via
                // isStrategicRole/isPerformanceRole (qui renvoient tous deux `true` pour ce rôle).
                const rolePrograms =
                  profile.role && isCrossTrackRole(profile.role)
                    ? [...performancePrograms, ...strategicPrograms]
                    : isStrategicRole(profile.role)
                      ? strategicPrograms
                      : performancePrograms;
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <select
                      value={profile.role}
                      onChange={(e) => {
                        const role = e.target.value as Role | "";
                        setForm((f) => ({
                          ...f,
                          profiles: f.profiles.map((p, i) =>
                            i === idx ? { role: role as Role, programId: undefined } : p
                          ),
                        }));
                      }}
                      className="w-56 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                    >
                      <option value="">{t("adminUsers.chooseRole", "Choisir un rôle")}</option>
                      <optgroup label={t("adminUsers.groupPerformance", "Plan Performance")}>
                        {PERFORMANCE_ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {t(r.labelKey, r.label)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label={t("adminUsers.groupStrategic", "Plan Stratégique")}>
                        {STRATEGIC_ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {t(r.labelKey, r.label)}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup
                        label={t(
                          "adminUsers.groupCrossTrack",
                          "Transverse (Performance + Stratégique)"
                        )}
                      >
                        {CROSS_TRACK_ROLE_OPTIONS.map((r) => (
                          <option
                            key={r.value}
                            value={r.value}
                            // Un seul profil Directeur RH par utilisateur (assertValidProfiles).
                            disabled={
                              r.value === "hr" &&
                              form.profiles.some((p, i) => i !== idx && p.role === "hr")
                            }
                          >
                            {t(r.labelKey, r.label)}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                    {profile.role === "hr" && rolePrograms.length === 0 && (
                      <p className="flex-1 text-xs text-rag-red">
                        {t(
                          "adminUsers.hrNoProgram",
                          "Aucun programme dans l'entreprise : créez d'abord un programme pour y rattacher le Directeur RH."
                        )}
                      </p>
                    )}
                    {profile.role && rolePrograms.length > 0 && (
                      <select
                        value={profile.programId ?? ""}
                        onChange={(e) => {
                          const programId = e.target.value || undefined;
                          setForm((f) => ({
                            ...f,
                            profiles: f.profiles.map((p, i) =>
                              i === idx ? { ...p, programId } : p
                            ),
                          }));
                        }}
                        className="flex-1 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                      >
                        {/* Directeur RH : un programme précis OBLIGATOIRE (assertValidProfiles) —
                            pas d'option « Tous les programmes », seulement une invite à choisir
                            (aussi affichée pour un profil legacy sans programme). */}
                        <option value="" disabled={profile.role === "hr"}>
                          {profile.role === "hr"
                            ? t("adminUsers.chooseProgram", "Choisir un programme")
                            : isCrossTrackRole(profile.role)
                              ? t("adminUsers.allPrograms", "Tous les programmes")
                              : isStrategicRole(profile.role)
                                ? t(
                                    "adminUsers.allProgramsStrategic",
                                    "Tous les programmes Stratégique"
                                  )
                                : t(
                                    "adminUsers.allProgramsPerformance",
                                    "Tous les programmes Performance"
                                  )}
                        </option>
                        {rolePrograms.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          profiles: f.profiles.filter((_, i) => i !== idx),
                        }))
                      }
                      className="text-text-secondary hover:text-rag-red"
                      aria-label={t("adminUsers.removeProfile", "Retirer ce profil")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Habilitations d'administration — additives aux profils métier ci-dessus (round
              multi-profils, voir AuthUser.isGlobalAdmin/isCompanyAdmin). */}
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-bg-surface p-3">
            {!form.isGlobalAdmin && (
              <label className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={form.isCompanyAdmin}
                  disabled={editingPeerAdmin}
                  onChange={(e) => setForm((f) => ({ ...f, isCompanyAdmin: e.target.checked }))}
                />
                {t("adminUsers.companyAdmin", "Administrateur de l'entreprise")}
                {editingPeerAdmin && (
                  <span className="text-[11px] font-normal text-text-secondary">
                    {t(
                      "adminUsers.peerAdminLocked",
                      "(seul un administrateur global peut retirer cette habilitation)"
                    )}
                  </span>
                )}
              </label>
            )}
            {canAssignGlobalAdmin && (
              <label className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                <input
                  type="checkbox"
                  checked={form.isGlobalAdmin}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      isGlobalAdmin: e.target.checked,
                      isCompanyAdmin: e.target.checked ? false : f.isCompanyAdmin,
                    }))
                  }
                />
                {t("adminUsers.globalAdmin", "Administrateur global")}
              </label>
            )}
          </div>

          {showClearanceControl && (
            <div className="rounded-lg border border-border bg-bg-surface p-3">
              <label className="text-xs font-medium text-text-secondary">
                {t("adminUsers.clearanceTitle", "Habilitation de confidentialité (individuelle)")}
              </label>
              <p className="mt-1 text-xs text-text-secondary">
                {t(
                  "adminUsers.clearanceHelp",
                  "Remplace l'habilitation par défaut du rôle pour ce seul utilisateur — dans les deux sens : « Niveau personnalisé » ou « Tous les niveaux » peuvent aussi bien restreindre qu'étendre l'accès au-delà de ce que son rôle donne normalement (ex. donner à un profil « Responsable de levier » l'accès à un niveau confidentiel réservé au CTO)."
                )}
              </p>
              <p className="mt-1.5 text-xs font-medium text-text-secondary">
                {t(
                  "adminUsers.clearanceScopeNote",
                  "Ce réglage contrôle uniquement l'accès aux niveaux confidentiels. Il ne modifie pas le périmètre de base d'un rôle (ex. un Responsable de levier continuera à ne voir que ses propres leviers, même avec « Tous les niveaux »)."
                )}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(
                  [
                    {
                      // Options = échelle de l'entreprise (`formCompany.confidentialityLevels`) ;
                      // le défaut affiche le niveau hérité des rôles saisis (Company.roleClearance).
                      value: "inherit",
                      label: t(
                        "admin.confidentiality.inheritWithLevel",
                        "Hérite du rôle (niveau {level})"
                      ).replace(
                        "{level}",
                        inheritedRoleLevel(
                          form.profiles.filter((p) => p.role),
                          formCompany?.roleClearance,
                          formCompany?.confidentialityLevels ?? []
                        ) ?? t("admin.confidentiality.noLevel", "aucun")
                      ),
                    },
                    { value: "none", label: t("adminUsers.clearanceNone", "Aucun accès") },
                    {
                      value: "custom",
                      label: t("adminUsers.clearanceCustom", "Niveau personnalisé"),
                    },
                    { value: "all", label: t("adminUsers.clearanceAll", "Tous les niveaux") },
                  ] as { value: ClearanceMode; label: string }[]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, clearanceMode: opt.value }))}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      form.clearanceMode === opt.value
                        ? "bg-bp-coral text-white"
                        : "border border-border text-text-secondary hover:bg-bg-elevated"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {form.clearanceMode === "custom" && (
                <div className="mt-3">
                  <div
                    role="radiogroup"
                    aria-label={t("adminUsers.clearanceLevel", "Niveau de confidentialité")}
                    className="flex flex-wrap gap-3"
                  >
                    {(formCompany?.confidentialityLevels ?? []).map((level) => (
                      <label
                        key={level}
                        className="flex items-center gap-1.5 text-xs text-text-primary"
                      >
                        <input
                          type="radio"
                          name="user-clearance-level"
                          checked={form.clearanceLevel === level}
                          onChange={() => setForm((f) => ({ ...f, clearanceLevel: level }))}
                        />
                        {level}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-text-secondary">
                    {t(
                      "adminUsers.clearanceHierarchyNote",
                      "Ce niveau donne aussi accès aux niveaux inférieurs."
                    )}
                  </p>
                </div>
              )}
            </div>
          )}

          {showClearanceHint && (
            <p className="rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-secondary">
              {isEntAdmin && !user?.isGlobalAdmin
                ? t(
                    "adminUsers.clearanceNoLevelsCompany",
                    "Aucun niveau de confidentialité n'est défini pour votre entreprise — contactez BearingPoint pour les mettre en place."
                  )
                : t(
                    "adminUsers.clearanceNoLevels",
                    "Configurez d'abord des niveaux de confidentialité dans l'onglet Paramètres de cette entreprise pour activer ce contrôle."
                  )}
            </p>
          )}
        </div>
      </Modal>

      {!fixedCompanyId && companies.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-text-secondary">
            {t("adminUsers.filterByCompany", "Filtrer par entreprise")}
          </label>
          <MultiSelect
            label={t("adminUsers.fieldCompany", "Entreprise")}
            placeholder={t("adminUsers.allCompanies", "Toutes les entreprises")}
            values={companyFilter}
            onChange={setCompanyFilter}
            options={companies.map((c) => ({ value: c.id, label: c.name }))}
          />
          <span className="text-xs text-text-secondary">
            {t("adminUsers.userCount", "{n} utilisateur(s)").replace(
              "{n}",
              String(users.filter((u) => matchesFilter(u.companyId, companyFilter)).length)
            )}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <label htmlFor="users-status-filter" className="text-xs font-semibold text-text-secondary">
          {t("adminUsers.filterByStatus", "Statut")}
        </label>
        <select
          id="users-status-filter"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as UserStatusFilter)}
          className="rounded-lg border border-border bg-bg-surface px-3 py-1.5 text-xs text-text-primary outline-none focus:border-bp-coral"
        >
          <option value="all">{t("adminUsers.statusAll", "Tous")}</option>
          <option value="active">{t("adminUsers.statusActive", "Actifs")}</option>
          <option value="disabled">{t("adminUsers.statusDisabled", "Désactivés")}</option>
        </select>
      </div>

      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                {t("adminUsers.fieldUsername", "Identifiant")}
              </th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                {t("adminUsers.fieldFirstName", "Prénom")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminUsers.fieldLastName", "Nom")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminUsers.colProfiles", "Profils")}
              </th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                {t("adminUsers.fieldCompany", "Entreprise")}
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">
                {t("adminUsers.colActions", "Actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filterUsersByStatus(users, statusFilter)
              .filter((u) => fixedCompanyId || matchesFilter(u.companyId, companyFilter))
              .map((u, idx) => {
                const { profileLabels, badges, legacyHr } = profilesSummary(u);
                const isDisabled = u.disabled === true;
                return (
                  <tr
                    key={`${u.username}.${u.companyId ?? ""}`}
                    className={`border-b border-border hover:bg-bg-elevated/50 ${
                      isDisabled ? "opacity-60" : ""
                    }`}
                  >
                    <td className="hidden px-4 py-2.5 font-mono text-xs text-text-secondary sm:table-cell">
                      {u.username}
                    </td>
                    <td className="hidden px-4 py-2.5 font-medium text-text-primary sm:table-cell">
                      {u.firstName}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-text-primary">{u.lastName}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {profileLabels.length > 0 ? (
                          <span className="rounded-full bg-bp-coral/10 px-2 py-0.5 text-xs font-semibold text-bp-coral">
                            {profileLabels.join(", ")}
                          </span>
                        ) : (
                          badges.length === 0 && (
                            <span className="text-xs text-text-secondary">—</span>
                          )
                        )}
                        {badges.map((badge) => (
                          <span
                            key={badge}
                            className="rounded-full bg-bg-elevated px-2 py-0.5 text-xs font-semibold text-text-secondary"
                          >
                            {badge}
                          </span>
                        ))}
                        {legacyHr && (
                          <span
                            className="rounded-full bg-rag-amber-light px-2 py-0.5 text-xs font-semibold text-rag-amber"
                            title={t(
                              "adminUsers.legacyHrHint",
                              "Profil Directeur RH sans programme : modifiez l'utilisateur pour choisir son programme."
                            )}
                          >
                            {t("adminUsers.badgeLegacyHr", "RH : programme à choisir")}
                          </span>
                        )}
                        {isDisabled && (
                          <span className="rounded-full bg-rag-red-light px-2 py-0.5 text-xs font-semibold text-rag-red">
                            {t("adminUsers.badgeDisabled", "Désactivé")}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-text-secondary sm:table-cell">
                      {companies.find((c) => c.id === u.companyId)?.name ?? u.companyId ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => startEdit(u, idx)}
                        className="mr-2 text-text-secondary hover:text-bp-coral"
                        aria-label={t("common.edit", "Modifier")}
                      >
                        <Pencil size={14} />
                      </button>
                      {!isDisabled && (
                        <button
                          onClick={() => openResetLink(u)}
                          className="mr-2 text-text-secondary hover:text-bp-coral"
                          aria-label={t(
                            "adminUsers.resetPassword",
                            "Réinitialiser le mot de passe"
                          )}
                          title={t("adminUsers.resetPassword", "Réinitialiser le mot de passe")}
                        >
                          <KeyRound size={14} />
                        </button>
                      )}
                      {!isPeerCompanyAdmin(u) && (
                        <button
                          onClick={() => requestToggleDisabled(u)}
                          className={`mr-2 text-text-secondary ${
                            isDisabled ? "hover:text-rag-green" : "hover:text-rag-red"
                          }`}
                          aria-label={
                            isDisabled
                              ? t("adminUsers.enableUser", "Réactiver")
                              : t("adminUsers.disableUser", "Désactiver")
                          }
                          title={
                            isDisabled
                              ? t("adminUsers.enableUser", "Réactiver")
                              : t("adminUsers.disableUser", "Désactiver")
                          }
                        >
                          <Power size={14} />
                        </button>
                      )}
                      {!isPeerCompanyAdmin(u) && (
                        <button
                          onClick={() => remove(u.username, u.companyId ?? null)}
                          className="text-text-secondary hover:text-rag-red"
                          aria-label={t("common.delete", "Supprimer")}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {/* Erreur prominente : mot de passe invalide (soumission ou rejet Firebase Auth), profils
          invalides (assertValidProfiles), ou échec renvoyé par le backend admin lors d'un
          renommage/suppression. Toujours une modale centrée — jamais un simple toast — pour qu'un
          admin ne puisse pas la manquer. */}
      <Modal
        open={errorDialog !== null}
        onOpenChange={(next) => {
          if (!next) setErrorDialog(null);
        }}
        title={errorDialog?.title ?? ""}
        footer={
          <Button variant="primary" onClick={() => setErrorDialog(null)}>
            OK
          </Button>
        }
      >
        <ul className="list-disc space-y-1 pl-4 text-sm text-rag-red">
          {errorDialog?.messages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      </Modal>

      {/* Confirmation obligatoire avant un renommage — annuler abandonne l'enregistrement sans
          rien envoyer, le formulaire reste tel quel. */}
      <Modal
        open={renameConfirm !== null}
        onOpenChange={(next) => {
          if (!next) setRenameConfirm(null);
        }}
        title={t("adminUsers.confirmRenameTitle", "Renommer l'utilisateur ?")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameConfirm(null)}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button variant="danger" onClick={confirmRename}>
              {t("adminUsers.confirm", "Confirmer")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          {t(
            "adminUsers.confirmRenameBody",
            "Vous vous apprêtez à renommer le compte « {old} » en « {new} ». L'ancien identifiant cessera de fonctionner ; les profils, l'entreprise et les droits associés sont conservés."
          )
            .replace("{old}", renameConfirm?.oldUsername ?? "")
            .replace("{new}", renameConfirm?.newUser.username ?? "")}{" "}
          {t("adminUsers.notReversible", "Cette action n'est pas réversible depuis cet écran.")}
        </p>
      </Modal>

      {/* Confirmation obligatoire avant une suppression, destructrice (compte Firebase Auth +
          profil Firestore). */}
      <Modal
        open={deleteConfirm !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteConfirm(null);
        }}
        title={t("adminUsers.confirmDeleteTitle", "Supprimer l'utilisateur ?")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              {t("common.delete", "Supprimer")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          {t(
            "adminUsers.confirmDeleteBody",
            "Le compte « {username} » sera définitivement supprimé (Firebase Auth et profil). Cette action est irréversible."
          ).replace("{username}", deleteConfirm?.username ?? "")}
        </p>
      </Modal>

      {/* Confirmation avant désactivation / réactivation (compte conservé, historique intact). */}
      <Modal
        open={disableConfirm !== null}
        onOpenChange={(next) => {
          if (!next) setDisableConfirm(null);
        }}
        title={
          disableConfirm?.disabled
            ? t("adminUsers.confirmDisableTitle", "Désactiver l'utilisateur ?")
            : t("adminUsers.confirmEnableTitle", "Réactiver l'utilisateur ?")
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDisableConfirm(null)}>
              {t("common.cancel", "Annuler")}
            </Button>
            <Button
              variant={disableConfirm?.disabled ? "danger" : "primary"}
              onClick={confirmToggleDisabled}
            >
              {disableConfirm?.disabled
                ? t("adminUsers.disableUser", "Désactiver")
                : t("adminUsers.enableUser", "Réactiver")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          {(disableConfirm?.disabled
            ? t(
                "adminUsers.confirmDisableBody",
                "Le compte « {username} » ne pourra plus se connecter et ses sessions ouvertes seront coupées. Le compte et son historique sont conservés ; vous pourrez le réactiver à tout moment."
              )
            : t(
                "adminUsers.confirmEnableBody",
                "Le compte « {username} » pourra de nouveau se connecter avec son mot de passe actuel."
              )
          ).replace("{username}", disableConfirm?.user.username ?? "")}
        </p>
      </Modal>

      {/* Lien de réinitialisation à usage unique — l'admin ne voit ni ne choisit jamais le mot de
          passe. Copie / mailto parce que les e-mails Firebase Auth sont synthétiques et ne
          reçoivent aucun courrier (voir openResetLink). */}
      <Modal
        open={resetLinkDialog !== null}
        onOpenChange={(next) => {
          if (!next) setResetLinkDialog(null);
        }}
        title={
          resetLinkDialog?.isNewAccount
            ? t("adminUsers.resetLinkNewTitle", "Utilisateur créé — lien d'activation")
            : t("adminUsers.resetLinkTitle", "Lien de réinitialisation du mot de passe")
        }
        maxWidth="560px"
        footer={
          <Button variant="primary" onClick={() => setResetLinkDialog(null)}>
            {t("adminUsers.close", "Fermer")}
          </Button>
        }
      >
        {resetLinkDialog && (
          <div className="space-y-3 text-sm text-text-secondary">
            <p>
              {t(
                "adminUsers.resetLinkBody",
                "Transmettez ce lien à « {username} » : il lui permet de définir lui-même son mot de passe. Il est à usage unique et expire après un délai limité. Vous ne voyez jamais le mot de passe."
              ).replace("{username}", resetLinkDialog.username)}
            </p>
            <input
              readOnly
              value={resetLinkDialog.link}
              onFocus={(e) => e.currentTarget.select()}
              aria-label={t("adminUsers.resetLinkLabel", "Lien de réinitialisation")}
              className="w-full rounded-lg border border-border bg-bg-surface px-3 py-2 font-mono text-xs text-text-primary outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={copyResetLink}>
                <Copy size={14} className="mr-1.5 inline" />
                {linkCopied
                  ? t("adminUsers.linkCopied", "Lien copié")
                  : t("adminUsers.copyLink", "Copier le lien")}
              </Button>
              {resetLinkDialog.email && (
                <a
                  href={buildPasswordResetMailto({
                    email: resetLinkDialog.email,
                    displayName: resetLinkDialog.displayName,
                    username: resetLinkDialog.username,
                    link: resetLinkDialog.link,
                  })}
                  className="inline-flex items-center rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
                >
                  <Mail size={14} className="mr-1.5" />
                  {t("adminUsers.sendByEmail", "Envoyer par e-mail à {email}").replace(
                    "{email}",
                    resetLinkDialog.email
                  )}
                </a>
              )}
            </div>
            {!resetLinkDialog.email && (
              <p className="text-xs">
                {t(
                  "adminUsers.resetLinkNoEmail",
                  "Aucun e-mail de contact renseigné pour cet utilisateur : copiez le lien et transmettez-le par un canal sûr."
                )}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
