import { useEffect, useMemo, useState } from "react";
import { subscribeEmployees, subscribeMovements } from "@/lib/firestore/workforce";
import { currentFteByDepartment } from "@/lib/hrEngine";
import { fteByDepartment } from "@/lib/workforceLogic";
import type { Employee, WorkforceMovement } from "@/types";

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
export function useCompanyDepartments(
  companyId: string | null | undefined,
  /** `true` : `fteByDept` = effectif ACTUEL (base + mouvements RH réalisés, comme l'« Effectif
   *  actuel » de la Base ETP — audit KPI-03). Défaut `false` : base brute des fiches employé (les
   *  appelants qui n'ont besoin que des noms d'équipes n'ouvrent pas d'abonnement supplémentaire). */
  options: { withRealizedMovements?: boolean } = {}
) {
  const withMovements = options.withRealizedMovements ?? false;
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [movements, setMovements] = useState<WorkforceMovement[]>([]);
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

  useEffect(() => {
    if (!companyId || !withMovements) {
      setMovements([]);
      return;
    }
    return subscribeMovements(setMovements, companyId);
  }, [companyId, withMovements]);

  const baseFteByDept = useMemo(() => fteByDepartment(employees), [employees]);
  const fteByDept = useMemo(
    () => (withMovements ? currentFteByDepartment(baseFteByDept, movements) : baseFteByDept),
    [withMovements, baseFteByDept, movements]
  );
  const departmentNames = useMemo(
    () => Object.keys(baseFteByDept).sort((a, b) => a.localeCompare(b)),
    [baseFteByDept]
  );

  return { employees, loading, fteByDept, departmentNames };
}
