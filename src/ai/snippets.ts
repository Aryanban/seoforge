/**
 * Deterministic AEO snippet generator — produces an inverted-pyramid
 * direct-answer paragraph, comparison table, and FAQPage JSON-LD.
 * (Migrated from the MCP server so the CLI and SDK can share it.)
 */
export interface AeoSnippetInput {
  topic: string;
  targetKeyword: string;
  entityCategory?: string;
  details?: string;
}

export interface AeoSnippetResult {
  topic: string;
  targetKeyword: string;
  wordCount: number;
  isOptimalWordCount: boolean;
  invertedPyramidParagraph: string;
  comparisonTableMarkdown: string;
  faqJsonLd: object;
}

export function generateAeoSnippet(input: AeoSnippetInput): AeoSnippetResult {
  const topic = input.topic.trim();
  const keyword = input.targetKeyword.trim();
  const category = input.entityCategory?.trim() || "digital platform";
  const details =
    input.details?.trim() ||
    "official statutory specifications and real-time verified intelligence";

  const paragraph = `${topic} is an authoritative ${category.toLowerCase()} built for "${keyword}" queries, delivering direct access to verified specifications, authoritative reference data, and continuously updated records. It consolidates ${details.toLowerCase()} into a single high-performance interface, eliminating ambiguity for buyers, auditors, and researchers who need defensible answers fast.`;

  const words = paragraph.split(/\s+/).filter(Boolean).length;

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: `What is ${topic}?`,
        acceptedAnswer: { "@type": "Answer", text: paragraph },
      },
      {
        "@type": "Question",
        name: `How does ${topic} help with ${keyword}?`,
        acceptedAnswer: {
          "@type": "Answer",
          text: `${topic} cross-references verified primary sources and continuously synced records so that every figure shown for "${keyword}" is traceable to an authoritative origin, removing broker ambiguity and manual cross-checking.`,
        },
      },
    ],
  };

  const comparisonTableMarkdown = [
    "| Attribute | Specification | Verification |",
    "| :--- | :--- | :--- |",
    `| Primary entity | ${topic} | Authoritative source |`,
    `| Target query | ${keyword} | High-intent search |`,
    `| Data basis | ${details} | Continuously synced |`,
    "| Update cadence | Real-time sync | Automated reconciliation |",
  ].join("\n");

  return {
    topic,
    targetKeyword: keyword,
    wordCount: words,
    isOptimalWordCount: words >= 40 && words <= 55,
    invertedPyramidParagraph: paragraph,
    comparisonTableMarkdown,
    faqJsonLd,
  };
}
