import { useEffect, useMemo, useState } from "react";
import { subscribeEmployees } from "@/lib/firestore/workforce";
import { fteByDepartment } from "@/lib/workforceLogic";
import type { Employee } from "@/types";

/**
 * Base ETP ENTREPRISE (`Employee[]`, module Workforce/Plan Performance — `lib/firestore/
 * workforce.ts`), exposée telle quelle au Plan Stratégique — round 13. Abonnement direct,
 * indépendant du programme actif : la base ETP est scopée par `companyId` uniquement (voir
 * `lib/firestore/workforce.ts`), jamais par programme, contrairement à `ChantierStaffing`.
 *
 * Point d'entrée UNIQUE pour tout composant stratégique qui a besoin de savoir « quelles équipes
 * existent réellement dans l'entreprise, et combien d'ETP chacune a-t-elle ? » —
 * `ChantierStaffingEditor` (sélecteur d'équipe à la saisie), `EffectifsPageClient` (comparaison
 * besoin/disponible), `StaffingImportButton`/`lib/staffingExcelImport.ts` (validation d'import) en
 * dérivent tous leur référentiel d'équipes plutôt que de coder une liste en dur (voir le retrait de
 * `StaffingFunction`, `types/index.ts`).
 */
export function useCompanyDepartments(companyId: string | null | undefined) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!companyId) {
      setEmployees([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = subscribeEmployees((list) => {
      setEmployees(list);
      setLoading(false);
    }, companyId);
    return unsub;
  }, [companyId]);

  const fteByDept = useMemo(() => fteByDepartment(employees), [employees]);
  const departmentNames = useMemo(
    () => Object.keys(fteByDept).sort((a, b) => a.localeCompare(b)),
    [fteByDept]
  );

  return { employees, loading, fteByDept, departmentNames };
}
