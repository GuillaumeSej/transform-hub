"use client";

import { MultiSelect } from "@/components/shared/MultiSelect";
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import type { AuditEntry, Company, Lever } from "@/types";
import { subscribeAuditLog, subscribeLevers, filterAuditByCompany } from "@/lib/firestore/levers";
import {
  subscribeAccountAudit,
  subscribeCompanies,
  type AccountAuditEntry,
} from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { intlTag } from "@/lib/format";

const ACTION_COLORS: Record<string, string> = {
  created: "bg-rag-green-light text-rag-green-dark",
  updated: "bg-info-blue-light text-info-blue",
  deleted: "bg-rag-red-light text-rag-red",
  completed: "bg-bp-purple/10 text-bp-purple",
  validated: "bg-rag-amber-light text-rag-amber",
  commented: "bg-neutral-100 text-neutral-600",
  // Demande de validation (voir lib/leversLogic.ts::requestLeverApproval/
  // approveLeverGate/rejectLeverApproval).
  approval_requested: "bg-rag-amber-light text-rag-amber",
  approval_approved: "bg-rag-amber-light text-rag-amber",
  approval_rejected: "bg-rag-red-light text-rag-red",
};

function actionLabels(t: (key: string, fallback?: string) => string): Record<string, string> {
  return {
    created: t("adminHistory.action.created", "Création"),
    updated: t("adminHistory.action.updated", "Modification"),
    deleted: t("adminHistory.action.deleted", "Suppression"),
    completed: t("adminHistory.action.completed", "Achèvement"),
    validated: t("adminHistory.action.validated", "Validation"),
    commented: t("adminHistory.action.commented", "Commentaire"),
    approval_requested: t("adminHistory.action.approvalRequested", "Validation demandée"),
    approval_approved: t("adminHistory.action.approvalApproved", "Demande validée"),
    approval_rejected: t("adminHistory.action.approvalRejected", "Validation rejetée"),
  };
}

/** Libellés des actions sur les COMPTES journalisées par admin-api (`adminApiAuditLog`, voir
 *  admin-api/src/lib/audit.ts). */
