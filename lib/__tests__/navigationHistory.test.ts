import { describe, expect, it } from "vitest";
import { shouldGoBack } from "@/lib/navigationHistory";

const base = { navigatedInApp: false, historyLength: 3, referrer: "", origin: "https://app.test" };

describe("shouldGoBack", () => {
  it("goes back after an in-app navigation", () => {
    expect(shouldGoBack({ ...base, navigatedInApp: true })).toBe(true);
  });
  it("falls back on a fresh tab / direct link", () => {
    expect(shouldGoBack({ ...base, historyLength: 1, navigatedInApp: true })).toBe(false);
    expect(shouldGoBack(base)).toBe(false);
    expect(shouldGoBack({ ...base, referrer: "https://mail.example.com/x" })).toBe(false);
    expect(shouldGoBack({ ...base, referrer: "not a url" })).toBe(false);
  });
  it("same-origin referrer counts as in-app history", () => {
    expect(shouldGoBack({ ...base, referrer: "https://app.test/levers" })).toBe(true);
  });
});
