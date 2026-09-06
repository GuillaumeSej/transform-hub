"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ProgramConfig, Workstream } from "@/types";
import {
  subscribeProgramConfig,
  saveProgramConfig,
  type ProgramSeed,
} from "@/lib/firestore/programConfig";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";

/** Formulaire local — tous les champs numériques sont saisis en texte pour permettre un champ
 *  vide temporaire pendant la frappe (converti en nombre à la sauvegarde, 0 par défaut si vide).
 *  Même pattern que `CompanyFormState.socialChargesRate` dans CompanyFieldsEditor.tsx. */
type ProgramConfigFormState = {
  name: string;
  sponsor: string;
  currency: string;
  fyStart: string;
  fyEnd: string;
  baselineEBIT: string;
  revenue: string;
  target: string;
  workstreams: Workstream[];
};

function emptyForm(): ProgramConfigFormState {
  return {
    name: "",
    sponsor: "",
    currency: "EUR",
    fyStart: "",
    fyEnd: "",
    baselineEBIT: "",
    revenue: "",
    target: "",
    workstreams: [],
  };
}

function toForm(seed: ProgramSeed): ProgramConfigFormState {
  return {
    name: seed.program.name,
    sponsor: seed.program.sponsor,
    currency: seed.program.currency,
    fyStart: seed.program.fyStart,
    fyEnd: seed.program.fyEnd,
    baselineEBIT: String(seed.program.baselineEBIT),
    revenue: String(seed.program.revenue),
    target: String(seed.program.target),
    workstreams: seed.workstreams,
  };
}

