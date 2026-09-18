import * as cheerio from "cheerio";
import { SchemaValidationResult } from "./types.js";

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
      errors: ["No application/ld+json script tag found in HTML."],
      rawGraphCount: 0,
    };
  }

  scripts.each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw.trim());

      // Validate @context
      const context = parsed["@context"];
      if (!context || (typeof context === "string" && !context.includes("schema.org"))) {
        schemaOrgErrors.push(`Invalid @context: '${context}'. Expected 'https://schema.org'.`);
      }

      if (parsed["@graph"] && Array.isArray(parsed["@graph"])) {
        rawGraphCount += parsed["@graph"].length;
        for (const item of parsed["@graph"]) {
          if (item["@type"]) {
            typesFound.push(item["@type"]);
            validateEntity(item, errors, googleRichResultsErrors, schemaOrgErrors);
          } else {
            schemaOrgErrors.push("Schema entity node missing '@type' property in @graph.");
          }
        }
      } else if (parsed["@type"]) {
        rawGraphCount += 1;
        typesFound.push(parsed["@type"]);
        validateEntity(parsed, errors, googleRichResultsErrors, schemaOrgErrors);
      } else {
        schemaOrgErrors.push("Top-level JSON-LD object missing '@type' or '@graph'.");
      }
    } catch (e: any) {
      errors.push(`Malformed JSON-LD syntax: ${e.message}`);
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

function validateEntity(
  entity: any,
  errors: string[],
  googleRichResultsErrors: string[],
  schemaOrgErrors: string[]
) {
  const type = entity["@type"];

  if (type === "SoftwareApplication" || type === "WebApplication") {
    const appName = entity.name || "Unnamed Application";
    if (!entity.name) {
      googleRichResultsErrors.push(`SoftwareApplication missing mandatory 'name' property.`);
    }
    // Google Rich Results requirement: must have 'offers', 'review', or 'aggregateRating'
    if (!entity.offers && !entity.review && !entity.aggregateRating) {
      googleRichResultsErrors.push(
        `SoftwareApplication '${appName}' missing required 'offers', 'review', or 'aggregateRating' for Google Rich Results.`
      );
    }
    if (!entity.operatingSystem) {
      schemaOrgErrors.push(`SoftwareApplication '${appName}' missing 'operatingSystem'.`);
    }
  } else if (type === "Person") {
    if (!entity.name) {
      googleRichResultsErrors.push("Person entity missing 'name' property.");
    }
    if (!entity.url && !entity["@id"]) {
      schemaOrgErrors.push("Person entity missing 'url' or '@id'.");
    }
    // Schema.org validation for string primitives in relational properties
    if (entity.alumniOf && typeof entity.alumniOf === "string") {
      schemaOrgErrors.push(
        `Person.alumniOf contains raw string '${entity.alumniOf}' instead of structured EducationalOrganization object.`
      );
    }
    if (entity.worksFor && typeof entity.worksFor === "string") {
      schemaOrgErrors.push(
        `Person.worksFor contains raw string '${entity.worksFor}' instead of structured Organization/EducationalOrganization object.`
      );
    }
  } else if (type === "WebSite") {
    if (!entity.url) {
      googleRichResultsErrors.push("WebSite entity missing 'url' property.");
    }
    if (!entity.name) {
      googleRichResultsErrors.push("WebSite entity missing 'name' property.");
    }
  } else if (type === "FAQPage") {
    if (!entity.mainEntity || !Array.isArray(entity.mainEntity)) {
      googleRichResultsErrors.push("FAQPage entity missing 'mainEntity' question array.");
    } else {
      for (const q of entity.mainEntity) {
        if (!q.name) {
          googleRichResultsErrors.push("FAQPage question missing 'name'.");
        }
        if (!q.acceptedAnswer || !q.acceptedAnswer.text) {
          googleRichResultsErrors.push(`FAQPage question '${q.name || "unnamed"}' missing 'acceptedAnswer.text'.`);
        }
      }
    }
  }
}
