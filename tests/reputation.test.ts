import { describe, it, expect } from "vitest";
import { sourceScore, assess, reassess } from "../src/reputation/score.js";
import {
  host,
  publisherKey,
  targetLinks,
  mentionEvidence,
  sourceRows,
} from "../src/reputation/verify.js";
import { reputationMarkdown, reputationCsv } from "../src/reputation/report.js";
import type {
  CheckSourcesResult,
  ReputationResult,
  SourceRow,
  VerificationResult,
} from "../src/reputation/types.js";

const TARGET = "https://example.com";

/** Build a verified source row fixture. */
function row(opts: {
  url: string;
  finalUrl?: string | null;
  verification?: VerificationResult["verification"];
  linkToTarget?: boolean;
  mentions?: boolean;
  discovery?: Record<string, unknown>;
}): VerificationResult {
  const finalUrl = opts.finalUrl === undefined ? opts.url : opts.finalUrl;
  const links =
    opts.verification === "link_observed" || opts.linkToTarget
      ? [{ url: "https://example.com/page", anchor: "Example", rel: [] }]
      : [];
  return {
    source_url: opts.url,
    final_url: finalUrl,
    status: 200,
    checked_at: "2026-09-22T00:00:00.000Z",
    verification: opts.verification ?? "link_observed",
    representation: "raw_html",
    coverage_limited: false,
    target_links: links,
    brand_mentions: opts.mentions ? [{ name: "Example", excerpt: "…Example…" }] : [],
    mention_status: opts.mentions ? "observed_in_page" : "not_observed_in_capture",
    error: "",
    title: "A page",
    main_excerpt: "body text",
    discovery: (opts.discovery ?? {}) as never,
    missing_content_candidate: false,
  };
}

const FULL_REVIEW = {
  relevance: "high",
  relationship: "independent",
  context: "editorial",
  reviewed_by: "agent",
  reviewed_at: "2026-09-01",
  review_evidence: "checked the page",
};

function wrap(results: VerificationResult[], supplied = results.length): CheckSourcesResult {
  return {
    target: TARGET,
    brand: "Example",
    checked_at: "2026-09-22T00:00:00.000Z",
    sources_supplied: supplied,
    sources_checked: results.length,
    sources_remaining: Math.max(0, supplied - results.length),
    observed_link_pages: results.filter((r) => r.verification === "link_observed").length,
    observed_mention_pages: results.filter((r) => r.brand_mentions.length > 0).length,
    unverified_pages: results.filter((r) => r.verification === "unverified_access").length,
    results,
    note: "",
  };
}

describe("host and publisher grouping", () => {
  it("strips www from hosts", () => {
    expect(host("https://www.example.com/x")).toBe("example.com");
    expect(host("https://sub.example.com/x")).toBe("sub.example.com");
    expect(host("not-a-url")).toBe("");
  });

  it("pools publishing-platform host families", () => {
    expect(publisherKey("https://medium.com/@someone")).toBe("medium.com");
    expect(publisherKey("https://foo.medium.com/x")).toBe("medium.com");
    expect(publisherKey("https://dev.to/u/x")).toBe("dev.to");
    expect(publisherKey("https://independent.com/x")).toBe("independent.com");
  });
});

describe("link and mention extraction", () => {
  const html = `<html><body>
    <a href="https://example.com/page">one</a>
    <a href="/relative">rel</a>
    <a href="https://other.com/x">other</a>
    <a href="https://www.example.com/alias">www alias</a>
  </body></html>`;

  it("finds only links to the target host, resolving relative hrefs", () => {
    const links = targetLinks(html, "https://source.com/page", "example.com");
    expect(links.map((l) => l.url)).toEqual([
      "https://example.com/page",
      "https://www.example.com/alias",
    ]);
  });

  it("ignores links to other hosts", () => {
    const links = targetLinks(html, "https://source.com/page", "other.com");
    // The relative href resolves to source.com, so nothing points at other.com
    // except the explicit other.com link.
    expect(links.map((l) => l.url)).toEqual(["https://other.com/x"]);
  });

  it("matches brand mentions at word boundaries and is case-insensitive", () => {
    const text = "We use Example tooling. ThisExample is not a match, nor is examples.";
    const m = mentionEvidence(text, ["Example"]);
    expect(m).toHaveLength(1);
    expect(m[0].name).toBe("Example");
  });

  it("escapes regex metacharacters in brand names", () => {
    expect(mentionEvidence("a.b+c (x)", ["a.b+c"])).toHaveLength(1);
  });
});

