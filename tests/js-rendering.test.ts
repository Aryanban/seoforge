import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { jsRenderingIssues } from "../src/checks/js-rendering.js";

const url = "https://example.com/";
const ids = (raw: string, rendered: string) => jsRenderingIssues(raw, cheerio.load(rendered), url).map((i) => i.id);

describe("jsRenderingIssues", () => {
  it("returns nothing when raw and rendered match", () => {
    const html = `<html><head><title>T</title></head><body><h1>H</h1><a href="/a">a</a></body></html>`;
    expect(ids(html, html)).toEqual([]);
  });

  it("flags noindex removed by JS as an error", () => {
    const issues = jsRenderingIssues(
      `<head><meta name="robots" content="noindex"></head>`,
      cheerio.load(`<head><meta name="robots" content="index,follow"></head>`),
      url
    );
    expect(issues[0]).toMatchObject({ id: "js_removes_noindex", severity: "Error", category: "JavaScript" });
  });

  it("flags JS-only title, h1, canonical change and links", () => {
    const links = Array.from({ length: 8 }, (_, i) => `<a href="/p${i}">p</a>`).join("");
    const got = ids(
      `<head><link rel="canonical" href="https://example.com/a"></head><body></body>`,
      `<head><title>T</title><link rel="canonical" href="https://example.com/b"></head><body><h1>H</h1>${links}</body>`
    );
    expect(got).toEqual(expect.arrayContaining(["js_only_title", "js_only_h1", "js_changes_canonical", "js_only_links"]));
  });

  it("flags content that needs JS", () => {
    const words = Array.from({ length: 300 }, () => "word").join(" ");
    expect(ids(`<body><div id="app"></div></body>`, `<body><p>${words}</p></body>`)).toContain("js_dependent_content");
  });
});
