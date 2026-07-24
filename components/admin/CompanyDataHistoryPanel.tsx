"use client";

import { useEffect, useState } from "react";
import { Users, Target, Briefcase, FileSpreadsheet, Activity, History } from "lucide-react";
import type { Company, AuthUser, Project, Lever, SubLever, AuditEntry } from "@/types";
import { subscribeUsers, subscribeProjects } from "@/lib/firestore/admin";
import {
  subscribeLevers,
  subscribeSubLevers,
  subscribeAuditLog,
  filterAuditByCompany,
} from "@/lib/firestore/levers";
import { subscribeEmployees, subscribeMovements } from "@/lib/firestore/workforce";

const ACTION_COLORS: Record<string, string> = {
  created: "bg-green-100 text-green-700",
  updated: "bg-blue-100 text-blue-700",
  deleted: "bg-red-100 text-red-700",
  completed: "bg-purple-100 text-purple-700",
  validated: "bg-amber-100 text-amber-700",
  commented: "bg-gray-100 text-gray-600",
};

const ACTION_LABELS: Record<string, string> = {
  created: "Création",
  updated: "Modification",
  deleted: "Suppression",
  completed: "Achèvement",
  validated: "Validation",
  commented: "Commentaire",
};

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
  const companyId = company.id;
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [levers, setLevers] = useState<Lever[]>([]);
  const [subLevers, setSubLevers] = useState<SubLever[]>([]);
  const [employeesCount, setEmployeesCount] = useState(0);
  const [movementsCount, setMovementsCount] = useState(0);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const unsub1 = subscribeUsers(setUsers);
    const unsub2 = subscribeProjects(setProjects);
    return () => {
      unsub1();
      unsub2();
    };
  }, []);

  useEffect(() => {
    const unsub1 = subscribeLevers(setLevers, companyId);
    const unsub2 = subscribeSubLevers(setSubLevers, companyId);
    const unsub3 = subscribeAuditLog(setAudit);
    return () => {
      unsub1();
      unsub2();
      unsub3();
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
  const cProjects = projects.filter((p) => p.companyId === companyId);
  const userRoles: Record<string, number> = {};
  cUsers.forEach((u) => {
    userRoles[u.role] = (userRoles[u.role] || 0) + 1;
  });

  const scopedAudit = filterAuditByCompany(audit, levers, companyId);
  const filtered = scopedAudit.filter((entry) => {
    if (actionFilter !== "all" && entry.action !== actionFilter) return false;
    if (entityFilter !== "all") {
      const e = entry.entity.toLowerCase();
      if (entityFilter === "lever" && !e.startsWith("l") && !e.startsWith("sl")) return false;
      if (entityFilter === "sublever" && !e.startsWith("sl")) return false;
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
          Résumé des données — {company.name}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Users size={14} />
              <span className="text-xs font-semibold">Utilisateurs</span>
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
              <span className="text-xs font-semibold">Projets</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{cProjects.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Target size={14} />
              <span className="text-xs font-semibold">Leviers</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{levers.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Target size={14} />
              <span className="text-xs font-semibold">Sous-leviers</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{subLevers.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <FileSpreadsheet size={14} />
              <span className="text-xs font-semibold">Employés (global)</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{employeesCount}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Activity size={14} />
              <span className="text-xs font-semibold">Mouvements (global)</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{movementsCount}</div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <History size={18} className="text-bp-coral" />
          <h2 className="text-sm font-bold text-text-primary">Historique des modifications</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher..."
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral w-56"
          />
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            <option value="all">Toutes les actions</option>
            <option value="created">Création</option>
            <option value="updated">Modification</option>
            <option value="deleted">Suppression</option>
            <option value="completed">Achèvement</option>
            <option value="validated">Validation</option>
            <option value="commented">Commentaire</option>
          </select>
          <select
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            <option value="all">Toutes les entités</option>
            <option value="lever">Leviers</option>
            <option value="sublever">Sous-leviers</option>
            <option value="movement">Mouvements RH</option>
            <option value="employee">Employés</option>
          </select>
          <span className="text-xs text-text-secondary">{sorted.length} entrée(s)</span>
        </div>

        <div className="rounded-xl border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-bg-elevated border-b border-border">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Date
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Utilisateur
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Action
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Entité
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Champ
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Ancien
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-text-secondary">
                  Nouveau
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
                    Aucune entrée dans l&apos;historique.
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
