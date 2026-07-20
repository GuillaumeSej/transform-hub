"use client";

import { useEffect, useState } from "react";
import { Users, Plus, Pencil, Trash2 } from "lucide-react";
import type { AuthUser, Role, Company } from "@/types";
import { subscribeUsers, saveUser, deleteUser, subscribeCompanies } from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";

const ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Administrator" },
  { value: "admin_entreprise", label: "Admin Entreprise" },
  { value: "cto", label: "CTO" },
  { value: "sponsor", label: "Sponsor" },
  { value: "lever", label: "Lever Owner" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "ops", label: "Ops" },
];

export default function AdminUsersPage() {
  const { role, user } = useRole();
  const isEntAdmin = role === "admin_entreprise";
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

  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [form, setForm] = useState({ username: "", name: "", role: "cto" as Role, companyId: "c1", password: "test" });
  const [showForm, setShowForm] = useState(false);

  const startCreate = () => {
    setEditIdx(null);
    setForm({ username: "", name: "", role: "cto", companyId: isEntAdmin && user?.companyId ? user.companyId : "c1", password: "test" });
    setShowForm(true);
  };

  const startEdit = (u: AuthUser, idx: number) => {
    setEditIdx(idx);
    setForm({ username: u.username, name: u.name, role: u.role, companyId: u.companyId ?? "c1", password: u.password });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.username.trim() || !form.name.trim()) return;
    const newUser: AuthUser = {
      username: form.username,
      password: form.password,
      role: form.role,
      name: form.name,
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
                {ROLES.map((r) => (
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

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Identifiant</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Nom</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Rôle</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Entreprise</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, idx) => (
              <tr key={u.username} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{u.username}</td>
                <td className="px-4 py-2.5 font-medium text-text-primary">{u.name}</td>
                <td className="px-4 py-2.5">
                  <span className="rounded-full bg-bp-coral/10 px-2 py-0.5 text-xs font-semibold text-bp-coral">
                    {ROLES.find((r) => r.value === u.role)?.label ?? u.role}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{u.companyId ?? "—"}</td>
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
