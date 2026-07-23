"use client";

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import type { AuditEntry, Lever } from "@/types";
import { subscribeAuditLog, subscribeLevers, filterAuditByCompany } from "@/lib/firestore/levers";
import { useRole } from "@/lib/hooks/useRole";

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

export default function AdminHistoryPage() {
  const { user } = useRole();
  const companyId = user?.companyId ?? null;
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [levers, setLevers] = useState<Lever[]>([]);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const unsub = subscribeAuditLog(setAudit);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeLevers(setLevers, companyId);
    return unsub;
  }, [companyId]);

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
      <div className="flex items-center gap-3">
        <History size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">Historique des Modifications</h1>
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

      <div className="rounded-xl border border-border overflow-hidden">
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
  );
}
