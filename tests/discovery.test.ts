import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  candidatesToRows,
  challengeSignal,
  consolidate,
  discoveryHost,
  discoveryMarkdown,
  discover,
  failureDetail,
  hostAttempts,
  importSearchHtml,
  normalizeCandidateUrl,
  parseSearch,
  RequestBudget,
  searchPlan,
  searchPlanMarkdown,
  sourcesCsv,
  writeSearchPlan,
} from "../src/discovery/index.js";

let work: string;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), "seoforge-discovery-"));
});
afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

describe("normalizeCandidateUrl", () => {
  it("drops fragments and tracking params while preserving query order", () => {
    expect(
      normalizeCandidateUrl("https://Example.COM/A?b=2&UTM_SOURCE=x&a=1&gclid=zzz#frag"),
    ).toBe("https://example.com/A?b=2&a=1");
  });

  it("keeps path case, non-default ports and repeated params", () => {
    expect(normalizeCandidateUrl("https://host.com:8080/Path/Sub?t=1&t=2")).toBe(
      "https://host.com:8080/Path/Sub?t=1&t=2",
    );
    expect(normalizeCandidateUrl("https://host.com")).toBe("https://host.com/");
  });

  it("rejects unusable input", () => {
    expect(normalizeCandidateUrl("")).toBeNull();
    expect(normalizeCandidateUrl("not a url")).toBeNull();
    expect(normalizeCandidateUrl("ftp://example.com/x")).toBeNull();
    expect(normalizeCandidateUrl("https://user:pw@example.com/x")).toBeNull();
    expect(normalizeCandidateUrl("https://example.com\\evil")).toBeNull();
    expect(normalizeCandidateUrl("https://example.com/x\u0000")).toBeNull();
  });
});

describe("discoveryHost", () => {
  it("lowercases and strips the leading www.", () => {
    expect(discoveryHost("https://WWW.Example.com/x")).toBe("example.com");
    expect(discoveryHost("garbage")).toBe("");
  });
});

describe("failureDetail", () => {
  it("returns null for a clean 2xx", () => {
    expect(failureDetail("", 200)).toBeNull();
  });

  it("classifies transport errors", () => {
    expect(failureDetail("TimeoutError: timed out").code).toBe("connection_timeout");
    expect(failureDetail("AbortError: the operation was aborted").code).toBe("connection_timeout");
    expect(failureDetail("Error: getaddrinfo ENOTFOUND bad").code).toBe("dns_failure");
    expect(failureDetail("Error: unable to verify the first certificate").code).toBe("tls_failure");
    expect(failureDetail("Error: self-signed certificate").code).toBe("tls_failure");
    expect(failureDetail("Error: fetch failed, ECONNREFUSED").code).toBe("connection_failure");
    expect(failureDetail("discovery_request_budget_exhausted").code).toBe("budget_exhausted");
    expect(failureDetail("robots_rule_disallowed").code).toBe("robots_restricted");
  });

  it("classifies HTTP status codes", () => {
    expect(failureDetail("", 429).code).toBe("provider_rate_limited");
    expect(failureDetail("", 403).code).toBe("http_access_denied");
    expect(failureDetail("", 404).code).toBe("http_error");
    expect(failureDetail("", 500).code).toBe("http_error");
  });

  it("leaves ambiguous evidence cause-unknown", () => {
    const unknown = failureDetail("something odd happened", 200)!;
    expect(unknown.code).toBe("unknown");
    expect(unknown.cause).toBe("unknown");
  });
});

describe("challengeSignal", () => {
  it("detects a challenge title with supporting markup", () => {
    const body = "<title>Just a moment...</title><div class='cf-chl-widget'></div>";
    expect(challengeSignal({}, body)?.code).toBe("provider_challenge");
    expect(challengeSignal({ "cf-mitigated": "challenge" }, "")?.code).toBe("provider_challenge");
  });

  it("does not flag ordinary content that merely mentions captcha", () => {
    expect(
      challengeSignal({}, "<title>Our Blog</title><p>We do not use captcha walls.</p>"),
    ).toBeNull();
    // Title alone, without challenge markup, is not enough.
    expect(challengeSignal({}, "<title>Just a moment...</title><p>article</p>")).toBeNull();
  });
});

