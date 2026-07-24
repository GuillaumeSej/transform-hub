"use client";

import { useEffect, useState } from "react";
import { Network } from "lucide-react";
import type { Company } from "@/types";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";
import { HierarchyEditor } from "@/components/admin/HierarchyEditor";

/** Page globale de configuration de l'arborescence financière — garde son propre sélecteur
 * d'entreprise ; la logique d'édition (niveaux + valeurs) vit dans HierarchyEditor, partagée avec
 * l'onglet "Hiérarchie" du hub `/admin/companies/[id]` (déjà scopé sur une entreprise). Réservé au
 * global admin (voir AppShell — retiré de la nav admin_entreprise). */
export default function AdminHierarchyPage() {
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
        <Network size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">Arborescence financière</h1>
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

      {selectedCompany && <HierarchyEditor companies={companies} companyId={selectedCompany} />}
    </div>
  );
}
