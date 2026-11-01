import { describe, it, expect } from "vitest";
import {
  computeSimHash,
  hammingDistance,
  simHashSimilarity,
  findDuplicateClusters,
} from "../src/analysis/simhash.js";

describe("64-bit SimHash & Duplicate Detection", () => {
  it("computes identical SimHash for identical text", () => {
    const text = "SEOForge delivers autonomous technical SEO audits and AEO scoring for modern AI search engines.";
    const hash1 = computeSimHash(text);
    const hash2 = computeSimHash(text);

    expect(hash1).toBe(hash2);
    expect(hammingDistance(hash1, hash2)).toBe(0);
    expect(simHashSimilarity(hash1, hash2)).toBe(100);
  });

  it("yields low Hamming distance for minor wording variations (near-duplicates)", () => {
    const textA = `
      High performance red running shoes designed with breathable mesh fabric, cushioned EVA midsoles,
      and durable rubber outsoles for marathon training. Enjoy maximum shock absorption and comfort.
      Free shipping on orders over 50 dollars across North America with a 30-day money-back guarantee.
    `;
    const textB = `
      High performance red running shoes designed with breathable air mesh fabric, cushioned EVA midsoles,
      and durable rubber outsoles for marathon training. Enjoy maximum shock absorption and lightweight comfort.
      Free shipping on orders over 50 dollars across North America with a 30-day money-back guarantee.
    `;

    const hashA = computeSimHash(textA);
    const hashB = computeSimHash(textB);

    const dist = hammingDistance(hashA, hashB);
    expect(dist).toBeLessThanOrEqual(6);
    expect(simHashSimilarity(hashA, hashB)).toBeGreaterThanOrEqual(90);
  });

  it("yields high Hamming distance for completely different topics", () => {
    const textA = "The solar system contains eight planets orbiting the sun along elliptical paths in space.";
    const textB = "Recipe for homemade chocolate chip cookies with organic butter, dark cocoa, and brown sugar.";

    const hashA = computeSimHash(textA);
    const hashB = computeSimHash(textB);

    const dist = hammingDistance(hashA, hashB);
    expect(dist).toBeGreaterThan(15);
  });

  it("finds duplicate clusters across a page set", () => {
    const pages = [
      {
        url: "https://shop.com/shoes-red",
        bodyText: "High performance running shoes in red color with air mesh support and free shipping today worldwide for all runners.",
      },
      {
        url: "https://shop.com/shoes-red-sale",
        bodyText: "High performance running shoes in red color with air mesh support and free shipping today worldwide for all athletes.",
      },
      {
        url: "https://shop.com/gardening-tools",
        bodyText: "Heavy duty steel garden shovels, rakes, pruning shears, soil fertilizers, and watering hoses for landscaping.",
      },
    ];

    const clusters = findDuplicateClusters(pages, 6);
    expect(clusters.length).toBe(1);
    expect(clusters[0].canonicalUrl).toBe("https://shop.com/shoes-red");
    expect(clusters[0].duplicateUrls[0].url).toBe("https://shop.com/shoes-red-sale");
  });
});
