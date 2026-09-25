import type { AuthUser, Company, Program, StrategicAxis } from "@/types";
import { resolveProgramType } from "@/lib/axisLogic";

/**
 * Mise en place d'une entreprise cliente par l'admin GLOBAL BearingPoint (checklist « Mise en
 * place » en tête de `/admin/companies/detail`). Helpers PURS (aucun accès Firestore) : l'appelant
 * fournit les données déjà abonnées, le statut de chaque étape est entièrement DÉRIVÉ des données —
 * jamais une case cochée à la main, pour qu'il ne puisse pas mentir sur l'état réel.
 *
 *  1. company          — l'espace entreprise existe (toujours vrai une fois sur la page détail) ;
 *  2. companyAdmin     — au moins un compte admin d'entreprise ACTIF (premier accès client) ;
 *  3. settings         — paramétrage initial : au moins un programme (module) configuré ;
 *  4. confidentiality  — échelle de confidentialité définie (au moins un niveau) ; l'admin
 *                        d'entreprise décidera ensuite qui accède à quel niveau ;
 *  5. strategicPlan    — plan stratégique importé : un programme stratégique porte au moins un axe.
 */

export type CompanyOnboardingStepId =
  "company" | "companyAdmin" | "settings" | "confidentiality" | "strategicPlan";

export type CompanyOnboardingStep = {
  id: CompanyOnboardingStepId;
  done: boolean;
  /** Compteur affiché à côté du libellé (nb d'admins, de programmes, de niveaux, d'axes). */
  count: number;
};

export type CompanyOnboardingInput = {
  company: Pick<Company, "id" | "confidentialityLevels"> | null | undefined;
  users: Pick<AuthUser, "companyId" | "isCompanyAdmin" | "disabled">[];
  programs: Pick<Program, "id" | "companyId" | "type">[];
  axes: Pick<StrategicAxis, "companyId" | "programId">[];
};

/** Admin d'entreprise = flag `isCompanyAdmin`, ou ancien format à rôle scalaire
 *  `role: "admin_entreprise"` (documents non migrés, voir lib/auth.ts::normalizeProfileFields).
 *  Un compte désactivé ne compte pas : il ne peut pas se connecter. */
export function isActiveCompanyAdmin(user: Pick<AuthUser, "isCompanyAdmin" | "disabled">): boolean {
  if (user.disabled) return false;
  const legacyRole = (user as { role?: unknown }).role;
  return !!user.isCompanyAdmin || legacyRole === "admin_entreprise";
}

export function computeCompanyOnboardingSteps(
  input: CompanyOnboardingInput
): CompanyOnboardingStep[] {
  const { company } = input;
  const companyId = company?.id;
  const users = companyId ? input.users.filter((u) => u.companyId === companyId) : [];
  const programs = companyId ? input.programs.filter((p) => p.companyId === companyId) : [];
  const strategicProgramIds = new Set(
    programs.filter((p) => resolveProgramType(p) === "strategic").map((p) => p.id)
  );
  const strategicAxes = companyId
    ? input.axes.filter((a) => a.companyId === companyId && strategicProgramIds.has(a.programId))
    : [];
  const adminCount = users.filter(isActiveCompanyAdmin).length;
  const levelCount = (company?.confidentialityLevels ?? []).filter((l) => l.trim() !== "").length;

  return [
    { id: "company", done: !!company, count: company ? 1 : 0 },
    { id: "companyAdmin", done: adminCount > 0, count: adminCount },
    { id: "settings", done: programs.length > 0, count: programs.length },
    { id: "confidentiality", done: levelCount > 0, count: levelCount },
    { id: "strategicPlan", done: strategicAxes.length > 0, count: strategicAxes.length },
  ];
}

// ─── Usage des niveaux de confidentialité ─────────────────────────────────────────────────────

type WithLevel = { confidentialityLevel?: string | null };

export type ConfidentialityUsageSources = {
  levers?: WithLevel[];
  axes?: WithLevel[];
  chantiers?: WithLevel[];
  indicators?: WithLevel[];
  users?: Pick<AuthUser, "confidentialityClearance">[];
};

/**
 * Nombre d'éléments (leviers, axes, chantiers, indicateurs) et d'habilitations individuelles
 * d'utilisateurs qui référencent chaque niveau, PAR NOM. Sert à avertir l'admin avant de retirer
 * ou renommer un niveau utilisé : ces références ne sont pas migrées, et un élément portant un
 * niveau inconnu de l'échelle devient invisible pour tout profil non-admin (voir
 * lib/confidentiality.ts::isLevelAccessible). `"all"` (habilitation totale) n'est pas un niveau.
 */
export function countConfidentialityLevelUsage(
  sources: ConfidentialityUsageSources
): Record<string, number> {
  const counts: Record<string, number> = {};
  const bump = (level: string | null | undefined) => {
    if (!level) return;
    counts[level] = (counts[level] ?? 0) + 1;
  };
  for (const list of [sources.levers, sources.axes, sources.chantiers, sources.indicators]) {
    for (const item of list ?? []) bump(item.confidentialityLevel);
  }
  for (const user of sources.users ?? []) {
    const clearance = user.confidentialityClearance;
    if (clearance == null || clearance === "all") continue;
    const levels = Array.isArray(clearance) ? clearance : [clearance];
    for (const level of Array.from(new Set(levels))) bump(level);
  }
  return counts;
}

/** Déplace le niveau d'index `from` d'un cran vers le haut (-1) ou le bas (+1) de l'échelle.
 *  Hors bornes = liste inchangée (nouvelle référence dans tous les cas). */
export function moveLevel(levels: string[], from: number, delta: -1 | 1): string[] {
  const to = from + delta;
  const next = [...levels];
  if (from < 0 || from >= levels.length || to < 0 || to >= levels.length) return next;
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** Renomme un niveau dans l'échelle ET dans la matrice `roleClearance` (les rôles habilités à
 *  l'ancien nom le restent au nouveau). Renvoie `null` si le nouveau nom est vide ou déjà pris. */
export function renameLevel<K extends string>(
  levels: string[],
  roleClearance: Partial<Record<K, string | string[]>>,
  from: string,
  to: string
): { levels: string[]; roleClearance: Partial<Record<K, string | string[]>> } | null {
  const target = to.trim();
  if (!target || (target !== from && levels.includes(target)) || !levels.includes(from)) {
    return null;
  }
  const nextClearance: Partial<Record<K, string | string[]>> = {};
  for (const role of Object.keys(roleClearance) as K[]) {
    const stored = roleClearance[role];
    if (stored == null) continue;
    nextClearance[role] = Array.isArray(stored)
      ? stored.map((l) => (l === from ? target : l))
      : stored === from
        ? target
        : stored;
  }
  return { levels: levels.map((l) => (l === from ? target : l)), roleClearance: nextClearance };
}
