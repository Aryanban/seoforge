import { describe, it, expect } from "vitest";
import { generateCodePatch, detectFramework } from "../src/analysis/code-patcher.js";

describe("Autonomous Codebase Patcher (Self-Healing SEO)", () => {
  it("detects frameworks accurately", () => {
    expect(detectFramework("export default function Page() {}", "app/page.tsx")).toBe("nextjs-app");
    expect(detectFramework("---\nconst x = 1;\n---", "src/pages/index.astro")).toBe("astro");
    expect(detectFramework("<!DOCTYPE html><html><head></head><body></body></html>", "index.html")).toBe("html");
  });

  it("patches Next.js App Router metadata", () => {
    const source = `
import Link from "next/link";

export const metadata = {
  description: "Old description",
};

export default function Home() {
  return <div>Welcome</div>;
}
    `.trim();

    const patch = generateCodePatch({
      sourceCode: source,
      filePath: "app/page.tsx",
      issueId: "title_missing",
      fixData: {
        title: "Optimized Next.js SEO Platform",
        canonicalUrl: "https://seoforge.dev",
      },
    });

    expect(patch.applied).toBe(true);
    expect(patch.patchedCode).toContain('title: "Optimized Next.js SEO Platform"');
    expect(patch.patchedCode).toContain('canonical: "https://seoforge.dev"');
    expect(patch.frameworkDetected).toBe("nextjs-app");
  });

  it("patches HTML head tags (title, canonical, JSON-LD schema)", () => {
    const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>Old</title>
  </head>
  <body>
    <h1>Hi</h1>
  </body>
</html>
    `.trim();

    const patch = generateCodePatch({
      sourceCode: html,
      filePath: "public/index.html",
      issueId: "title_too_short",
      fixData: {
        title: "Brand New Comprehensive Page Title",
        canonicalUrl: "https://example.com/canonical-url",
        schemaJson: { "@context": "https://schema.org", "@type": "WebSite", name: "Example" },
      },
    });

    expect(patch.applied).toBe(true);
    expect(patch.patchedCode).toContain("<title>Brand New Comprehensive Page Title</title>");
    expect(patch.patchedCode).toContain('<link rel="canonical" href="https://example.com/canonical-url">');
    expect(patch.patchedCode).toContain('"@type": "WebSite"');
  });

  it("patches missing alt tag on image", () => {
    const html = `<div><img src="/hero.png" class="w-full"></div>`;
    const patch = generateCodePatch({
      sourceCode: html,
      filePath: "components/Hero.tsx",
      issueId: "img_missing_alt",
      fixData: {
        imgSrc: "/hero.png",
        imgAlt: "SEOForge real-time dashboard analytics screenshot",
      },
    });

    expect(patch.applied).toBe(true);
    expect(patch.patchedCode).toContain('alt="SEOForge real-time dashboard analytics screenshot"');
  });
});
