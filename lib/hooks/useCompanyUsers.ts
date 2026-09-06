"use client";

import { useEffect, useState } from "react";
import { subscribeUsers } from "@/lib/firestore/admin";
import type { AuthUser } from "@/types";

/**
 * S'abonne aux comptes `AuthUser` d'UNE entreprise (`companyId`) — extrait de `LeverForm.tsx` et
 * `LeverOwnerReconciliationDialog.tsx` (round "ownership réel", voir `lib/leverOwnerReconciliation.ts`)
 * qui ont tous deux besoin de la même liste pour rattacher un levier à un compte réel. Même contrat
 * que `subscribeUsers` : `companyId` absent/null -> liste vide (pas d'admin global ici, ce hook sert
 * uniquement des écrans scopés à une entreprise).
 */
export function useCompanyUsers(companyId: string | null | undefined): AuthUser[] {
  const [users, setUsers] = useState<AuthUser[]>([]);

  useEffect(() => {
    if (!companyId) {
      setUsers([]);
      return;
    }
    const unsub = subscribeUsers(setUsers, companyId);
    return unsub;
  }, [companyId]);

  return users;
}
