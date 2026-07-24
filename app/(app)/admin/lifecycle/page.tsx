"use client";

import { useEffect, useState } from "react";
import { Workflow } from "lucide-react";
import type { Company } from "@/types";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";
import { LifecycleEditor } from "@/components/admin/LifecycleEditor";

/** Page globale de configuration du cycle de vie — garde son propre sélecteur d'entreprise ; la
 * logique d'édition vit dans LifecycleEditor, partagée avec l'onglet "Cycle de vie" du hub
 * `/admin/companies/detail`. Reste accessible à admin ET admin_entreprise (inchangé). */
export default function AdminLifecyclePage() {
  const { role, user } = useRole();
  const isEntAdmin = role === "admin_entreprise";
  const [companies, setCompanies] = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState("");

  useEffect(() => {
    const unsub = subscribeCompanies((list) => {
      setCompanies(list);
      if (!selectedCompany) {
        if (isEntAdmin && user?.companyId) {
          setSelectedCompany(user.companyId);
        } else if (list.length > 0) {
          setSelectedCompany(list[0].id);
        }
      }
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEntAdmin, user?.companyId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Workflow size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">Configuration du Cycle de Vie</h1>
      </div>

      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-text-secondary">Entreprise :</label>
        {isEntAdmin ? (
          <span className="text-sm font-medium text-text-primary">
            {companies.find((c) => c.id === user?.companyId)?.name ?? user?.companyId}
          </span>
        ) : (
          <select
            value={selectedCompany}
            onChange={(e) => setSelectedCompany(e.target.value)}
            className="rounded-lg border border-border bg-bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-bp-coral"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedCompany && <LifecycleEditor companyId={selectedCompany} />}
    </div>
  );
}
