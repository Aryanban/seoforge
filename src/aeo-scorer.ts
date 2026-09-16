import * as cheerio from "cheerio";
import { AeoScoreResult } from "./types.js";

export function evaluateAeo(html: string): AeoScoreResult {
  const $ = cheerio.load(html);
  const recommendations: string[] = [];
  let score = 0;

  // 1. Heading Structure (Max 25 pts)
  const h1s = $("h1");
  const h2s = $("h2");
  const h1Count = h1s.length;
  const h2Count = h2s.length;

  if (h1Count === 1) {
    score += 15;
  } else if (h1Count === 0) {
    recommendations.push("Missing <h1> tag. AI answer engines prioritize single authoritative <h1> headings.");
  } else {
    recommendations.push(`Found ${h1Count} <h1> tags. Best practice is exactly 1 primary <h1> per document.`);
    score += 8;
  }

  if (h2Count >= 2) {
    score += 10;
  } else if (h2Count === 1) {
    score += 5;
  } else {
    recommendations.push("Add semantic <h2> subheadings to divide topics into parseable AI answer blocks.");
  }

  // 2. Inverted Pyramid Snippet Detection (Max 30 pts)
  // Check if paragraphs immediately following H1 or H2 have 35-65 words providing direct answers
  let hasInvertedPyramidSnippet = false;
  let definitionSnippet: string | undefined;

  $("h1, h2").each((_, heading) => {
    if (hasInvertedPyramidSnippet) return;
    const nextElem = $(heading).next();
    const text = nextElem.is("p") ? nextElem.text().trim() : nextElem.find("p").first().text().trim();
    if (text) {
      const words = text.split(/\s+/).filter(Boolean);
      if (words.length >= 25 && words.length <= 75) {
        hasInvertedPyramidSnippet = true;
        definitionSnippet = text;
      }
    }
  });

  if (hasInvertedPyramidSnippet) {
    score += 30;
  } else {
    recommendations.push(
      "Add a 40–55 word declarative definition paragraph directly under your <h1> or first <h2> for AI overview extraction."
    );
    score += 10; // Partial score
  }

  // 3. Structured Data / Tables (Max 20 pts)
  const tables = $("table");
  const tableCount = tables.length;
  if (tableCount >= 1) {
    score += 20;
  } else {
    recommendations.push("Include a comparison or specification <table>. AI engines heavily prioritize table formats.");
    score += 5;
  }

  // 4. Schema FAQ or Rich Entities (Max 25 pts)
  const hasFaqSchema = html.includes('"@type":"FAQPage"') || html.includes('"@type": "FAQPage"');
  if (hasFaqSchema) {
    score += 25;
  } else {
    // If it has other high-tier schemas, grant partial credit
    if (html.includes('"@type": "Person"') || html.includes('"@type": "SoftwareApplication"')) {
      score += 15;
    } else {
      recommendations.push("Add FAQPage or SoftwareApplication Schema.org JSON-LD to qualify for rich snippet carousels.");
    }
  }

  // Clamp score
  score = Math.min(100, Math.max(0, score));

  return {
    score,
    h1Count,
    h2Count,
    hasInvertedPyramidSnippet,
    definitionSnippet,
    tableCount,
    hasFaqSchema,
    recommendations,
  };
}
