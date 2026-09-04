"use client";

import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2 } from "lucide-react";
import type { AuthUser, Role, Company } from "@/types";
import { subscribeUsers, saveUser, deleteUser, subscribeCompanies } from "@/lib/firestore/admin";
import { isFirebaseErrorCode, usernameToSyntheticEmail } from "@/lib/auth";
import { withSecondaryAuth } from "@/lib/firebase";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";

const ALL_ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Administrator" },
  { value: "admin_entreprise", label: "Admin Entreprise" },
  { value: "cto", label: "CTO" },
  { value: "sponsor", label: "Sponsor" },
  { value: "lever", label: "Lever Owner" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "ops", label: "Ops" },
  // ─── Profils du Plan Stratégique (organigramme 3-5-15) ─────────────────────────────────────
  // Libellés littéraux comme les rôles historiques ci-dessus (cet écran d'admin n'est pas
  // traduit) ; les clés i18n `roles.*` correspondantes existent pour la sidebar/topbar.
  { value: "strategic_lead", label: "Pilote du plan stratégique" },
  { value: "axis_sponsor", label: "Sponsor d'axe" },
  { value: "chantier_owner", label: "Responsable de chantier" },
  { value: "chantier_contributor", label: "Contributeur chantier" },
  { value: "internal_comm", label: "Communication interne" },
  { value: "budget_control", label: "Contrôle de gestion" },
];

const OPERATIONAL_ROLES = ALL_ROLES.filter(
  (r) => r.value !== "admin" && r.value !== "admin_entreprise"
);

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
 *  1. admin/admin_entreprise ont un accès total, ce contrôle n'a pas d'effet pour ces rôles.
 *  2. En mode "inherit", la clé `confidentialityClearance` est OMISE (jamais mise à `undefined`) :
 *     Firestore setDoc() rejette toute valeur de champ explicitement `undefined`. L'omettre
 *     produit le même résultat sémantique (repli sur Company.roleClearance[role]) tout en étant
 *     accepté par setDoc, qui remplace le document entier — donc repasser en "Hérite du rôle"
 *     efface bien un override individuel précédemment enregistré.
 */
