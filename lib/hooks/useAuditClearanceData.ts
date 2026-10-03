"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeStrategicAxes } from "@/lib/firestore/strategicAxes";
import { subscribeChantiers } from "@/lib/firestore/chantiers";
import { subscribeChantierActions } from "@/lib/firestore/chantierActions";
import { subscribeIndicators } from "@/lib/firestore/indicators";
import { subscribeStrategicApprovals } from "@/lib/firestore/strategicApprovals";
import { subscribeCompanies } from "@/lib/firestore/admin";
import type { StrategicApproval } from "@/lib/strategicApprovals";
import type { AuditClearanceData } from "@/lib/strategicAuditClearance";
import type { Chantier, ChantierAction, Company, Indicator, StrategicAxis } from "@/types";

/**
 * Données de résolution de la confidentialité du journal (lot 6, lib/strategicAuditClearance.ts) :
 * axes / chantiers / projets / indicateurs / demandes de TOUTE l'entreprise (non filtrés, tous
 * programmes — le journal est partitionné par entreprise) et ses paramètres de confidentialité.
 * `enabled` false (lecteur admin, qui voit tout) : aucun abonnement.
 */
export function useAuditClearanceData(
  companyId: string | null | undefined,
  enabled: boolean
): AuditClearanceData {
  const [axes, setAxes] = useState<StrategicAxis[]>([]);
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [chantierActions, setActions] = useState<ChantierAction[]>([]);
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [approvals, setApprovals] = useState<StrategicApproval[]>([]);
  const [company, setCompany] = useState<Company | null | undefined>(undefined);

  useEffect(() => {
    setAxes([]);
    setChantiers([]);
    setActions([]);
    setIndicators([]);
    setApprovals([]);
    setCompany(undefined);
    if (!enabled || !companyId) return;
    const unsubs = [
      subscribeStrategicAxes(companyId, setAxes),
      subscribeChantiers(companyId, setChantiers),
      subscribeChantierActions(companyId, setActions),
      subscribeIndicators(companyId, setIndicators),
      subscribeStrategicApprovals(companyId, setApprovals),
      subscribeCompanies(
        (list) => setCompany(list.find((c) => c.id === companyId) ?? null),
        companyId
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [companyId, enabled]);

  return useMemo<AuditClearanceData>(
    () => ({
      axes,
      chantiers,
      chantierActions,
      indicators,
      approvals,
      // `undefined` (entreprise pas encore reçue) → `null` : en cours de chargement.
      confidentiality:
        company === undefined
          ? null
          : { roleClearance: company?.roleClearance, levels: company?.confidentialityLevels },
    }),
    [axes, chantiers, chantierActions, indicators, approvals, company]
  );
}
