"use client";

import { useEffect, useState } from "react";
import { Users, Target, Briefcase, FileSpreadsheet, Activity, History } from "lucide-react";
import type { Company, AuthUser, Program, Lever, AuditEntry } from "@/types";
import { subscribeUsers, subscribePrograms } from "@/lib/firestore/admin";
import { subscribeLevers, subscribeAuditLog, filterAuditByCompany } from "@/lib/firestore/levers";
import { subscribeEmployees, subscribeMovements } from "@/lib/firestore/workforce";
import { useTranslation } from "@/lib/i18n/useTranslation";

const ACTION_COLORS: Record<string, string> = {
  created: "bg-green-100 text-green-700",
  updated: "bg-blue-100 text-blue-700",
  deleted: "bg-red-100 text-red-700",
  completed: "bg-purple-100 text-purple-700",
  validated: "bg-amber-100 text-amber-700",
  commented: "bg-gray-100 text-gray-600",
};

function actionLabels(t: (key: string, fallback?: string) => string): Record<string, string> {
  return {
    created: t("adminCompanyHistory.action.created", "Création"),
    updated: t("adminCompanyHistory.action.updated", "Modification"),
    deleted: t("adminCompanyHistory.action.deleted", "Suppression"),
    completed: t("adminCompanyHistory.action.completed", "Achèvement"),
    validated: t("adminCompanyHistory.action.validated", "Validation"),
    commented: t("adminCompanyHistory.action.commented", "Commentaire"),
  };
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("fr-FR", {
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

/**
 * Onglet "Données & Historique" du hub `/admin/companies/detail` : combine la carte de statistiques
 * par entreprise de `admin/data/page.tsx` et le tableau d'audit de `admin/history/page.tsx`,
 * scopés sur une seule entreprise (`companyId`). Réutilise les mêmes abonnements/helpers
 * Firestore que les deux pages globales, qui restent inchangées et continuent de fonctionner de
 * leur côté (vue multi-entreprises pour data, vue de son unique entreprise pour un
 * admin_entreprise sur history).
 */
export function CompanyDataHistoryPanel({ company }: { company: Company }) {
  const { t } = useTranslation();
  const ACTION_LABELS = actionLabels(t);
  const companyId = company.id;
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [levers, setLevers] = useState<Lever[]>([]);
  const [employeesCount, setEmployeesCount] = useState(0);
  const [movementsCount, setMovementsCount] = useState(0);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const unsub1 = subscribeUsers(setUsers);
    const unsub2 = subscribePrograms(setPrograms);
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  useEffect(() => {
    const unsub1 = subscribeLevers(setLevers, companyId);
    const unsub2 = subscribeAuditLog(setAudit);
    return () => {
      unsub1();
      unsub2();
    };
  }, [companyId]);

  useEffect(() => {
    // L'effectif RH n'est pas encore multi-tenant (voir lib/firestore/workforce.ts) : on affiche
    // le total global tel quel, comme le fait déjà admin/data/page.tsx.
    const unsub1 = subscribeEmployees((list) => setEmployeesCount(list.length));
    const unsub2 = subscribeMovements((list) => setMovementsCount(list.length));
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  const cUsers = users.filter((u) => u.companyId === companyId);
  const cPrograms = programs.filter((p) => p.companyId === companyId);
  const userRoles: Record<string, number> = {};
  cUsers.forEach((u) => {
    userRoles[u.role] = (userRoles[u.role] || 0) + 1;
  });

  const scopedAudit = filterAuditByCompany(audit, levers, companyId);
  const filtered = scopedAudit.filter((entry) => {
    if (actionFilter !== "all" && entry.action !== actionFilter) return false;
    if (entityFilter !== "all") {
      const e = entry.entity.toLowerCase();
      if (entityFilter === "lever" && !e.startsWith("l")) return false;
      if (entityFilter === "movement" && !e.startsWith("mv")) return false;
      if (entityFilter === "employee" && !e.startsWith("emp")) return false;
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
      <div className="rounded-xl border border-border bg-bg-elevated p-5 space-y-4">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          {t("adminCompanyHistory.summaryTitle", "Résumé des données — {name}").replace(
            "{name}",
            company.name
          )}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Users size={14} />
              <span className="text-xs font-semibold">
                {t("adminCompanyHistory.users", "Utilisateurs")}
              </span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{cUsers.length}</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(userRoles).map(([role, count]) => (
                <span
                  key={role}
                  className="rounded-full bg-bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
                >
                  {role}: {count}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Briefcase size={14} />
              <span className="text-xs font-semibold">
                {t("adminCompanyHistory.programs", "Programmes")}
              </span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{cPrograms.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Target size={14} />
              <span className="text-xs font-semibold">
                {t("adminCompanyHistory.levers", "Leviers")}
              </span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{levers.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <FileSpreadsheet size={14} />
              <span className="text-xs font-semibold">
                {t("adminCompanyHistory.employeesGlobal", "Employés (global)")}
              </span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{employeesCount}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Activity size={14} />
              <span className="text-xs font-semibold">
                {t("adminCompanyHistory.movementsGlobal", "Mouvements (global)")}
              </span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{movementsCount}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <History size={18} className="text-bp-coral" />
          <h2 className="text-sm font-bold text-text-primary">
            {t("adminCompanyHistory.title", "Historique des modifications")}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("adminCompanyHistory.searchPlaceholder", "Rechercher...")}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral w-56"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            <option value="all">{t("adminCompanyHistory.allActions", "Toutes les actions")}</option>
            <option value="created">{ACTION_LABELS.created}</option>
            <option value="updated">{ACTION_LABELS.updated}</option>
            <option value="deleted">{ACTION_LABELS.deleted}</option>
            <option value="completed">{ACTION_LABELS.completed}</option>
            <option value="validated">{ACTION_LABELS.validated}</option>
            <option value="commented">{ACTION_LABELS.commented}</option>
          </select>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            <option value="all">
              {t("adminCompanyHistory.allEntities", "Toutes les entités")}
            </option>
            <option value="lever">{t("adminCompanyHistory.levers", "Leviers")}</option>
            <option value="movement">
              {t("adminCompanyHistory.movementsHr", "Mouvements RH")}
            </option>
            <option value="employee">{t("adminCompanyHistory.employees", "Employés")}</option>
          </select>
          <span className="text-xs text-text-secondary">
            {t("adminCompanyHistory.count", "{n} entrée(s)").replace("{n}", String(sorted.length))}
          </span>
        </div>

        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-elevated border-b border-border">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminCompanyHistory.colDate", "Date")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminCompanyHistory.colUser", "Utilisateur")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminCompanyHistory.colAction", "Action")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminCompanyHistory.colEntity", "Entité")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminCompanyHistory.colField", "Champ")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminCompanyHistory.colOld", "Ancien")}
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  {t("adminCompanyHistory.colNew", "Nouveau")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, idx) => (
                <tr key={idx} className="border-b border-border hover:bg-bg-elevated/50">
                  <td className="px-4 py-2.5 font-mono text-xs text-text-secondary whitespace-nowrap">
                    {formatTimestamp(entry.ts)}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-text-primary">{entry.user}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION_COLORS[entry.action] ?? "bg-gray-100 text-gray-600"}`}
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
                    {t("adminCompanyHistory.empty", "Aucune entrée dans l'historique.")}
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
