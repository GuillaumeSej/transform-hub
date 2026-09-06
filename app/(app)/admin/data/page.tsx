"use client";

import { useEffect, useState } from "react";
import {
  Database,
  Building2,
  Users,
  Target,
  Briefcase,
  FileSpreadsheet,
  Activity,
} from "lucide-react";
import type { Company, AuthUser, Program, Lever, Employee, WorkforceMovement } from "@/types";
import { subscribeCompanies, subscribeUsers, subscribePrograms } from "@/lib/firestore/admin";
import { subscribeLevers } from "@/lib/firestore/levers";
import { subscribeEmployees, subscribeMovements } from "@/lib/firestore/workforce";
import { useRole } from "@/lib/hooks/useRole";
import { useTranslation } from "@/lib/i18n/useTranslation";

function StatusDot({ filled }: { filled: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${filled ? "bg-green-500" : "bg-gray-300"}`}
    />
  );
}

type CompanyStats = {
  company: Company;
  users: number;
  userRoles: Record<string, number>;
  programs: number;
  levers: number;
  employees: number;
  movements: number;
  hasLevers: boolean;
  hasEmployees: boolean;
};

/**
 * Effectifs/mouvements RH par entreprise (`leverMeta/{companyId}__workforce*`, voir
 * lib/firestore/workforce.ts) : un admin_entreprise (`companyId` non-null) n'a jamais besoin que
 * du document de SA propre entreprise — `useEffect` classique, un seul abonnement. Un admin
 * global (`companyId` null) doit en revanche ouvrir un abonnement PAR entreprise (chacune a son
 * propre document désormais isolé) et agréger côté client : ce hook fait exactement ça, et se
 * re-souscrit proprement à chaque changement de la liste des entreprises.
 */
function useWorkforceByCompany(companies: Company[], companyId: string | null) {
  const [byCompany, setByCompany] = useState<
    Record<string, { employees: Employee[]; movements: WorkforceMovement[] }>
  >({});

  useEffect(() => {
    if (companyId) {
      // admin_entreprise : un seul document, celui de sa propre entreprise.
      const unsubE = subscribeEmployees(
        (list) =>
          setByCompany((prev) => ({
            ...prev,
            [companyId]: { employees: list, movements: prev[companyId]?.movements ?? [] },
          })),
        companyId
      );
      const unsubM = subscribeMovements(
        (list) =>
          setByCompany((prev) => ({
            ...prev,
            [companyId]: { employees: prev[companyId]?.employees ?? [], movements: list },
          })),
        companyId
      );
      return () => {
        unsubE();
        unsubM();
      };
    }

    // admin global : un abonnement par entreprise connue, agrégé côté client (voir docstring).
    const unsubs = companies.flatMap((c) => [
      subscribeEmployees(
        (list) =>
          setByCompany((prev) => ({
            ...prev,
            [c.id]: { employees: list, movements: prev[c.id]?.movements ?? [] },
          })),
        c.id
      ),
      subscribeMovements(
        (list) =>
          setByCompany((prev) => ({
            ...prev,
            [c.id]: { employees: prev[c.id]?.employees ?? [], movements: list },
          })),
        c.id
      ),
    ]);
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, companies.map((c) => c.id).join(",")]);

  return byCompany;
}

export default function AdminDataPage() {
  const { t } = useTranslation();
  const { user } = useRole();
  const companyId = user?.companyId ?? null;
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [levers, setLevers] = useState<Lever[]>([]);

  useEffect(() => {
    const unsub1 = subscribeCompanies(setCompanies, companyId);
    const unsub2 = subscribeUsers(setUsers, companyId);
    const unsub3 = subscribePrograms(setPrograms, companyId);
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [companyId]);

  useEffect(() => {
    const unsub1 = subscribeLevers(setLevers, companyId);
    return () => {
      unsub1();
    };
  }, [companyId]);

  const visibleCompanies = companyId ? companies.filter((c) => c.id === companyId) : companies;
  const visibleUsers = companyId ? users.filter((u) => u.companyId === companyId) : users;
  const visiblePrograms = companyId ? programs.filter((p) => p.companyId === companyId) : programs;

  const workforceByCompany = useWorkforceByCompany(visibleCompanies, companyId);
  // Résumé global = somme des VRAIS effectifs/mouvements de chaque entreprise visible (jamais le
  // même document réutilisé pour toutes — voir useWorkforceByCompany).
  const employees = visibleCompanies.flatMap((c) => workforceByCompany[c.id]?.employees ?? []);
  const movements = visibleCompanies.flatMap((c) => workforceByCompany[c.id]?.movements ?? []);

  const companyStats: CompanyStats[] = visibleCompanies.map((c) => {
    const cUsers = visibleUsers.filter((u) => u.companyId === c.id);
    const cPrograms = visiblePrograms.filter((p) => p.companyId === c.id);
    const cLevers = levers.filter((l) => l.companyId === c.id);
    const cEmployees = workforceByCompany[c.id]?.employees ?? [];
    const cMovements = workforceByCompany[c.id]?.movements ?? [];

    const userRoles: Record<string, number> = {};
    cUsers.forEach((u) => {
      userRoles[u.role] = (userRoles[u.role] || 0) + 1;
    });

    return {
      company: c,
      users: cUsers.length,
      userRoles,
      programs: cPrograms.length,
      levers: cLevers.length,
      employees: cEmployees.length,
      movements: cMovements.length,
      hasLevers: cLevers.length > 0,
      hasEmployees: cEmployees.length > 0,
    };
  });

  const globalUserRoles: Record<string, number> = {};
  visibleUsers.forEach((u) => {
    globalUserRoles[u.role] = (globalUserRoles[u.role] || 0) + 1;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">
          {t("adminData.title", "Vue d'ensemble des Données")}
        </h1>
      </div>

      <div className="rounded-xl border border-border bg-bg-elevated p-5 space-y-4">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          {t("adminData.globalSummary", "Résumé global")}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Building2 size={14} />
              <span className="text-xs font-semibold">{t("nav.companies", "Entreprises")}</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{visibleCompanies.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Users size={14} />
              <span className="text-xs font-semibold">{t("nav.users", "Utilisateurs")}</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{visibleUsers.length}</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(globalUserRoles).map(([role, count]) => (
                <span
                  key={role}
                  className="rounded-full bg-bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
                >
                  {role}: {count}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Briefcase size={14} />
              <span className="text-xs font-semibold">{t("adminData.programs", "Programmes")}</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{visiblePrograms.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Target size={14} />
              <span className="text-xs font-semibold">
                {t("dashboard.tableHeader.leverCount", "Leviers")}
              </span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{levers.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <FileSpreadsheet size={14} />
              <span className="text-xs font-semibold">{t("adminData.employees", "Employés")}</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{employees.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Activity size={14} />
              <span className="text-xs font-semibold">
                {t("adminData.movements", "Mouvements")}
              </span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{movements.length}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          {t("adminData.byCompany", "Par entreprise")}
        </h2>
        {visibleCompanies.length === 0 && (
          <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center text-sm text-text-secondary">
            {t("adminData.noCompanies", "Aucune entreprise enregistrée.")}
          </div>
        )}
        {companyStats.map((cs) => (
          <div
            key={cs.company.id}
            className="rounded-xl border border-border bg-bg-elevated p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-bp-coral" />
                <span className="text-sm font-bold text-text-primary">{cs.company.name}</span>
                <span className="text-xs text-text-secondary">({cs.company.industry})</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <StatusDot filled={cs.hasLevers} />
                  <span className="text-[10px] text-text-secondary">
                    {t("dashboard.tableHeader.leverCount", "Leviers")}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusDot filled={cs.hasEmployees} />
                  <span className="text-[10px] text-text-secondary">
                    {t("adminData.employees", "Employés")}
                  </span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Users size={12} />
                  <span className="text-xs font-semibold">{t("nav.users", "Utilisateurs")}</span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.users}</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(cs.userRoles).map(([role, count]) => (
                    <span
                      key={role}
                      className="rounded-full bg-bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
                    >
                      {role}: {count}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Briefcase size={12} />
                  <span className="text-xs font-semibold">
                    {t("adminData.programs", "Programmes")}
                  </span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.programs}</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Target size={12} />
                  <span className="text-xs font-semibold">
                    {t("dashboard.tableHeader.leverCount", "Leviers")}
                  </span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.levers}</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <FileSpreadsheet size={12} />
                  <span className="text-xs font-semibold">
                    {t("adminData.employees", "Employés")}
                  </span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.employees}</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Activity size={12} />
                  <span className="text-xs font-semibold">
                    {t("adminData.movements", "Mouvements")}
                  </span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.movements}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
