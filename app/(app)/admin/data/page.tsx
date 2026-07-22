"use client";

import { useEffect, useState } from "react";
import { Database, Building2, Users, Target, Briefcase, FileSpreadsheet, Activity } from "lucide-react";
import type { Company, AuthUser, Project, Lever, SubLever, Employee, WorkforceMovement } from "@/types";
import { subscribeCompanies, subscribeUsers, subscribeProjects } from "@/lib/firestore/admin";
import { subscribeLevers, subscribeSubLevers } from "@/lib/firestore/levers";
import { subscribeEmployees, subscribeMovements } from "@/lib/firestore/workforce";

function StatusDot({ filled }: { filled: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${filled ? "bg-green-500" : "bg-gray-300"}`} />
  );
}

type CompanyStats = {
  company: Company;
  users: number;
  userRoles: Record<string, number>;
  projects: number;
  levers: number;
  subLevers: number;
  employees: number;
  hasLevers: boolean;
  hasEmployees: boolean;
};

export default function AdminDataPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [levers, setLevers] = useState<Lever[]>([]);
  const [subLevers, setSubLevers] = useState<SubLever[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [movements, setMovements] = useState<WorkforceMovement[]>([]);

  useEffect(() => {
    const unsub1 = subscribeCompanies(setCompanies);
    const unsub2 = subscribeUsers(setUsers);
    const unsub3 = subscribeProjects(setProjects);
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  useEffect(() => {
    const unsub1 = subscribeLevers(setLevers);
    const unsub2 = subscribeSubLevers(setSubLevers);
    return () => { unsub1(); unsub2(); };
  }, []);

  useEffect(() => {
    const unsub1 = subscribeEmployees(setEmployees);
    const unsub2 = subscribeMovements(setMovements);
    return () => { unsub1(); unsub2(); };
  }, []);

  const companyStats: CompanyStats[] = companies.map((c) => {
    const cUsers = users.filter((u) => u.companyId === c.id);
    const cProjects = projects.filter((p) => p.companyId === c.id);
    const cLevers = levers.filter((l) => l.companyId === c.id);
    const cSubLevers = subLevers.filter((s) => s.companyId === c.id);

    const userRoles: Record<string, number> = {};
    cUsers.forEach((u) => {
      userRoles[u.role] = (userRoles[u.role] || 0) + 1;
    });

    return {
      company: c,
      users: cUsers.length,
      userRoles,
      projects: cProjects.length,
      levers: cLevers.length,
      subLevers: cSubLevers.length,
      employees: employees.length,
      hasLevers: cLevers.length > 0 || cSubLevers.length > 0,
      hasEmployees: employees.length > 0,
    };
  });

  const globalUserRoles: Record<string, number> = {};
  users.forEach((u) => {
    globalUserRoles[u.role] = (globalUserRoles[u.role] || 0) + 1;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Database size={22} className="text-bp-coral" />
        <h1 className="text-xl font-bold text-text-primary">Vue d&apos;ensemble des Données</h1>
      </div>

      <div className="rounded-xl border border-border bg-bg-elevated p-5 space-y-4">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Résumé global</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Building2 size={14} />
              <span className="text-xs font-semibold">Entreprises</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{companies.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Users size={14} />
              <span className="text-xs font-semibold">Utilisateurs</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{users.length}</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(globalUserRoles).map(([role, count]) => (
                <span key={role} className="rounded-full bg-bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                  {role}: {count}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Briefcase size={14} />
              <span className="text-xs font-semibold">Projets</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{projects.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Target size={14} />
              <span className="text-xs font-semibold">Leviers</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{levers.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Target size={14} />
              <span className="text-xs font-semibold">Sous-leviers</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{subLevers.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <FileSpreadsheet size={14} />
              <span className="text-xs font-semibold">Employés</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{employees.length}</div>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-text-secondary">
              <Activity size={14} />
              <span className="text-xs font-semibold">Mouvements</span>
            </div>
            <div className="text-2xl font-bold text-text-primary">{movements.length}</div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Par entreprise</h2>
        {companyStats.length === 0 && (
          <div className="rounded-xl border border-border bg-bg-elevated p-8 text-center text-sm text-text-secondary">
            Aucune entreprise enregistrée.
          </div>
        )}
        {companyStats.map((cs) => (
          <div key={cs.company.id} className="rounded-xl border border-border bg-bg-elevated p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={18} className="text-bp-coral" />
                <span className="text-sm font-bold text-text-primary">{cs.company.name}</span>
                <span className="text-xs text-text-secondary">({cs.company.industry})</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <StatusDot filled={cs.hasLevers} />
                  <span className="text-[10px] text-text-secondary">Leviers</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusDot filled={cs.hasEmployees} />
                  <span className="text-[10px] text-text-secondary">Employés</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Users size={12} />
                  <span className="text-xs font-semibold">Utilisateurs</span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.users}</div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(cs.userRoles).map(([role, count]) => (
                    <span key={role} className="rounded-full bg-bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                      {role}: {count}
                    </span>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Briefcase size={12} />
                  <span className="text-xs font-semibold">Projets</span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.projects}</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Target size={12} />
                  <span className="text-xs font-semibold">Leviers</span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.levers}</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Target size={12} />
                  <span className="text-xs font-semibold">Sous-leviers</span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.subLevers}</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <FileSpreadsheet size={12} />
                  <span className="text-xs font-semibold">Employés</span>
                </div>
                <div className="text-lg font-bold text-text-primary">{cs.employees}</div>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Activity size={12} />
                  <span className="text-xs font-semibold">Mouvements</span>
                </div>
                <div className="text-lg font-bold text-text-primary">{movements.length}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