describe("source-level scoring", () => {
  it("gives an unreviewed observed link 40 supported points and a 40-100 range", () => {
    const s = sourceScore(
      row({ url: "https://foo.com/a", verification: "link_observed" }),
      TARGET,
    );
    expect(s.eligible_evidence).toBe(true);
    expect(s.supported_quality_points).toBe(40);
    expect(s.quality_range).toEqual([40, 100]);
    expect(s.quality_estimate).toBe(70);
    expect(s.assessed_weight_percent).toBe(40);
    expect(s.independence_unknown).toBe(true);
  });

  it("awards full points for a reviewed independent editorial link", () => {
    const s = sourceScore(
      row({ url: "https://foo.com/a", verification: "link_observed", discovery: FULL_REVIEW }),
      TARGET,
    );
    expect(s.supported_quality_points).toBe(100);
    expect(s.quality_range).toEqual([100, 100]);
    expect(s.independent_editorial_evidence).toBe(true);
  });

  it("treats a mention without a link as 25 evidence points", () => {
    const s = sourceScore(
      row({
        url: "https://foo.com/a",
        verification: "no_link_in_captured_content",
        mentions: true,
      }),
      TARGET,
    );
    expect(s.eligible_evidence).toBe(true);
    expect(s.supported_quality_points).toBe(25);
    expect(s.observed_link).toBe(false);
    expect(s.observed_mention).toBe(true);
  });

  it("excludes same-site and subdomain sources as owned", () => {
    const s = sourceScore(
      row({ url: "https://sub.example.com/about", verification: "link_observed" }),
      TARGET,
    );
    expect(s.eligible_evidence).toBe(false);
    expect(s.excluded_reason).toBe("same_site_source");
    expect(s.quality_estimate).toBe(null);
  });

  it("treats supplied related hosts as owned, earning no independence points", () => {
    const s = sourceScore(
      row({ url: "https://sister.example.org/a", verification: "link_observed" }),
      TARGET,
      ["example.org"],
    );
    expect(s.relationship).toBe("owned");
    expect(s.dimensions.relationship.points).toBe(0);
    expect(s.independent_editorial_evidence).toBe(false);
  });

  it("removes independence points for a sponsored placement", () => {
    const s = sourceScore(
      row({
        url: "https://paid.com/a",
        verification: "link_observed",
        discovery: { ...FULL_REVIEW, paid: "true" },
      }),
      TARGET,
    );
    expect(s.relationship).toBe("sponsored");
    expect(s.dimensions.relationship.points).toBe(0);
  });

  it("keeps unassessed dimensions unknown rather than guessing", () => {
    const s = sourceScore(
      row({ url: "https://foo.com/a", verification: "link_observed" }),
      TARGET,
    );
    expect(s.dimensions.topic_relevance.status).toBe("unknown");
    expect(s.dimensions.topic_relevance.points).toBe(null);
    expect(s.dimensions.observed_evidence.status).toBe("assessed");
  });

  it("ignores judgments that lack review attribution", () => {
    const s = sourceScore(
      row({
        url: "https://foo.com/a",
        verification: "link_observed",
        discovery: { relevance: "high", relationship: "independent" },
      }),
      TARGET,
    );
    expect(s.relevance).toBe("unknown");
  });
});

