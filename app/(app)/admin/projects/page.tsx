"use client";

import { useEffect, useState } from "react";
import { FolderKanban, Plus, Pencil, Trash2 } from "lucide-react";
import type { Company, Project } from "@/types";
import {
  subscribeCompanies,
  subscribeProjects,
  saveProject,
  deleteProject,
} from "@/lib/firestore/admin";

export default function AdminProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeProjects(setProjects);
    return unsub;
  }, []);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ companyId: "", name: "", sponsor: "", target: "" });
  const [showForm, setShowForm] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  const startCreate = () => {
    setEditId(null);
    setForm({ companyId: companies[0]?.id ?? "", name: "", sponsor: "", target: "" });
    setShowForm(true);
  };

  const startEdit = (p: Project) => {
    setEditId(p.id);
    setForm({ companyId: p.companyId, name: p.name, sponsor: p.sponsor, target: String(p.target) });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const target = parseFloat(form.target) || 0;
    if (editId) {
      const existing = projects.find((p) => p.id === editId);
      if (existing) {
        await saveProject({
          ...existing,
          name: form.name,
          sponsor: form.sponsor,
          target,
          companyId: form.companyId,
        });
      }
    } else {
      const id = `p${Date.now()}`;
      await saveProject({
        id,
        companyId: form.companyId,
        name: form.name,
        sponsor: form.sponsor,
        target,
        currency: "€M",
        fyStart: "2026-01",
        fyEnd: "2026-12",
        baselineEBIT: 0,
        revenue: 0,
        createdAt: new Date().toISOString().slice(0, 10),
      });
    }
    setShowForm(false);
  };

  const remove = async (id: string) => {
    await deleteProject(id);
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
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
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

      {companies.length > 0 && (
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
            {
              projects.filter((p) => companyFilter === "all" || p.companyId === companyFilter)
                .length
            }{" "}
            projet(s)
          </span>
        </div>
      )}

      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                ID
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Projet
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Entreprise
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Sponsor
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">
                Cible
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {projects
              .filter((p) => companyFilter === "all" || p.companyId === companyFilter)
              .map((p) => (
                <tr key={p.id} className="border-b border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">{p.id}</td>
                  <td className="px-4 py-2.5 font-medium text-text-primary">{p.name}</td>
                  <td className="px-4 py-2.5 text-text-secondary">
                    {companies.find((c) => c.id === p.companyId)?.name ?? p.companyId}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">{p.sponsor}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-text-primary">
                    €{p.target}M
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => startEdit(p)}
                      className="mr-2 text-text-secondary hover:text-bp-coral"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => remove(p.id)}
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