describe("parseSearch", () => {
  it("parses duckduckgo-html results and unwraps uddg redirects", () => {
    const body = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.org%2Fstory">Story</a>
        <a class="result__snippet">A snippet</a>
      </div>
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fother.com%2Fb">Other</a>
      </div>`;
    const [status, rows] = parseSearch(body, "duckduckgo-html");
    expect(status).toBe("results");
    expect(rows.map((r) => r.url)).toEqual([
      "https://news.example.org/story",
      "https://other.com/b",
    ]);
    expect(rows[0].title).toBe("Story");
    expect(rows[0].snippet).toBe("A snippet");
    expect(rows[1].snippet).toBe("");
    expect(rows.map((r) => r.result_order)).toEqual([1, 2]);
  });

  it("parses google results wrapped in h3 anchors", () => {
    const body = `<a href="/url?q=https://news.example.org/story&amp;sa=U"><h3>Story</h3></a>`;
    const [status, rows] = parseSearch(body, "google");
    expect(status).toBe("results");
    expect(rows[0].url).toBe("https://news.example.org/story");
  });

  it("parses bing results", () => {
    const body = `<li class="b_algo"><h2><a href="https://news.example.org/story">Story</a></h2></li>`;
    const [status, rows] = parseSearch(body, "bing");
    expect(status).toBe("results");
    expect(rows[0].url).toBe("https://news.example.org/story");
  });

  it("parses bing-rss XML", () => {
    const body = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Search</title>
        <item><link>https://news.example.org/a</link><title>A</title><description>Desc</description></item>
        <item><link>https://news.example.org/b</link><title>B</title></item>
      </channel></rss>`;
    const [status, rows] = parseSearch(body, "bing-rss");
    expect(status).toBe("results");
    expect(rows.map((r) => r.url)).toEqual(["https://news.example.org/a", "https://news.example.org/b"]);
    expect(rows[0].snippet).toBe("Desc");
  });

  it("handles a single RSS item that parses to an object, not an array", () => {
    const body = `<rss version="2.0"><channel><item><link>https://news.example.org/only</link></item></channel></rss>`;
    const [status, rows] = parseSearch(body, "bing-rss");
    expect(status).toBe("results");
    expect(rows.map((r) => r.url)).toEqual(["https://news.example.org/only"]);
  });

  it("rejects unsupported XML declarations", () => {
    expect(parseSearch("<!DOCTYPE rss [<!ENTITY x \"y\">]><rss/>", "bing-rss")[0]).toBe(
      "parse_failed",
    );
  });

  it("reports provider_challenge for an interstitial form", () => {
    const body = `<title>Just a moment...</title><form id="challenge-form"></form><div class="cf-chl-widget"></div>`;
    expect(parseSearch(body, "duckduckgo-html")[0]).toBe("provider_challenge");
  });

  it("reports empty_results only when the page says so", () => {
    expect(parseSearch("<div class='no-results'>No results</div>", "duckduckgo-html")[0]).toBe(
      "empty_results",
    );
    expect(parseSearch("<html><body><p>unrelated</p></body></html>", "duckduckgo-html")[0]).toBe(
      "parse_failed",
    );
  });

  it("rejects unknown providers", () => {
    expect(parseSearch("<a href='https://x.com'>x</a>", "yahoo")[0]).toBe("parse_failed");
  });
});

describe("RequestBudget", () => {
  it("counts requests and enforces the wall-clock deadline", () => {
    const budget = new RequestBudget(2, 60);
    expect(budget.remainingMs()).toBeGreaterThan(0);
    budget.take();
    budget.take();
    expect(() => budget.take()).toThrow(/budget_exhausted/);
    expect(budget.used).toBe(2);
  });

  it("treats an expired deadline as exhausted", () => {
    const budget = new RequestBudget(10, -1);
    expect(() => budget.take()).toThrow(/budget_exhausted/);
  });
});

describe("consolidate", () => {
  it("merges duplicate URLs and keeps every observation", () => {
    const merged = consolidate([
      { url: "https://x.com/a?utm_source=n#f", provenance: [{ provider: "p1" }] },
      { url: "https://x.com/a", provenance: [{ provider: "p2" }] },
      { url: "garbage", provenance: [{ provider: "p3" }] },
    ]);
    expect(merged.map((c) => c.url)).toEqual(["https://x.com/a"]);
    expect(merged[0].verification).toBe("unverified_lead");
    expect(merged[0].provenance.map((p) => p.provider)).toEqual(["p1", "p2"]);
  });
});

