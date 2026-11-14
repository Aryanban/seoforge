import { describe, it, expect } from "vitest";
import http from "node:http";
import { parseRobots, normalizeRobotsTxt, fetchRobots, isDisallowed, ROBOTS_MAX_BYTES } from "../src/crawl/robots.js";

// Cases adapted from Google's reference parser tests (github.com/google/robotstxt,
// robots_test.cc, Apache-2.0) and RFC 9309 §2.2.
const allowed = (txt: string, url: string, ua = "FooBot") => parseRobots("http://foo.bar/robots.txt", txt).isAllowed(url, ua);

const CASES: Array<[string, string, string, boolean]> = [
  ["longest match: allow wins", "user-agent: FooBot\ndisallow: /x/\nallow: /x/page", "http://foo.bar/x/page", true],
  ["equal length: allow wins", "user-agent: FooBot\ndisallow: /x\nallow: /x", "http://foo.bar/x", true],
  ["wildcard", "user-agent: FooBot\ndisallow: /*.php", "http://foo.bar/a/b.php", false],
  ["$ anchors end", "user-agent: FooBot\ndisallow: /*.php$", "http://foo.bar/a.php?x", true],
  ["user-agent is case-insensitive", "user-agent: foobot\ndisallow: /", "http://foo.bar/a", false],
  ["user-agent version suffix", "user-agent: FooBot/1.2\ndisallow: /", "http://foo.bar/a", false],
  ["same-agent groups merge", "user-agent: FooBot\ndisallow: /a\nuser-agent: FooBot\ndisallow: /b", "http://foo.bar/b", false],
  ["specific group beats *", "user-agent: *\ndisallow: /\nuser-agent: FooBot\nallow: /", "http://foo.bar/a", true],
  ["unreserved %-encoding is not decoded", "user-agent: FooBot\ndisallow: /%7Ea", "http://foo.bar/~a", true],
  ["non-ASCII path matches encoded URL", "user-agent: FooBot\ndisallow: /ä", "http://foo.bar/%C3%A4", false],
  ["empty disallow allows", "user-agent: FooBot\ndisallow:", "http://foo.bar/a", true],
  ["consecutive user-agent lines share rules", "user-agent: BarBot\nuser-agent: FooBot\ndisallow: /", "http://foo.bar/a", false],
  ["rules before any user-agent are ignored", "disallow: /\nuser-agent: FooBot\nallow: /x", "http://foo.bar/y", true],
  ["BOM is ignored", "﻿user-agent: FooBot\ndisallow: /", "http://foo.bar/a", false],
  ["CR line endings", "user-agent: FooBot\rdisallow: /", "http://foo.bar/a", false],
  ["missing colon (Google accepts)", "user-agent FooBot\ndisallow /", "http://foo.bar/a", false],
  ["'disalow' typo (Google accepts)", "user-agent: FooBot\ndisalow: /", "http://foo.bar/a", false],
  ["'useragent' typo (Google accepts)", "useragent: FooBot\ndisallow: /", "http://foo.bar/a", false],
  ["'user agent' with a space (Google accepts)", "user agent: FooBot\ndisallow: /", "http://foo.bar/a", false],
  ["unknown keys are ignored", "user-agent: FooBot\nfoo: bar\ndisallow: /a", "http://foo.bar/b", true],
];

describe("robots.txt conformance (Google reference cases)", () => {
  it.each(CASES)("%s", (_name, txt, url, want) => {
    expect(allowed(txt, url)).toBe(want);
  });

  it("reads sitemap lines with a missing colon", () => {
    expect(parseRobots("http://foo.bar/robots.txt", "sitemap http://foo.bar/s.xml").getSitemaps()).toEqual(["http://foo.bar/s.xml"]);
  });

  it("leaves comments and unknown lines alone", () => {
    expect(normalizeRobotsTxt("# disallow: /\nfoo bar")).toBe("# disallow: /\nfoo bar");
  });

  it("ignores content after 500 KiB", () => {
    const pad = "# " + "x".repeat(ROBOTS_MAX_BYTES) + "\n";
    expect(allowed(`user-agent: FooBot\n${pad}disallow: /`, "http://foo.bar/a")).toBe(true);
  });
});

describe("robots.txt HTTP status handling (RFC 9309 §2.3.1)", () => {
  async function withStatus(status: number) {
    const server = http.createServer((_req, res) => res.writeHead(status, { "content-type": "text/plain" }).end("user-agent: *\nallow: /"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const robots = await fetchRobots(`${base}/robots.txt`);
    server.close();
    return { robots, base };
  }

  it("4xx means no restrictions", async () => {
    const { robots, base } = await withStatus(404);
    expect(robots.unreachable).toBeFalsy();
    expect(isDisallowed(robots, `${base}/a`)).toBe(false);
  });

  it.each([500, 503, 429])("%i means disallow everything", async (status) => {
    const { robots, base } = await withStatus(status);
    expect(robots.unreachable).toBe(true);
    expect(isDisallowed(robots, `${base}/a`)).toBe(true);
  });
});
