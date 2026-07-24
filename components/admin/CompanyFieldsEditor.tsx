"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Role } from "@/types";

export const OPERATIONAL_ROLES: { value: Role; label: string }[] = [
  { value: "cto", label: "CTO" },
  { value: "sponsor", label: "Sponsor" },
  { value: "lever", label: "Lever Owner" },
  { value: "finance", label: "Finance" },
  { value: "hr", label: "HR" },
  { value: "ops", label: "Ops" },
];

export type CompanyFormState = {
  name: string;
  industry: string;
  fyStart: string;
  fyEnd: string;
  capexBudget: string;
  actionPlanEnabled: boolean;
  confidentialityLevels: string[];
  roleClearance: Partial<Record<Role, string[]>>;
};

export const DEFAULT_COMPANY_FORM: CompanyFormState = {
  name: "",
  industry: "",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
  capexBudget: "",
  actionPlanEnabled: true,
  confidentialityLevels: [],
  roleClearance: {},
};

/**
 * Formulaire d'édition des paramètres d'une entreprise (identité, exercice fiscal, CAPEX, module
 * Plan d'action, échelle de confidentialité + matrice d'habilitation par profil). Extrait de
 * `admin/companies/page.tsx` pour être réutilisé tel quel par le hub `/admin/companies/detail`
 * (onglet Paramètres) — seule source de vérité pour ces champs, ne pas dupliquer.
 */
export function CompanyFieldsEditor({
  value,
  onChange,
}: {
  value: CompanyFormState;
  onChange: (patch: Partial<CompanyFormState>) => void;
}) {
  const [newLevel, setNewLevel] = useState("");

  const addLevel = () => {
    const level = newLevel.trim();
    if (!level || value.confidentialityLevels.includes(level)) return;
    onChange({ confidentialityLevels: [...value.confidentialityLevels, level] });
    setNewLevel("");
  };

  const removeLevel = (level: string) => {
    onChange({
      confidentialityLevels: value.confidentialityLevels.filter((l) => l !== level),
      roleClearance: Object.fromEntries(
        Object.entries(value.roleClearance).map(([role, levels]) => [
          role,
          (levels ?? []).filter((l) => l !== level),
        ])
      ),
    });
  };

  const toggleClearance = (role: Role, level: string) => {
    const current = value.roleClearance[role] ?? [];
    const next = current.includes(level) ? current.filter((l) => l !== level) : [...current, level];
    onChange({ roleClearance: { ...value.roleClearance, [role]: next } });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-text-secondary">Nom</label>
          <input
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            placeholder="Nom de l'entreprise"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">Secteur</label>
          <input
            value={value.industry}
            onChange={(e) => onChange({ industry: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            placeholder="Industrie / Secteur"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">Début exercice</label>
          <input
            type="date"
            value={value.fyStart}
            onChange={(e) => onChange({ fyStart: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">Fin exercice</label>
          <input
            type="date"
            value={value.fyEnd}
            onChange={(e) => onChange({ fyEnd: e.target.value })}
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
              value={value.capexBudget}
              onChange={(e) => onChange({ capexBudget: e.target.value })}
              className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
              placeholder="Non renseigné"
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={value.actionPlanEnabled}
                onChange={(e) => onChange({ actionPlanEnabled: e.target.checked })}
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
          {value.confidentialityLevels.length === 0 && (
            <p className="mt-1 rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-secondary">
              La confidentialité n&apos;est pas encore activée pour cette entreprise. Ajoutez un
              premier niveau ci-dessous (ex. Public, Confidentiel) pour pouvoir restreindre
              l&apos;accès à certains leviers par rôle ou par utilisateur.
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            {value.confidentialityLevels.map((level) => (
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

        {value.confidentialityLevels.length > 0 && (
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
                    {value.confidentialityLevels.map((level) => (
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
                      {value.confidentialityLevels.map((level) => (
                        <td key={level} className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={(value.roleClearance[r.value] ?? []).includes(level)}
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
    </div>
  );
}
