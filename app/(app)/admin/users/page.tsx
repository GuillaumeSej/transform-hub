"use client";

import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2 } from "lucide-react";
import type { AuthUser, Role, Company } from "@/types";
import { subscribeUsers, saveUser, deleteUser, subscribeCompanies } from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";

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

export default function AdminUsersPage() {
  const { role, user } = useRole();
  const isEntAdmin = role === "admin_entreprise";
  const availableRoles = isEntAdmin ? OPERATIONAL_ROLES : ALL_ROLES;
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeUsers((list) => {
      setUsers(isEntAdmin && user?.companyId ? list.filter((u) => u.companyId === user.companyId) : list);
    });
    return unsub;
  }, [isEntAdmin, user?.companyId]);

  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState({ username: "", firstName: "", lastName: "", name: "", role: "cto" as Role, companyId: "", password: "test" });
  const [showForm, setShowForm] = useState(false);

  const startCreate = () => {
    setEditIdx(null);
    setForm({ username: "", firstName: "", lastName: "", name: "", role: "cto", companyId: isEntAdmin && user?.companyId ? user.companyId : (companies[0]?.id ?? ""), password: "test" });
    setShowForm(true);
  };

  const startEdit = (u: AuthUser, idx: number) => {
    setEditIdx(idx);
    setForm({ username: u.username, firstName: u.firstName ?? "", lastName: u.lastName ?? "", name: u.name, role: u.role, companyId: u.companyId ?? (companies[0]?.id ?? ""), password: u.password });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.username.trim() || (!form.name.trim() && !(`${form.firstName} ${form.lastName}`.trim()))) return;
    const normalizedUsername = form.username.trim().toLowerCase();
    const newUser: AuthUser = {
      username: normalizedUsername,
      password: form.password,
      role: form.role,
      firstName: form.firstName,
      lastName: form.lastName,
      name: form.name || `${form.firstName} ${form.lastName}`.trim(),
      companyId: form.role === "admin" ? null : isEntAdmin && user?.companyId ? user.companyId : form.companyId,
    };
    await saveUser(newUser);
    setShowForm(false);
  };

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
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            {form.role !== "admin" && !isEntAdmin && (
              <div>
                <label className="text-xs font-medium text-text-secondary">Entreprise</label>
                <select
                  value={form.companyId}
                  onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90">
              Enregistrer
            </button>
            <button onClick={() => setShowForm(false)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface">
              Annuler
            </button>
          </div>
        </div>
      )}

      {!isEntAdmin && companies.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-xs font-semibold text-text-secondary">Filtrer par entreprise</label>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            <option value="all">Toutes les entreprises</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <span className="text-xs text-text-secondary">
            {users.filter((u) => companyFilter === "all" || u.companyId === companyFilter).length} utilisateur(s)
          </span>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Identifiant</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Prénom</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Nom</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Rôle</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Entreprise</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users
              .filter((u) => companyFilter === "all" || u.companyId === companyFilter)
              .map((u, idx) => (
              <tr key={u.username} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{u.username}</td>
                <td className="px-4 py-2.5 font-medium text-text-primary">{u.firstName}</td>
                <td className="px-4 py-2.5 font-medium text-text-primary">{u.lastName}</td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-bp-coral/10 px-2 py-0.5 text-xs font-semibold text-bp-coral">
                    {ALL_ROLES.find((r) => r.value === u.role)?.label ?? u.role}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{companies.find((c) => c.id === u.companyId)?.name ?? u.companyId ?? "—"}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => startEdit(u, idx)} className="mr-2 text-text-secondary hover:text-bp-coral">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(u.username)} className="text-text-secondary hover:text-red-500">
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
