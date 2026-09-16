import * as cheerio from "cheerio";
import { SchemaValidationResult } from "./types.js";

export function validateSchemaOrg(
  html: string,
  expectedEntities: string[] = []
): SchemaValidationResult {
  const $ = cheerio.load(html);
  const typesFound: string[] = [];
  const errors: string[] = [];
  let rawGraphCount = 0;

  const scripts = $('script[type="application/ld+json"]');

  if (scripts.length === 0) {
    return {
      hasJsonLd: false,
      typesFound: [],
      missingExpected: expectedEntities,
      errors: ["No application/ld+json script tag found in HTML."],
      rawGraphCount: 0,
    };
  }

  scripts.each((_, el) => {
    const raw = $(el).html();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw.trim());

      if (parsed["@graph"] && Array.isArray(parsed["@graph"])) {
        rawGraphCount += parsed["@graph"].length;
        for (const item of parsed["@graph"]) {
          if (item["@type"]) {
            typesFound.push(item["@type"]);
            validateEntity(item, errors);
          }
        }
      } else if (parsed["@type"]) {
        rawGraphCount += 1;
        typesFound.push(parsed["@type"]);
        validateEntity(parsed, errors);
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
    errors,
    rawGraphCount,
  };
}

function validateEntity(entity: any, errors: string[]) {
  const type = entity["@type"];
  if (type === "Person") {
    if (!entity.name) errors.push("Person entity missing 'name' property.");
    if (!entity.url && !entity["@id"]) errors.push("Person entity missing 'url' or '@id'.");
  } else if (type === "WebSite") {
    if (!entity.url) errors.push("WebSite entity missing 'url' property.");
    if (!entity.name) errors.push("WebSite entity missing 'name' property.");
  } else if (type === "SoftwareApplication") {
    if (!entity.name) errors.push("SoftwareApplication entity missing 'name' property.");
    if (!entity.operatingSystem) errors.push(`SoftwareApplication '${entity.name || "unnamed"}' missing 'operatingSystem'.`);
  } else if (type === "FAQPage") {
    if (!entity.mainEntity || !Array.isArray(entity.mainEntity)) {
      errors.push("FAQPage entity missing 'mainEntity' question array.");
    }
  }
}
