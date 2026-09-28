import { describe, expect, it } from "vitest";
import { trailingSlashRedirectTarget } from "@/lib/notFoundRedirect";

describe("trailingSlashRedirectTarget", () => {
  it("retire le slash final en conservant requête et ancre", () => {
    expect(trailingSlashRedirectTarget("/transform-hub/login/", "", "", "/transform-hub")).toBe(
      "/transform-hub/login"
    );
    expect(
      trailingSlashRedirectTarget(
        "/transform-hub/levers/detail/",
        "?id=L1",
        "#actions",
        "/transform-hub"
      )
    ).toBe("/transform-hub/levers/detail?id=L1#actions");
    expect(trailingSlashRedirectTarget("/dashboard//")).toBe("/dashboard");
  });
  it("ne redirige pas sans slash final", () => {
    expect(
      trailingSlashRedirectTarget("/transform-hub/unknown", "", "", "/transform-hub")
    ).toBeNull();
  });
  it("ne redirige pas la racine ni le basePath", () => {
    expect(trailingSlashRedirectTarget("/")).toBeNull();
    expect(trailingSlashRedirectTarget("/transform-hub/", "", "", "/transform-hub")).toBeNull();
  });
});
