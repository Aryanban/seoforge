/**
 * Structured data checks — surfaces schema.org and Google Rich Results
 * validation errors as audit issues.
 */
import { AuditIssue } from "../types.js";
import { PageCheckContext, CheckOutput } from "./registry.js";

export function schemaChecks(ctx: PageCheckContext): CheckOutput {
  const issues: AuditIssue[] = [];
  const { meta, pageUrl, html, thresholds } = ctx;

  if (!html) return { issues };

  const schema = meta.schema;

  if (!schema.hasJsonLd && thresholds?.requireSchema !== false) {
    issues.push({
      id: "schema_missing",
      name: "No structured data found",
      severity: "Notice",
      category: "StructuredData",
      message: "Page has no Schema.org JSON-LD structured data. Add entity markup to qualify for rich results and AI answers.",
      url: pageUrl,
    });
  }

  for (const err of schema.googleRichResultsErrors) {
    issues.push({
      id: "schema_google_rich_results_error",
      name: "Structured data has Google rich results validation error",
      severity: "Notice",
      category: "StructuredData",
      message: err,
      url: pageUrl,
    });
  }

  for (const err of schema.schemaOrgErrors) {
    issues.push({
      id: "schema_org_validation_error",
      name: "Structured data has schema.org validation error",
      severity: "Notice",
      category: "StructuredData",
      message: err,
      url: pageUrl,
    });
  }

  for (const err of schema.errors) {
    issues.push({
      id: "schema_malformed_jsonld",
      name: "Malformed JSON-LD structured data",
      severity: "Warning",
      category: "StructuredData",
      message: err,
      url: pageUrl,
    });
  }

  if (schema.missingExpected.length > 0) {
    issues.push({
      id: "schema_missing_expected",
      name: "Missing expected Schema.org entities",
      severity: "Notice",
      category: "StructuredData",
      message: `Missing expected Schema.org entities: ${schema.missingExpected.join(", ")}.`,
      url: pageUrl,
      details: { missing: schema.missingExpected },
    });
  }

  return { issues };
}