describe("assessment (model 1.1)", () => {
  it("caps low-confidence headlines at 49/100", () => {
    const result = assess(
      wrap(
        Array.from({ length: 5 }, (_, i) =>
          row({ url: `https://p${i}.com/a`, verification: "link_observed", discovery: FULL_REVIEW }),
        ),
      ),
      { requestedSearchPages: 5 },
    );
    expect(result.score).not.toBeNull();
    expect(result.score!).toBeLessThanOrEqual(49);
    expect(result.confidence).toBe("low");
    expect(result.score_status).toBe("provisional");
  });

  it("withholds the score when no link check is conclusive", () => {
    const result = assess(
      wrap([row({ url: "https://q.com/a", verification: "unverified_access" })]),
      { requestedSearchPages: 5 },
    );
    expect(result.score).toBe(null);
    expect(result.score_status).toBe("withheld");
    expect(result.confidence).toBe("insufficient conclusive evidence");
  });

  it("multiplies supported points by the weakest measured evidence factor", () => {
    // 5 fully-reviewed sources but only a fraction of the known candidates
    // actually checked: verification coverage becomes the weakest factor.
    const results = Array.from({ length: 5 }, (_, i) =>
      row({ url: `https://p${i}.com/a`, verification: "link_observed", discovery: FULL_REVIEW }),
    );
    const full = assess(wrap(results, 5), { requestedSearchPages: 5 });
    const partial = assess(wrap(results, 40), { requestedSearchPages: 5 });
    expect(partial.evidence_adjustment.factor).toBeLessThan(full.evidence_adjustment.factor);
    expect(partial.score!).toBeLessThan(full.score!);
    // 5 conclusive checks of 40 known candidates -> verification factor 0.125.
    expect(partial.evidence_adjustment.factors.conclusive_link_checks).toBeCloseTo(0.125, 2);
  });

  it("keeps unchecked candidates in the coverage denominator", () => {
    const result = assess(
      wrap(
        Array.from({ length: 3 }, (_, i) =>
          row({ url: `https://p${i}.com/a`, verification: "link_observed", discovery: FULL_REVIEW }),
        ),
        40,
      ),
      { requestedSearchPages: 5 },
    );
    expect(result.coverage.known_source_candidates).toBe(40);
    expect(result.coverage.sources_unchecked).toBe(37);
  });

  it("ignores duplicate source rows so repetition cannot inflate coverage", () => {
    const one = row({ url: "https://p0.com/a", verification: "link_observed", discovery: FULL_REVIEW });
    const result = assess(wrap([one, { ...one }], 2), { requestedSearchPages: 5 });
    expect(result.coverage.duplicate_source_rows_ignored).toBe(1);
    expect(result.coverage.sources_checked).toBe(1);
  });

  it("groups repeated publishers so one publisher cannot dominate", () => {
    const results = [
      row({ url: "https://medium.com/a", verification: "link_observed", discovery: FULL_REVIEW }),
      row({ url: "https://medium.com/b", verification: "link_observed", discovery: FULL_REVIEW }),
      row({ url: "https://medium.com/c", verification: "link_observed", discovery: FULL_REVIEW }),
    ];
    const result = assess(wrap(results, 3), { requestedSearchPages: 5 });
    expect(result.coverage.unique_publisher_groups_with_evidence).toBe(1);
  });

  it("separates observed links from mentions without links", () => {
    const results = [
      row({ url: "https://link.com/a", verification: "link_observed", mentions: true, discovery: FULL_REVIEW }),
      row({ url: "https://mention.com/a", verification: "no_link_in_captured_content", mentions: true }),
    ];
    const result = assess(wrap(results, 2), { requestedSearchPages: 5 });
    expect(result.observed_link_pages).toBe(1);
    expect(result.observed_mention_pages).toBe(2);
    expect(result.top_backlinks[0].source_url).toBe("https://link.com/a");
    expect(result.top_mentions_without_links[0].source_url).toBe("https://mention.com/a");
  });

  it("rejects an out-of-range search-page budget", () => {
    expect(() => assess(wrap([]), { requestedSearchPages: 0 })).toThrow();
    expect(() => assess(wrap([]), { requestedSearchPages: 21 })).toThrow();
  });

  it("reassess marks reused evidence and changes nothing numerically", () => {
    const verification = wrap([
      row({ url: "https://p0.com/a", verification: "link_observed", discovery: FULL_REVIEW }),
    ]);
    const first = assess(verification, { requestedSearchPages: 5 });
    const again = reassess(verification, { requestedSearchPages: 5 }) as ReputationResult;
    expect(again.reused_evidence).toBe(true);
    expect(again.score).toBe(first.score);
  });
});

describe("source row parsing", () => {
  it("deduplicates and normalizes URLs", () => {
    const rows: SourceRow[] = [
      { URL: "HTTPS://Example.com/A/" },
      { URL: "https://example.com/a" },
      { URL: "https://other.com/b" },
    ];
    const parsed = sourceRows(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].URL).toBe("https://example.com/a");
  });

  it("requires at least one URL", () => {
    expect(() => sourceRows([])).toThrow("no URLs");
  });
});

describe("report rendering", () => {
  function sampleResult(): ReputationResult {
    return assess(
      wrap([
        row({ url: "https://p0.com/a", verification: "link_observed", discovery: FULL_REVIEW }),
        row({ url: "https://p1.com/b", verification: "no_link_in_captured_content", mentions: true }),
      ]),
      { requestedSearchPages: 5 },
    );
  }

  it("renders markdown with score, range and confidence together", () => {
    const md = reputationMarkdown(sampleResult());
    expect(md).toContain("# SEOForge Reputation Score");
    expect(md).toContain("Evidence-supported score:");
    expect(md).toContain("Sensitivity range:");
    expect(md).toContain("confidence:");
    expect(md).toContain("## Limits");
  });

  it("renders a per-source csv companion", () => {
    const csv = reputationCsv(sampleResult());
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toContain("source_url,final_url,publisher_group,verification");
    expect(lines.length).toBe(1 + 2);
  });
});
