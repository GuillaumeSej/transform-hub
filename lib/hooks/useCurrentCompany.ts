"use client";

import { useEffect, useState } from "react";
import { subscribeCompanies } from "@/lib/firestore/admin";
import type { Company } from "@/types";

/** S'abonne au document `Company` de l'entreprise `companyId` (null tant qu'il n'est pas chargé,
 *  ou sans entreprise). Sert notamment à l'habilitation de confidentialité de la file finance
 *  « Réalisés à valider » (`useRealizedApprovalQueue`). */
export function useCurrentCompany(companyId: string | null | undefined): Company | null {
  const [company, setCompany] = useState<Company | null>(null);
  useEffect(() => {
    if (!companyId) {
      setCompany(null);
      return;
    }
    return subscribeCompanies(
      (companies) => setCompany(companies.find((c) => c.id === companyId) ?? null),
      companyId
    );
  }, [companyId]);
  return company;
}