export function buildClearancePatch(
  role: Role,
  clearanceMode: ClearanceMode,
  clearanceLevels: string[]
): Pick<AuthUser, "confidentialityClearance"> | Record<string, never> {
  if (role === "admin" || role === "admin_entreprise") return {};
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
  role: Role;
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
 *  - Entreprise : requise seulement quand le champ est affiché, càd rôle non-admin ET aucun
 *    `fixedCompanyId` imposé par le contexte (scope du hub `/admin/companies/detail`, ou
 *    admin_entreprise limité à sa propre entreprise sur la page globale).
 *  Rôle n'apparaît jamais dans le résultat : le <select> a toujours une valeur par défaut valide
 *  et ne peut pas être vidé par l'utilisateur.
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
  if (form.role !== "admin" && !fixedCompanyId && !form.companyId.trim()) {
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
  const { role, user } = useRole();
  const { showToast } = useToast();
  const isEntAdmin = role === "admin_entreprise";
  // companyId effectif imposé à ce panneau : soit le scope explicite du hub (global admin gérant
  // une entreprise précise), soit — sans scope — celui d'un admin_entreprise limité à sa propre
  // entreprise (comportement historique de la page globale).
  const fixedCompanyId =
    scopeCompanyId ?? (isEntAdmin ? (user?.companyId ?? undefined) : undefined);
  const availableRoles = isEntAdmin && !scopeCompanyId ? OPERATIONAL_ROLES : ALL_ROLES;
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeUsers((list) => {
      setUsers(fixedCompanyId ? list.filter((u) => u.companyId === fixedCompanyId) : list);
    });
    return unsub;
  }, [fixedCompanyId]);

  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState({
    username: "",
    firstName: "",
    lastName: "",
    name: "",
    role: "cto" as Role,
    companyId: "",
    password: "test",
    clearanceMode: "inherit" as ClearanceMode,
    clearanceLevels: [] as string[],
  });
  const [showForm, setShowForm] = useState(false);

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
    setForm({
      username: "",
      firstName: "",
      lastName: "",
      name: "",
      role: "cto",
      companyId: fixedCompanyId ?? companies[0]?.id ?? "",
      password: "test",
      clearanceMode: "inherit",
      clearanceLevels: [],
    });
    setShowForm(true);
  };

  const startEdit = (u: AuthUser, idx: number) => {
    setEditIdx(idx);
    setForm({
      username: u.username,
      firstName: u.firstName ?? "",
      lastName: u.lastName ?? "",
      name: u.name,
      role: u.role,
      companyId: u.companyId ?? companies[0]?.id ?? "",
      password: u.password,
      clearanceMode: clearanceModeOf(u.confidentialityClearance),
      clearanceLevels: Array.isArray(u.confidentialityClearance) ? u.confidentialityClearance : [],
    });
    setShowForm(true);
  };

  const save = async () => {
    const missing = missingRequiredFields(form, fixedCompanyId);
    if (missing.length > 0) {
      showToast(
        "Champs obligatoires manquants",
        `Merci de renseigner : ${missing.join(", ")}.`,
        "error"
      );
      return;
    }
    const normalizedUsername = form.username.trim().toLowerCase();
    const newUser: AuthUser = {
      username: normalizedUsername,
      password: form.password,
      role: form.role,
      firstName: form.firstName,
      lastName: form.lastName,
      name: form.name || `${form.firstName} ${form.lastName}`.trim(),
      companyId: form.role === "admin" ? null : (fixedCompanyId ?? form.companyId),
      ...buildClearancePatch(form.role, form.clearanceMode, form.clearanceLevels),
    };
    try {
      // Crée le compte Firebase Auth correspondant AVANT d'écrire le profil Firestore — sur une
      // instance Auth SECONDAIRE (voir withSecondaryAuth dans lib/firebase.ts), jamais sur
      // l'instance principale : createUserWithEmailAndPassword connecte automatiquement le
      // navigateur en tant que ce nouvel utilisateur, ce qui déconnecterait l'admin de sa propre
      // session s'il l'appelait sur l'instance principale.
      await createAuthAccount(normalizedUsername, form.password);
      await saveUser(newUser);
      setShowForm(false);
    } catch (err) {
      showToast(
        "Échec de l'enregistrement",
        err instanceof Error ? err.message : "Erreur inconnue",
        "error"
      );
    }
  };

  /**
   * Crée le compte Firebase Auth d'un utilisateur d'entreprise (e-mail synthétique dérivé du
   * username saisi). 'auth/email-already-in-use' est explicitement toléré et n'interrompt pas le
   * formulaire : soit l'admin modifie un profil existant (compte Firebase déjà là), soit le
   * compte a été créé lors d'une tentative précédente sans que le profil Firestore ait suivi —
   * dans les deux cas on procède quand même à l'écriture/mise à jour du profil Firestore.
   */
  async function createAuthAccount(username: string, password: string): Promise<void> {
    await withSecondaryAuth(async (secondaryAuth) => {
      const { createUserWithEmailAndPassword } = await import("firebase/auth");
      try {
        await createUserWithEmailAndPassword(
          secondaryAuth,
          usernameToSyntheticEmail(username),
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
  // que le rôle sélectionné n'est pas admin/admin_entreprise (accès total, contrôle sans effet).
  const formCompany = companies.find((c) => c.id === form.companyId);
  const eligibleRole = form.role !== "admin" && form.role !== "admin_entreprise";
  const companyHasLevels = (formCompany?.confidentialityLevels?.length ?? 0) > 0;
  const showClearanceControl = eligibleRole && companyHasLevels;
  const showClearanceHint = eligibleRole && !companyHasLevels;

  const remove = async (username: string) => {
    await deleteUser(username);
  };

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
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="test"
                required
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Rôle <span className="text-red-500">*</span>
              </label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                required
              >
                {availableRoles.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {form.role !== "admin" && !fixedCompanyId && (
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
              className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90"
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
                Rôle
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
              .map((u, idx) => (
                <tr key={u.username} className="border-b border-border hover:bg-bg-elevated/50">
                  <td className="hidden px-4 py-2.5 font-mono text-xs text-text-secondary sm:table-cell">
                    {u.username}
                  </td>
                  <td className="hidden px-4 py-2.5 font-medium text-text-primary sm:table-cell">
                    {u.firstName}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-text-primary">{u.lastName}</td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-bp-coral/10 px-2 py-0.5 text-xs font-semibold text-bp-coral">
                      {ALL_ROLES.find((r) => r.value === u.role)?.label ?? u.role}
                    </span>
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
                      onClick={() => remove(u.username)}
                      className="text-text-secondary hover:text-red-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