describe("hostAttempts", () => {
  const base = {
    provider: "host-tool",
    query: '"Brand"',
    captured_at: "2026-09-23T00:00:00Z",
    status: "results",
    evidence: "recorded by the host tool",
  };

  it("accepts a recorded success and classifies recorded failures", () => {
    // Host records carry evidence text and an HTTP status only, so a recorded
    // failure is classified from those — a challenge the host could not name
    // precisely stays cause-unknown rather than being guessed.
    const [ok, rateLimited, unnamed] = hostAttempts([
      { ...base, results: [{ url: "https://news.example.org/a" }] },
      { ...base, status: "failed", evidence: "provider throttled us", http_status: 429 },
      { ...base, status: "failed", evidence: "something odd in the response" },
    ]);
    expect(ok.status).toBe("results");
    expect(ok.origin).toBe("host_recorded");
    expect(ok.results.map((r) => r.result_order)).toEqual([1]);
    expect(rateLimited.status).toBe("provider_rate_limited");
    expect(rateLimited.failure?.http_status).toBe(429);
    expect(unnamed.status).toBe("unknown");
    expect(unnamed.failure?.cause).toBe("unknown");
  });

  it("requires the fields that make a record meaningful", () => {
    expect(() => hostAttempts([{ ...base, query: "" }])).toThrow(/query/);
    expect(() => hostAttempts([{ ...base, captured_at: "yesterday" }])).toThrow(/captured_at/);
    expect(() => hostAttempts([{ ...base, status: "results", results: [] }])).toThrow(
      /must contain result URLs/,
    );
    expect(() => hostAttempts([...Array(101)].map(() => base))).toThrow(/at most 100/);
  });
});

describe("discover (offline)", () => {
  it("collects supplied candidates without any network access", async () => {
    const out = path.join(work, "supplied");
    const result = await discover([], out, {
      target: "https://example.com",
      offline: true,
      candidates: ["https://other.com/a", "https://other.com/a?utm_source=x#frag"],
    });
    expect(result.status).toBe("leads_available");
    expect(result.candidate_count).toBe(1);
    expect(result.candidates[0].url).toBe("https://other.com/a");
    expect(result.candidates[0].provenance).toHaveLength(2);
    expect(result.search_available).toBe(false);
    expect(result.native_requests).toBe(0);
    // Own-site filtering never applies to URLs the operator supplied.
    expect(result.candidates[0].verification).toBe("unverified_lead");
  });

  it("filters own-site, subdomain and search-provider hosts out of attempt leads", async () => {
    const out = path.join(work, "filtered");
    const result = await discover(
      [{ query: '"Brand" -site:example.com' }],
      out,
      {
        target: "https://example.com",
        offline: true,
        hostRecords: hostAttempts([
          {
            provider: "host-tool",
            query: '"Brand" -site:example.com',
            captured_at: "2026-09-23T00:00:00+00:00",
            status: "results",
            evidence: "host recorded",
            results: [
              { url: "https://example.com/own" },
              { url: "https://blog.example.com/sub" },
              { url: "https://google.com/serp" },
              { url: "https://news.example.org/story" },
            ],
          },
        ]),
      },
    );
    expect(result.candidates.map((c) => c.url)).toEqual(["https://news.example.org/story"]);
    expect(result.attempts[0].accepted_leads).toBe(1);
    // A successful host record means no native attempt is made for that query.
    expect(result.native_requests).toBe(0);
  });

  it("records a query that needs review instead of searching it", async () => {
    const out = path.join(work, "review");
    const result = await discover(
      [{ query: "generated seed", query_review_status: "needs_review" }],
      out,
      { target: "https://example.com", offline: true },
    );
    expect(result.queries_needing_review).toBe(1);
    expect(result.attempts.map((a) => a.status)).toContain("query_review_required");
    expect(result.candidate_count).toBe(0);
  });

  it("records unavailable native search in offline mode", async () => {
    const out = path.join(work, "offline");
    const result = await discover([{ query: '"Brand"' }], out, {
      target: "https://example.com",
      offline: true,
    });
    expect(result.attempts[0].status).toBe("tool_unavailable");
    expect(result.attempts[0].failure?.code).toBe("tool_unavailable");
  });

  it("caps candidates at the configured budget", async () => {
    const out = path.join(work, "capped");
    const many = [...Array(12)].map((_, i) => `https://host-${i}.com/page`);
    const result = await discover([], out, {
      target: "https://example.com",
      offline: true,
      candidates: many,
      maxCandidates: 5,
    });
    expect(result.candidate_count).toBe(5);
    expect(result.candidate_budget_reached).toBe(true);
  });

  it("writes discovery.json under the output directory", async () => {
    const out = path.join(work, "written");
    await discover([], out, {
      target: "https://example.com",
      offline: true,
      candidates: ["https://other.com/a"],
    });
    const { readFile } = await import("node:fs/promises");
    const persisted = JSON.parse(await readFile(path.join(out, "discovery.json"), "utf-8"));
    expect(persisted.schema_version).toBe(1);
    expect(persisted.note).toContain("unverified");
  });

  it("rejects out-of-range budgets and unknown providers", async () => {
    const out = path.join(work, "bad");
    await expect(
      discover([{ query: "x" }], out, { target: "https://example.com", maxRequests: 500 }),
    ).rejects.toThrow(/budget/);
    await expect(
      discover(
        [{ query: "x" }],
        out,
        { target: "https://example.com", providers: ["google" as never] },
      ),
    ).rejects.toThrow(/Unknown native search provider/);
  });
});

