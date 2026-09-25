"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Pencil } from "lucide-react";
import type { AuthUser, Company, Program, ProgramType, Role } from "@/types";
import { STRATEGIC_ROLES, PERFORMANCE_ROLES } from "@/types";
import {
  subscribeCompanies,
  subscribePrograms,
  subscribeUsers,
  saveCompanyRoleClearance,
} from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useRegisterUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { Button } from "@/components/shared/Button";
import { OPERATIONAL_ROLES } from "@/components/admin/CompanyFieldsEditor";
import { resolveProgramType } from "@/lib/axisLogic";
import { normalizeRoleClearance } from "@/lib/confidentiality";
import {
  buildRoleClearanceMatrix,
  describeUserClearance,
  usersWithClearanceOverride,
  withRoleLevel,
  type UserClearanceSummary,
} from "@/lib/confidentialityAdmin";

/**
 * Onglet « Confidentialité » de /admin/users (décision PO) : l'échelle des niveaux est DÉFINIE par
 * BearingPoint (admin global, fiche entreprise) et affichée ici en lecture seule ; l'admin
 * d'entreprise y choisit le niveau par défaut de chaque rôle (`Company.roleClearance`) et retrouve
 * les utilisateurs portant une surcharge individuelle (éditée dans l'onglet Utilisateurs).
 * Un admin global choisit l'entreprise ; un admin d'entreprise est limité à la sienne (et
 * firestore.rules lui interdit de toucher `confidentialityLevels`).
 */
