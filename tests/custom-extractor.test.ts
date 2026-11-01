import { describe, it, expect } from "vitest";
import { extractCustomFields, xpathToCss, CustomExtractorRule } from "../src/analysis/custom-extractor.js";

describe("Custom Extractor (Screaming Frog parity)", () => {
  const sampleHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Test Page</title>
        <meta name="author" content="Jane Doe" />
        <meta name="analytics-id" content="GTM-XYZ1234" />
      </head>
      <body>
        <div class="product" data-sku="SKU-9988">
          <h2 class="title">Super Widget 3000</h2>
          <span class="price" data-currency="USD">$49.99</span>
          <p class="description">Best widget on the market. Call 1-800-555-0199 for bulk sales.</p>
        </div>
        <div class="tags">
          <span class="tag">electronics</span>
          <span class="tag">gadgets</span>
          <span class="tag">trending</span>
        </div>
      </body>
    </html>
  `;

  it("extracts values using CSS text selector", () => {
    const rules: CustomExtractorRule[] = [
      { id: "product_title", name: "Product Title", type: "css", selector: "h2.title" },
      { id: "tags", name: "Tags", type: "css", selector: ".tags .tag" },
    ];
    const res = extractCustomFields(sampleHtml, rules);
    expect(res["product_title"]).toEqual(["Super Widget 3000"]);
    expect(res["tags"]).toEqual(["electronics", "gadgets", "trending"]);
  });

  it("extracts attribute values using CSS", () => {
    const rules: CustomExtractorRule[] = [
      { id: "sku", name: "SKU", type: "css", selector: ".product", attribute: "data-sku" },
      { id: "author", name: "Author", type: "css", selector: 'meta[name="author"]', attribute: "content" },
    ];
    const res = extractCustomFields(sampleHtml, rules);
    expect(res["sku"]).toEqual(["SKU-9988"]);
    expect(res["author"]).toEqual(["Jane Doe"]);
  });

  it("extracts values using Regex patterns with capture groups", () => {
    const rules: CustomExtractorRule[] = [
      { id: "gtm", name: "GTM ID", type: "regex", selector: "GTM-[A-Z0-9]+" },
      { id: "price", name: "Extracted Price", type: "regex", selector: "\\$([0-9]+\\.[0-9]{2})" },
    ];
    const res = extractCustomFields(sampleHtml, rules);
    expect(res["gtm"]).toEqual(["GTM-XYZ1234"]);
    expect(res["price"]).toEqual(["49.99"]);
  });

  it("extracts values using XPath selector conversion", () => {
    const rules: CustomExtractorRule[] = [
      { id: "xpath_price", name: "Price via XPath", type: "xpath", selector: "//span[@class='price']" },
      { id: "xpath_curr", name: "Currency via XPath", type: "xpath", selector: "//span[@class='price']", attribute: "data-currency" },
    ];
    const res = extractCustomFields(sampleHtml, rules);
    expect(res["xpath_price"]).toEqual(["$49.99"]);
    expect(res["xpath_curr"]).toEqual(["USD"]);
  });

  it("converts basic XPath to CSS selectors", () => {
    expect(xpathToCss("//div[@id='content']")).toBe("div#content");
    expect(xpathToCss("//span[@class='price']")).toBe("span.price");
    expect(xpathToCss("//meta[@name='author']")).toBe("meta[name='author']");
  });
});
