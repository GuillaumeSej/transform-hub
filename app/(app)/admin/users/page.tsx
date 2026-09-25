"use client";

import { useState } from "react";
import { Lock, Users } from "lucide-react";
import { UsersPanel } from "@/components/admin/UsersPanel";
import { ConfidentialityPanel } from "@/components/admin/ConfidentialityPanel";
import { useTranslation } from "@/lib/i18n/useTranslation";

type TabId = "users" | "confidentiality";

/** Page globale de gestion des utilisateurs — la logique CRUD vit dans UsersPanel (partagée avec
 * l'onglet "Utilisateurs" du hub `/admin/companies/detail`, pré-filtré sur une seule entreprise).
 * Second onglet « Confidentialité » : l'admin d'entreprise y choisit le niveau par défaut de chaque
 * rôle (échelle définie par BearingPoint) — voir ConfidentialityPanel. Onglet local plutôt qu'une
 * nouvelle route pour ne pas toucher à la nav. */
export default function AdminUsersPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<TabId>("users");
  const tabs: { id: TabId; label: string; icon: typeof Users }[] = [
    { id: "users", label: t("admin.confidentiality.tabUsers", "Utilisateurs"), icon: Users },
    {
      id: "confidentiality",
      label: t("admin.confidentiality.tab", "Confidentialité"),
      icon: Lock,
    },
  ];

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex gap-2 border-b border-border pb-2">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                active
                  ? "bg-bp-coral text-white"
                  : "border border-border text-text-secondary hover:bg-bg-elevated"
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          );
        })}
      </div>
      {tab === "users" ? (
        <UsersPanel />
      ) : (
        <ConfidentialityPanel onEditUsers={() => setTab("users")} />
      )}
    </div>
  );
}
