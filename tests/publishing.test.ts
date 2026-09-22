import { describe, it, expect } from "vitest";
import {
  loadSources,
  catalogSize,
  catalogMarkdown,
  buildPlan,
  planMarkdown,
  planCsv,
  validateProfile,
  publicationRole,
  type PostingProfile,
  type PostingSite,
} from "../src/publishing/index.js";

const PROFILE: PostingProfile = {
  business: "Example Automation Studio",
  website: "https://example.com",
  audience: "service-business owners evaluating automation",
  topics: ["technology", "business", "software", "education"],
  markets: ["Pakistan", "United Kingdom"],
  assets: [],
  posts_per_week: 2,
  evidence_basis: "Test profile",
  pages: [
    { url: "https://example.com/automation-guide", topic: "AI workflow automation", status: "planned" },
    { url: "https://example.com/knowledge-base-guide", topic: "customer-support knowledge bases", status: "planned" },
  ],
};

// A fixed "today" keeps date arithmetic deterministic.
const AS_OF = "2026-09-22";

describe("publishing catalog", () => {
  it("exposes the full 206-entry catalog", () => {
    expect(catalogSize()).toBe(206);
    expect(loadSources()).toHaveLength(206);
  });

  it("filters by review status", () => {
    expect(loadSources({ status: "guidance_reviewed" })).toHaveLength(22);
  });

  it("filters by kind", () => {
    const rows = loadSources({ kind: "newsletter" });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("substack.com");
  });

  it("filters by topic substring", () => {
    expect(loadSources({ category: "developer" }).length).toBeGreaterThan(0);
    expect(loadSources({ category: "nonexistenttopic123" })).toHaveLength(0);
  });

  it("renders a markdown table with unverified DR labels", () => {
    const md = catalogMarkdown(loadSources({ kind: "newsletter" }));
    expect(md).toContain("# Free article and posting-site catalog");
    expect(md).toContain("unverified");
    expect(md).toContain("Substack");
  });
});

describe("profile validation", () => {
  it("accepts a complete profile", () => {
    expect(() => validateProfile(PROFILE)).not.toThrow();
  });

  it("rejects a missing required string field", () => {
    expect(() => validateProfile({ ...PROFILE, business: "" })).toThrow("Profile requires business");
  });

  it("rejects a non-URL website", () => {
    expect(() => validateProfile({ ...PROFILE, website: "not a url" })).toThrow("HTTP(S)");
  });

  it("rejects empty topics", () => {
    expect(() => validateProfile({ ...PROFILE, topics: [] })).toThrow("nonempty topics");
  });

  it("rejects a page without a topic", () => {
    expect(() =>
      validateProfile({ ...PROFILE, pages: [{ url: "https://example.com/x", topic: "" }] }),
    ).toThrow("specific topic");
  });

  it("rejects out-of-range publishing capacity", () => {
    expect(() => validateProfile({ ...PROFILE, posts_per_week: 9 })).toThrow("1 to 7");
    expect(() => validateProfile({ ...PROFILE, posts_per_week: 0 })).toThrow("1 to 7");
  });

  it("rejects a bad page status", () => {
    expect(() =>
      validateProfile({
        ...PROFILE,
        pages: [{ url: "https://example.com/x", topic: "t", status: "draft" as never }],
      }),
    ).toThrow("existing, planned or provided");
  });

  it("rejects a bad limit", () => {
    expect(() => buildPlan(PROFILE, loadSources(), { limit: 21, asOf: AS_OF })).toThrow("1 to 20");
  });
});

