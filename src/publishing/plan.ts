/**
 * Build a website-specific publishing / backlink-prospect plan.
 *
 * Ported from BeyondSEO `scripts/backlink_sources.py` (`validate_profile`,
 * `writing_outline`, `publication_role`, `build_plan`, `plan_markdown`).
 * Deterministic: pure function of (profile, catalog, limit, asOf). No network.
 *
 * A plan is a shortlist of *candidate* publishing opportunities, never a claim
 * of acquired backlinks. Sites without documented free terms, a reviewed route,
 * or topical fit are excluded and the exclusion is reported, not hidden.
 */

import { cell } from "./sources.js";
import type {
  PostingProfile,
  PostingSite,
  PublishingPlan,
  PublishingTask,
  ExcludedSource,
  ExclusionReason,
  ProfilePage,
} from "./types.js";

const FREE_COST_STATUSES = new Set(["free_basic", "conditional_free", "free_recheck"]);
const READINESS_PRIORITY: Record<string, number> = { start: 0, supporting: 1, alternative: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Add N days to a naive ISO date string, returning a naive ISO date string. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
}

function isValidUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (/\s/.test(value)) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!parsed.hostname) return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

/**
 * Validate a business profile. Throws on structural problems so a bad profile
 * can never silently produce an empty or misleading plan.
 */
export function validateProfile(profile: unknown): asserts profile is PostingProfile {
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
    throw new Error("Profile must be a JSON object");
  }
  const p = profile as Record<string, unknown>;
  for (const name of ["website", "business", "audience"] as const) {
    if (typeof p[name] !== "string" || !p[name].trim()) {
      throw new Error(`Profile requires ${name}`);
    }
  }
  if (!isValidUrl(p.website)) {
    throw new Error("Use an HTTP(S) target URL without credentials");
  }
  const topics = p.topics;
  if (
    !Array.isArray(topics) ||
    topics.length === 0 ||
    topics.some((t) => typeof t !== "string" || !t.trim())
  ) {
    throw new Error("Profile requires nonempty topics, such as technology, business or travel");
  }
  for (const field of ["markets", "assets"] as const) {
    const value = p[field];
    if (
      value !== undefined &&
      (!Array.isArray(value) || value.some((t) => typeof t !== "string"))
    ) {
      throw new Error(`${field} must be a list of strings`);
    }
  }
  const pages = p.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("Profile requires pages with actual target URLs and specific topics");
  }
  for (const page of pages) {
    if (
      typeof page !== "object" ||
      page === null ||
      typeof (page as ProfilePage).topic !== "string" ||
      !(page as ProfilePage).topic!.trim()
    ) {
      throw new Error("Every target page requires a specific topic");
    }
    if (!isValidUrl((page as ProfilePage).url)) {
      throw new Error("Use an HTTP(S) target page URL without credentials");
    }
    const status = (page as ProfilePage).status ?? "provided";
    if (!["existing", "planned", "provided"].includes(status)) {
      throw new Error("Page status must be existing, planned or provided");
    }
  }
  const capacity = p.posts_per_week ?? 2;
  if (
    typeof capacity !== "number" ||
    !Number.isInteger(capacity) ||
    capacity < 1 ||
    capacity > 7
  ) {
    throw new Error("posts_per_week must be an integer from 1 to 7 reflecting actual capacity");
  }
  if (typeof p.start_date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(p.start_date)) {
    throw new Error("start_date must be an ISO date (YYYY-MM-DD)");
  }
}

/**
 * Give the actual site format its own brief instead of assigning an article
 * everywhere. Ports `writing_outline`.
 */
