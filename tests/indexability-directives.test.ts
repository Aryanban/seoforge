import { describe, it, expect } from "vitest";
import { hasNoindex, xRobotsHasNoindex, extractPageMeta } from "../src/checks/registry.js";

describe("robots directives (Google robots meta spec)", () => {
  it("treats none as noindex and matches whole tokens", () => {
    expect(hasNoindex("none")).toBe(true);
    expect(hasNoindex("index, follow")).toBe(false);
    expect(hasNoindex("NOINDEX,nofollow")).toBe(true);
  });

  it("scopes X-Robots-Tag directives to the named crawler", () => {
    expect(xRobotsHasNoindex("noindex")).toBe(true);
    expect(xRobotsHasNoindex("bingbot: noindex")).toBe(false);
    expect(xRobotsHasNoindex("googlebot: noindex, nofollow")).toBe(true);
    expect(xRobotsHasNoindex("max-snippet: 20, noindex")).toBe(true);
    expect(xRobotsHasNoindex("unavailable_after: 25 Jun 2010 15:00:00 PST")).toBe(false);
  });

  it("combines robots and googlebot meta tags, case-insensitively", () => {
    const meta = (html: string) => extractPageMeta(html, "https://s.test/", "https://s.test/", {}, [], "strict");
    expect(meta('<meta name="ROBOTS" content="none">').isIndexable).toBe(false);
    expect(meta('<meta name="robots" content="index"><meta name="googlebot" content="noindex">').isIndexable).toBe(false);
    expect(meta('<meta name="robots" content="noimageindex">').isIndexable).toBe(true);
  });

  it("resolves a relative self-canonical before comparing", () => {
    const m = extractPageMeta('<link rel="canonical" href="/shop/">', "https://s.test/shop", "https://s.test/shop", {}, [], "strict");
    expect(m.canonicalMatches).toBe(true);
  });
});
