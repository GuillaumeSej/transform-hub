"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Plus, Pencil, Trash2, ExternalLink } from "lucide-react";
import type { Company } from "@/types";
import { subscribeCompanies, saveCompany, deleteCompany } from "@/lib/firestore/admin";
import { useToast } from "@/lib/hooks/useToast";
import {
  CompanyFieldsEditor,
  DEFAULT_COMPANY_FORM,
  type CompanyFormState,
} from "@/components/admin/CompanyFieldsEditor";

const DEFAULT_FORM: CompanyFormState = DEFAULT_COMPANY_FORM;

export default function AdminCompaniesPage() {
  const { showToast } = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const unsub = subscribeCompanies(setCompanies);
    return unsub;
  }, []);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
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

  const save = async () => {
    if (!form.name.trim()) return;
    // Ne jamais assigner `capexBudget: undefined` explicitement — Firestore `setDoc` rejette
    // toute clé valant `undefined` (même bug corrigé sur AuthUser.confidentialityClearance dans
    // UsersPanel.tsx et sur ce même champ dans CompanyDetailClient.tsx) : on omet la clé plutôt
    // que de la mettre à `undefined` quand le champ est vidé.
    const trimmedCapex = form.capexBudget.trim();
    const common = {
      name: form.name,
      industry: form.industry,
      fyStart: form.fyStart,
      fyEnd: form.fyEnd,
      ...(trimmedCapex !== "" ? { capexBudget: Number(trimmedCapex) } : {}),
      actionPlanEnabled: form.actionPlanEnabled,
      confidentialityLevels: form.confidentialityLevels,
      roleClearance: form.roleClearance,
    };
    try {
      if (editId) {
        const existing = companies.find((c) => c.id === editId);
        if (existing) {
          const rest = { ...existing };
          delete rest.capexBudget;
          await saveCompany({ ...rest, ...common });
        }
      } else {
        const id = `c${Date.now()}`;
        await saveCompany({ id, ...common, createdAt: new Date().toISOString().slice(0, 10) });
      }
      setShowForm(false);
    } catch (err) {
      console.error("[betrack] échec de l'enregistrement de l'entreprise :", err);
      showToast("Échec de l'enregistrement", "L'entreprise n'a pas pu être sauvegardée.", "error");
    }
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
          <CompanyFieldsEditor
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />

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
                  <Link
                    href={`/admin/companies/detail?id=${c.id}`}
                    className="mr-3 inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium text-text-secondary hover:border-bp-coral hover:text-bp-coral"
                    title="Voir le détail complet de l'entreprise"
                  >
                    <ExternalLink size={12} /> Gérer
                  </Link>
                  <button
                    onClick={() => startEdit(c)}
                    className="mr-2 text-text-secondary hover:text-bp-coral"
                    title="Modification rapide"
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