export function writingOutline(site: PostingSite, topic: string, audience: string): string[] {
  const kind = site.kind;
  const common = "Use verified facts and original evidence; never invent results or customer stories.";
  if (kind === "answer") {
    return [
      `Find an existing, relevant question about ${topic} and answer it directly.`,
      `Explain the key decision for ${audience}, with a concrete example.`,
      common,
      "Disclose your affiliation. Include a link only when it supports the answer and the rules permit it.",
    ];
  }
  if (kind === "community" || kind === "professional_community" || kind === "community_submission") {
    return [
      `Choose a specific community or discussion where ${topic} is relevant; check its rules first.`,
      "Write a short, useful description of the actual lesson or working demonstration.",
      common,
      "Disclose involvement, ask one useful question and respond to discussion. Do not copy an article into unrelated threads.",
    ];
  }
  if (kind === "curation") {
    return [
      `Create a focused reading collection about ${topic} for ${audience}.`,
      "Select useful independent reading as well as your original resource.",
      "Add a short note explaining what each item helps the reader do; link to original publishers.",
      "Keep the collection selective and updated; do not turn it into repeated self-promotion.",
    ];
  }
  if (kind === "code_resource" || kind === "owned_resource") {
    return [
      `Publish the useful ${topic} resource itself before promoting it.`,
      "Explain its purpose, prerequisites, steps to use it and a reproducible example.",
      common,
      "Include limitations, maintenance information and relevant project documentation links.",
    ];
  }
  if (kind === "social_article") {
    return [
      `Explain one part of ${topic} using an original diagram, screenshot or visual example.`,
      `Write a short caption and accessible explanation for ${audience}.`,
      common,
      "Credit sources and offer a relevant supporting resource where permitted.",
    ];
  }
  return [
    `Answer the main question about ${topic} directly.`,
    `Explain the decision criteria that matter to ${audience}.`,
    common,
    "Explain limitations and when another option is better.",
    "Offer the relevant supporting resource only where the platform permits it.",
  ];
}

/** Ports `publication_role`: what a placement on this kind of site can establish. */
export function publicationRole(site: PostingSite): string {
  if (site.kind === "editorial_article") {
    return "Editorial submission; acceptance and the extent of independent review remain unconfirmed.";
  }
  if (
    site.kind === "article_directory" ||
    site.kind === "community" ||
    site.kind === "answer" ||
    site.kind === "professional_community" ||
    site.kind === "community_submission"
  ) {
    return "A moderated contribution; moderation alone is not independent endorsement.";
  }
  return "An author-controlled publication, resource or collection; it does not establish independent endorsement.";
}

/** Interpolate `{topic}`, `{Topic}`, `{audience}`, `{business}` into an angle. */
function interpolate(angle: string, topic: string, audience: string, business: string): string {
  const Topic = topic.slice(0, 1).toUpperCase() + topic.slice(1);
  return angle
    .replace(/\{Topic\}/g, Topic)
    .replace(/\{topic\}/g, topic)
    .replace(/\{audience\}/g, audience)
    .replace(/\{business\}/g, business);
}

export interface BuildPlanOptions {
  limit?: number;
  /** ISO date used as "today" (UTC); mainly for reproducible tests. */
  asOf?: string;
}

/**
 * Build a prioritized publishing plan from a validated profile.
 *
 * Eligibility gates, in order: guidance review status, documented posting
 * route, established free terms, guidance freshness (<=90 days), topical fit,
 * market eligibility, and required assets. Every rejection is counted in
 * `excluded_summary` so a short plan is explained, not hidden.
 */
