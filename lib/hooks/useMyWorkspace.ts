"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeCompanies } from "@/lib/firestore/admin";
import { useActiveProgram } from "@/lib/hooks/useActiveProgram";
import { useCompanyUsers } from "@/lib/hooks/useCompanyUsers";
import { useRole } from "@/lib/hooks/useRole";
import { useBeTrackData } from "@/lib/hooks/useStorage";
import { useStrategicApprovals } from "@/lib/hooks/useStrategicApprovals";
import { useStrategicData } from "@/lib/hooks/useStrategicData";
import { resolveProgramType } from "@/lib/axisLogic";
import { hrToday } from "@/lib/hrEngine";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { buildMyWorkspace, type MyWorkspaceStrategicInput } from "@/lib/myWorkspace";
import type { MyWorkspace } from "@/lib/myWorkspaceTypes";
import { getAuthorizedPrograms, getStrategicProfiles } from "@/lib/roleProfiles";
import type { BeTrackData, Company } from "@/types";

/**
 * Données du portail « Mon espace » (`/me`) — branche les hooks déjà utilisés par les pages
 * (`useRole`, `useBeTrackData`, `useActiveProgram`, `useStrategicData`, `useStrategicApprovals`)
 * sur le moteur pur `buildMyWorkspace` (lib/myWorkspace.ts).
 *
 * Plan Stratégique : `useStrategicData` ne charge qu'UN programme à la fois. On prend le programme
 * actif s'il est stratégique ; sinon, pour un utilisateur ayant un profil stratégique, son premier
 * programme stratégique autorisé (pour que ses projets/validations remontent même quand il navigue
 * sur un Plan Performance). Aucun abonnement stratégique sinon.
 */
export function useMyWorkspace(): { workspace: MyWorkspace; loading: boolean } {
  const { t } = useTranslation();
  const { user } = useRole();
  const companyId = user?.companyId ?? null;
  const performance = useBeTrackData(companyId, user);
  const { programs, activeProgram, loading: programsLoading } = useActiveProgram();
  const users = useCompanyUsers(companyId);

  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => subscribeCompanies(setCompanies, companyId), [companyId]);

  const strategicProgramId = useMemo(() => {
    if (activeProgram && resolveProgramType(activeProgram) === "strategic") return activeProgram.id;
    if (!user || getStrategicProfiles(user).length === 0) return null;
    return (
      getAuthorizedPrograms(user, programs).find((p) => resolveProgramType(p) === "strategic")
        ?.id ?? null
    );
  }, [activeProgram, programs, user]);

  const strategicData = useStrategicData(
    strategicProgramId ? companyId : null,
    strategicProgramId,
    user
  );
  const strategicApprovals = useStrategicApprovals({
    user,
    companyId: strategicProgramId ? companyId : null,
    programId: strategicProgramId,
    data: strategicData,
  });

  const strategic = useMemo<MyWorkspaceStrategicInput | null>(
    () =>
      strategicProgramId
        ? {
            programId: strategicProgramId,
            axes: strategicData.axes,
            chantiers: strategicData.chantiers,
            chantierActions: strategicData.chantierActions,
            indicators: strategicData.indicators,
            measurements: strategicData.measurements,
            projetProgress: strategicData.projetProgress,
            approvals: strategicApprovals.approvals,
          }
        : null,
    [
      strategicProgramId,
      strategicData.axes,
      strategicData.chantiers,
      strategicData.chantierActions,
      strategicData.indicators,
      strategicData.measurements,
      strategicData.projetProgress,
      strategicApprovals.approvals,
    ]
  );

  // `useBeTrackData` renvoie un NOUVEL objet à chaque rendu (données + mutations étalées) : on
  // reconstruit un `BeTrackData` à partir de ses champs, eux stables (mémoïsés dans le hook).
  const {
    program,
    workstreams,
    levers,
    workforce,
    operations,
    alerts,
    alertStates,
    audit,
    comments,
    leverStatuses,
    riskLevels,
    leverTypes,
    geographies,
    functions,
    pnlAccounts,
  } = performance;
  const performanceData = useMemo<BeTrackData>(
    () => ({
      program,
      workstreams,
      levers,
      workforce,
      operations,
      alerts,
      alertStates,
      audit,
      comments,
      leverStatuses,
      riskLevels,
      leverTypes,
      geographies,
      functions,
      pnlAccounts,
    }),
    [
      program,
      workstreams,
      levers,
      workforce,
      operations,
      alerts,
      alertStates,
      audit,
      comments,
      leverStatuses,
      riskLevels,
      leverTypes,
      geographies,
      functions,
      pnlAccounts,
    ]
  );

  const today = hrToday();

  const workspace = useMemo(
    () =>
      buildMyWorkspace(
        { user, performance: performanceData, strategic, programs, users, companies, today },
        t
      ),
    [user, performanceData, strategic, programs, users, companies, today, t]
  );

  const loading =
    !!user &&
    (programsLoading ||
      !performance.leversLoaded ||
      (!!strategicProgramId && (strategicData.loading || strategicApprovals.loading)));

  return { workspace, loading };
}
