import { describe, expect, it } from "vitest";
import { accountActionDenial, type AccountAction } from "../../admin-api/src/lib/accountRules";

// Protection des PAIRS admins d'entreprise côté admin-api — miroir de firestore.rules
// (`adminUsers` : keepsPeerCompanyAdmin + règle de suppression).
const companyAdmin = { slug: "alice.acme", isGlobalAdmin: false };
const globalAdmin = { slug: "root", isGlobalAdmin: true };
const peerAdmin = { isCompanyAdmin: true };
const legacyPeerAdmin = { role: "admin_entreprise" };
const plainUser = { role: "lever" };
const ALL: AccountAction[] = ["delete", "disable", "enable", "rename", "reset_password"];

describe("accountActionDenial (admin-api)", () => {
  it("refuse toute action d'un admin d'entreprise sur un AUTRE admin d'entreprise", () => {
    for (const action of ALL) {
      expect(accountActionDenial(companyAdmin, "bob.acme", peerAdmin, action)).toMatch(
        /administrateur global/
      );
      expect(accountActionDenial(companyAdmin, "bob.acme", legacyPeerAdmin, action)).not.toBeNull();
    }
  });

  it("laisse un admin d'entreprise gérer les comptes non-admin", () => {
    for (const action of ALL) {
      expect(accountActionDenial(companyAdmin, "carl.acme", plainUser, action)).toBeNull();
    }
  });

  it("admin global : autorisé sur un admin d'entreprise", () => {
    for (const action of ALL) {
      expect(accountActionDenial(globalAdmin, "bob.acme", peerAdmin, action)).toBeNull();
    }
  });

  it("propre compte : renommage / réinitialisation permis, jamais suppression ni désactivation", () => {
    expect(accountActionDenial(companyAdmin, "alice.acme", peerAdmin, "rename")).toBeNull();
    expect(accountActionDenial(companyAdmin, "alice.acme", peerAdmin, "reset_password")).toBeNull();
    expect(accountActionDenial(companyAdmin, "alice.acme", peerAdmin, "delete")).toMatch(
      /propre compte/
    );
    expect(accountActionDenial(companyAdmin, "alice.acme", peerAdmin, "disable")).toMatch(
      /propre compte/
    );
    expect(accountActionDenial(globalAdmin, "root", {}, "delete")).toMatch(/propre compte/);
  });
});
