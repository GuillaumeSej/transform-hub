import type { AuthUser } from "@/types";

/**
 * Comptes de démo — connexion réelle par identifiant/mot de passe (mot de passe "test" pour les
 * 7), mais toujours des comptes de test, pas une vraie authentification. `name` doit correspondre
 * exactement au champ `owner` des leviers de démo qu'on veut voir apparaître pour ce compte (voir
 * data/mockData.ts, leviers rattachés au Lever Owner de test).
 */
export const TEST_USERS: AuthUser[] = [
  { username: "admin", password: "test", role: "admin", name: "Admin BeTrack", companyId: null },
  { username: "admin.c1", password: "test", role: "admin_entreprise", name: "Admin Acme", companyId: "c1" },
  { username: "test.cto", password: "test", role: "cto", name: "Test CTO", companyId: "c1" },
  { username: "test.sponsor", password: "test", role: "sponsor", name: "Test Sponsor", companyId: "c1" },
  { username: "test.lever", password: "test", role: "lever", name: "Test Lever Owner", companyId: "c1" },
  { username: "test.finance", password: "test", role: "finance", name: "Test Finance", companyId: "c1" },
  { username: "test.hr", password: "test", role: "hr", name: "Test HR", companyId: "c1" },
  { username: "test.ops", password: "test", role: "ops", name: "Test Ops", companyId: "c1" },
];

export function findUser(username: string, password: string): AuthUser | null {
  const u = username.trim().toLowerCase();
  return TEST_USERS.find((t) => t.username.toLowerCase() === u && t.password === password) ?? null;
}
