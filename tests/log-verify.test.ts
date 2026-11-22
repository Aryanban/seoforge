import { describe, it, expect } from "vitest";
import { parseLogLine, verifyBotIp, verifyCrawlerHits, type DnsResolver, type LogEntry } from "../src/analysis/log-parser.js";

const GOOGLE_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const BING_UA = "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)";

function entry(ip: string, ua: string, path = "/"): LogEntry {
  const e = parseLogLine(`${ip} - - [10/Oct/2026:13:55:36 +0000] "GET ${path} HTTP/1.1" 200 2326 "-" "${ua}"`);
  if (!e) throw new Error("line did not parse");
  return e;
}

/** Fake resolver backed by in-memory tables. Unknown IPs/hosts resolve to nothing. */
function fakeDns(ptr: Record<string, string[]>, a: Record<string, string[]>, opts: { throwAll?: boolean } = {}) {
  const calls: string[] = [];
  const resolver: DnsResolver = {
    async reverse(ip) {
      calls.push(ip);
      if (opts.throwAll) throw new Error("SERVFAIL");
      return ptr[ip] ?? [];
    },
    async lookup(host) {
      if (opts.throwAll) throw new Error("SERVFAIL");
      return a[host] ?? [];
    },
  };
  return { resolver, calls };
}

describe("verifyBotIp", () => {
  it("verifies a real Googlebot IP via reverse then forward DNS", async () => {
    const { resolver } = fakeDns(
      { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com"] },
      { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"] },
    );
    expect(await verifyBotIp("66.249.66.1", "Googlebot", resolver)).toBe(true);
  });

  it("verifies a Bingbot IP against search.msn.com", async () => {
    const { resolver } = fakeDns(
      { "157.55.39.1": ["msnbot-157-55-39-1.search.msn.com"] },
      { "msnbot-157-55-39-1.search.msn.com": ["157.55.39.1"] },
    );
    expect(await verifyBotIp("157.55.39.1", "Bingbot", resolver)).toBe(true);
  });

  it("rejects a spoofed Googlebot IP whose PTR is outside the bot domains", async () => {
    const { resolver } = fakeDns({ "1.2.3.4": ["evil.example.com"] }, { "evil.example.com": ["1.2.3.4"] });
    expect(await verifyBotIp("1.2.3.4", "Googlebot", resolver)).toBe(false);
  });

  it("rejects when the forward lookup does not return the original IP", async () => {
    const { resolver } = fakeDns(
      { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com"] },
      { "crawl-66-249-66-1.googlebot.com": ["66.249.99.9"] },
    );
    expect(await verifyBotIp("66.249.66.1", "Googlebot", resolver)).toBe(false);
  });

  it("rejects when the resolver throws", async () => {
    const { resolver } = fakeDns({}, {}, { throwAll: true });
    expect(await verifyBotIp("66.249.66.1", "Googlebot", resolver)).toBe(false);
  });

  it("does not accept a lookalike suffix such as notgooglebot.com", async () => {
    const { resolver } = fakeDns({ "5.5.5.5": ["fakegooglebot.com"] }, { "fakegooglebot.com": ["5.5.5.5"] });
    expect(await verifyBotIp("5.5.5.5", "Googlebot", resolver)).toBe(false);
  });
});

describe("verifyCrawlerHits", () => {
  it("counts hits (not IPs) as verified or spoofed and lists spoofed IPs", async () => {
    const { resolver } = fakeDns(
      { "66.249.66.1": ["crawl-66-249-66-1.googlebot.com"], "1.2.3.4": ["evil.example.com"] },
      { "crawl-66-249-66-1.googlebot.com": ["66.249.66.1"] },
    );
    const entries = [
      entry("66.249.66.1", GOOGLE_UA, "/a"),
      entry("66.249.66.1", GOOGLE_UA, "/b"),
      entry("66.249.66.1", GOOGLE_UA, "/c"),
      entry("1.2.3.4", GOOGLE_UA, "/a"),
      entry("1.2.3.4", GOOGLE_UA, "/b"),
      entry("10.0.0.1", "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0"), // human, ignored
    ];
    const res = await verifyCrawlerHits(entries, { resolver });
    expect(res).toEqual([{ bot: "Googlebot", verified: 3, spoofed: 2, unverifiedIps: ["1.2.3.4"] }]);
  });

  it("treats a resolver error as spoofed", async () => {
    const { resolver } = fakeDns({}, {}, { throwAll: true });
    const res = await verifyCrawlerHits([entry("66.249.66.1", GOOGLE_UA)], { resolver });
    expect(res).toEqual([{ bot: "Googlebot", verified: 0, spoofed: 1, unverifiedIps: ["66.249.66.1"] }]);
  });

  it("verifies each distinct IP once and never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const ips = Array.from({ length: 10 }, (_, i) => `66.249.66.${i + 1}`);
    const resolver: DnsResolver = {
      async reverse(ip) {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return [`crawl-${ip.replaceAll(".", "-")}.googlebot.com`];
      },
      async lookup(host) {
        return [host.slice(6, -14).replaceAll("-", ".")];
      },
    };
    const entries = ips.flatMap((ip) => [entry(ip, GOOGLE_UA, "/x"), entry(ip, GOOGLE_UA, "/y")]);
    const res = await verifyCrawlerHits(entries, { resolver, concurrency: 3 });
    expect(res).toEqual([{ bot: "Googlebot", verified: 20, spoofed: 0, unverifiedIps: [] }]);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });
});
