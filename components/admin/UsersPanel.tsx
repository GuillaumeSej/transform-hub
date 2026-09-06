"use client";

import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2 } from "lucide-react";
import type { AuthUser, Role, Company, Program, ProfileAssignment } from "@/types";
import {
  subscribeUsers,
  saveUser,
  subscribeCompanies,
  subscribePrograms,
} from "@/lib/firestore/admin";
import { isFirebaseErrorCode, usernameToSyntheticEmail } from "@/lib/auth";
import { withSecondaryAuth, getAuthInstance } from "@/lib/firebase";
import { renameUser, deleteUserAccount, AdminApiError } from "@/lib/adminApi";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Modal } from "@/components/shared/Modal";
import { Button } from "@/components/shared/Button";
import {
  isAnyAdmin,
  getPerformanceProfile,
  getStrategicProfile,
  assertValidProfiles,
} from "@/lib/roleProfiles";
import { resolveProgramType } from "@/lib/axisLogic";

/** Longueur minimale du mot de passe — DOIT rester alignée sur la politique de Firebase Auth
 *  (aucune autre règle par défaut ; un mot de passe plus court est rejeté avec `auth/weak-password`
 *  à la création du compte). Utilisée à la fois pour la validation temps réel du formulaire et pour
 *  le message affiché quand Firebase Auth rejette lui-même le mot de passe côté serveur. */
export const MIN_PASSWORD_LENGTH = 6;

const PASSWORD_TOO_SHORT_MESSAGE = `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`;

/** Libellés FR des 6 rôles du Plan Performance (round historique) — cet écran d'admin n'est pas
 *  traduit, mêmes libellés littéraux que les rôles du Plan Stratégique ci-dessous. */
const PERFORMANCE_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "cto", label: "CTO" },
  { value: "sponsor", label: "Sponsor" },
  { value: "lever", label: "Lever Owner" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "ops", label: "Ops" },
];

/** Libellés FR des 6 profils du Plan Stratégique (organigramme 3-5-15) — les clés i18n `roles.*`
 *  correspondantes existent séparément pour la sidebar/topbar. */
const STRATEGIC_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "strategic_lead", label: "Pilote du plan stratégique" },
  { value: "axis_sponsor", label: "Sponsor d'axe" },
  { value: "chantier_owner", label: "Responsable de chantier" },
  { value: "chantier_contributor", label: "Contributeur chantier" },
  { value: "internal_comm", label: "Communication interne" },
  { value: "budget_control", label: "Contrôle de gestion" },
];

/** Réunion des deux listes ci-dessus — sert uniquement à retrouver le libellé d'un `Role` donné
 *  (table des utilisateurs), jamais comme source d'options d'un unique `<select>` (round
 *  multi-profils : il y a désormais deux pickers indépendants, un par type). */
const ALL_ROLE_OPTIONS = [...PERFORMANCE_ROLE_OPTIONS, ...STRATEGIC_ROLE_OPTIONS];

/** Les 4 états sémantiques de AuthUser.confidentialityClearance (voir types/index.ts) : */
type ClearanceMode = "inherit" | "none" | "custom" | "all";

function clearanceModeOf(clearance: AuthUser["confidentialityClearance"]): ClearanceMode {
  if (clearance === undefined) return "inherit";
  if (clearance === "all") return "all";
  return clearance.length === 0 ? "none" : "custom";
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
  clearanceLevels: string[]
): Pick<AuthUser, "confidentialityClearance"> | Record<string, never> {
  if (isAdmin) return {};
  if (clearanceMode === "all") return { confidentialityClearance: "all" };
  if (clearanceMode === "none") return { confidentialityClearance: [] };
  if (clearanceMode === "custom") return { confidentialityClearance: clearanceLevels };
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
};

