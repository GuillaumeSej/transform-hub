import type { AuthUser } from "@/types";

/**
 * Comptes de démo — connexion réelle par identifiant/mot de passe (mot de passe "test" pour les
 * 6), mais toujours des comptes de test, pas une vraie authentification. `name` doit correspondre
 * exactement au champ `owner` des leviers de démo qu'on veut voir apparaître pour ce compte (voir
 * data/mockData.ts, leviers rattachés au Lever Owner de test).
 */
export const TEST_USERS: AuthUser[] = [
  { username: "test.cto", password: "test", role: "cto", name: "Test CTO" },
  { username: "test.sponsor", password: "test", role: "sponsor", name: "Test Sponsor" },
  { username: "test.lever", password: "test", role: "lever", name: "Test Lever Owner" },
  { username: "test.finance", password: "test", role: "finance", name: "Test Finance" },
  { username: "test.hr", password: "test", role: "hr", name: "Test HR" },
  { username: "test.ops", password: "test", role: "ops", name: "Test Ops" },
];

export function findUser(username: string, password: string): AuthUser | null {
  const u = username.trim().toLowerCase();
  return TEST_USERS.find((t) => t.username.toLowerCase() === u && t.password === password) ?? null;
}