function formEquals(a: ProgramConfigFormState, b: ProgramConfigFormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

const num = (value: string): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

let nextWorkstreamSuffix = 0;
function newWorkstreamId(): string {
  nextWorkstreamSuffix += 1;
  return `ws${Date.now()}${nextWorkstreamSuffix}`;
}

/**
 * Formulaire d'édition du `ProgramConfig` legacy d'une entreprise (`meta/program__{companyId}` —
 * voir lib/firestore/programConfig.ts) : nom/sponsor/devise/exercice/EBIT/CA/cible du "programme"
 * mono-instance historique, plus la liste de ses workstreams. À NE PAS CONFONDRE avec la
 * collection `Program`/`programs` (voir components/admin/ProgramsPanel.tsx, un-à-plusieurs par
 * entreprise, système parallèle plus récent) : ce formulaire couvre le seul singleton legacy
 * consommé par `lib/hooks/useStorage.ts` (`data.program`/`data.workstreams`), qui ne disposait
 * jusqu'ici d'AUCUNE UI d'administration (une entreprise nouvellement créée démarre avec un
 * `ProgramConfig` vide, voir `emptyProgramConfig()`).
 */
export function ProgramConfigEditor({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [baseline, setBaseline] = useState<ProgramConfigFormState>(emptyForm());
  const [form, setForm] = useState<ProgramConfigFormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [newWs, setNewWs] = useState<{
    name: string;
    sponsor: string;
    color: string;
    target: string;
  }>({
    name: "",
    sponsor: "",
    color: "#e5484d",
    target: "",
  });

  useEffect(() => {
    setLoaded(false);
    const unsub = subscribeProgramConfig((config) => {
      const next = config ? toForm(config) : emptyForm();
      setBaseline(next);
      setForm(next);
      setLoaded(true);
    }, companyId);
    return unsub;
  }, [companyId]);

  const dirty = loaded && !formEquals(form, baseline);
  useRegisterUnsavedChanges(`admin:program-config:${companyId}`, dirty);

  const updateWorkstream = (id: string, patch: Partial<Workstream>) => {
    setForm((f) => ({
      ...f,
      workstreams: f.workstreams.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  };

  const removeWorkstream = (id: string) => {
    setForm((f) => ({ ...f, workstreams: f.workstreams.filter((w) => w.id !== id) }));
  };

  const addWorkstream = () => {
    const name = newWs.name.trim();
    if (!name) return;
    const ws: Workstream = {
      id: newWorkstreamId(),
      name,
      sponsor: newWs.sponsor.trim(),
      color: newWs.color,
      target: num(newWs.target),
    };
    setForm((f) => ({ ...f, workstreams: [...f.workstreams, ws] }));
    setNewWs({ name: "", sponsor: "", color: "#e5484d", target: "" });
  };

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const program: ProgramConfig = {
        id: companyId,
        name: form.name,
        sponsor: form.sponsor,
        currency: form.currency,
        fyStart: form.fyStart,
        fyEnd: form.fyEnd,
        baselineEBIT: num(form.baselineEBIT),
        revenue: num(form.revenue),
        target: num(form.target),
      };
      await saveProgramConfig({ program, workstreams: form.workstreams }, companyId);
      showToast(
        t("adminProgramConfig.saveSuccessTitle", "Configuration enregistrée"),
        undefined,
        "success"
      );
    } catch (err) {
      console.error("[betrack] échec de l'enregistrement de la configuration programme :", err);
      showToast(
        t("adminCompanies.saveFailedTitle", "Échec de l'enregistrement"),
        t(
          "adminProgramConfig.saveFailedBody",
          "La configuration programme n'a pas pu être sauvegardée."
        ),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return (
      <p className="text-sm text-text-secondary">{t("adminCompanies.loading", "Chargement…")}</p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-secondary">
        {t(
          "adminProgramConfig.hint",
          "Configuration du programme historique de l'entreprise (nom, sponsor, exercice, cibles financières) et de ses workstreams — utilisée par le tableau de bord et les calculs financiers."
        )}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminProgramConfig.name", "Nom du programme")}
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            placeholder={t("adminProgramConfig.namePlaceholder", "Ex : Plan de Performance 2026")}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminProgramConfig.sponsor", "Sponsor")}
          </label>
          <input
            value={form.sponsor}
            onChange={(e) => setForm((f) => ({ ...f, sponsor: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminProgramConfig.currency", "Devise")}
          </label>
          <input
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            placeholder="EUR"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminProgramConfig.target", "Cible d'économies totale (€M)")}
          </label>
          <input
            type="number"
            value={form.target}
            onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminCompanyFields.fyStart", "Début exercice")}
          </label>
          <input
            type="date"
            value={form.fyStart}
            onChange={(e) => setForm((f) => ({ ...f, fyStart: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminCompanyFields.fyEnd", "Fin exercice")}
          </label>
          <input
            type="date"
            value={form.fyEnd}
            onChange={(e) => setForm((f) => ({ ...f, fyEnd: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminProgramConfig.baselineEBIT", "EBIT de référence (€M)")}
          </label>
          <input
            type="number"
            value={form.baselineEBIT}
            onChange={(e) => setForm((f) => ({ ...f, baselineEBIT: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminProgramConfig.revenue", "Chiffre d'affaires (€M)")}
          </label>
          <input
            type="number"
            value={form.revenue}
            onChange={(e) => setForm((f) => ({ ...f, revenue: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
      </div>

      <div className="border-t border-border pt-3 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {t("adminProgramConfig.workstreamsTitle", "Workstreams")}
        </div>

        {form.workstreams.length === 0 && (
          <p className="rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-secondary">
            {t(
              "adminProgramConfig.workstreamsEmpty",
              "Aucun workstream configuré pour ce programme."
            )}
          </p>
        )}

        {form.workstreams.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-bg-surface border-b border-border">
                  <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                    {t("adminProgramConfig.colId", "ID")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                    {t("adminProgramConfig.colName", "Nom")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                    {t("adminProgramConfig.sponsor", "Sponsor")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                    {t("adminProgramConfig.colColor", "Couleur")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                    {t("adminProgramConfig.colTarget", "Cible (€M)")}
                  </th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {form.workstreams.map((w) => (
                  <tr key={w.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-mono text-text-secondary">{w.id}</td>
                    <td className="px-3 py-2">
                      <input
                        value={w.name}
                        onChange={(e) => updateWorkstream(w.id, { name: e.target.value })}
                        className="w-36 rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={w.sponsor}
                        onChange={(e) => updateWorkstream(w.id, { sponsor: e.target.value })}
                        className="w-32 rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="color"
                        value={w.color}
                        onChange={(e) => updateWorkstream(w.id, { color: e.target.value })}
                        className="h-7 w-12 cursor-pointer rounded border border-border bg-bg-surface p-0.5"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={w.target}
                        onChange={(e) => updateWorkstream(w.id, { target: num(e.target.value) })}
                        className="w-24 rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                      />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => removeWorkstream(w.id)}
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
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="text-xs font-medium text-text-secondary">
              {t("adminProgramConfig.colName", "Nom")}
            </label>
            <input
              value={newWs.name}
              onChange={(e) => setNewWs((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-40 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              placeholder={t("adminProgramConfig.newWorkstreamPlaceholder", "Ex : Sourcing")}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary">
              {t("adminProgramConfig.sponsor", "Sponsor")}
            </label>
            <input
              value={newWs.sponsor}
              onChange={(e) => setNewWs((f) => ({ ...f, sponsor: e.target.value }))}
              className="mt-1 w-36 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary">
              {t("adminProgramConfig.colColor", "Couleur")}
            </label>
            <input
              type="color"
              value={newWs.color}
              onChange={(e) => setNewWs((f) => ({ ...f, color: e.target.value }))}
              className="mt-1 h-9 w-14 cursor-pointer rounded-lg border border-border bg-bg-surface p-0.5"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary">
              {t("adminProgramConfig.colTarget", "Cible (€M)")}
            </label>
            <input
              type="number"
              value={newWs.target}
              onChange={(e) => setNewWs((f) => ({ ...f, target: e.target.value }))}
              className="mt-1 w-24 rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            />
          </div>
          <button
            onClick={addWorkstream}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-surface"
          >
            <Plus size={14} /> {t("adminProgramConfig.addWorkstream", "Ajouter le workstream")}
          </button>
        </div>
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-50"
      >
        {saving ? t("adminCompanies.saving", "Enregistrement…") : t("common.save", "Enregistrer")}
      </button>
    </div>
  );
}
