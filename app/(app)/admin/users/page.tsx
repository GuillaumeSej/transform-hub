"use client";

import { UsersPanel } from "@/components/admin/UsersPanel";

/** Page globale de gestion des utilisateurs — la logique CRUD vit dans UsersPanel (partagée avec
 * l'onglet "Utilisateurs" du hub `/admin/companies/detail`, pré-filtré sur une seule entreprise). */
export default function AdminUsersPage() {
  return <UsersPanel />;
}
