"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { Company, ImpactNatureDef, Lever } from "@/types";
import { subscribeCompanies, saveCompanyImpactConfig } from "@/lib/firestore/admin";
import { subscribeLevers } from "@/lib/firestore/levers";
import { DEFAULT_IMPACT_NATURES, DEFAULT_LEVER_TYPES } from "@/lib/impactConfig";
import {
  addLeverType,
  addNature,
  cleanNatures,
  countLeversByNature,
  countLeversByType,
  moveItem,
  renameLeverType,
  updateNature,
} from "@/lib/impactConfigEdit";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";

const inputCls =
  "rounded-lg border border-border bg-bg-surface px-2 py-1.5 text-xs text-text-primary";
const iconBtn = "rounded p-1 text-text-secondary hover:bg-bg-surface disabled:opacity-30";

/** Éditeur des types de levier et natures d'impact (coûts/gains) d'une entreprise — persistés sur
 *  `companies/{id}` (`leverTypes`, `impactNatures`). Non paramétré = valeurs par défaut. */
export function ImpactConfigEditor({ companyId }: { companyId: string }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [company, setCompany] = useState<Company | null>(null);
  const [levers, setLevers] = useState<Lever[]>([]);
  const [types, setTypes] = useState<string[]>(DEFAULT_LEVER_TYPES);
  const [natures, setNatures] = useState<ImpactNatureDef[]>(DEFAULT_IMPACT_NATURES);
  const [newType, setNewType] = useState("");
  const [newNature, setNewNature] = useState("");
  const [newApplies, setNewApplies] = useState<ImpactNatureDef["appliesTo"]>("both");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const u1 = subscribeCompanies((list) => {
      setCompany(list.find((c) => c.id === companyId) ?? null);
    }, companyId);
    const u2 = subscribeLevers(setLevers, companyId);
    return () => {
      u1();
      u2();
    };
  }, [companyId]);

  useEffect(() => {
    if (!company) return;
    setTypes(company.leverTypes?.length ? company.leverTypes : DEFAULT_LEVER_TYPES);
    setNatures(company.impactNatures?.length ? company.impactNatures : DEFAULT_IMPACT_NATURES);
  }, [company]);

  const typeCounts = useMemo(() => countLeversByType(levers), [levers]);
  const natureCounts = useMemo(() => countLeversByNature(levers), [levers]);

  const confirmRemove = (count: number, label: string) =>
    count === 0 ||
    window.confirm(
      t(
        "adminImpactConfig.removeWarn",
        `« ${label} » est encore utilisé par ${count} levier(s). Le supprimer ne modifie pas ces leviers mais la valeur n'apparaîtra plus dans les listes. Supprimer quand même ?`
      )
    );

  const save = async (next?: { types?: string[] | null; natures?: ImpactNatureDef[] | null }) => {
    if (!company) return;
    setSaving(true);
    try {
      const tt = next && "types" in next ? next.types : types;
      const nn = next && "natures" in next ? next.natures : cleanNatures(natures);
      await saveCompanyImpactConfig(company.id, {
        leverTypes: tt ?? undefined,
        impactNatures: nn ?? undefined,
      });
      showToast(t("adminImpactConfig.saved", "Configuration enregistrée"), "", "success");
    } catch (err) {
      console.error("[betrack] échec enregistrement types/natures :", err);
      showToast(
        t("adminCompanies.saveFailedTitle", "Échec de l'enregistrement"),
        t("adminCompanies.settingsSaveFailedBody", "Les paramètres n'ont pas pu être sauvegardés."),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        t("adminImpactConfig.resetConfirm", "Réinitialiser types et natures par défaut ?")
      )
    )
      return;
    setTypes(DEFAULT_LEVER_TYPES);
    setNatures(DEFAULT_IMPACT_NATURES);
    await save({ types: null, natures: null });
  };

  if (!company)
    return (
      <p className="text-sm text-text-secondary">{t("adminCompanies.loading", "Chargement…")}</p>
    );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-bg-elevated p-4 space-y-3">
        <div className="text-sm font-semibold text-text-primary">
          {t("adminImpactConfig.typesTitle", "Types de levier")}
        </div>
        <ul className="space-y-1.5">
          {types.map((label, i) => (
            <li key={i} className="flex items-center gap-1.5">
              <input
                className={`${inputCls} flex-1`}
                value={label}
                onChange={(e) => setTypes((l) => l.map((x, j) => (j === i ? e.target.value : x)))}
                onBlur={(e) => setTypes((l) => renameLeverType(l, i, e.target.value))}
              />
              <span className="w-20 text-[11px] text-text-secondary">
                {typeCounts[label] ?? 0} {t("adminImpactConfig.levers", "levier(s)")}
              </span>
              <button
                className={iconBtn}
                disabled={i === 0}
                onClick={() => setTypes((l) => moveItem(l, i, i - 1))}
                aria-label="Monter"
              >
                <ArrowUp size={14} />
              </button>
              <button
                className={iconBtn}
                disabled={i === types.length - 1}
                onClick={() => setTypes((l) => moveItem(l, i, i + 1))}
                aria-label="Descendre"
              >
                <ArrowDown size={14} />
              </button>
              <button
                className={iconBtn}
                aria-label="Supprimer"
                onClick={() => {
                  if (confirmRemove(typeCounts[label] ?? 0, label))
                    setTypes((l) => l.filter((_, j) => j !== i));
                }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <input
            className={`${inputCls} flex-1`}
            value={newType}
            placeholder={t("adminImpactConfig.newType", "Nouveau type de levier")}
            onChange={(e) => setNewType(e.target.value)}
          />
          <button
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
            onClick={() => {
              setTypes((l) => addLeverType(l, newType));
              setNewType("");
            }}
          >
            <Plus size={14} /> {t("common.add", "Ajouter")}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-bg-elevated p-4 space-y-3">
        <div className="text-sm font-semibold text-text-primary">
          {t("adminImpactConfig.naturesTitle", "Natures des impacts (coûts et gains)")}
        </div>
        <ul className="space-y-1.5">
          {natures.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-1.5">
              <input
                className={`${inputCls} min-w-40 flex-1`}
                value={n.label}
                onChange={(e) =>
                  setNatures((l) => updateNature(l, n.id, { label: e.target.value }))
                }
              />
              <select
                className={inputCls}
                value={n.appliesTo}
                onChange={(e) =>
                  setNatures((l) =>
                    updateNature(l, n.id, {
                      appliesTo: e.target.value as ImpactNatureDef["appliesTo"],
                    })
                  )
                }
              >
                <option value="cost">{t("adminImpactConfig.cost", "Coûts")}</option>
                <option value="saving">{t("adminImpactConfig.saving", "Gains")}</option>
                <option value="both">{t("adminImpactConfig.both", "Les deux")}</option>
              </select>
              <span className="w-20 text-[11px] text-text-secondary">
                {natureCounts[n.id] ?? 0} {t("adminImpactConfig.levers", "levier(s)")}
              </span>
              <button
                className={iconBtn}
                aria-label="Supprimer"
                onClick={() => {
                  if (confirmRemove(natureCounts[n.id] ?? 0, n.label))
                    setNatures((l) => l.filter((x) => x.id !== n.id));
                }}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <input
            className={`${inputCls} min-w-40 flex-1`}
            value={newNature}
            placeholder={t("adminImpactConfig.newNature", "Nouvelle nature")}
            onChange={(e) => setNewNature(e.target.value)}
          />
          <select
            className={inputCls}
            value={newApplies}
            onChange={(e) => setNewApplies(e.target.value as ImpactNatureDef["appliesTo"])}
          >
            <option value="cost">{t("adminImpactConfig.cost", "Coûts")}</option>
            <option value="saving">{t("adminImpactConfig.saving", "Gains")}</option>
            <option value="both">{t("adminImpactConfig.both", "Les deux")}</option>
          </select>
          <button
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
            onClick={() => {
              setNatures((l) => addNature(l, newNature, newApplies));
              setNewNature("");
            }}
          >
            <Plus size={14} /> {t("common.add", "Ajouter")}
          </button>
        </div>
      </section>

      <div className="flex gap-2">
        <button
          disabled={saving}
          onClick={() => save()}
          className="rounded-lg bg-bp-coral px-3 py-1.5 text-xs font-semibold text-white hover:bg-bp-coral/90 disabled:opacity-50"
        >
          {saving ? t("adminCompanies.saving", "Enregistrement…") : t("common.save", "Enregistrer")}
        </button>
        <button
          disabled={saving}
          onClick={reset}
          className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
        >
          <RotateCcw size={14} /> {t("adminImpactConfig.reset", "Réinitialiser par défaut")}
        </button>
      </div>
    </div>
  );
}