/**
 * Détermine les libellés des champs obligatoires manquants du formulaire utilisateur — à vérifier
 * AVANT tout appel Firebase Auth/Firestore dans save(). Fonction pure (testable sans
 * React/Firestore), même logique d'extraction que buildClearancePatch ci-dessus.
 *  - Identifiant : toujours requis.
 *  - Nom affiché OU Prénom + Nom : l'un des deux doit être renseigné (le second sert de repli à
 *    l'écriture du champ `name`, voir save()).
 *  - Mot de passe : toujours requis — pré-rempli à "test" par défaut, mais ne doit pas pouvoir
 *    être vidé puis enregistré.
 *  - Entreprise : requise seulement quand le champ est affiché, càd compte non-admin-global ET
 *    aucun `fixedCompanyId` imposé par le contexte (scope du hub `/admin/companies/detail`, ou
 *    admin_entreprise limité à sa propre entreprise sur la page globale).
 *  Les profils métier (Plan Performance / Plan Stratégique) n'apparaissent jamais dans le
 *  résultat : les deux pickers sont toujours optionnels (0 à 2 profils).
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
  if (!form.password.trim()) missing.push("Mot de passe");
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
export function UsersPanel({ scopeCompanyId }: { scopeCompanyId?: string } = {}) {
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

  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState({
    username: "",
    firstName: "",
    lastName: "",
    name: "",
    // Profils métier — round multi-profils : deux pickers indépendants ("" = aucun profil de ce
    // type), au lieu de l'ancien `role: Role` unique.
    performanceRole: "" as Role | "",
    performanceProgramId: "",
    strategicRole: "" as Role | "",
    strategicProgramId: "",
    isGlobalAdmin: false,
    isCompanyAdmin: false,
    companyId: "",
    password: "test",
    clearanceMode: "inherit" as ClearanceMode,
    clearanceLevels: [] as string[],
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
  // Idem pour le mot de passe : en édition, le champ est pré-rempli avec le mot de passe RÉEL de
  // l'utilisateur (pas un défaut factice) — on ne veut envoyer `newPassword` au backend que si
  // l'admin l'a explicitement modifié pendant cette édition, jamais renvoyer la valeur inchangée.
  const [passwordTouched, setPasswordTouched] = useState(false);

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
  const passwordError =
    form.password.length < MIN_PASSWORD_LENGTH ? PASSWORD_TOO_SHORT_MESSAGE : null;

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

  const startCreate = () => {
    setEditIdx(null);
    setOriginalUsername(null);
    setPasswordTouched(false);
    setForm({
      username: "",
      firstName: "",
      lastName: "",
      name: "",
      performanceRole: "",
      performanceProgramId: "",
      strategicRole: "",
      strategicProgramId: "",
      isGlobalAdmin: false,
      isCompanyAdmin: false,
      companyId: fixedCompanyId ?? companies[0]?.id ?? "",
      password: "test",
      clearanceMode: "inherit",
      clearanceLevels: [],
      direction: "",
    });
    setShowForm(true);
  };

  const startEdit = (u: AuthUser, idx: number) => {
    setEditIdx(idx);
    setOriginalUsername(u.username);
    setPasswordTouched(false);
    const perfProfile = getPerformanceProfile(u);
    const stratProfile = getStrategicProfile(u);
    setForm({
      username: u.username,
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      name: u.name,
      performanceRole: perfProfile?.role ?? "",
      performanceProgramId: perfProfile?.programId ?? "",
      strategicRole: stratProfile?.role ?? "",
      strategicProgramId: stratProfile?.programId ?? "",
      isGlobalAdmin: !!u.isGlobalAdmin,
      isCompanyAdmin: !!u.isCompanyAdmin,
      companyId: u.companyId ?? companies[0]?.id ?? "",
      password: u.password,
      clearanceMode: clearanceModeOf(u.confidentialityClearance),
      clearanceLevels: Array.isArray(u.confidentialityClearance) ? u.confidentialityClearance : [],
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
      },
      fixedCompanyId
    );
    if (missing.length > 0) {
      showToast(
        "Champs obligatoires manquants",
        `Merci de renseigner : ${missing.join(", ")}.`,
        "error"
      );
      return;
    }
    // Le mot de passe est déjà couvert par missingRequiredFields (vide) ; ici on bloque en plus
    // un mot de passe non-vide mais trop court — affiché en temps réel sous le champ, et rappelé
    // ici dans une modale impossible à manquer si l'admin a quand même cliqué Enregistrer.
    if (passwordError) {
      setErrorDialog({ title: "Mot de passe invalide", messages: [passwordError] });
      return;
    }

    // Construction des profils métier à partir des deux pickers indépendants — structurellement
    // au plus un profil Plan Performance + un profil Plan Stratégique (deux `<select>` séparés ne
    // peuvent pas produire deux profils du même type). `assertValidProfiles` reste appelée comme
    // filet de sécurité avant tout enregistrement (voir lib/roleProfiles.ts).
    const profiles: ProfileAssignment[] = [];
    if (form.performanceRole) {
      profiles.push({
        role: form.performanceRole,
        ...(form.performanceProgramId ? { programId: form.performanceProgramId } : {}),
      });
    }
    if (form.strategicRole) {
      profiles.push({
        role: form.strategicRole,
        ...(form.strategicProgramId ? { programId: form.strategicProgramId } : {}),
      });
    }
    try {
      assertValidProfiles(profiles);
    } catch (err) {
      setErrorDialog({
        title: "Profils invalides",
        messages: [err instanceof Error ? err.message : "Erreur inconnue"],
      });
      return;
    }

    const normalizedUsername = form.username.trim().toLowerCase();
    const companyId = form.isGlobalAdmin ? null : (fixedCompanyId ?? form.companyId);
    const newUser: AuthUser = {
      username: normalizedUsername,
      password: form.password,
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
        form.clearanceLevels
      ),
      // "" (non renseigné) omet la clé plutôt que de la mettre à `undefined` — même précaution que
      // buildClearancePatch en mode "inherit" : Firestore setDoc() rejette toute valeur de champ
      // explicitement `undefined`, et setDoc remplace le document entier, donc omettre la clé ici
      // efface bien un `direction` précédemment enregistré si l'admin repasse à "Non renseigné".
      ...(form.direction.trim() !== "" ? { direction: form.direction.trim() } : {}),
    };

    const isEditingExisting = editIdx !== null && originalUsername !== null;
    const usernameChanged = isEditingExisting && normalizedUsername !== originalUsername;

    // Renommer un utilisateur existant touche Firebase Auth (l'identifiant technique en dépend,
    // voir usernameToSyntheticEmail) : ça ne peut pas être un simple setDoc Firestore, ça doit
    // passer par le backend admin — et ça exige une confirmation explicite avant d'agir (voir
    // renameConfirm plus bas, résolu par confirmRename()/l'annulation de la modale).
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
          "Échec de l'enregistrement",
          err instanceof Error ? err.message : "Erreur inconnue",
          "error"
        );
      }
      return;
    }

    // Création d'un nouvel utilisateur — comportement inchangé.
    try {
      // Crée le compte Firebase Auth correspondant AVANT d'écrire le profil Firestore — sur une
      // instance Auth SECONDAIRE (voir withSecondaryAuth dans lib/firebase.ts), jamais sur
      // l'instance principale : createUserWithEmailAndPassword connecte automatiquement le
      // navigateur en tant que ce nouvel utilisateur, ce qui déconnecterait l'admin de sa propre
      // session s'il l'appelait sur l'instance principale.
      await createAuthAccount(normalizedUsername, form.password, newUser.companyId ?? null);
      await saveUser(newUser);
      setShowForm(false);
    } catch (err) {
      if (isFirebaseErrorCode(err, "auth/weak-password")) {
        setErrorDialog({ title: "Mot de passe invalide", messages: [PASSWORD_TOO_SHORT_MESSAGE] });
        return;
      }
      showToast(
        "Échec de l'enregistrement",
        err instanceof Error ? err.message : "Erreur inconnue",
        "error"
      );
    }
  };

  /** Message d'erreur lisible à partir d'une erreur du backend admin (AdminApiError, dont
   *  `.message` est déjà une chaîne française prête à afficher) ou de toute autre exception. */
  function adminApiErrorMessage(err: unknown): string {
    if (err instanceof AdminApiError) return err.message;
    return err instanceof Error ? err.message : "Erreur inconnue";
  }

  /** Récupère le jeton d'ID de l'admin CONNECTÉ (session principale, jamais l'auth secondaire
   *  utilisée pour créer des comptes — voir withSecondaryAuth) : ce sont bien les appels du backend
   *  admin qui doivent s'authentifier comme l'admin agissant, pas comme l'utilisateur ciblé. */
  async function getAdminIdToken(): Promise<string> {
    const current = getAuthInstance().currentUser;
    if (!current) {
      throw new AdminApiError(
        "unauthenticated",
        "Session administrateur expirée — merci de vous reconnecter."
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
        newPassword: passwordTouched ? newUser.password : undefined,
      });
      // subscribeUsers() est un onSnapshot Firestore : le renommage écrit par le backend admin
      // (nouveau document, ancien supprimé) redéclenche l'abonnement tout seul — rien à refaire ici.
      setShowForm(false);
      showToast(
        "Utilisateur renommé",
        `Le compte « ${oldUsername} » a été renommé en « ${newUser.username} ».`,
        "success"
      );
    } catch (err) {
      setErrorDialog({ title: "Échec du renommage", messages: [adminApiErrorMessage(err)] });
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

  const toggleClearanceLevel = (level: string) => {
    setForm((f) => ({
      ...f,
      clearanceLevels: f.clearanceLevels.includes(level)
        ? f.clearanceLevels.filter((l) => l !== level)
        : [...f.clearanceLevels, level],
    }));
  };

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
      showToast("Utilisateur supprimé", `Le compte « ${username} » a été supprimé.`, "success");
    } catch (err) {
      setErrorDialog({ title: "Échec de la suppression", messages: [adminApiErrorMessage(err)] });
    }
  };

  /** Résumé compact des profils/habilitations d'un utilisateur pour la colonne "Profils" du
   *  tableau : libellés des profils métier séparés par des virgules, puis badges "Admin" /
   *  "Admin entreprise" quand les flags additifs sont actifs. Vide ("—") si aucun des deux. */
  function profilesSummary(u: AuthUser): { profileLabels: string[]; badges: string[] } {
    const profileLabels = (u.profiles ?? []).map(
      (p) => ALL_ROLE_OPTIONS.find((r) => r.value === p.role)?.label ?? p.role
    );
    const badges: string[] = [];
    if (u.isGlobalAdmin) badges.push("Admin");
    if (u.isCompanyAdmin) badges.push("Admin entreprise");
    return { profileLabels, badges };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users size={22} className="text-bp-coral" />
          <h1 className="text-xl font-bold text-text-primary">Gestion des Utilisateurs</h1>
        </div>
        <button
          onClick={startCreate}
          className="flex items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
        >
          <Plus size={14} /> Ajouter
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-bg-elevated p-4 space-y-3">
          <div className="text-sm font-semibold text-text-primary">
            {editIdx !== null ? "Modifier l'utilisateur" : "Nouvel utilisateur"}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Identifiant <span className="text-red-500">*</span>
              </label>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="prenom.nom"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Prénom</label>
              <input
                value={form.firstName}
                onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Prénom"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Nom</label>
              <input
                value={form.lastName}
                onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Nom"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Nom affiché <span className="text-red-500">*</span>
              </label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Prénom Nom"
                required={!form.firstName.trim() && !form.lastName.trim()}
              />
            </div>
            <div className="col-span-2 -mt-2">
              <p className="text-xs text-text-secondary">
                <span className="text-red-500">*</span> Nom affiché requis, sauf si Prénom et Nom
                sont tous les deux renseignés.
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Mot de passe <span className="text-red-500">*</span>
              </label>
              <input
                value={form.password}
                onChange={(e) => {
                  setForm((f) => ({ ...f, password: e.target.value }));
                  setPasswordTouched(true);
                }}
                className={`mt-1 w-full rounded-lg border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral ${
                  passwordError ? "border-red-500" : "border-border"
                }`}
                placeholder="test"
                required
                aria-invalid={passwordError !== null}
              />
              {passwordError && <p className="mt-1 text-xs text-red-500">{passwordError}</p>}
            </div>
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
                  Entreprise <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.companyId}
                  onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                  required
                >
                  <option value="" disabled>
                    Sélectionner une entreprise
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

          {/* Profils métier — round multi-profils : deux pickers indépendants, chacun optionnel
              ("Aucun" + les 6 rôles du type concerné). Structurellement au plus un profil par
              type, donc pas de validation supplémentaire nécessaire côté UI (voir
              assertValidProfiles, appelée comme filet de sécurité dans save()). */}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-bg-surface p-3">
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Profil Plan Performance
              </label>
              <select
                value={form.performanceRole}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    performanceRole: e.target.value as Role | "",
                    performanceProgramId: "",
                  }))
                }
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              >
                <option value="">Aucun</option>
                {PERFORMANCE_ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              {form.performanceRole && performancePrograms.length > 0 && (
                <select
                  value={form.performanceProgramId}
                  onChange={(e) => setForm((f) => ({ ...f, performanceProgramId: e.target.value }))}
                  className="mt-2 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                >
                  <option value="">Tous les programmes Performance</option>
                  {performancePrograms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Profil Plan Stratégique
              </label>
              <select
                value={form.strategicRole}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    strategicRole: e.target.value as Role | "",
                    strategicProgramId: "",
                  }))
                }
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              >
                <option value="">Aucun</option>
                {STRATEGIC_ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
              {form.strategicRole && strategicPrograms.length > 0 && (
                <select
                  value={form.strategicProgramId}
                  onChange={(e) => setForm((f) => ({ ...f, strategicProgramId: e.target.value }))}
                  className="mt-2 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                >
                  <option value="">Tous les programmes Stratégique</option>
                  {strategicPrograms.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
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
                  onChange={(e) => setForm((f) => ({ ...f, isCompanyAdmin: e.target.checked }))}
                />
                Administrateur de l&apos;entreprise
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
                Administrateur global
              </label>
            )}
          </div>

          {showClearanceControl && (
            <div className="rounded-lg border border-border bg-bg-surface p-3">
              <label className="text-xs font-medium text-text-secondary">
                Habilitation de confidentialité (individuelle)
              </label>
              <p className="mt-1 text-xs text-text-secondary">
                Remplace l&apos;habilitation par défaut du rôle pour ce seul utilisateur — dans les
                deux sens : « Accès personnalisé » ou « Tous les niveaux » peuvent aussi bien
                restreindre qu&apos;étendre l&apos;accès au-delà de ce que son rôle donne
                normalement (ex. donner à un profil « Lever Owner » l&apos;accès à un niveau
                confidentiel réservé au CTO).
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {(
                  [
                    { value: "inherit", label: "Hérite du rôle" },
                    { value: "none", label: "Aucun accès" },
                    { value: "custom", label: "Accès personnalisé" },
                    { value: "all", label: "Tous les niveaux" },
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
                <div className="mt-3 flex flex-wrap gap-3">
                  {(formCompany?.confidentialityLevels ?? []).map((level) => (
                    <label
                      key={level}
                      className="flex items-center gap-1.5 text-xs text-text-primary"
                    >
                      <input
                        type="checkbox"
                        checked={form.clearanceLevels.includes(level)}
                        onChange={() => toggleClearanceLevel(level)}
                      />
                      {level}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {showClearanceHint && (
            <p className="rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-secondary">
              Configurez d&apos;abord des niveaux de confidentialité dans l&apos;onglet Paramètres
              de cette entreprise pour activer ce contrôle.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={passwordError !== null}
              className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enregistrer
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {!fixedCompanyId && companies.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-text-secondary">
            Filtrer par entreprise
          </label>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            <option value="all">Toutes les entreprises</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-text-secondary">
            {users.filter((u) => companyFilter === "all" || u.companyId === companyFilter).length}{" "}
            utilisateur(s)
          </span>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                Identifiant
              </th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                Prénom
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Nom
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Profils
              </th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                Entreprise
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {users
              .filter(
                (u) => fixedCompanyId || companyFilter === "all" || u.companyId === companyFilter
              )
              .map((u, idx) => {
                const { profileLabels, badges } = profilesSummary(u);
                return (
                  <tr
                    key={`${u.username}.${u.companyId ?? ""}`}
                    className="border-b border-border hover:bg-bg-elevated/50"
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
                      </div>
                    </td>
                    <td className="hidden px-4 py-2.5 text-text-secondary sm:table-cell">
                      {companies.find((c) => c.id === u.companyId)?.name ?? u.companyId ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => startEdit(u, idx)}
                        className="mr-2 text-text-secondary hover:text-bp-coral"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => remove(u.username, u.companyId ?? null)}
                        className="text-text-secondary hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
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
        <ul className="list-disc space-y-1 pl-4 text-sm text-red-600">
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
        title="Renommer l'utilisateur ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameConfirm(null)}>
              Annuler
            </Button>
            <Button variant="danger" onClick={confirmRename}>
              Confirmer
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Vous vous apprêtez à renommer le compte «&nbsp;{renameConfirm?.oldUsername}&nbsp;» en «
          &nbsp;{renameConfirm?.newUser.username}&nbsp;». L&apos;ancien identifiant cessera de
          fonctionner ; les profils, l&apos;entreprise et les droits associés sont conservés. Cette
          action n&apos;est pas réversible depuis cet écran.
        </p>
      </Modal>

      {/* Confirmation obligatoire avant une suppression, destructrice (compte Firebase Auth +
          profil Firestore). */}
      <Modal
        open={deleteConfirm !== null}
        onOpenChange={(next) => {
          if (!next) setDeleteConfirm(null);
        }}
        title="Supprimer l'utilisateur ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>
              Annuler
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Supprimer
            </Button>
          </>
        }
      >
        <p className="text-sm text-text-secondary">
          Le compte «&nbsp;{deleteConfirm?.username}&nbsp;» sera définitivement supprimé (Firebase
          Auth et profil). Cette action est irréversible.
        </p>
      </Modal>
    </div>
  );
}
