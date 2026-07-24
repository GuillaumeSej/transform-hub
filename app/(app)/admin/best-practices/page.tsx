"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Plus, Pencil, Trash2 } from "lucide-react";
import type { BestPracticeRule, Company } from "@/types";
import {
  subscribeCompanies,
  subscribeBestPracticeRules,
  saveBestPracticeRule,
  deleteBestPracticeRule,
} from "@/lib/firestore/admin";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useRole } from "@/lib/hooks/useRole";

const EMPTY_FORM = {
  label: "",
  description: "",
  matchFunction: "",
  matchWorkstreamId: "",
  matchType: "",
  active: true,
};

/** Admin CRUD des règles "bonnes pratiques" — même schéma page/rôle que
 *  app/(app)/admin/lifecycle/page.tsx (isEntAdmin verrouillé sur sa propre entreprise). */
export default function AdminBestPracticesPage() {
  const { role, user } = useRole();
  const isEntAdmin = role === "admin_entreprise";
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("");
  const [rules, setRules] = useState<BestPracticeRule[]>([]);

  // Référentiels (fonctions/workstreams/types) de l'entreprise sélectionnée, pour les menus.
  const data = useBeTrackData(selectedCompany || null);

  useEffect(() => {
    const unsub = subscribeCompanies((list) => {
      setCompanies(list);
      if (!selectedCompany) {
        if (isEntAdmin && user?.companyId) {
          setSelectedCompany(user.companyId);
        } else if (list.length > 0) {
          setSelectedCompany(list[0].id);
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEntAdmin, user?.companyId]);

  useEffect(() => {
    if (!selectedCompany) return;
    const unsub = subscribeBestPracticeRules(selectedCompany, setRules);
    return unsub;
  }, [selectedCompany]);

  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);

  const startCreate = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const startEdit = (r: BestPracticeRule) => {
    setEditId(r.id);
    setForm({
      label: r.label,
      description: r.description,
      matchFunction: r.matchFunction ?? "",
      matchWorkstreamId: r.matchWorkstreamId ?? "",
      matchType: r.matchType ?? "",
      active: r.active,
    });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.label.trim() || !selectedCompany) return;
    const rule: BestPracticeRule = {
      id: editId ?? `bpr-${Date.now()}`,
      companyId: selectedCompany,
      label: form.label,
      description: form.description,
      matchFunction: form.matchFunction || undefined,
      matchWorkstreamId: form.matchWorkstreamId || undefined,
      matchType: form.matchType || undefined,
      active: form.active,
    };
    await saveBestPracticeRule(rule);
    setShowForm(false);
  };

  const remove = async (id: string) => {
    await deleteBestPracticeRule(id);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck size={22} className="text-bp-coral" />
          <h1 className="text-xl font-bold text-text-primary">Bonnes pratiques</h1>
        </div>
        <button
          onClick={startCreate}
          disabled={!selectedCompany}
          className="flex items-center gap-1.5 rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-40"
        >
          <Plus size={14} /> Ajouter une règle
        </button>
      </div>

      <p className="max-w-2xl text-sm text-text-secondary">
        Définissez les catégories de leviers qu&apos;un programme bien mené devrait couvrir (ex. «
        au moins un levier Sourcing &amp; Achats »). Le dashboard signale les règles pour lesquelles
        aucun levier actif ne correspond — un manquement à examiner, pas forcément une anomalie.
      </p>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-text-secondary">Entreprise :</label>
        {isEntAdmin ? (
          <span className="text-sm font-medium text-text-primary">
            {companies.find((c) => c.id === user?.companyId)?.name ?? user?.companyId}
          </span>
        ) : (
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {showForm && (
        <div className="rounded-xl border border-border bg-bg-elevated p-4 space-y-3">
          <div className="text-sm font-semibold text-text-primary">
            {editId ? "Modifier la règle" : "Nouvelle règle"}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary">Libellé</label>
              <input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="ex. Levier Sourcing & Achats"
              />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-text-secondary">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={2}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
                placeholder="Explication affichée en cas de manquement"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Fonction (optionnel)
              </label>
              <select
                value={form.matchFunction}
                onChange={(e) => setForm((f) => ({ ...f, matchFunction: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              >
                <option value="">— Toutes —</option>
                {data.functions.map((fn) => (
                  <option key={fn} value={fn}>
                    {fn}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Workstream (optionnel)
              </label>
              <select
                value={form.matchWorkstreamId}
                onChange={(e) => setForm((f) => ({ ...f, matchWorkstreamId: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              >
                <option value="">— Tous —</option>
                {data.workstreams.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">
                Type de levier (optionnel)
              </label>
              <select
                value={form.matchType}
                onChange={(e) => setForm((f) => ({ ...f, matchType: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              >
                <option value="">— Tous —</option>
                {data.leverTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={() => setForm((f) => ({ ...f, active: !f.active }))}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  form.active
                    ? "bg-green-100 text-green-700 hover:bg-green-200"
                    : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                }`}
              >
                {form.active ? "Active" : "Inactive"}
              </button>
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

      <div className="rounded-xl border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Libellé
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                Critères
              </th>
              <th className="px-4 py-2.5 text-center text-xs font-semibold text-text-secondary">
                Statut
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-text-secondary">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border last:border-b-0 hover:bg-bg-elevated/50"
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium text-text-primary">{r.label}</div>
                  <div className="text-xs text-text-secondary">{r.description}</div>
                </td>
                <td className="px-4 py-2.5 text-xs text-text-secondary">
                  {[
                    r.matchFunction && `Fonction: ${r.matchFunction}`,
                    r.matchWorkstreamId &&
                      `Workstream: ${data.workstreams.find((w) => w.id === r.matchWorkstreamId)?.name ?? r.matchWorkstreamId}`,
                    r.matchType && `Type: ${r.matchType}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Aucun critère (toute couverture)"}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      r.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {r.active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => startEdit(r)}
                    className="mr-2 text-text-secondary hover:text-bp-coral"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => remove(r.id)}
                    className="text-text-secondary hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-sm text-text-secondary">
                  Aucune règle configurée pour cette entreprise.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