export function buildPlan(
  profile: PostingProfile,
  sites: PostingSite[],
  options: BuildPlanOptions = {},
): PublishingPlan {
  validateProfile(profile);
  const limit = options.limit ?? 15;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Choose 1 to 20 sources; 15 is the usual first shortlist");
  }
  const asOf = options.asOf ?? todayUtc();
  const start = profile.start_date ?? asOf;
  const topics = new Set(profile.topics.map((t) => t.toLowerCase()));
  const assets = new Set((profile.assets ?? []).map((a) => a.toLowerCase()));
  const markets = new Set((profile.markets ?? []).map((m) => m.toLowerCase()));

  const eligible: PostingSite[] = [];
  const excluded: ExcludedSource[] = [];
  const seen = new Set<string>();
  for (const site of sites) {
    if (seen.has(site.id)) continue;
    seen.add(site.id);
    let reason: ExclusionReason | null = null;
    if (site.review_status !== "guidance_reviewed") {
      reason = site.review_status;
    } else if (
      !site.posting_url ||
      site.review_sources.length === 0 ||
      site.how_to_post.length === 0
    ) {
      reason = "posting_route_not_documented";
    } else if (!FREE_COST_STATUSES.has(site.cost_status)) {
      reason = "free_terms_not_established";
    } else if (!site.reviewed_at || !isGuidanceFresh(site.reviewed_at, asOf)) {
      reason = "guidance_needs_refresh";
    } else if (!site.topics.some((t) => topics.has(t.toLowerCase()) || t.toLowerCase() === "general")) {
      reason = "topic_mismatch";
    } else if (site.regions.length > 0 && !site.regions.some((r) => markets.has(r.toLowerCase()))) {
      reason = "market_eligibility_unconfirmed";
    } else if (!site.requirements.every((r) => assets.has(r.toLowerCase()))) {
      reason = "required_asset_or_eligibility_missing";
    }
    if (reason) {
      excluded.push({ site: site.id, reason });
    } else {
      eligible.push(site);
    }
  }

  eligible.sort((a, b) => {
    const pa = READINESS_PRIORITY[a.readiness] ?? 3;
    const pb = READINESS_PRIORITY[b.readiness] ?? 3;
    if (pa !== pb) return pa - pb;
    const oa = a.topics.filter((t) => topics.has(t.toLowerCase())).length;
    const ob = b.topics.filter((t) => topics.has(t.toLowerCase())).length;
    if (oa !== ob) return ob - oa;
    return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
  });

  const capacity = profile.posts_per_week ?? 2;
  const tasks: PublishingTask[] = [];
  const selected = eligible.slice(0, limit);
  selected.forEach((site, i) => {
    const page = profile.pages[i % profile.pages.length];
    const topic = page.topic;
    const due = addDays(
      start,
      7 + Math.floor(i / capacity) * 7 + (i % capacity) * Math.floor(7 / capacity),
    );
    const angle = interpolate(site.article_angle, topic, profile.audience, profile.business);
    tasks.push({
      position: i + 1,
      site_id: site.id,
      website: site.name,
      posting_url: site.posting_url,
      format: site.kind,
      priority: site.readiness,
      why_this_site: `${site.fit_note} Planned for ${profile.business} and ${profile.audience}, using the supplied topic: ${topic}.`,
      suggested_title_or_action: angle,
      target_page: page.url,
      target_page_status: page.status ?? "provided",
      outline: writingOutline(site, topic, profile.audience),
      anchor_guidance: `Use a descriptive resource title or ${profile.business} where natural; follow this site's link-location rules.`,
      how_to_post: site.how_to_post,
      link_guidance: site.link_guidance,
      eligibility: site.eligibility,
      cost_status: site.cost_status,
      sheet_dr_values_unverified: site.sheet_dr_values,
      sheet_dr_conflict: site.sheet_dr_conflict,
      current_da: site.current_da,
      current_dr: site.current_dr,
      publication_role: publicationRole(site),
      authority_assessment:
        "Potential discovery and referral value depend on the actual audience, content and placement. No authority gain has been measured.",
      guidance_checked_on: site.reviewed_at,
      guidance_sources: site.review_sources,
      suggested_week: 2 + Math.floor(i / capacity),
      suggested_date: due,
      timing_basis: "Capacity-based planning slot, not a ranking formula or automatic posting schedule.",
      status: "proposed; account, exact placement and final free terms need checking",
      before_posting: [
        "Check the target page is public, useful and complete.",
        "Confirm topic fit, current free terms, exact route and any account eligibility.",
        "Review original facts, platform AI rules, authorship and the final draft.",
        "Obtain task-specific publishing authorization if it is not already provided.",
      ],
      after_posting: [
        "Save the public post URL and publication date.",
        "Use the native verifier to inspect the actual target link and rel attributes.",
        "Check logged-out access, robots/noindex and canonical observations; record search indexing separately.",
        "Review retention, referral traffic and useful responses after 14 and 30 days.",
      ],
    });
  });

  return {
    business: profile.business,
    website: profile.website,
    profile_basis: profile.evidence_basis ?? "User-supplied profile; no website crawl performed by this command.",
    created_on: asOf,
    requested_sources: limit,
    selected_sources: tasks.length,
    shortfall: Math.max(0, limit - tasks.length),
    catalog_sites_considered: seen.size,
    excluded_summary: countBy(excluded, (x) => x.reason),
    excluded,
    tasks,
    interpretation:
      "A shortlist of candidate publishing opportunities, not acquired backlinks. Guidance review does not verify account access, acceptance, a free commercial placement, dofollow, indexing or authority transfer. Research additional relevant sources when the shortlist is short; never pad it with ineligible entries.",
    preparation_week:
      "Week 1: inspect the actual website, choose useful destination pages, confirm account eligibility and prepare the first two strong drafts. Choose among alternative owned blogs rather than creating all of them.",
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Whole days from `fromIso` to `toIso`, matching Python date arithmetic. */
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS);
}

