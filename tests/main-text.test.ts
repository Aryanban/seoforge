import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { extractMainText, countWords } from "../src/crawl/link-extractor.js";
import { detectDuplicates } from "../src/analysis/duplicates.js";

const chrome = (body: string) =>
  `<body><header><a href="/">Logo</a> menu items here</header><nav>${"link ".repeat(200)}</nav>${body}<aside>related ${"post ".repeat(50)}</aside><footer>${"legal ".repeat(150)}</footer></body>`;

describe("extractMainText", () => {
  it("uses <main> and keeps its header", () => {
    const $ = cheerio.load(chrome(`<main><header><h1>Title</h1></header><p>Body words.</p><nav>crumb</nav></main>`));
    expect(extractMainText($)).toBe("Title Body words.");
  });

  it("drops landmarks from <body> when there is no <main>", () => {
    const $ = cheerio.load(chrome(`<div id="content"><h1>Hi</h1><p>Real text.</p></div><div role="navigation">x</div>`));
    expect(extractMainText($)).toBe("Hi Real text.");
  });

  it("falls back to all visible text when main is empty", () => {
    const $ = cheerio.load(`<body><nav>only nav</nav></body>`);
    expect(extractMainText($)).toBe("only nav");
  });

  it("does not let shared chrome make different pages near-duplicates", () => {
    const words = (seed: number) => Array.from({ length: 120 }, (_, i) => `w${seed}x${i}`).join(" ");
    const pages = [1, 2].map((n) => {
      const $ = cheerio.load(chrome(`<main><p>${words(n)}</p></main>`));
      return { url: `https://a.test/${n}`, bodyText: extractMainText($) };
    });
    expect(countWords(pages[0].bodyText)).toBe(120);
    expect(detectDuplicates(pages as any).nearDuplicates ?? []).toHaveLength(0);
  });
});
