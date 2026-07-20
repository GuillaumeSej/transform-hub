"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, Pencil, Trash2 } from "lucide-react";
import type { Company } from "@/types";
import { subscribeCompanies, saveCompany, deleteCompany } from "@/lib/firestore/admin";

export default function AdminCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies);
    return unsub;
  }, []);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", industry: "", fyStart: "2026-01-01", fyEnd: "2026-12-31" });
  const [showForm, setShowForm] = useState(false);

  const startCreate = () => {
    setEditId(null);
    setForm({ name: "", industry: "", fyStart: "2026-01-01", fyEnd: "2026-12-31" });
    setShowForm(true);
  };

  const startEdit = (c: Company) => {
    setEditId(c.id);
    setForm({ name: c.name, industry: c.industry, fyStart: c.fyStart, fyEnd: c.fyEnd });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    if (editId) {
      const existing = companies.find((c) => c.id === editId);
      if (existing) {
        await saveCompany({ ...existing, name: form.name, industry: form.industry, fyStart: form.fyStart, fyEnd: form.fyEnd });
      }
    } else {
      const id = `c${Date.now()}`;
      await saveCompany({ id, name: form.name, industry: form.industry, createdAt: new Date().toISOString().slice(0, 10), fyStart: form.fyStart, fyEnd: form.fyEnd });
    }
    setShowForm(false);
  };

  const remove = async (id: string) => {
    await deleteCompany(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Building2 size={22} className="text-bp-coral" />
          <h1 className="text-xl font-bold text-text-primary">Gestion des Entreprises</h1>
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
            {editId ? "Modifier l'entreprise" : "Nouvelle entreprise"}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary">Nom</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Nom de l'entreprise"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Secteur</label>
              <input
                value={form.industry}
                onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Industrie / Secteur"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Début exercice</label>
              <input
                type="date"
                value={form.fyStart}
                onChange={(e) => setForm((f) => ({ ...f, fyStart: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Fin exercice</label>
              <input
                type="date"
                value={form.fyEnd}
                onChange={(e) => setForm((f) => ({ ...f, fyEnd: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              />
            </div>
          </div>
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

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">ID</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Nom</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Secteur</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Créé le</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{c.id}</td>
                <td className="px-4 py-2.5 font-medium text-text-primary">{c.name}</td>
                <td className="px-4 py-2.5 text-text-secondary">{c.industry}</td>
                <td className="px-4 py-2.5 text-text-secondary">{c.createdAt}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => startEdit(c)} className="mr-2 text-text-secondary hover:text-bp-coral">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(c.id)} className="text-text-secondary hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {companies.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-text-secondary">
                  Aucune entreprise enregistrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
