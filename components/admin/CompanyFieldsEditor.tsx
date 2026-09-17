"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { Role, RiskLevel } from "@/types";
import { useTranslation } from "@/lib/i18n/useTranslation";

function riskLevels(
  t: (key: string, fallback?: string) => string
): { value: RiskLevel; label: string }[] {
  return [
    { value: "critical", label: t("adminCompanyFields.riskCritical", "Critique") },
    { value: "high", label: t("adminCompanyFields.riskHigh", "Élevé") },
    { value: "medium", label: t("adminCompanyFields.riskMedium", "Moyen") },
    { value: "low", label: t("adminCompanyFields.riskLow", "Faible") },
  ];
}

/** Seuils par défaut affichés quand `riskThresholds` n'est pas défini — mêmes ordres de grandeur
 *  que DEFAULT_RISK_THRESHOLDS (lib/engine.ts), mais exprimés ici en €K (UI) plutôt qu'en € brut
 *  (engine) : conversion à la charge de qui branche l'affichage/sauvegarde effective. */
const DEFAULT_RISK_THRESHOLDS_KEUR: Record<RiskLevel, string> = {
  critical: "500",
  high: "200",
  medium: "50",
  low: "0",
};

/** Délais par défaut (jours), mêmes valeurs que DEFAULT_RISK_THRESHOLDS (lib/engine.ts) — le
 *  critère délai est traité exactement comme le seuil financier ci-dessus : toujours pré-rempli
 *  d'une vraie valeur par défaut, jamais présenté comme "optionnel" (round "délai pas optionnel",
 *  suite à la confusion que ça créait par rapport au seuil financier voisin). */
const DEFAULT_RISK_DELAY_DAYS: Record<RiskLevel, string> = {
  critical: "7",
  high: "15",
  medium: "30",
  low: "60",
};

/** Seuils de risque par défaut, pré-remplis avec seuil ET délai — utilisé comme valeur initiale de
 *  `DEFAULT_COMPANY_FORM.riskThresholds` pour qu'une entreprise nouvellement créée les persiste
 *  d'emblée (voir doc-comment de `CompanyFormState.riskThresholds` plus bas) au lieu de rester
 *  `undefined` tant qu'un admin n'a pas ouvert "Paramètres avancés" pour y toucher. */
export const DEFAULT_RISK_THRESHOLDS_FORM: {
  level: RiskLevel;
  minAmount: string;
  delayDays: string;
}[] = (["critical", "high", "medium", "low"] as const).map((level) => ({
  level,
  minAmount: DEFAULT_RISK_THRESHOLDS_KEUR[level],
  delayDays: DEFAULT_RISK_DELAY_DAYS[level],
}));

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
  confidentialityLevels: string[];
  /** Directions/services métier de l'entreprise (round 4, filtres Plan Stratégique) — même
   *  pattern éditable que `confidentialityLevels` juste au-dessus, référencé par
   *  `AuthUser.direction`. Additif/optionnel, sans impact sur le Plan Performance. */
  directions: string[];
  roleClearance: Partial<Record<Role, string[]>>;
  /** Seuils de risque par niveau, saisis en €K (voir Company.riskThresholds — stocké en € brut,
   *  conversion à la charge de qui branche la sauvegarde). `delayDays` (ancienneté en jours de la
   *  plus vieille alerte ouverte du scope) fait aussi basculer le niveau de risque, en plus du
   *  montant — même statut que `minAmount` : toujours pré-rempli d'une vraie valeur par défaut
   *  (voir DEFAULT_RISK_THRESHOLDS_FORM), jamais laissé vide/"optionnel" par défaut. */
  riskThresholds?: { level: RiskLevel; minAmount: string; delayDays: string }[];
};

export const DEFAULT_COMPANY_FORM: CompanyFormState = {
  name: "",
  industry: "",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
  confidentialityLevels: [],
  directions: [],
  roleClearance: {},
  riskThresholds: DEFAULT_RISK_THRESHOLDS_FORM,
};

