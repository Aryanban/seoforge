import { describe, it, expect } from "vitest";
import { extractLinks, extractImages } from "../src/crawl/link-extractor.js";
import { imageChecks } from "../src/checks/images.js";

describe("extractLinks", () => {
  it("uses aria-label and image alt as anchor text", () => {
    const { links } = extractLinks(
      '<a href="/a" aria-label="Home"><svg></svg></a><a href="/b"><img src="x.png" alt="Pricing"></a><a href="/c"><img src="y.png"></a>',
      "https://site.test/"
    );
    expect(links.map((l) => l.anchorText)).toEqual(["Home", "Pricing", ""]);
  });

  it("classifies internal links by the page origin, not <base href>", () => {
    const { links } = extractLinks(
      '<base href="https://cdn.other.test/"><a href="https://site.test/x">x</a><a href="img.png">y</a>',
      "https://site.test/page"
    );
    expect(links.map((l) => [l.target, l.isInternal])).toEqual([
      ["https://site.test/x", true],
      ["https://cdn.other.test/img.png", false],
    ]);
  });

  it("matches rel tokens exactly", () => {
    const { links } = extractLinks('<a href="/a" rel="noopener nofollow">a</a><a href="/b" rel="nofollowing">b</a>', "https://site.test/");
    expect(links.map((l) => l.nofollow)).toEqual([true, false]);
  });
});

describe("image link anchor check", () => {
  it("flags only image links without alt", () => {
    const images = extractImages('<a href="/a"><img src="a.png" alt="Map"></a><a href="/b"><img src="b.png"></a>', "https://site.test/");
    const issue = imageChecks({ images, pageUrl: "https://site.test/", html: "x" } as any).issues.find((i) => i.id === "image_link_no_anchor");
    expect(issue?.details).toEqual({ count: 1 });
  });
});