function accountActionLabels(
  t: (key: string, fallback?: string) => string
): Record<string, string> {
  return {
    rename_user: t("adminHistory.account.renameUser", "Renommage"),
    delete_user: t("adminHistory.account.deleteUser", "Suppression"),
    disable_user: t("adminHistory.account.disableUser", "Désactivation"),
    enable_user: t("adminHistory.account.enableUser", "Réactivation"),
    password_reset_link: t("adminHistory.account.passwordResetLink", "Lien de réinitialisation"),
  };
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(intlTag(), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

export default function AdminHistoryPage() {
  const { t } = useTranslation();
  const ACTION_LABELS = actionLabels(t);
  const ACCOUNT_ACTION_LABELS = accountActionLabels(t);
  const { user } = useRole();
  // Admin d'entreprise : toujours SA société. Admin global (companyId null) : le journal métier
  // est partitionné par entreprise (`leverMeta/{companyId}__auditLog`) et `subscribeAuditLog(null)`
  // ne renvoie rien — sans sélecteur, l'historique d'un admin global restait donc toujours vide.
  const ownCompanyId = user?.companyId ?? null;
  const isGlobalViewer = !!user && ownCompanyId === null;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const companyId = ownCompanyId ?? (selectedCompanyId || companies[0]?.id || null);
  const [accountAudit, setAccountAudit] = useState<AccountAuditEntry[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [levers, setLevers] = useState<Lever[]>([]);
  const [actionFilter, setActionFilter] = useState<string[]>([]);
  const [entityFilter, setEntityFilter] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isGlobalViewer) return;
    const unsub = subscribeCompanies(setCompanies, null);
    return unsub;
  }, [isGlobalViewer]);

  useEffect(() => {
    const unsub = subscribeAuditLog(setAudit, companyId);
    return unsub;
  }, [companyId]);

  // Actions sur les comptes (admin-api) : scopées à l'entreprise pour un admin d'entreprise
  // (imposé par firestore.rules), journal complet pour l'admin global, filtré ci-dessous sur
  // l'entreprise sélectionnée (+ les actions sur les comptes admin globaux, companyId null).
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeAccountAudit(setAccountAudit, ownCompanyId);
    return unsub;
  }, [user, ownCompanyId]);
  const visibleAccountAudit = isGlobalViewer
    ? accountAudit.filter((e) => e.companyId === companyId || e.companyId === null)
    : accountAudit;

  useEffect(() => {
    const unsub = subscribeLevers(setLevers, companyId);
    return unsub;
  }, [companyId]);

  const scopedAudit = filterAuditByCompany(audit, levers, companyId);

  const filtered = scopedAudit.filter((entry) => {
    if (actionFilter.length > 0 && !actionFilter.includes(entry.action)) return false;
    if (entityFilter.length > 0) {
      const e = entry.entity.toLowerCase();
      // Multi-sélection : l'entrée passe si elle correspond à AU MOINS un type d'entité coché.
      // Entités Plan Stratégique (round audit trail) — ids générés par `newId()`
      // (lib/hooks/useStrategicData.ts), toujours `{PREFIX}-...` : "ax-" (axe), "ch-" (chantier),
      // "ca-" (projet), "ind-" (indicateur) ; avec le tiret pour ne jamais chevaucher un futur
      // préfixe Performance à une seule lettre.
      const matchesEntity = (f: string) => {
        if (f === "lever") return e.startsWith("l") || e.startsWith("sl");
        if (f === "sublever") return e.startsWith("sl");
        if (f === "movement") return e.startsWith("mv");
        if (f === "employee") return e.startsWith("emp");
        if (f === "axis") return e.startsWith("ax-");
        if (f === "chantier") return e.startsWith("ch-");
        if (f === "projet") return e.startsWith("ca-");
        if (f === "indicator") return e.startsWith("ind-");
        return false;
      };
      if (!entityFilter.some(matchesEntity)) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const haystack =
        `${entry.user} ${entry.entity} ${entry.field} ${entry.old} ${entry.new}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => b.ts.localeCompare(a.ts));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <History size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">
          {t("adminHistory.title", "Historique des Modifications")}
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {isGlobalViewer && companies.length > 0 && (
          <select
            value={companyId ?? ""}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            aria-label={t("adminHistory.company", "Entreprise")}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("adminHistory.searchPlaceholder", "Rechercher...")}
          className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral w-56"
        />
        <MultiSelect
          label={t("adminHistory.filterAction", "Action")}
          placeholder={t("adminHistory.allActions", "Toutes les actions")}
          values={actionFilter}
          onChange={setActionFilter}
          options={[
            { value: "created", label: ACTION_LABELS.created },
            { value: "updated", label: ACTION_LABELS.updated },
            { value: "deleted", label: ACTION_LABELS.deleted },
            { value: "completed", label: ACTION_LABELS.completed },
            { value: "validated", label: ACTION_LABELS.validated },
            { value: "commented", label: ACTION_LABELS.commented },
            { value: "approval_requested", label: ACTION_LABELS.approval_requested },
            { value: "approval_approved", label: ACTION_LABELS.approval_approved },
            { value: "approval_rejected", label: ACTION_LABELS.approval_rejected },
          ]}
        />
        <MultiSelect
          label={t("adminHistory.filterEntity", "Entité")}
          placeholder={t("adminHistory.allEntities", "Toutes les entités")}
          values={entityFilter}
          onChange={setEntityFilter}
          options={[
            { value: "lever", label: t("dashboard.tableHeader.leverCount", "Leviers") },
            { value: "sublever", label: t("adminHistory.entity.sublevers", "Sous-leviers") },
            { value: "movement", label: t("adminHistory.entity.hrMovements", "Mouvements RH") },
            { value: "employee", label: t("adminHistory.entity.employees", "Employés") },
            { value: "axis", label: t("adminHistory.entity.axis", "Axes") },
            { value: "chantier", label: t("adminHistory.entity.chantier", "Chantiers") },
            { value: "projet", label: t("adminHistory.entity.projet", "Projets") },
            { value: "indicator", label: t("adminHistory.entity.indicator", "Indicateurs") },
          ]}
        />
        <span className="text-xs text-text-secondary">
          {t("adminHistory.entryCount", "{n} entrée(s)").replace("{n}", String(sorted.length))}
        </span>
      </div>

      {/* Desktop/tablette (>= sm) : tableau complet. En dessous de sm, 7 colonnes (dont
       * anciennes/nouvelles valeurs) ne peuvent pas tenir sans troncature illisible — remplacé
       * par des cartes empilées verticalement (voir ci-dessous). */}
      <div className="hidden rounded-xl border border-border overflow-x-auto sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-bg-elevated border-b border-border">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminHistory.column.date", "Date")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminHistory.column.user", "Utilisateur")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminHistory.column.action", "Action")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminHistory.column.entity", "Entité")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminHistory.column.field", "Champ")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminHistory.column.old", "Ancien")}
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                {t("adminHistory.column.new", "Nouveau")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((entry) => (
              <tr
                key={`${entry.ts}|${entry.user}|${entry.action}|${entry.entity}|${entry.field}`}
                className="border-b border-border hover:bg-bg-elevated/50"
              >
                <td className="px-4 py-2.5 font-mono text-xs text-text-secondary whitespace-nowrap">
                  {formatTimestamp(entry.ts)}
                </td>
                <td className="px-4 py-2.5 font-medium text-text-primary">{entry.user}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION_COLORS[entry.action] ?? "bg-neutral-100 text-neutral-600"}`}
                  >
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">
                  {entry.entity}
                </td>
                <td className="px-4 py-2.5 text-text-secondary">{entry.field}</td>
                <td
                  className="px-4 py-2.5 text-text-secondary max-w-[120px] truncate"
                  title={String(entry.old)}
                >
                  {String(entry.old)}
                </td>
                <td
                  className="px-4 py-2.5 text-text-secondary max-w-[120px] truncate"
                  title={String(entry.new)}
                >
                  {String(entry.new)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-text-secondary">
                  {t("adminHistory.empty", "Aucune entrée dans l'historique.")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile (< sm) : une carte par entrée, tout le contenu empilé verticalement. */}
      <div className="divide-y divide-border rounded-xl border border-border sm:hidden">
        {sorted.map((entry) => (
          <div
            key={`${entry.ts}|${entry.user}|${entry.action}|${entry.entity}|${entry.field}`}
            className="p-3"
          >
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-text-secondary">
                {formatTimestamp(entry.ts)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${ACTION_COLORS[entry.action] ?? "bg-neutral-100 text-neutral-600"}`}
              >
                {ACTION_LABELS[entry.action] ?? entry.action}
              </span>
            </div>
            <div className="mb-1.5 text-[13px] font-medium text-text-primary">
              {entry.user} ·{" "}
              <span className="font-mono text-[11px] text-text-secondary">{entry.entity}</span>
            </div>
            <div className="text-xs text-text-secondary">
              <span className="font-semibold text-text-primary">{entry.field}</span> :{" "}
              <span className="break-words">{String(entry.old)}</span>
              {" → "}
              <span className="break-words font-medium text-text-primary">{String(entry.new)}</span>
            </div>
          </div>
        ))}
        {sorted.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-text-secondary">
            {t("adminHistory.empty", "Aucune entrée dans l'historique.")}
          </div>
        )}
      </div>

      {/* Actions sur les comptes utilisateurs (renommage, suppression, désactivation, lien de
          réinitialisation) — journal `adminApiAuditLog` écrit par admin-api. */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-text-primary">
          {t("adminHistory.accountTitle", "Actions sur les comptes utilisateurs")}
        </h2>
        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-elevated border-b border-border">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminHistory.column.date", "Date")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminHistory.account.actor", "Par")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminHistory.column.action", "Action")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminHistory.account.target", "Compte")}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleAccountAudit.map((entry) => (
                <tr key={entry.id} className="border-b border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-text-secondary whitespace-nowrap">
                    {formatTimestamp(entry.ts)}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-text-primary">
                    {entry.actorUsername}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">
                    {ACCOUNT_ACTION_LABELS[entry.action] ?? entry.action}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-text-secondary">
                    {entry.targetNewUsername
                      ? `${entry.targetOldUsername} → ${entry.targetNewUsername}`
                      : entry.targetOldUsername}
                  </td>
                </tr>
              ))}
              {visibleAccountAudit.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-sm text-text-secondary">
                    {t("adminHistory.accountEmpty", "Aucune action sur les comptes.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
