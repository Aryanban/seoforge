/**
 * Schema.org JSON-LD validation — broadened to 12+ entity types with both
 * schema.org property correctness and Google Rich Results requirements.
 */
import * as cheerio from "cheerio";
import { SchemaValidationResult } from "../types.js";

export function validateSchemaOrg(
  html: string,
  expectedEntities: string[] = []
): SchemaValidationResult {
  const $ = cheerio.load(html);
  const typesFound: string[] = [];
  const errors: string[] = [];
  const googleRichResultsErrors: string[] = [];
  const schemaOrgErrors: string[] = [];
  let rawGraphCount = 0;

  const scripts = $('script[type="application/ld+json"]');

  if (scripts.length === 0) {
    return {
      hasJsonLd: false,
      typesFound: [],
      missingExpected: expectedEntities,
      googleRichResultsErrors: [],
      schemaOrgErrors: ["No application/ld+json script tag found in HTML."],
      // NOTE: `errors` is reserved for JSON *parse* failures. Leaving it empty
      // here prevents the "no structured data" case from also being reported
      // as "malformed JSON-LD".
      errors: [],
      rawGraphCount: 0,
    };
  }

  scripts.each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;

    let parsed: any;
    try {
      parsed = JSON.parse(raw.trim());
    } catch (e: any) {
      errors.push(`Malformed JSON-LD syntax: ${e.message}`);
      return;
    }

    const nodes: any[] = [];
    let topLevelContext: string | undefined;
    if (Array.isArray(parsed)) {
      nodes.push(...parsed);
    } else if (parsed["@graph"] && Array.isArray(parsed["@graph"])) {
      // A @graph carries one @context on the wrapper that applies to every
      // nested node; inheriting it avoids flagging valid graphs as "undefined".
      topLevelContext = typeof parsed["@context"] === "string" ? parsed["@context"] : undefined;
      nodes.push(...parsed["@graph"]);
    } else if (parsed["@type"]) {
      nodes.push(parsed);
    } else {
      schemaOrgErrors.push("Top-level JSON-LD object missing '@type' or '@graph'.");
      return;
    }

    rawGraphCount += nodes.length;

    for (const node of nodes) {
      const ctx = node["@context"] ?? topLevelContext;
      if (!ctx || (typeof ctx === "string" && !ctx.includes("schema.org"))) {
        schemaOrgErrors.push(`Invalid @context: '${ctx}'. Expected 'https://schema.org'.`);
      }
      const type = node["@type"];
      if (!type) {
        schemaOrgErrors.push("Schema entity node missing '@type' property.");
        continue;
      }
      // Support multi-type nodes e.g. ["Product", "Offer"]
      const typeList = Array.isArray(type) ? type : [type];
      for (const t of typeList) typesFound.push(t);
      validateEntity(node, typeList, errors, googleRichResultsErrors, schemaOrgErrors);
    }
  });

  const missingExpected = expectedEntities.filter((exp) => {
    if (typesFound.includes(exp)) return false;
    if (exp === "SoftwareApplication" && typesFound.includes("WebApplication")) return false;
    return true;
  });

  return {
    hasJsonLd: typesFound.length > 0,
    typesFound,
    missingExpected,
    googleRichResultsErrors,
    schemaOrgErrors,
    errors,
    rawGraphCount,
  };
}

function isPlainString(value: unknown): boolean {
  return typeof value === "string";
}

