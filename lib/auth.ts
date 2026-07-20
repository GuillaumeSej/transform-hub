import type { AuthUser } from "@/types";

/**
 * Comptes de démo — connexion réelle par identifiant/mot de passe (mot de passe "test" pour les
 * 7), mais toujours des comptes de test, pas une vraie authentification. `name` doit correspondre
 * exactement au champ `owner` des leviers de démo qu'on veut voir apparaître pour ce compte (voir
 * data/mockData.ts, leviers rattachés au Lever Owner de test).
 */
export const TEST_USERS: AuthUser[] = [
  { username: "admin", password: "test", role: "admin", firstName: "Admin", lastName: "BeTrack", name: "Admin BeTrack", companyId: null },
  { username: "admin.c1", password: "test", role: "admin_entreprise", firstName: "Admin", lastName: "Acme", name: "Admin Acme", companyId: "c1" },
  { username: "test.cto", password: "test", role: "cto", firstName: "Jean", lastName: "Dupont", name: "Jean Dupont", companyId: "c1" },
  { username: "test.sponsor", password: "test", role: "sponsor", firstName: "Marie", lastName: "Martin", name: "Marie Martin", companyId: "c1" },
  { username: "test.lever", password: "test", role: "lever", firstName: "Pierre", lastName: "Bernard", name: "Pierre Bernard", companyId: "c1" },
  { username: "test.finance", password: "test", role: "finance", firstName: "Sophie", lastName: "Dubois", name: "Sophie Dubois", companyId: "c1" },
  { username: "test.hr", password: "test", role: "hr", firstName: "Claire", lastName: "Moreau", name: "Claire Moreau", companyId: "c1" },
  { username: "test.ops", password: "test", role: "ops", firstName: "Lucas", lastName: "Petit", name: "Lucas Petit", companyId: "c1" },
];

export function findUser(username: string, password: string): AuthUser | null {
  const u = username.trim().toLowerCase();
  return TEST_USERS.find((t) => t.username.toLowerCase() === u && t.password === password) ?? null;
}
