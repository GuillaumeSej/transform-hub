"use client";

import { DateInput } from "@/components/shared/DateInput";
import { useState } from "react";
import { X } from "lucide-react";
import type { Role, RiskLevel } from "@/types";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { normalizeClearanceLevel } from "@/lib/confidentiality";
import { ConfidentialityLevelsEditor } from "@/components/admin/ConfidentialityLevelsEditor";

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

/** Rôles proposés dans la matrice d'habilitation par niveau de confidentialité (`roleClearance`).
 *  Liste volontairement DUPLIQUÉE ici (même convention que `RESPONSIBLE_ROLES` dans
 *  `IndicatorsEditor.tsx` / `ALL_ROLE_OPTIONS` dans `UsersPanel.tsx`) : chaque écran d'admin
 *  choisit son propre sous-ensemble de rôles, il n'y a pas de liste partagée à maintenir.
 *
 *  Historiquement limitée aux 6 rôles du Plan Performance alors même que `Company.roleClearance`
 *  est typé `Partial<Record<Role, string[]>>` (accepte n'importe quel `Role`) et que les entités
 *  du Plan Stratégique portent elles aussi un `confidentialityLevel` (`StrategicAxis`, `Chantier`,
 *  `Indicator`...) — lacune comblée round 25 en ajoutant les 6 rôles Stratégiques, à l'occasion de
 *  l'ajout de `comex_member` (transverse aux deux pistes, voir types/index.ts) qui en avait de
 *  toute façon besoin. */
export const OPERATIONAL_ROLES: { value: Role; labelKey: string; label: string }[] = [
  { value: "cto", labelKey: "roles.cto.short", label: "CTO" },
  // Libellé "Responsable de chantier" (renommage du libellé affiché — la clé technique `sponsor` reste
  // inchangée, toujours scopée WORKSTREAM, voir types/index.ts).
  { value: "sponsor", labelKey: "roles.sponsor.label", label: "Responsable de chantier" },
  { value: "lever", labelKey: "roles.lever.label", label: "Responsable de levier" },
  { value: "finance", labelKey: "roles.finance.label", label: "Finance" },
  { value: "hr", labelKey: "roles.hr.label", label: "RH" },
  { value: "ops", labelKey: "roles.ops.label", label: "Ops" },
  // Fondation vue consolidée multi-programmes (voir types/index.ts).
  {
    value: "program_sponsor",
    labelKey: "roles.programSponsor.label",
    label: "Commanditaire du programme",
  },
  {
    value: "program_owner",
    labelKey: "roles.programOwner.label",
    label: "Responsable du programme",
  },
  {
    value: "strategic_lead",
    labelKey: "roles.strategicLead.label",
    label: "Pilote du plan stratégique",
  },
  { value: "axis_sponsor", labelKey: "roles.axisSponsor.label", label: "Sponsor d'axe" },
  {
    value: "chantier_owner",
    labelKey: "roles.chantierOwner.label",
    label: "Sponsor de chantier",
  },
  {
    value: "chantier_contributor",
    labelKey: "roles.chantierContributor.label",
    label: "Responsable projet",
  },
  {
    value: "projet_contributor",
    labelKey: "roles.projetContributor.label",
    label: "Contributeur projet",
  },
  { value: "comex_member", labelKey: "roles.comexMember.label", label: "Membre du COMEX" },
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
  /** UN niveau par rôle (hiérarchique, voir `lib/confidentiality.ts`). Les tableaux legacy lus en
   *  base restent acceptés et sont normalisés à l'affichage vers leur niveau le plus haut. */
  roleClearance: Partial<Record<Role, string | string[]>>;
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
  levelUsage,
}: {
  value: CompanyFormState;
  onChange: (patch: Partial<CompanyFormState>) => void;
  /** Nb d'éléments/habilitations référençant chaque niveau de confidentialité (avertissement au
   *  retrait/renommage, voir ConfidentialityLevelsEditor). Absent = aucun avertissement. */
  levelUsage?: Record<string, number>;
}) {
  const { t } = useTranslation();
  const RISK_LEVELS = riskLevels(t);
  const [newDirection, setNewDirection] = useState("");

  const addDirection = () => {
    const direction = newDirection.trim();
    if (!direction || value.directions.includes(direction)) return;
    onChange({ directions: [...value.directions, direction] });
    setNewDirection("");
  };

  const removeDirection = (direction: string) => {
    onChange({ directions: value.directions.filter((d) => d !== direction) });
  };

  /** Choix UNIQUE du niveau d'un rôle ("" = aucun accès aux éléments confidentiels). */
  const setClearance = (role: Role, level: string) => {
    const next = { ...value.roleClearance };
    if (level) next[role] = level;
    else delete next[role];
    onChange({ roleClearance: next });
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
          <DateInput
            value={value.fyStart}
            onChange={(v) => onChange({ fyStart: v })}
            className="mt-1 w-full rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-text-secondary">
            {t("adminCompanyFields.fyEnd", "Fin exercice")}
          </label>
          <DateInput
            value={value.fyEnd}
            onChange={(v) => onChange({ fyEnd: v })}
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

        <ConfidentialityLevelsEditor
          levels={value.confidentialityLevels}
          roleClearance={value.roleClearance}
          usage={levelUsage}
          onChange={(patch) => onChange(patch)}
        />

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
                  type="button"
                  aria-label={t("common.remove", "Retirer")}
                  title={t("common.remove", "Retirer")}
                  onClick={() => removeDirection(direction)}
                  className="text-text-secondary hover:text-rag-red"
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
                "Habilitation par profil — un seul niveau par profil ; un élément au niveau X n'est visible que par les profils habilités au niveau X ou à un niveau supérieur (un élément sans niveau reste visible par tous)"
              )}
            </label>
            <p className="mt-1 text-xs text-text-secondary">
              {t(
                "adminCompanyFields.clearanceHierarchyHint",
                "Ce niveau donne aussi accès aux niveaux inférieurs."
              )}
            </p>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-bg-surface border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                      {t("adminCompanyFields.colProfile", "Profil")}
                    </th>
                    <th className="px-3 py-2 text-center font-semibold text-text-secondary">
                      {t("adminCompanyFields.colNoClearance", "Aucun")}
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
                  {OPERATIONAL_ROLES.map((r) => {
                    const current = normalizeClearanceLevel(
                      value.roleClearance[r.value],
                      value.confidentialityLevels
                    );
                    const currentRank = current ? value.confidentialityLevels.indexOf(current) : -1;
                    const roleLabel = t(r.labelKey, r.label);
                    return (
                      <tr key={r.value} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium text-text-primary">{roleLabel}</td>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="radio"
                            name={`clearance-${r.value}`}
                            aria-label={`${roleLabel} — ${t("adminCompanyFields.colNoClearance", "Aucun")}`}
                            checked={!current}
                            onChange={() => setClearance(r.value, "")}
                            className="h-4 w-4 border-border accent-bp-coral"
                          />
                        </td>
                        {value.confidentialityLevels.map((level, idx) => (
                          <td
                            key={level}
                            className={`px-3 py-2 text-center ${
                              idx < currentRank ? "bg-bp-coral/5" : ""
                            }`}
                          >
                            <input
                              type="radio"
                              name={`clearance-${r.value}`}
                              aria-label={`${roleLabel} — ${level}`}
                              checked={current === level}
                              onChange={() => setClearance(r.value, level)}
                              className="h-4 w-4 border-border accent-bp-coral"
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
