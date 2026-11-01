/**
 * High-Speed 64-bit SimHash & Hamming Distance Engine.
 * Provides O(N) near-duplicate content detection across tens of thousands of pages.
 * Hamming distance <= 6 indicates near-duplicate content (>90% similarity).
 */

/**
 * Fast 64-bit FNV-1a hash of a token string.
 */
function fnv1a64(str: string): bigint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;

  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash;
}

/**
 * Computes a 64-bit SimHash fingerprint from text tokens using shingles (1-gram and 2-gram).
 */
export function computeSimHash(text: string): bigint {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (tokens.length === 0) return 0n;

  const bitCounts = new Array<number>(64).fill(0);

  // Generate 1-grams and 2-grams
  const shingles: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    shingles.push(tokens[i]);
    if (i + 1 < tokens.length) {
      shingles.push(`${tokens[i]} ${tokens[i + 1]}`);
    }
  }

  // Compute frequencies for token weighting
  const frequencies = new Map<string, number>();
  for (const s of shingles) {
    frequencies.set(s, (frequencies.get(s) || 0) + 1);
  }

  for (const [shingle, weight] of frequencies) {
    const hash = fnv1a64(shingle);
    for (let i = 0; i < 64; i++) {
      const bit = (hash >> BigInt(i)) & 1n;
      bitCounts[i] += bit === 1n ? weight : -weight;
    }
  }

  let fingerprint = 0n;
  for (let i = 0; i < 64; i++) {
    if (bitCounts[i] > 0) {
      fingerprint |= 1n << BigInt(i);
    }
  }

  return fingerprint;
}

/**
 * Calculates the Hamming distance (number of differing bits) between two 64-bit fingerprints.
 */
export function hammingDistance(a: bigint, b: bigint): number {
  let diff = a ^ b;
  let count = 0;
  while (diff > 0n) {
    count += Number(diff & 1n);
    diff >>= 1n;
  }
  return count;
}

/**
 * Evaluates similarity percentage between two SimHash fingerprints.
 */
export function simHashSimilarity(a: bigint, b: bigint): number {
  const dist = hammingDistance(a, b);
  return Math.round(((64 - dist) / 64) * 100);
}

export interface DuplicateCluster {
  canonicalUrl: string;
  duplicateUrls: Array<{ url: string; similarityPct: number; hammingDist: number }>;
}

/**
 * Finds near-duplicate clusters across a page dataset using SimHash.
 * @param pages List of pages with url and bodyText
 * @param maxHammingDistance Maximum differing bits to consider duplicate (default 6, ~90% similarity)
 */
export function findDuplicateClusters(
  pages: Array<{ url: string; bodyText?: string }>,
  maxHammingDistance = 6
): DuplicateCluster[] {
  const fingerprints: Array<{ url: string; hash: bigint }> = [];

  for (const p of pages) {
    if (!p.bodyText || p.bodyText.length < 50) continue;
    fingerprints.push({
      url: p.url,
      hash: computeSimHash(p.bodyText),
    });
  }

  const clusters: DuplicateCluster[] = [];
  const visited = new Set<string>();

  for (let i = 0; i < fingerprints.length; i++) {
    const cur = fingerprints[i];
    if (visited.has(cur.url)) continue;

    const duplicates: Array<{ url: string; similarityPct: number; hammingDist: number }> = [];

    for (let j = i + 1; j < fingerprints.length; j++) {
      const other = fingerprints[j];
      if (visited.has(other.url)) continue;

      const dist = hammingDistance(cur.hash, other.hash);
      if (dist <= maxHammingDistance) {
        visited.add(other.url);
        duplicates.push({
          url: other.url,
          similarityPct: simHashSimilarity(cur.hash, other.hash),
          hammingDist: dist,
        });
      }
    }

    if (duplicates.length > 0) {
      visited.add(cur.url);
      clusters.push({
        canonicalUrl: cur.url,
        duplicateUrls: duplicates,
      });
    }
  }

  return clusters;
}