/**
 * Formulaire d'édition des paramètres d'une entreprise (identité, exercice fiscal, paramètre RH,
 * échelle de confidentialité + matrice d'habilitation par profil). Extrait de
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
  const { t } = useTranslation();
  const RISK_LEVELS = riskLevels(t);
  const [newLevel, setNewLevel] = useState("");
  const [newDirection, setNewDirection] = useState("");

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

  const addDirection = () => {
    const direction = newDirection.trim();
    if (!direction || value.directions.includes(direction)) return;
    onChange({ directions: [...value.directions, direction] });
    setNewDirection("");
  };

  const removeDirection = (direction: string) => {
    onChange({ directions: value.directions.filter((d) => d !== direction) });
  };

  const toggleClearance = (role: Role, level: string) => {
    const current = value.roleClearance[role] ?? [];
    const next = current.includes(level) ? current.filter((l) => l !== level) : [...current, level];
    onChange({ roleClearance: { ...value.roleClearance, [role]: next } });
  };

  const riskThresholdFor = (level: RiskLevel): string => {
    const found = value.riskThresholds?.find((t) => t.level === level);
    return found ? found.minAmount : DEFAULT_RISK_THRESHOLDS_KEUR[level];
  };

  const riskDelayFor = (level: RiskLevel): string => {
    const found = value.riskThresholds?.find((t) => t.level === level);
    return found ? found.delayDays : DEFAULT_RISK_DELAY_DAYS[level];
  };

  const setRiskThreshold = (
    level: RiskLevel,
    patch: { minAmount?: string; delayDays?: string }
  ) => {
    const base = RISK_LEVELS.map((r) => ({
      level: r.value,
      minAmount: riskThresholdFor(r.value),
      delayDays: riskDelayFor(r.value),
    }));
    onChange({
      riskThresholds: base.map((t) => (t.level === level ? { ...t, ...patch } : t)),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminCompanyFields.name", "Nom")}
          </label>
          <input
            value={value.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            placeholder={t("adminCompanyFields.namePlaceholder", "Nom de l'entreprise")}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminCompanyFields.industry", "Secteur")}
          </label>
          <input
            value={value.industry}
            onChange={(e) => onChange({ industry: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            placeholder={t("adminCompanyFields.industryPlaceholder", "Industrie / Secteur")}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminCompanyFields.fyStart", "Début exercice")}
          </label>
          <input
            type="date"
            value={value.fyStart}
            onChange={(e) => onChange({ fyStart: e.target.value })}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminCompanyFields.fyEnd", "Fin exercice")}
          </label>
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
          {t("adminCompanyFields.advancedSettings", "Paramètres avancés")}
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t(
              "adminCompanyFields.riskThresholdsLabel",
              "Seuils de risque (€K) — cumul des montants d'alertes ouvertes à partir duquel un levier passe à ce niveau de risque"
            )}
          </label>
          <div className="mt-2 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-bg-surface border-b border-border">
                  <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                    {t("adminCompanyFields.colLevel", "Niveau")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                    {t("adminCompanyFields.colThreshold", "Seuil (€K)")}
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                    {t("adminCompanyFields.colDelay", "Délai (jours)")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {RISK_LEVELS.map((r) => (
                  <tr key={r.value} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium text-text-primary">{r.label}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        value={riskThresholdFor(r.value)}
                        onChange={(e) => setRiskThreshold(r.value, { minAmount: e.target.value })}
                        className="w-32 rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        value={riskDelayFor(r.value)}
                        onChange={(e) => setRiskThreshold(r.value, { delayDays: e.target.value })}
                        className="w-40 rounded-lg border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary outline-none focus:border-bp-coral"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t(
              "adminCompanyFields.confidentialityLevelsLabel",
              "Niveaux de confidentialité (du moins au plus restreint)"
            )}
          </label>
          {value.confidentialityLevels.length === 0 && (
            <p className="mt-1 rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-secondary">
              {t(
                "adminCompanyFields.confidentialityEmpty",
                "La confidentialité n'est pas encore activée pour cette entreprise. Ajoutez un premier niveau ci-dessous (ex. Public, Confidentiel) pour pouvoir restreindre l'accès à certains leviers par rôle ou par utilisateur."
              )}
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
              placeholder={t("adminCompanyFields.newLevelPlaceholder", "Ex : Confidentiel")}
              className="w-full max-w-xs rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            />
            <button
              onClick={addLevel}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
            >
              {t("adminCompanyFields.addLevel", "Ajouter le niveau")}
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminCompanyFields.directionsLabel", "Directions / services")}
          </label>
          {value.directions.length === 0 && (
            <p className="mt-1 rounded-lg border border-border bg-bg-surface p-3 text-xs text-text-secondary">
              {t(
                "adminCompanyFields.directionsEmpty",
                "Aucune direction/service configuré pour cette entreprise. Ajoutez-en pour permettre le rattachement des utilisateurs et le filtrage par direction sur le Plan Stratégique."
              )}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-2">
            {value.directions.map((direction) => (
              <span
                key={direction}
                className="flex items-center gap-1 rounded-full bg-bg-surface border border-border px-2.5 py-1 text-xs text-text-primary"
              >
                {direction}
                <button
                  onClick={() => removeDirection(direction)}
                  className="text-text-secondary hover:text-red-500"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={newDirection}
              onChange={(e) => setNewDirection(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDirection();
                }
              }}
              placeholder={t(
                "adminCompanyFields.newDirectionPlaceholder",
                "Ex : Direction Industrielle"
              )}
              className="w-full max-w-xs rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
            />
            <button
              onClick={addDirection}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-surface"
            >
              {t("adminCompanyFields.addDirection", "Ajouter la direction")}
            </button>
          </div>
        </div>

        {value.confidentialityLevels.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-secondary">
              {t(
                "adminCompanyFields.clearanceLabel",
                "Habilitations par profil — un levier au niveau X n'est visible que par les profils habilités pour X (un levier sans niveau reste visible par tous)"
              )}
            </label>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-bg-surface border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                      {t("adminCompanyFields.colProfile", "Profil")}
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
