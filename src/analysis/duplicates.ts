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
 * blowup on large crawls). Candidate generation now uses MinHash + LSH, see
 * detectDuplicates below.
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
  /** Number of near-duplicate pages found for `url` (near findings only). */
  matches?: number;
}

export interface DuplicateReport {
  exactGroups: string[][]; // each group shares one fingerprint
  nearDuplicates: DuplicateFinding[];
}

/** MinHash signature length (hash functions). */
const MINHASH_K = 128;
/** LSH banding: 16 bands x 8 rows. P(candidate) ≈ 0.99 at Jaccard 0.85, ≈ 0.24 at 0.6. */
const LSH_BANDS = 16;
const LSH_ROWS = MINHASH_K / LSH_BANDS;
/** Upper bound of candidates verified per page (highest band agreement first). */
const MAX_CANDIDATES_PER_PAGE = 256;
/** MinHash pre-filter before the exact Jaccard check (slack for estimator error). */
const MINHASH_PREFILTER = NEAR_DUPLICATE_THRESHOLD - 0.1;

/** 32-bit FNV-1a. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hashed, de-duplicated, sorted 5-word shingles (sorted → linear-merge Jaccard). */
function hashedShingles(words: string[], n: number): Uint32Array {
  const set = new Set<number>();
  if (words.length <= n) {
    if (words.length) set.add(fnv1a(words.join(" ")));
  } else {
    for (let i = 0; i + n <= words.length; i++) set.add(fnv1a(words.slice(i, i + n).join(" ")));
  }
  return Uint32Array.from(set).sort();
}

function sortedJaccard(a: Uint32Array, b: Uint32Array): number {
  if (a.length === 0 || b.length === 0) return 0;
  let i = 0, j = 0, inter = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { inter++; i++; j++; }
    else if (a[i] < b[j]) i++;
    else j++;
  }
  return inter / (a.length + b.length - inter);
}

// Deterministic hash-function coefficients (seeded LCG) so results are reproducible.
const MH_A = new Uint32Array(MINHASH_K);
const MH_B = new Uint32Array(MINHASH_K);
{
  let seed = 0x9e3779b9;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let k = 0; k < MINHASH_K; k++) { MH_A[k] = next() | 1; MH_B[k] = next(); }
}

function minhash(shingles: Uint32Array): Uint32Array {
  const sig = new Uint32Array(MINHASH_K).fill(0xffffffff);
  for (let s = 0; s < shingles.length; s++) {
    const x = shingles[s];
    for (let k = 0; k < MINHASH_K; k++) {
      const h = (Math.imul(MH_A[k], x) + MH_B[k]) >>> 0;
      if (h < sig[k]) sig[k] = h;
    }
  }
  return sig;
}

/**
 * Detect exact + near duplicates across a crawl.
 *
 * Near duplicates use MinHash (k=128) + LSH banding (16x8) to generate
 * candidates in near-linear time, then confirm with exact shingle Jaccard.
 * The previous inverted-shingle index degenerated to O(n²) on templated sites
 * (shared boilerplate shingles made every page a candidate of every other).
 * Each page is reported once, against its most similar page, with the number
 * of near-duplicates found (Screaming Frog "Closest Similarity Match" parity).
 */
export function detectDuplicates(pages: DuplicatePageInput[]): DuplicateReport {
  interface ProcessedPage {
    url: string;
    words: string[];
    fp: string;
  }

  const processed: ProcessedPage[] = [];
  const byFingerprint = new Map<string, string[]>();

  // Single-pass normalization and exact fingerprinting O(N * words)
  for (const p of pages) {
    const words = wordsOf(p.bodyText);
    if (words.length < (p.minWords ?? 40)) continue;
    const fp = fingerprintBodyText(p.bodyText);
    processed.push({ url: p.url, words, fp });
    const group = byFingerprint.get(fp) || [];
    group.push(p.url);
    byFingerprint.set(fp, group);
  }

  const exactGroups = Array.from(byFingerprint.values()).filter((g) => g.length > 1);

  // Tier 2: one representative per exact-fingerprint group (exact dups are already reported).
  const reps: ProcessedPage[] = [];
  const seenFp = new Set<string>();
  for (const p of processed) {
    if (seenFp.has(p.fp)) continue;
    seenFp.add(p.fp);
    reps.push(p);
  }
  const n = reps.length;
  const shingles = reps.map((p) => hashedShingles(p.words, DUPLICATE_SHINGLE_SIZE));
  const sigs = shingles.map(minhash);

  // LSH buckets: band index + band values → page indices
  const buckets = new Map<string, number[]>();
  const pageBandKeys: string[][] = [];
  for (let i = 0; i < n; i++) {
    const keys: string[] = [];
    for (let b = 0; b < LSH_BANDS; b++) {
      let h = 0x811c9dc5 ^ b;
      for (let r = 0; r < LSH_ROWS; r++) h = Math.imul(h ^ sigs[i][b * LSH_ROWS + r], 0x01000193);
      const key = `${b}:${h >>> 0}`;
      keys.push(key);
      const list = buckets.get(key);
      if (list) list.push(i);
      else buckets.set(key, [i]);
    }
    pageBandKeys.push(keys);
  }

  const nearDuplicates: DuplicateFinding[] = [];
  const bandHits = new Uint16Array(n);
  const touched: number[] = [];
  for (let i = 0; i < n; i++) {
    touched.length = 0;
    for (const key of pageBandKeys[i]) {
      for (const j of buckets.get(key)!) {
        if (j === i) continue;
        if (bandHits[j] === 0) touched.push(j);
        bandHits[j]++;
      }
    }
    // Most band agreement first; bounded verification work per page.
    touched.sort((x, y) => bandHits[y] - bandHits[x]);
    const limit = Math.min(touched.length, MAX_CANDIDATES_PER_PAGE);
    let best = -1;
    let bestSim = 0;
    let matches = 0;
    for (let c = 0; c < limit; c++) {
      const j = touched[c];
      let agree = 0;
      const si = sigs[i], sj = sigs[j];
      for (let k = 0; k < MINHASH_K; k++) if (si[k] === sj[k]) agree++;
      if (agree / MINHASH_K < MINHASH_PREFILTER) continue;
      const sim = sortedJaccard(shingles[i], shingles[j]);
      if (sim < NEAR_DUPLICATE_THRESHOLD) continue;
      matches++;
      if (sim > bestSim || (sim === bestSim && reps[j].url < reps[best].url)) {
        bestSim = sim;
        best = j;
      }
    }
    for (const j of touched) bandHits[j] = 0;
    if (best >= 0) {
      nearDuplicates.push({
        url: reps[i].url,
        duplicateOf: reps[best].url,
        kind: "near",
        similarity: Math.round(bestSim * 100) / 100,
        matches,
      });
    }
  }

  return { exactGroups, nearDuplicates };
}