function validateEntity(
  node: any,
  types: string[],
  errors: string[],
  googleRichResultsErrors: string[],
  schemaOrgErrors: string[]
): void {
  const has = (t: string) => types.includes(t);
  const label = node.name || node.headline || node["@type"] || "entity";

  if (has("SoftwareApplication") || has("WebApplication")) {
    if (!node.name) googleRichResultsErrors.push(`SoftwareApplication '${label}' missing mandatory 'name'.`);
    if (!node.offers && !node.review && !node.aggregateRating) {
      googleRichResultsErrors.push(
        `SoftwareApplication '${label}' missing required 'offers', 'review', or 'aggregateRating' for Google Rich Results.`
      );
    }
    if (!node.operatingSystem) schemaOrgErrors.push(`SoftwareApplication '${label}' missing 'operatingSystem'.`);
  }

  if (has("Person")) {
    if (!node.name) googleRichResultsErrors.push("Person entity missing 'name' property.");
    if (!node.url && !node["@id"]) schemaOrgErrors.push("Person entity missing 'url' or '@id'.");
    if (node.alumniOf && isPlainString(node.alumniOf)) {
      schemaOrgErrors.push(
        `Person.alumniOf contains raw string '${node.alumniOf}' instead of structured EducationalOrganization object.`
      );
    }
    if (node.worksFor && isPlainString(node.worksFor)) {
      schemaOrgErrors.push(
        `Person.worksFor contains raw string '${node.worksFor}' instead of structured Organization object.`
      );
    }
  }

  if (has("WebSite")) {
    if (!node.url) googleRichResultsErrors.push("WebSite entity missing 'url' property.");
    if (!node.name) googleRichResultsErrors.push("WebSite entity missing 'name' property.");
  }

  if (has("Organization")) {
    if (!node.name) googleRichResultsErrors.push("Organization entity missing 'name' property.");
    if (!node.url && !node["@id"]) schemaOrgErrors.push("Organization entity missing 'url' or '@id'.");
    if (node.contactPoint && isPlainString(node.contactPoint)) {
      schemaOrgErrors.push("Organization.contactPoint is a raw string instead of a structured ContactPoint object.");
    }
  }

  if (has("FAQPage")) {
    if (!node.mainEntity || !Array.isArray(node.mainEntity)) {
      googleRichResultsErrors.push("FAQPage entity missing 'mainEntity' question array.");
    } else {
      for (const q of node.mainEntity) {
        if (!q.name) googleRichResultsErrors.push("FAQPage question missing 'name'.");
        if (!q.acceptedAnswer || !q.acceptedAnswer.text) {
          googleRichResultsErrors.push(`FAQPage question '${q.name || "unnamed"}' missing 'acceptedAnswer.text'.`);
        }
      }
    }
  }

  if (has("Article") || has("NewsArticle") || has("BlogPosting")) {
    if (!node.headline) googleRichResultsErrors.push(`Article '${label}' missing mandatory 'headline'.`);
    if (!node.author) googleRichResultsErrors.push(`Article '${label}' missing mandatory 'author'.`);
    if (!node.datePublished)
      googleRichResultsErrors.push(`Article '${label}' missing mandatory 'datePublished'.`);
    if (node.author && isPlainString(node.author)) {
      schemaOrgErrors.push(`Article.author is a raw string '${node.author}' instead of a structured Person object.`);
    }
  }

  if (has("Product")) {
    if (!node.name) googleRichResultsErrors.push(`Product '${label}' missing mandatory 'name'.`);
    if (!node.offers && !node.aggregateRating) {
      googleRichResultsErrors.push(`Product '${label}' missing 'offers' or 'aggregateRating' for rich results.`);
    }
    if (node.offers && isPlainString(node.offers)) {
      schemaOrgErrors.push("Product.offers is a raw string instead of a structured Offer object.");
    }
  }

  if (has("Offer")) {
    if (!node.price && node.price === undefined)
      schemaOrgErrors.push(`Offer missing 'price'.`);
    if (!node.priceCurrency && !node.priceSpecification)
      schemaOrgErrors.push(`Offer missing 'priceCurrency' (e.g. 'USD').`);
  }

  if (has("Event")) {
    if (!node.name) googleRichResultsErrors.push(`Event '${label}' missing mandatory 'name'.`);
    if (!node.startDate) googleRichResultsErrors.push(`Event '${label}' missing mandatory 'startDate'.`);
    if (!node.location) googleRichResultsErrors.push(`Event '${label}' missing mandatory 'location'.`);
  }

  if (has("LocalBusiness")) {
    if (!node.name) googleRichResultsErrors.push("LocalBusiness missing mandatory 'name'.");
    if (!node.address) googleRichResultsErrors.push("LocalBusiness missing mandatory 'address'.");
  }

  if (has("BreadcrumbList")) {
    if (!node.itemListElement || !Array.isArray(node.itemListElement)) {
      googleRichResultsErrors.push("BreadcrumbList missing 'itemListElement' array.");
    } else {
      node.itemListElement.forEach((item: any, idx: number) => {
        if (!item.position) googleRichResultsErrors.push(`BreadcrumbList item ${idx} missing 'position'.`);
        if (!item.name) googleRichResultsErrors.push(`BreadcrumbList item ${idx} missing 'name'.`);
      });
    }
  }

  if (has("HowTo")) {
    if (!node.step || (Array.isArray(node.step) && node.step.length === 0)) {
      googleRichResultsErrors.push("HowTo missing 'step' instructions.");
    }
    if (!node.totalTime && !node.estimatedCost) {
      schemaOrgErrors.push("HowTo missing 'totalTime' or 'estimatedCost'.");
    }
  }

  if (has("Review")) {
    if (!node.reviewRating) googleRichResultsErrors.push("Review missing 'reviewRating'.");
    if (!node.author) googleRichResultsErrors.push("Review missing 'author'.");
  }

  if (has("Rating")) {
    if (node.ratingValue === undefined) schemaOrgErrors.push("Rating missing 'ratingValue'.");
    if (node.bestRating === undefined) schemaOrgErrors.push("Rating missing 'bestRating'.");
  }

  if (has("VideoObject")) {
    if (!node.name) googleRichResultsErrors.push("VideoObject missing mandatory 'name'.");
    if (!node.thumbnailUrl) googleRichResultsErrors.push("VideoObject missing mandatory 'thumbnailUrl'.");
    if (!node.uploadDate) googleRichResultsErrors.push("VideoObject missing mandatory 'uploadDate'.");
  }

  if (has("Dataset")) {
    if (!node.name) schemaOrgErrors.push("Dataset missing 'name'.");
    if (!node.description) schemaOrgErrors.push("Dataset missing 'description'.");
  }
}
