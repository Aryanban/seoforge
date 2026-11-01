/**
 * Autonomous Codebase Patcher — Self-Healing SEO.
 * Automatically generates code modifications, unified diffs, or direct patches
 * for detected SEO issues across Next.js (App Router), Astro, and HTML files.
 */

export interface PatchRequest {
  framework?: "nextjs-app" | "astro" | "html";
  filePath?: string;
  sourceCode: string;
  issueId: string;
  fixData: {
    title?: string;
    description?: string;
    canonicalUrl?: string;
    schemaJson?: Record<string, any>;
    imgSrc?: string;
    imgAlt?: string;
  };
}

export interface PatchResult {
  applied: boolean;
  patchedCode: string;
  explanation: string;
  frameworkDetected: "nextjs-app" | "astro" | "html" | "unknown";
}

/**
 * Detect framework from file extension and code patterns.
 */
export function detectFramework(sourceCode: string, filePath?: string): "nextjs-app" | "astro" | "html" | "unknown" {
  if (filePath?.endsWith(".astro") || sourceCode.includes("---")) {
    return "astro";
  }
  if (
    filePath?.match(/\.(tsx|jsx|js|ts)$/) ||
    sourceCode.includes("export const metadata") ||
    sourceCode.includes("generateMetadata") ||
    sourceCode.includes("from 'next'") ||
    sourceCode.includes('from "next"')
  ) {
    return "nextjs-app";
  }
  if (filePath?.endsWith(".html") || sourceCode.includes("<!DOCTYPE html>") || sourceCode.includes("<head>")) {
    return "html";
  }
  return "unknown";
}

/**
 * Generate code patch for detected SEO issues.
 */
export function generateCodePatch(req: PatchRequest): PatchResult {
  const framework = req.framework || detectFramework(req.sourceCode, req.filePath);
  let code = req.sourceCode;
  let applied = false;
  let explanation = "";

  // 1. Next.js App Router Metadata Patching
  if (framework === "nextjs-app") {
    if (req.fixData.title || req.fixData.description || req.fixData.canonicalUrl) {
      // Check if `export const metadata` already exists
      const metadataRegex = /export\s+const\s+metadata(?::\s*Metadata)?\s*=\s*\{([\s\S]*?)\};/;
      const match = code.match(metadataRegex);

      if (match) {
        let inside = match[1];
        if (req.fixData.title && !inside.includes("title:")) {
          inside = `\n  title: "${req.fixData.title.replace(/"/g, '\\"')}",` + inside;
          applied = true;
          explanation += `Added title: "${req.fixData.title}" to export const metadata. `;
        }
        if (req.fixData.description && !inside.includes("description:")) {
          inside = `\n  description: "${req.fixData.description.replace(/"/g, '\\"')}",` + inside;
          applied = true;
          explanation += `Added description to export const metadata. `;
        }
        if (req.fixData.canonicalUrl && !inside.includes("alternates")) {
          inside = `\n  alternates: { canonical: "${req.fixData.canonicalUrl}" },` + inside;
          applied = true;
          explanation += `Added canonical URL to export const metadata. `;
        }
        code = code.replace(metadataRegex, `export const metadata = {${inside}};`);
      } else {
        // Prepend metadata export
        const newMetadataBlock = `import type { Metadata } from "next";\n\nexport const metadata: Metadata = {\n${
          req.fixData.title ? `  title: "${req.fixData.title.replace(/"/g, '\\"')}",\n` : ""
        }${
          req.fixData.description ? `  description: "${req.fixData.description.replace(/"/g, '\\"')}",\n` : ""
        }${
          req.fixData.canonicalUrl ? `  alternates: { canonical: "${req.fixData.canonicalUrl}" },\n` : ""
        }};\n\n`;
        code = newMetadataBlock + code;
        applied = true;
        explanation = "Created new `export const metadata: Metadata` export.";
      }
    }
  }

  // 2. HTML / Static Document Patching
  if (framework === "html" || (!applied && code.includes("<head>"))) {
    if (req.fixData.title) {
      if (code.includes("<title>")) {
        code = code.replace(/<title>.*?<\/title>/i, `<title>${req.fixData.title}</title>`);
      } else {
        code = code.replace(/<head>/i, `<head>\n  <title>${req.fixData.title}</title>`);
      }
      applied = true;
      explanation += `Updated <title> tag. `;
    }

    if (req.fixData.description) {
      if (/name=["']description["']/i.test(code)) {
        code = code.replace(/<meta\s+name=["']description["'][^>]*>/i, `<meta name="description" content="${req.fixData.description}">`);
      } else {
        code = code.replace(/<head>/i, `<head>\n  <meta name="description" content="${req.fixData.description}">`);
      }
      applied = true;
      explanation += `Added meta description tag. `;
    }

    if (req.fixData.canonicalUrl) {
      if (/rel=["']canonical["']/i.test(code)) {
        code = code.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${req.fixData.canonicalUrl}">`);
      } else {
        code = code.replace(/<head>/i, `<head>\n  <link rel="canonical" href="${req.fixData.canonicalUrl}">`);
      }
      applied = true;
      explanation += `Added canonical link tag. `;
    }

    if (req.fixData.schemaJson) {
      const scriptTag = `\n  <script type="application/ld+json">\n${JSON.stringify(req.fixData.schemaJson, null, 2)}\n  </script>`;
      code = code.replace(/<\/head>/i, `${scriptTag}\n</head>`);
      applied = true;
      explanation += `Injected JSON-LD Schema snippet into <head>. `;
    }
  }

  // 3. Image Alt Tag Patching across any framework
  if (req.fixData.imgSrc && req.fixData.imgAlt) {
    const escapedSrc = req.fixData.imgSrc.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    const imgRegex = new RegExp(`<img([^>]*src=["']${escapedSrc}["'][^>]*)>`, "i");
    const match = code.match(imgRegex);
    if (match && !/alt=["'][^'"]+["']/.test(match[0])) {
      if (/alt=["']["']/.test(match[0])) {
        code = code.replace(imgRegex, `<img$1>`.replace(/alt=["']["']/, `alt="${req.fixData.imgAlt}"`));
      } else {
        code = code.replace(imgRegex, `<img$1 alt="${req.fixData.imgAlt}">`);
      }
      applied = true;
      explanation += `Added descriptive alt="${req.fixData.imgAlt}" to image "${req.fixData.imgSrc}". `;
    }
  }

  return {
    applied,
    patchedCode: code,
    explanation: explanation.trim() || "No automated patch applied for this issue pattern.",
    frameworkDetected: framework,
  };
}
