"use client";

import { useState } from "react";
import { FolderKanban, Plus, Pencil, Trash2 } from "lucide-react";
import type { Project } from "@/types";

const DEMO_PROJECTS: Project[] = [
  { id: "p1", companyId: "c1", name: "Transformation 2026", sponsor: "CEO Acme", target: 50, currency: "€M", fyStart: "2026-01", fyEnd: "2026-12", baselineEBIT: 120, revenue: 800, createdAt: "2026-01-20" },
  { id: "p2", companyId: "c2", name: "GlobalTech Cost Program", sponsor: "CFO GT", target: 30, currency: "€M", fyStart: "2026-01", fyEnd: "2026-12", baselineEBIT: 90, revenue: 500, createdAt: "2026-02-15" },
  { id: "p3", companyId: "c3", name: "EuroFinance Efficiency", sponsor: "COO EF", target: 20, currency: "€M", fyStart: "2026-01", fyEnd: "2026-12", baselineEBIT: 60, revenue: 300, createdAt: "2026-03-10" },
];

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<Project[]>(DEMO_PROJECTS);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ companyId: "c1", name: "", sponsor: "", target: "" });
  const [showForm, setShowForm] = useState(false);

  const startCreate = () => {
    setEditId(null);
    setForm({ companyId: "c1", name: "", sponsor: "", target: "" });
    setShowForm(true);
  };

  const startEdit = (p: Project) => {
    setEditId(p.id);
    setForm({ companyId: p.companyId, name: p.name, sponsor: p.sponsor, target: String(p.target) });
    setShowForm(true);
  };

  const save = () => {
    if (!form.name.trim()) return;
    const target = parseFloat(form.target) || 0;
    if (editId) {
      setProjects((prev) =>
        prev.map((p) =>
          p.id === editId ? { ...p, name: form.name, sponsor: form.sponsor, target, companyId: form.companyId } : p
        )
      );
    } else {
      const id = `p${Date.now()}`;
      setProjects((prev) => [
        ...prev,
        { id, companyId: form.companyId, name: form.name, sponsor: form.sponsor, target, currency: "€M", fyStart: "2026-01", fyEnd: "2026-12", baselineEBIT: 0, revenue: 0, createdAt: new Date().toISOString().slice(0, 10) },
      ]);
    }
    setShowForm(false);
  };

  const remove = (id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderKanban size={22} className="text-bp-coral" />
          <h1 className="text-xl font-bold text-text-primary">Gestion des Projets</h1>
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
            {editId ? "Modifier le projet" : "Nouveau projet"}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-text-secondary">Entreprise</label>
              <select
                value={form.companyId}
                onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              >
                <option value="c1">Acme Corp</option>
                <option value="c2">GlobalTech</option>
                <option value="c3">EuroFinance</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Nom du projet</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Nom"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Sponsor</label>
              <input
                value={form.sponsor}
                onChange={(e) => setForm((f) => ({ ...f, sponsor: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Sponsor"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Cible (€M)</label>
              <input
                type="number"
                value={form.target}
                onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="50"
              />
            </div>
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
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">ID</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Projet</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Entreprise</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">Sponsor</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">Cible</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">Actions</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{p.id}</td>
                <td className="px-4 py-2.5 font-medium text-text-primary">{p.name}</td>
                <td className="px-4 py-2.5 text-text-secondary">{p.companyId}</td>
                <td className="px-4 py-2.5 text-text-secondary">{p.sponsor}</td>
                <td className="px-4 py-2.5 text-right font-medium text-text-primary">€{p.target}M</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => startEdit(p)} className="mr-2 text-text-secondary hover:text-bp-coral">
                    <Pencil size={14} />
                  </button>
                  <button onClick={() => remove(p.id)} className="text-text-secondary hover:text-red-500">
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
