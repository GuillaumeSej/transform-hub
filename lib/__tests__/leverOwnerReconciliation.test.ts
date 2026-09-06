import { describe, expect, it } from "vitest";
import { matchLeverOwner, type OwnerMatchCandidate } from "@/lib/leverOwnerReconciliation";

const users: OwnerMatchCandidate[] = [
  { username: "marc.dubois", name: "Marc Dubois" },
  { username: "isabelle.roy", name: "Isabelle Roy" },
  { username: "marc.dubois2", name: "Marc Dubois" },
  { username: "francois.leroy", name: "François Leroy" },
];

describe("matchLeverOwner", () => {
  it("returns a unique match on an exact name", () => {
    expect(matchLeverOwner("Isabelle Roy", users)).toEqual({
      kind: "unique",
      candidate: { username: "isabelle.roy", name: "Isabelle Roy" },
    });
  });

  it("matches ignoring case", () => {
    expect(matchLeverOwner("isabelle roy", users)).toEqual({
      kind: "unique",
      candidate: { username: "isabelle.roy", name: "Isabelle Roy" },
    });
  });

  it("matches ignoring surrounding whitespace", () => {
    expect(matchLeverOwner("  Isabelle Roy  ", users)).toEqual({
      kind: "unique",
      candidate: { username: "isabelle.roy", name: "Isabelle Roy" },
    });
  });

  it("matches ignoring accents", () => {
    expect(matchLeverOwner("Francois Leroy", users)).toEqual({
      kind: "unique",
      candidate: { username: "francois.leroy", name: "François Leroy" },
    });
  });

  it("returns homonyms when 2+ candidates share the same normalized name", () => {
    const result = matchLeverOwner("Marc Dubois", users);
    expect(result.kind).toBe("homonyms");
    if (result.kind === "homonyms") {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates.map((c) => c.username).sort()).toEqual([
        "marc.dubois",
        "marc.dubois2",
      ]);
    }
  });

  it("returns none when no account matches", () => {
    expect(matchLeverOwner("Jean Personne", users)).toEqual({ kind: "none" });
  });

  it("returns none for empty owner text", () => {
    expect(matchLeverOwner("", users)).toEqual({ kind: "none" });
  });

  it("returns none for whitespace-only owner text", () => {
    expect(matchLeverOwner("   ", users)).toEqual({ kind: "none" });
  });

  it("returns none against an empty company user list", () => {
    expect(matchLeverOwner("Marc Dubois", [])).toEqual({ kind: "none" });
  });
});
