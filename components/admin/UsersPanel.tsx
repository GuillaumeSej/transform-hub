"use client";

import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2 } from "lucide-react";
import type { AuthUser, Role, Company } from "@/types";
import { subscribeUsers, saveUser, deleteUser, subscribeCompanies } from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";

const ALL_ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Administrator" },
  { value: "admin_entreprise", label: "Admin Entreprise" },
  { value: "cto", label: "CTO" },
  { value: "sponsor", label: "Sponsor" },
  { value: "lever", label: "Lever Owner" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "ops", label: "Ops" },
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
    if (
      !form.username.trim() ||
      (!form.name.trim() && !`${form.firstName} ${form.lastName}`.trim())
    )
      return;
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
              <label className="text-xs font-medium text-text-secondary">Identifiant</label>
              <input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="prenom.nom"
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
              <label className="text-xs font-medium text-text-secondary">Nom affiché</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Prénom Nom"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Mot de passe</label>
              <input
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="test"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Rôle</label>
              <select
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
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
                <label className="text-xs font-medium text-text-secondary">Entreprise</label>
                <select
                  value={form.companyId}
                  onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                >
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
