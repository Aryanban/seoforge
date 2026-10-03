import { describe, it, expect } from "vitest";
import {
  generateArticleSchema,
  generateFaqSchema,
  extractFaqFromHtml,
  generateLocalBusinessSchema,
  generateBreadcrumbSchema,
  generateRecommendedSchemas,
  formatSchemaScript,
} from "../src/schema-generator.js";

describe("Schema Generator", () => {
  it("generates valid Article JSON-LD markup", () => {
    const schema: any = generateArticleSchema({
      headline: "How to Build High-Performance APIs",
      description: "A comprehensive guide to scaling backend architecture.",
      url: "https://example.com/blog/build-apis",
      authorName: "John Doe",
      authorType: "Person",
      publisherName: "Tech Publication",
    });

    expect(schema["@context"]).toBe("https://schema.org");
    expect(schema["@type"]).toBe("Article");
    expect(schema.headline).toBe("How to Build High-Performance APIs");
    expect(schema.author.name).toBe("John Doe");
    expect(schema.mainEntityOfPage["@id"]).toBe("https://example.com/blog/build-apis");
  });

  it("extracts and formats FAQPage from HTML questions", () => {
    const html = `
      <div>
        <h2>What is Answer Engine Optimization?</h2>
        <p>Answer Engine Optimization (AEO) is the practice of optimizing content so AI engines like Perplexity and Google Overviews cite it.</p>
        <h2>Why is Schema.org markup important?</h2>
        <p>Schema markup provides machine-readable entities directly to search crawlers without ambiguity.</p>
      </div>
    `;

    const faqs = extractFaqFromHtml(html);
    expect(faqs.length).toBe(2);
    expect(faqs[0].question).toContain("Answer Engine Optimization");
    expect(faqs[0].answer).toContain("Perplexity");

    const schema: any = generateFaqSchema(faqs);
    expect(schema["@type"]).toBe("FAQPage");
    expect(schema.mainEntity.length).toBe(2);
    expect(schema.mainEntity[0]["@type"]).toBe("Question");
    expect(schema.mainEntity[0].acceptedAnswer["@type"]).toBe("Answer");
  });

  it("generates BreadcrumbList from URL segments", () => {
    const schema: any = generateBreadcrumbSchema("https://example.com/services/seo/audit");
    expect(schema["@type"]).toBe("BreadcrumbList");
    expect(schema.itemListElement.length).toBe(4);
    expect(schema.itemListElement[0].name).toBe("Home");
    expect(schema.itemListElement[1].name).toBe("Services");
    expect(schema.itemListElement[2].name).toBe("Seo");
    expect(schema.itemListElement[3].name).toBe("Audit");
  });

  it("generates LocalBusiness JSON-LD", () => {
    const schema: any = generateLocalBusinessSchema({
      name: "Apex Dental Studio",
      url: "https://apexdental.com",
      telephone: "+1-555-0199",
      city: "Austin",
      streetAddress: "123 Main St",
    });

    expect(schema["@type"]).toBe("LocalBusiness");
    expect(schema.name).toBe("Apex Dental Studio");
    expect(schema.address["@type"]).toBe("PostalAddress");
    expect(schema.address.addressLocality).toBe("Austin");
  });

  it("formats schema into valid script tag", () => {
    const schema = { "@context": "https://schema.org", "@type": "Thing", "name": "Test" };
    const script = formatSchemaScript(schema);
    expect(script).toContain('<script type="application/ld+json">');
    expect(script).toContain('"@type": "Thing"');
    expect(script).toContain("</script>");
  });
});
