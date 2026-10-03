/**
 * Schema.org JSON-LD Generator for SEOForge.
 *
 * Generates Google Rich Results-compliant structured data for:
 * - Article / BlogPosting
 * - FAQPage (auto-extracted from page questions or customized)
 * - LocalBusiness
 * - Organization
 * - BreadcrumbList (derived from URL paths)
 * - Product
 */
import * as cheerio from "cheerio";

export interface ArticleSchemaOptions {
  headline: string;
  description?: string;
  url: string;
  authorName?: string;
  authorType?: "Person" | "Organization";
  publisherName?: string;
  publisherLogo?: string;
  datePublished?: string;
  dateModified?: string;
  imageUrl?: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface LocalBusinessSchemaOptions {
  name: string;
  url: string;
  telephone?: string;
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  priceRange?: string;
  latitude?: number;
  longitude?: number;
  openingHours?: string[]; // e.g. ["Mo-Fr 09:00-18:00", "Sa 10:00-15:00"]
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

/**
 * Builds Google-compliant Article JSON-LD markup.
 */
export function generateArticleSchema(opts: ArticleSchemaOptions): object {
  const now = new Date().toISOString();
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": opts.url,
    },
    "headline": opts.headline.slice(0, 110),
    ...(opts.description ? { "description": opts.description } : {}),
    ...(opts.imageUrl ? { "image": [opts.imageUrl] } : {}),
    "datePublished": opts.datePublished || now,
    "dateModified": opts.dateModified || now,
    "author": {
      "@type": opts.authorType || "Person",
      "name": opts.authorName || "Editorial Team",
    },
    "publisher": {
      "@type": "Organization",
      "name": opts.publisherName || "Publisher",
      ...(opts.publisherLogo ? { "logo": { "@type": "ImageObject", "url": opts.publisherLogo } } : {}),
    },
  };
}

/**
 * Builds Google-compliant FAQPage JSON-LD markup.
 */
export function generateFaqSchema(items: FaqItem[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": items.map((item) => ({
      "@type": "Question",
      "name": item.question.trim(),
      "acceptedAnswer": {
        "@type": "Answer",
        "text": item.answer.trim(),
      },
    })),
  };
}

/**
 * Extracts Q&A pairs from HTML headings and text.
 */
export function extractFaqFromHtml(html: string): FaqItem[] {
  const $ = cheerio.load(html || "");
  const faqs: FaqItem[] = [];

  // Check <details><summary>
  $("details").each((_, el) => {
    const question = $(el).find("summary").first().text().trim();
    const answer = $(el).clone().find("summary").remove().end().text().replace(/\s+/g, " ").trim();
    if (question && answer && question.length >= 8) {
      faqs.push({ question, answer });
    }
  });

  // Check <h2> and <h3> with question marks or interrogation words
  const questionPattern = /\?|^(how|what|why|when|where|who|is|are|can|do|does|will)\b/i;
  $(":header").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (questionPattern.test(text) && text.length >= 10 && text.length <= 150) {
      // Find following paragraph(s) until next heading
      let answer = "";
      let next = $(el).next();
      while (next.length > 0 && !next.is(":header") && answer.length < 500) {
        if (next.is("p") || next.is("div") || next.is("ul") || next.is("ol")) {
          const t = next.text().replace(/\s+/g, " ").trim();
          if (t) answer += (answer ? " " : "") + t;
        }
        next = next.next();
      }

      if (answer && answer.length >= 20) {
        faqs.push({ question: text, answer: answer.slice(0, 800) });
      }
    }
  });

  return faqs.slice(0, 10);
}

/**
 * Builds Google-compliant LocalBusiness JSON-LD markup.
 */
export function generateLocalBusinessSchema(opts: LocalBusinessSchemaOptions): object {
  const schema: any = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": opts.name,
    "url": opts.url,
  };

  if (opts.telephone) schema.telephone = opts.telephone;
  if (opts.priceRange) schema.priceRange = opts.priceRange;

  if (opts.streetAddress || opts.city || opts.region || opts.postalCode) {
    schema.address = {
      "@type": "PostalAddress",
      ...(opts.streetAddress ? { "streetAddress": opts.streetAddress } : {}),
      ...(opts.city ? { "addressLocality": opts.city } : {}),
      ...(opts.region ? { "addressRegion": opts.region } : {}),
      ...(opts.postalCode ? { "postalCode": opts.postalCode } : {}),
      ...(opts.country ? { "addressCountry": opts.country } : {}),
    };
  }

  if (opts.latitude != null && opts.longitude != null) {
    schema.geo = {
      "@type": "GeoCoordinates",
      "latitude": opts.latitude,
      "longitude": opts.longitude,
    };
  }

  if (opts.openingHours && opts.openingHours.length > 0) {
    schema.openingHours = opts.openingHours;
  }

  return schema;
}

/**
 * Generates BreadcrumbList schema from a URL path.
 */
export function generateBreadcrumbSchema(pageUrl: string, homeName: string = "Home"): object {
  try {
    const parsed = new URL(pageUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);

    const items = [
      {
        "@type": "ListItem",
        "position": 1,
        "name": homeName,
        "item": `${parsed.protocol}//${parsed.host}/`,
      },
    ];

    let currentPath = "";
    segments.forEach((seg, idx) => {
      currentPath += `/${seg}`;
      const name = seg
        .replace(/[-_]/g, " ")
        .replace(/\.[a-z0-9]+$/i, "")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      items.push({
        "@type": "ListItem",
        "position": idx + 2,
        "name": name,
        "item": `${parsed.protocol}//${parsed.host}${currentPath}`,
      });
    });

    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": items,
    };
  } catch {
    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      "itemListElement": [],
    };
  }
}

/**
 * Generates a collection of recommended Schema.org templates for a given page.
 */
export function generateRecommendedSchemas(url: string, html: string): Record<string, object> {
  const $ = cheerio.load(html || "");
  const title = $("title").first().text().trim() || "Web Page";
  const description = $('meta[name="description" i]').attr("content")?.trim() || "";
  const h1 = $("h1").first().text().trim() || title;
  const ogImage = $('meta[property="og:image" i]').attr("content")?.trim();

  const schemas: Record<string, object> = {};

  // 1. Breadcrumbs
  schemas["BreadcrumbList"] = generateBreadcrumbSchema(url);

  // 2. Article
  schemas["Article"] = generateArticleSchema({
    headline: h1 || title,
    description,
    url,
    imageUrl: ogImage,
  });

  // 3. FAQPage (if questions detected)
  const faqItems = extractFaqFromHtml(html);
  if (faqItems.length > 0) {
    schemas["FAQPage"] = generateFaqSchema(faqItems);
  } else {
    // Provide template FAQ
    schemas["FAQPage"] = generateFaqSchema([
      { question: `What services does ${h1 || "this business"} offer?`, answer: description || "Comprehensive professional solutions tailored to your requirements." },
      { question: "How do I get started?", answer: "Contact our team through the inquiry form or call our direct phone line." },
    ]);
  }

  // 4. LocalBusiness
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    schemas["LocalBusiness"] = generateLocalBusinessSchema({
      name: h1.length < 40 ? h1 : host,
      url,
      city: "Your City",
      priceRange: "$$",
    });
  } catch {}

  return schemas;
}

/**
 * Converts a schema object into an embeddable HTML script tag string.
 */
export function formatSchemaScript(schemaObj: object): string {
  return `<script type="application/ld+json">\n${JSON.stringify(schemaObj, null, 2)}\n</script>`;
}
