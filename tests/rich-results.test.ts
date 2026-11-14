import { describe, it, expect } from "vitest";
import { validateSchemaOrg } from "../src/checks/schema-engine.js";

const grErrors = (node: unknown) =>
  validateSchemaOrg(
    `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      ...(node as object),
    })}</script></head></html>`
  ).googleRichResultsErrors;

describe("Google rich results required properties", () => {
  it("Article has no required properties", () => {
    expect(grErrors({ "@type": "Article", headline: "Only a headline" })).toEqual([]);
  });

  it("Product with name and review is valid", () => {
    expect(grErrors({ "@type": "Product", name: "Widget", review: { "@type": "Review" } })).toEqual([]);
  });

  it("Product with only name reports one error", () => {
    expect(grErrors({ "@type": "Product", name: "Widget" })).toHaveLength(1);
  });

  it("Product offers without price or priceSpecification is an error", () => {
    const errors = grErrors({ "@type": "Product", name: "Widget", offers: [{ "@type": "Offer", priceCurrency: "USD" }] });
    expect(errors).toEqual(["Offer 'Widget' missing required 'price' (Google rich results)."]);
  });

  it("AggregateRating needs ratingValue and a count", () => {
    expect(grErrors({ "@type": "AggregateRating", ratingValue: 4.5 })).toHaveLength(1);
    expect(grErrors({ "@type": "AggregateRating", ratingValue: 4.5, reviewCount: 10 })).toEqual([]);
  });

  it("Review needs author, reviewRating and reviewRating.ratingValue", () => {
    expect(grErrors({ "@type": "Review", author: "A", reviewRating: { "@type": "Rating" } })).toHaveLength(1);
    expect(grErrors({ "@type": "Review", author: "A", reviewRating: { ratingValue: 5 } })).toEqual([]);
  });

  it("BreadcrumbList item missing position is an error", () => {
    const errors = grErrors({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", name: "Home", item: "https://example.com/", position: 1 },
        { "@type": "ListItem", name: "Blog" },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("item 1 missing required 'position'");
  });

  it("BreadcrumbList requires item on every ListItem except the last", () => {
    const valid = grErrors({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://example.com/" },
        { "@type": "ListItem", position: 2, name: "Blog" },
      ],
    });
    expect(valid).toEqual([]);

    const missingItem = grErrors({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home" },
        { "@type": "ListItem", position: 2, name: "Blog" },
      ],
    });
    expect(missingItem).toHaveLength(1);
  });

  it("Event missing location is an error", () => {
    const errors = grErrors({ "@type": "Event", name: "Conf", startDate: "2027-01-01" });
    expect(errors).toEqual(["Event 'Conf' missing required 'location' (Google rich results)."]);
  });

  it("JobPosting with TELECOMMUTE does not need jobLocation", () => {
    const errors = grErrors({
      "@type": "JobPosting",
      title: "Engineer",
      description: "Build things",
      datePosted: "2027-01-01",
      hiringOrganization: { "@type": "Organization", name: "Acme" },
      jobLocationType: "TELECOMMUTE",
    });
    expect(errors).toEqual([]);
  });

  it("Recipe missing image is an error", () => {
    expect(grErrors({ "@type": "Recipe", name: "Cake" })).toHaveLength(1);
  });

  it("LocalBusiness missing address is an error", () => {
    expect(grErrors({ "@type": "Restaurant", name: "Diner" })).toEqual([
      "Restaurant 'Diner' missing required 'address' (Google rich results).",
    ]);
  });
});