/** Guidance counts as fresh only when reviewed within the last 90 days. */
function isGuidanceFresh(reviewedAt: string, asOf: string): boolean {
  const age = daysBetween(reviewedAt, asOf);
  return age >= 0 && age <= 90;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** The fields written to the CSV export, in order. */
export const PLAN_CSV_FIELDS: readonly (keyof PublishingTask)[] = [
  "position",
  "website",
  "posting_url",
  "format",
  "why_this_site",
  "suggested_title_or_action",
  "outline",
  "target_page",
  "target_page_status",
  "anchor_guidance",
  "link_guidance",
  "how_to_post",
  "eligibility",
  "publication_role",
  "authority_assessment",
  "current_da",
  "current_dr",
  "sheet_dr_values_unverified",
  "sheet_dr_conflict",
  "guidance_checked_on",
  "guidance_sources",
  "suggested_week",
  "suggested_date",
  "priority",
  "cost_status",
  "status",
  "before_posting",
  "after_posting",
] as const;

/** Quote one CSV field. List values are newline-joined; CSV-injection is guarded. */
function csvField(value: unknown): string {
  let v = value;
  if (Array.isArray(v)) v = v.map(String).join("\n");
  if (v === null || v === undefined) v = "not measured";
  let s = String(v);
  if (/^[=+\-@]/.test(s.trimStart())) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Render a plan as CSV (one row per proposed task). */
export function planCsv(plan: PublishingPlan): string {
  const header = PLAN_CSV_FIELDS.join(",");
  const rows = plan.tasks.map((task) =>
    PLAN_CSV_FIELDS.map((field) => csvField(task[field])).join(","),
  );
  return [header, ...rows].join("\r\n") + "\r\n";
}

/**
 * Render a plan as a paste-ready markdown document: summary table plus a
 * detailed section per proposed source (outline, posting steps, link and
 * eligibility guidance, authority caveats, verification checklist).
 */
export function planMarkdown(plan: PublishingPlan): string {
  const lines = [
    `# Posting plan for ${cell(plan.business)}`,
    "",
    plan.profile_basis,
    "",
    `**${plan.selected_sources} proposed sources; ${plan.requested_sources} requested.**`,
    plan.interpretation,
    "",
    plan.preparation_week,
    "",
    "DA is not available in this catalog. The source sheet labels its numbers DR; their provider and measurement date are unknown. They are retained for provenance and never used to rank the shortlist.",
    "",
  ];
  if (plan.shortfall > 0) {
    lines.push(
      `**Research gap: ${plan.shortfall} more suitable sources are needed.** Broaden primary-source research before presenting a complete list.`,
      "",
    );
  }
  lines.push(
    "| # | Website / route | Format | Proposed topic or action | Target page | Week | Cost status |",
    "|---|---|---|---|---|---|---|",
  );
  for (const t of plan.tasks) {
    lines.push(
      `| ${t.position} | [${cell(t.website)}](${t.posting_url}) | ${t.format} | ${cell(
        t.suggested_title_or_action,
      )} | ${t.target_page} | ${t.suggested_week} | ${t.cost_status} |`,
    );
  }
  for (const t of plan.tasks) {
    lines.push(
      "",
      `## ${t.position}. ${cell(t.website)}`,
      "",
      t.why_this_site,
      "",
      `**Proposed title/action:** ${cell(t.suggested_title_or_action)}`,
      `**Target:** ${t.target_page} (${t.target_page_status})`,
      `**Planning slot:** ${t.suggested_date} — ${t.timing_basis}`,
      `**Priority:** ${t.priority}. **Status:** ${t.status}`,
      "",
      "What to write:",
      "",
      ...t.outline.map((x) => `- ${x}`),
      "",
      "How to post:",
      "",
      ...t.how_to_post.map((x, i) => `${i + 1}. ${x}`),
      "",
      `**Links:** ${t.link_guidance}`,
      `**Eligibility:** ${t.eligibility}`,
      `**Publication role:** ${t.publication_role}`,
      `**Authority:** ${t.authority_assessment} Current DA/DR: not measured. Sheet DR: ${t.sheet_dr_values_unverified.join(
        ", ",
      )} (unverified${t.sheet_dr_conflict ? " and conflicting" : ""}).`,
      "",
      "Before posting:",
      "",
      ...t.before_posting.map((x) => `- ${x}`),
      "",
      "After posting:",
      "",
      ...t.after_posting.map((x) => `- ${x}`),
      "",
      `Guidance checked ${t.guidance_checked_on}: ` +
        t.guidance_sources.map((u, i) => `[Source ${i + 1}](${u})`).join(" · "),
    );
  }
  return lines.join("\n") + "\n";
}

// Re-export the cell escaper for sibling modules.
export { cell } from "./sources.js";
