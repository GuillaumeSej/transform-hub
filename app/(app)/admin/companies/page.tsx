"use client";

import { useEffect, useState } from "react";
import { Building2, Plus, Pencil, Trash2, X } from "lucide-react";
import type { Company, Role } from "@/types";
import { subscribeCompanies, saveCompany, deleteCompany } from "@/lib/firestore/admin";

const OPERATIONAL_ROLES: { value: Role; label: string }[] = [
  { value: "cto", label: "CTO" },
  { value: "sponsor", label: "Sponsor" },
  { value: "lever", label: "Lever Owner" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "ops", label: "Ops" },
];

const DEFAULT_FORM = {
  name: "",
  industry: "",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
  capexBudget: "",
  actionPlanEnabled: true,
  confidentialityLevels: [] as string[],
  roleClearance: {} as Partial<Record<Role, string[]>>,
};

export default function AdminCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies);
    return unsub;
  }, []);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [newLevel, setNewLevel] = useState("");
  const [showForm, setShowForm] = useState(false);

  const startCreate = () => {
    setEditId(null);
    setForm(DEFAULT_FORM);
    setShowForm(true);
  };

  const startEdit = (c: Company) => {
    setEditId(c.id);
    setForm({
      name: c.name,
      industry: c.industry,
      fyStart: c.fyStart,
      fyEnd: c.fyEnd,
      capexBudget: c.capexBudget != null ? String(c.capexBudget) : "",
      actionPlanEnabled: c.actionPlanEnabled ?? true,
      confidentialityLevels: c.confidentialityLevels ?? [],
      roleClearance: c.roleClearance ?? {},
    });
    setShowForm(true);
  };

  const addLevel = () => {
    const level = newLevel.trim();
    if (!level || form.confidentialityLevels.includes(level)) return;
    setForm((f) => ({ ...f, confidentialityLevels: [...f.confidentialityLevels, level] }));
    setNewLevel("");
  };

  const removeLevel = (level: string) => {
    setForm((f) => ({
      ...f,
      confidentialityLevels: f.confidentialityLevels.filter((l) => l !== level),
      roleClearance: Object.fromEntries(
        Object.entries(f.roleClearance).map(([role, levels]) => [
          role,
          (levels ?? []).filter((l) => l !== level),
        ])
      ),
    }));
  };

  const toggleClearance = (role: Role, level: string) => {
    setForm((f) => {
      const current = f.roleClearance[role] ?? [];
      const next = current.includes(level)
        ? current.filter((l) => l !== level)
        : [...current, level];
      return { ...f, roleClearance: { ...f.roleClearance, [role]: next } };
    });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    const capexBudget = form.capexBudget.trim() === "" ? undefined : Number(form.capexBudget);
    const common = {
      name: form.name,
      industry: form.industry,
      fyStart: form.fyStart,
      fyEnd: form.fyEnd,
      capexBudget,
      actionPlanEnabled: form.actionPlanEnabled,
      confidentialityLevels: form.confidentialityLevels,
      roleClearance: form.roleClearance,
    };
    if (editId) {
      const existing = companies.find((c) => c.id === editId);
      if (existing) {
        await saveCompany({ ...existing, ...common });
      }
    } else {
      const id = `c${Date.now()}`;
      await saveCompany({ id, ...common, createdAt: new Date().toISOString().slice(0, 10) });
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

          <div className="border-t border-border pt-3 space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              Paramètres avancés
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-text-secondary">
                  Budget CAPEX total (€M) — optionnel
                </label>
                <input
                  type="number"
                  value={form.capexBudget}
                  onChange={(e) => setForm((f) => ({ ...f, capexBudget: e.target.value }))}
                  className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                  placeholder="Non renseigné"
                />
              </div>
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-text-primary">
                  <input
                    type="checkbox"
                    checked={form.actionPlanEnabled}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, actionPlanEnabled: e.target.checked }))
                    }
                    className="h-4 w-4 rounded border-border accent-bp-coral"
                  />
                  Module &quot;Plan d&apos;action&quot; activé
                </label>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-text-secondary">
                Niveaux de confidentialité (du moins au plus restreint)
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                {form.confidentialityLevels.map((level) => (
                  <span
                    key={level}
                    className="flex items-center gap-1 rounded-full bg-bg-surface border border-border px-2.5 py-1 text-xs text-text-primary"
                  >
                    {level}
                    <button
                      onClick={() => removeLevel(level)}
                      className="text-text-secondary hover:text-red-500"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  value={newLevel}
                  onChange={(e) => setNewLevel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLevel();
                    }
                  }}
                  placeholder="Ex : Confidentiel"
                  className="w-full max-w-xs rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                />
                <button
                  onClick={addLevel}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
                >
                  Ajouter le niveau
                </button>
              </div>
            </div>

            {form.confidentialityLevels.length > 0 && (
              <div>
                <label className="text-xs font-medium text-text-secondary">
                  Habilitations par profil — un levier au niveau X n&apos;est visible que par les
                  profils habilités pour X (un levier sans niveau reste visible par tous)
                </label>
                <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-bg-surface border-b border-border">
                        <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                          Profil
                        </th>
                        {form.confidentialityLevels.map((level) => (
                          <th
                            key={level}
                            className="px-3 py-2 text-center font-semibold text-text-secondary"
                          >
                            {level}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {OPERATIONAL_ROLES.map((r) => (
                        <tr key={r.value} className="border-b border-border last:border-0">
                          <td className="px-3 py-2 font-medium text-text-primary">{r.label}</td>
                          {form.confidentialityLevels.map((level) => (
                            <td key={level} className="px-3 py-2 text-center">
                              <input
                                type="checkbox"
                                checked={(form.roleClearance[r.value] ?? []).includes(level)}
                                onChange={() => toggleClearance(r.value, level)}
                                className="h-4 w-4 rounded border-border accent-bp-coral"
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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

      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                ID
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Nom
              </th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                Secteur
              </th>
              <th className="hidden px-4 py-2.5 text-left text-xs font-semibold text-text-secondary sm:table-cell">
                Créé le
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-b border-border hover:bg-bg-elevated/50">
                <td className="hidden px-4 py-2.5 font-mono text-xs text-text-secondary sm:table-cell">
                  {c.id}
                </td>
                <td className="px-4 py-2.5 font-medium text-text-primary">{c.name}</td>
                <td className="hidden px-4 py-2.5 text-text-secondary sm:table-cell">
                  {c.industry}
                </td>
                <td className="hidden px-4 py-2.5 text-text-secondary sm:table-cell">
                  {c.createdAt}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => startEdit(c)}
                    className="mr-2 text-text-secondary hover:text-bp-coral"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => remove(c.id)}
                    className="text-text-secondary hover:text-red-500"
                  >
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