describe("searchPlan", () => {
  it("builds navigation URLs and never claims to have searched", () => {
    const plan = searchPlan("https://www.example.com", "Acme", 3);
    expect(plan.query).toBe('"Acme" -site:example.com');
    expect(plan.pages.map((p) => p.url)).toEqual([
      "https://www.google.com/search?q=%22Acme%22+-site%3Aexample.com&start=0",
      "https://www.google.com/search?q=%22Acme%22+-site%3Aexample.com&start=10",
      "https://www.google.com/search?q=%22Acme%22+-site%3Aexample.com&start=20",
    ]);
    expect(plan.completed_pages).toBe(0);
    expect(plan.note).toContain("navigation links");
  });

  it("requires a target, brand and sane page budget", () => {
    expect(() => searchPlan("https://example.com", "", 3)).toThrow();
    expect(() => searchPlan("https://example.com", "Acme", 99)).toThrow();
    expect(() => searchPlan("garbage", "Acme", 3)).toThrow();
  });

  it("writes the plan to disk", async () => {
    const out = path.join(work, "plan-disk");
    const plan = await writeSearchPlan("https://example.com", "Acme", out, 2);
    expect(plan.pages).toHaveLength(2);
    expect(searchPlanMarkdown(plan)).toContain("Reputation discovery plan");
  });
});

describe("importSearchHtml", () => {
  it("extracts candidates from saved google result pages", async () => {
    const page = path.join(work, "google.html");
    await writeFile(
      page,
      `<a href="/url?q=https://news.example.org/story&amp;sa=U"><h3>Story</h3></a>
       <a href="/url?q=https://blog.example.com/sub"><h3>Sub</h3></a>`,
    );
    const out = path.join(work, "import");
    const result = await importSearchHtml([page], "https://example.com", '"Acme"', "2026-09-23", out);
    expect(result.snapshots_imported).toBe(1);
    expect(result.engine_declared_by_operator).toBe("Google");
    // Own-site and subdomain hosts are filtered; only the third-party story survives.
    expect(result.candidates.map((c) => c.url)).toEqual(["https://news.example.org/story"]);
    expect(result.note).toContain("No live search was performed");
  });

  it("requires a fresh output directory", async () => {
    const page = path.join(work, "google2.html");
    await writeFile(page, `<a href="/url?q=https://x.com/a"><h3>X</h3></a>`);
    const out = path.join(work, "import");
    await expect(
      importSearchHtml([page], "https://example.com", "q", "2026-09-23", out),
    ).rejects.toThrow(/new search-import folder/);
  });
});

describe("report writers", () => {
  it("quotes CSV fields containing commas, quotes and newlines", () => {
    expect(
      sourcesCsv([{ URL: "https://x.com/a", simple: "plain", list: "a, b" }], [
        "URL",
        "simple",
        "list",
      ]),
    ).toBe("URL,simple,list\nhttps://x.com/a,plain,\"a, b\"\n");

    expect(
      sourcesCsv([{ URL: "https://x.com/a", note: 'say "hi"' }], ["URL", "note"]),
    ).toBe('URL,note\nhttps://x.com/a,"say ""hi"""\n');

    // A JSON provenance blob stays one CSV field, embedded commas and all.
    const withNewline = sourcesCsv(
      [{ URL: "https://x.com/a", provenance: JSON.stringify({ a: 1, b: "two" }) }],
      ["URL", "provenance"],
    );
    expect(withNewline).toBe(
      'URL,provenance\nhttps://x.com/a,"{""a"":1,""b"":""two""}"\n',
    );
  });

  it("maps candidates to handoff rows", () => {
    const rows = candidatesToRows([
      {
        url: "https://x.com/a",
        verification: "unverified_lead",
        provenance: [{ provider: "duckduckgo-html", captured_at: "2026-09-23T00:00:00Z" }],
      },
    ]);
    expect(rows[0].URL).toBe("https://x.com/a");
    expect(rows[0].engine).toBe("duckduckgo-html");
  });

  it("renders discovery markdown with the conservative note", () => {
    const md = discoveryMarkdown({
      candidate_count: 2,
      status: "leads_available",
      search_available: true,
      native_requests: 3,
      request_budget: 16,
      candidate_budget_reached: false,
      attempts: [],
      candidates: [],
      target: "https://example.com",
      note: "Search results are unverified leads.",
    } as never);
    expect(md).toContain("unverified");
    expect(md).toContain("2 candidate URLs");
  });
});
