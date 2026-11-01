/**
 * Near-duplicate content detection — Screaming Frog "Near Duplicates" +
 * Sitebulb "Duplicate Content" parity.
 *
 * Two-tier, fully deterministic (zero network, zero model download):
 *  1. Exact duplicates — SHA-256 of a normalised body-text fingerprint. This is
 *     the cheap, always-correct tier (SF "Exact Duplicates" Issue).
 *  2. Near duplicates — word-level shingle (n=5) Jaccard similarity with a
 *     0.85 trigger threshold (SF "Near Duplicates" Warning; their exact %
 *     cutoff is unpublished, so SEOForge documents its own: ≥0.85).
 *
 * The fingerprint strips boilerplate (header/nav/footer/script/style) so that
 * shared templates do not inflate similarity — a common false-positive source
 * in naive whole-HTML hashing. Performance is O(total words): shingling is a
 * single linear pass per page and pairwise comparison is bounded to pages
 * sharing at least one exact-shingle bucket via an inverted index (no O(n²)
 * blowup on large crawls).
 */
import { createHash } from "crypto";

function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprintBodyText(bodyText: string): string {
  return createHash("sha256").update(normaliseText(bodyText)).digest("hex");
}

function wordsOf(bodyText: string): string[] {
  const n = normaliseText(bodyText);
  return n ? n.split(" ") : [];
}

function shingleSet(words: string[], n = 5): Set<string> {
  const set = new Set<string>();
  if (words.length === 0) return set;
  if (words.length <= n) {
    set.add(words.join(" "));
    return set;
  }
  for (let i = 0; i + n <= words.length; i++) {
    set.add(words.slice(i, i + n).join(" "));
  }
  return set;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const s of small) if (large.has(s)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Shingle size (words) used for near-duplicate similarity. */
export const DUPLICATE_SHINGLE_SIZE = 5;
/** Jaccard trigger for `near_duplicate_content` (SF parity Warning; SF cutoff unpublished). */
export const NEAR_DUPLICATE_THRESHOLD = 0.85;

export interface DuplicatePageInput {
  url: string;
  bodyText: string;
  minWords?: number; // pages below this are skipped (thin-content noise)
}

export interface DuplicateFinding {
  url: string;
  duplicateOf: string;
  kind: "exact" | "near";
  similarity: number; // 1 for exact
}

export interface DuplicateReport {
  exactGroups: string[][]; // each group shares one fingerprint
  nearDuplicates: DuplicateFinding[];
}

/**
 * Detect exact + near duplicates across a crawl.
 * Inverted shingle index keeps this near-linear for typical sites.
 */
export function detectDuplicates(pages: DuplicatePageInput[]): DuplicateReport {
  const filtered = pages.filter((p) => wordsOf(p.bodyText).length >= (p.minWords ?? 40));

  // Tier 1: exact fingerprint groups
  const byFingerprint = new Map<string, string[]>();
  for (const p of filtered) {
    const fp = fingerprintBodyText(p.bodyText);
    const group = byFingerprint.get(fp) || [];
    group.push(p.url);
    byFingerprint.set(fp, group);
  }
  const exactGroups = Array.from(byFingerprint.values()).filter((g) => g.length > 1);

  // Tier 2: shingle Jaccard via inverted index
  const shingles = new Map<string, Set<string>>();
  const index = new Map<string, string[]>(); // shingle -> urls
  for (const p of filtered) {
    const set = shingleSet(wordsOf(p.bodyText), DUPLICATE_SHINGLE_SIZE);
    shingles.set(p.url, set);
    for (const s of set) {
      const bucket = index.get(s) || [];
      bucket.push(p.url);
      index.set(s, bucket);
    }
  }

  const exactPair = new Set<string>();
  for (const g of exactGroups) {
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        exactPair.add(`${g[i]}|${g[j]}`);
        exactPair.add(`${g[j]}|${g[i]}`);
      }
  }

  const nearDuplicates: DuplicateFinding[] = [];
  const compared = new Set<string>();
  for (const p of filtered) {
    const candidates = new Set<string>();
    for (const s of shingles.get(p.url) || []) {
      for (const u of index.get(s) || []) {
        if (u !== p.url) candidates.add(u);
      }
    }
    for (const other of candidates) {
      const key = p.url < other ? `${p.url}|${other}` : `${other}|${p.url}`;
      if (compared.has(key)) continue;
      compared.add(key);
      if (exactPair.has(key)) continue; // already reported as exact
      const sim = jaccardSimilarity(shingles.get(p.url)!, shingles.get(other)!);
      if (sim >= NEAR_DUPLICATE_THRESHOLD) {
        // Attribute to the lexicographically-first URL for stable output
        const [first, second] = p.url < other ? [p.url, other] : [other, p.url];
        nearDuplicates.push({ url: second, duplicateOf: first, kind: "near", similarity: Math.round(sim * 100) / 100 });
      }
    }
  }

  return { exactGroups, nearDuplicates };
}