export function ConfidentialityPanel({ onEditUsers }: { onEditUsers?: () => void } = {}) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { user, isGlobalAdmin, isCompanyAdmin } = useRole();
  const ownCompanyId = !isGlobalAdmin && isCompanyAdmin ? (user?.companyId ?? null) : null;

  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const companyId = ownCompanyId ?? selectedId;
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [draft, setDraft] = useState<Partial<Record<Role, string>> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeCompanies(setCompanies, ownCompanyId), [ownCompanyId]);
  useEffect(() => {
    if (!ownCompanyId && !selectedId && companies[0]) setSelectedId(companies[0].id);
  }, [ownCompanyId, selectedId, companies]);
  useEffect(() => {
    if (!companyId) return;
    const unsubUsers = subscribeUsers(
      (list) => setUsers(list.filter((u) => u.companyId === companyId)),
      companyId
    );
    const unsubPrograms = subscribePrograms(
      (list) => setPrograms(list.filter((p) => p.companyId === companyId)),
      companyId
    );
    setDraft(null);
    return () => {
      unsubUsers();
      unsubPrograms();
    };
  }, [companyId]);

  const company = companies.find((c) => c.id === companyId);
  const levels = useMemo(() => company?.confidentialityLevels ?? [], [company]);
  const saved = useMemo(
    () => normalizeRoleClearance(company?.roleClearance, levels),
    [company, levels]
  );
  const current = draft ?? saved;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);
  useRegisterUnsavedChanges(`admin:confidentiality:${companyId || "none"}`, dirty);

  const canEdit =
    !!company && (isGlobalAdmin || (isCompanyAdmin && user?.companyId === company.id));
  const programTypes = Array.from(new Set(programs.map(resolveProgramType))) as ProgramType[];
  const rows = buildRoleClearanceMatrix(users, programTypes, current, levels);
  const overrides = usersWithClearanceOverride(users);

  const roleLabel = (role: Role) => {
    const def = OPERATIONAL_ROLES.find((r) => r.value === role);
    return def ? t(def.labelKey, def.label) : role;
  };
  const trackLabel = (role: Role) =>
    STRATEGIC_ROLES.includes(role) && PERFORMANCE_ROLES.includes(role)
      ? t("admin.confidentiality.trackBoth", "Transverse")
      : STRATEGIC_ROLES.includes(role)
        ? t("admin.confidentiality.trackStrategic", "Plan stratégique")
        : t("admin.confidentiality.trackPerformance", "Plan de performance");

  const summaryLabel = (s: UserClearanceSummary): string => {
    switch (s.kind) {
      case "all":
        return t("admin.confidentiality.summaryAll", "Tous les niveaux");
      case "none":
        return t("admin.confidentiality.summaryNone", "Aucun accès");
      case "level":
        return s.level;
      case "admin":
        return t("admin.confidentiality.summaryAdmin", "Administrateur (accès total)");
      default:
        return t(
          "admin.confidentiality.inheritWithLevel",
          "Hérite du rôle (niveau {level})"
        ).replace("{level}", s.level ?? t("admin.confidentiality.noLevel", "aucun"));
    }
  };

  const save = async () => {
    if (!company || !canEdit || !draft) return;
    setSaving(true);
    try {
      await saveCompanyRoleClearance(company.id, draft);
      setDraft(null);
      showToast(
        t("admin.confidentiality.savedTitle", "Habilitations enregistrées"),
        t(
          "admin.confidentiality.savedBody",
          "Les niveaux par défaut des rôles ont été mis à jour."
        ),
        "success"
      );
    } catch (err) {
      showToast(
        t("admin.confidentiality.saveError", "Échec de l'enregistrement"),
        err instanceof Error ? err.message : String(err),
        "error"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {!ownCompanyId && companies.length > 0 && (
        <div className="flex items-center gap-3">
          <label
            htmlFor="confidentiality-company"
            className="text-xs font-semibold text-text-secondary"
          >
            {t("admin.confidentiality.company", "Entreprise")}
          </label>
          <select
            id="confidentiality-company"
            value={selectedId}
            disabled={dirty}
            onChange={(e) => setSelectedId(e.target.value)}
            className="rounded-lg border border-border bg-bg-elevated px-3 py-1.5 text-sm"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {!company ? (
        <p className="text-sm text-text-secondary">
          {t("admin.confidentiality.loading", "Chargement…")}
        </p>
      ) : levels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-surface p-6 text-center">
          <Lock size={20} className="mx-auto text-text-secondary" aria-hidden />
          <p className="mt-2 text-sm font-semibold text-text-primary">
            {t("admin.confidentiality.emptyTitle", "Aucun niveau défini — contactez BearingPoint")}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            {t(
              "admin.confidentiality.emptyBody",
              "L'échelle des niveaux de confidentialité est définie par BearingPoint lors de la mise en place de votre entreprise."
            )}
          </p>
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("admin.confidentiality.scaleTitle", "Échelle des niveaux")}
            </h2>
            <p className="text-xs text-text-secondary">
              {t(
                "admin.confidentiality.scaleDefinedBy",
                "Défini par BearingPoint lors de la mise en place"
              )}
              {" · "}
              {t(
                "admin.confidentiality.scaleHint",
                "Du moins au plus restreint ; un niveau donne accès à tous les niveaux inférieurs."
              )}
            </p>
            <ol className="flex flex-wrap items-center gap-2">
              {levels.map((level, idx) => (
                <li key={level} className="flex items-center gap-2">
                  <span className="rounded-full border border-border bg-bg-surface px-3 py-1 text-xs font-semibold text-text-primary">
                    {idx + 1}. {level}
                  </span>
                  {idx < levels.length - 1 && (
                    <span aria-hidden className="text-text-secondary">
                      ›
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </section>

          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-text-primary">
                {t("admin.confidentiality.matrixTitle", "Niveau par défaut de chaque rôle")}
              </h2>
              {canEdit && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!dirty || saving}
                    onClick={() => setDraft(null)}
                  >
                    {t("common.cancel", "Annuler")}
                  </Button>
                  <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={save}>
                    {t("common.save", "Enregistrer")}
                  </Button>
                </div>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="text-xs text-text-secondary">
                {t(
                  "admin.confidentiality.noRoles",
                  "Aucun rôle utilisé dans cette entreprise pour l'instant."
                )}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-bg-surface">
                      <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                        {t("admin.confidentiality.colRole", "Rôle")}
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-text-secondary">
                        {t("admin.confidentiality.colUsers", "Utilisateurs")}
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-text-secondary">
                        {t("admin.confidentiality.colLevel", "Niveau par défaut")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.role} className="border-b border-border last:border-0">
                        <td className="px-3 py-2">
                          <span className="font-medium text-text-primary">
                            {roleLabel(row.role)}
                          </span>
                          <span className="ml-2 text-text-secondary">{trackLabel(row.role)}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-secondary">
                          {row.userCount}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            aria-label={`${roleLabel(row.role)} — ${t("admin.confidentiality.colLevel", "Niveau par défaut")}`}
                            value={row.level ?? ""}
                            disabled={!canEdit || saving}
                            onChange={(e) =>
                              setDraft(withRoleLevel(current, row.role, e.target.value, levels))
                            }
                            className="w-full min-w-40 rounded-lg border border-border bg-bg-elevated px-2 py-1 text-xs"
                          >
                            <option value="">
                              {t("admin.confidentiality.levelNone", "Aucun niveau confidentiel")}
                            </option>
                            {levels.map((level) => (
                              <option key={level} value={level}>
                                {level}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-text-secondary">
              {t(
                "admin.confidentiality.matrixHint",
                "Les administrateurs ont toujours accès à tout. Un utilisateur cumulant plusieurs rôles hérite du niveau le plus élevé."
              )}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("admin.confidentiality.overridesTitle", "Surcharges individuelles")}
            </h2>
            {overrides.length === 0 ? (
              <p className="text-xs text-text-secondary">
                {t(
                  "admin.confidentiality.overridesEmpty",
                  "Aucun utilisateur n'a d'habilitation individuelle : tous héritent du niveau de leur rôle."
                )}
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {overrides.map((u) => {
                  const inherited = describeUserClearance(
                    { ...u, confidentialityClearance: undefined },
                    current,
                    levels
                  );
                  return (
                    <li
                      key={u.username}
                      className="flex flex-wrap items-center gap-3 px-3 py-2 text-xs"
                    >
                      <span className="min-w-40 font-medium text-text-primary">{u.name}</span>
                      <span className="rounded-full bg-bp-coral/10 px-2 py-0.5 font-semibold text-text-primary">
                        {summaryLabel(describeUserClearance(u, current, levels))}
                      </span>
                      <span className="text-text-secondary">
                        {t("admin.confidentiality.insteadOf", "au lieu de")}{" "}
                        {summaryLabel(inherited)}
                      </span>
                      {onEditUsers && canEdit && (
                        <button
                          type="button"
                          onClick={onEditUsers}
                          className="ml-auto flex items-center gap-1 text-text-secondary hover:text-text-primary"
                        >
                          <Pencil size={12} aria-hidden />
                          {t("admin.confidentiality.editInUsers", "Modifier dans Utilisateurs")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