describe("plan building", () => {
  it("selects only guidance-reviewed sites with documented free routes", () => {
    const plan = buildPlan(PROFILE, loadSources(), { limit: 15, asOf: AS_OF });
    expect(plan.catalog_sites_considered).toBe(206);
    for (const task of plan.tasks) {
      expect(task.cost_status).toMatch(/free_basic|conditional_free|free_recheck/);
      expect(task.how_to_post.length).toBeGreaterThan(0);
    }
  });

  it("matches the reference shortlist order and dates", () => {
    const plan = buildPlan(PROFILE, loadSources(), { limit: 15, asOf: AS_OF });
    expect(plan.selected_sources).toBe(15);
    expect(plan.shortfall).toBe(0);
    expect(plan.tasks.map((t) => t.site_id)).toEqual([
      "linkedin.com",
      "medium.com",
      "substack.com",
      "dev.to",
      "hackernoon.com",
      "hashnode.com",
      "articlebiz.com",
      "articleted.com",
      "joinentre.com",
      "flipboard.com",
      "quora.com",
      "reddit.com",
      "sooperarticles.com",
      "teletype.in",
      "tumblr.com",
    ]);
    expect(plan.tasks[0].suggested_date).toBe("2026-09-29");
    expect(plan.tasks[0].suggested_week).toBe(2);
    expect(plan.tasks[2].suggested_date).toBe("2026-10-06");
    expect(plan.tasks[2].suggested_week).toBe(3);
  });

  it("reports exclusions rather than hiding them", () => {
    const plan = buildPlan(PROFILE, loadSources(), { limit: 15, asOf: AS_OF });
    expect(plan.excluded_summary["unreviewed"]).toBeGreaterThan(0);
    expect(plan.excluded.length + plan.selected_sources).toBeLessThanOrEqual(plan.catalog_sites_considered);
  });

  it("interpolates the angle template with topic, audience and business", () => {
    const plan = buildPlan(PROFILE, loadSources(), { limit: 1, asOf: AS_OF });
    expect(plan.tasks[0].suggested_title_or_action).toContain("service-business owners evaluating automation");
    expect(plan.tasks[0].suggested_title_or_action).toContain("AI workflow automation");
  });

  it("honours an explicit start_date", () => {
    const plan = buildPlan(
      { ...PROFILE, start_date: "2026-10-01" },
      loadSources(),
      { limit: 1, asOf: AS_OF },
    );
    expect(plan.tasks[0].suggested_date).toBe("2026-10-08");
  });

  it("cycles target pages across tasks", () => {
    const plan = buildPlan(PROFILE, loadSources(), { limit: 4, asOf: AS_OF });
    expect(plan.tasks[0].target_page).toBe(PROFILE.pages[0].url);
    expect(plan.tasks[1].target_page).toBe(PROFILE.pages[1].url);
    expect(plan.tasks[2].target_page).toBe(PROFILE.pages[0].url);
  });

  it("reports a shortfall when the limit exceeds eligible sites", () => {
    const plan = buildPlan(PROFILE, loadSources(), { limit: 20, asOf: AS_OF });
    expect(plan.requested_sources).toBe(20);
    expect(plan.selected_sources).toBeLessThanOrEqual(20);
    if (plan.selected_sources < plan.requested_sources) {
      expect(plan.shortfall).toBe(plan.requested_sources - plan.selected_sources);
    }
  });

  it("renders markdown and csv exports", () => {
    const plan = buildPlan(PROFILE, loadSources(), { limit: 2, asOf: AS_OF });
    const md = planMarkdown(plan);
    expect(md).toContain("# Posting plan for Example Automation Studio");
    expect(md).toContain("What to write:");
    expect(md).toContain("Guidance checked");
    const csv = planCsv(plan);
    expect(csv.split("\r\n")[0]).toContain("position,website,posting_url");
    expect(csv.split("\r\n").length).toBe(1 + 2 + 1); // header + 2 rows + trailing
  });

  it("does not duplicate a site that appears twice in the catalog", () => {
    const sites = loadSources({ status: "guidance_reviewed" });
    const plan = buildPlan(PROFILE, [...sites, ...sites], { limit: 15, asOf: AS_OF });
    const ids = plan.tasks.map((t) => t.site_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("publication role", () => {
  it("describes an editorial submission", () => {
    const site: PostingSite = {
      ...loadSources()[0],
      kind: "editorial_article",
    };
    expect(publicationRole(site)).toContain("Editorial submission");
  });

  it("describes a moderated contribution", () => {
    const site: PostingSite = { ...loadSources()[0], kind: "answer" };
    expect(publicationRole(site)).toContain("moderated contribution");
  });

  it("describes an author-controlled publication", () => {
    const site: PostingSite = { ...loadSources()[0], kind: "owned_blog" };
    expect(publicationRole(site)).toContain("author-controlled");
  });
});
