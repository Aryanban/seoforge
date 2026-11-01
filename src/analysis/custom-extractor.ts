/**
 * Custom Extraction Engine — Screaming Frog "Custom Extraction" parity.
 * Supports CSS selectors, XPath expressions, and Regular Expressions
 * to scrape arbitrary data (e-commerce prices, SKUs, authors, tracking IDs,
 * schema properties, custom data attributes) during a crawl.
 */
import * as cheerio from "cheerio";

export type ExtractorType = "css" | "xpath" | "regex";

export interface CustomExtractorRule {
  id: string;
  name: string;
  type: ExtractorType;
  /**
   * For 'css': CSS selector (e.g. '.author-name', 'span.price', 'meta[name="revised"]')
   * For 'xpath': Simplified XPath or tag path (e.g. '//div[@class="product"]//h2')
   * For 'regex': Regular expression string (e.g. 'GTM-[A-Z0-9]+', 'price:\s*\$([0-9.]+)')
   */
  selector: string;
  /** Attribute to extract (e.g. 'content', 'href', 'data-sku'). If omitted, extracts inner text. */
  attribute?: string;
  /** If true, returns all matches; if false, returns only the first match. Default: true. */
  extractAll?: boolean;
}

export interface ExtractedField {
  ruleId: string;
  ruleName: string;
  values: string[];
}

/**
 * Execute custom extraction rules against raw HTML content.
 */
export function extractCustomFields(
  html: string,
  rules: CustomExtractorRule[]
): Record<string, string[]> {
  const results: Record<string, string[]> = {};
  if (!html || rules.length === 0) return results;

  let $: cheerio.CheerioAPI | null = null;

  for (const rule of rules) {
    const values: string[] = [];

    try {
      if (rule.type === "regex") {
        const flags = rule.extractAll !== false ? "gi" : "i";
        const re = new RegExp(rule.selector, flags);
        if (rule.extractAll !== false) {
          let match: RegExpExecArray | null;
          while ((match = re.exec(html)) !== null) {
            // Prefer capture group 1 if present, else full match
            const val = match[1] !== undefined ? match[1] : match[0];
            if (val) values.push(val.trim());
          }
        } else {
          const match = re.exec(html);
          if (match) {
            const val = match[1] !== undefined ? match[1] : match[0];
            if (val) values.push(val.trim());
          }
        }
      } else {
        // CSS or XPath-like selector
        const instance = $ || ($ = cheerio.load(html));

        // Convert basic xpath (//tag[@attr='val']) to css equivalent if needed
        let selector = rule.selector;
        if (rule.type === "xpath") {
          selector = xpathToCss(rule.selector);
        }

        const elements = instance(selector);
        elements.each((_, el) => {
          if (rule.extractAll === false && values.length > 0) return false;
          let val = "";
          if (rule.attribute) {
            val = instance(el).attr(rule.attribute) || "";
          } else {
            val = instance(el).text();
          }
          val = val.trim();
          if (val) values.push(val);
        });
      }
    } catch {
      /* extraction error on invalid pattern */
    }

    results[rule.id] = values;
  }

  return results;
}

/**
 * Basic XPath to CSS selector converter for common XPath patterns.
 * Handles //tag, //*[@id='...'], //tag[@class='...'], //tag[@attr='...'].
 */
export function xpathToCss(xpath: string): string {
  let css = xpath.trim();
  // Replace leading // or /
  css = css.replace(/^\/\//, "").replace(/^\//, "");
  // Replace // inside with space
  css = css.replace(/\/\//g, " ").replace(/\//g, " > ");
  // Replace [@id="val"] with #val
  css = css.replace(/\[@id=['"]([^'"]+)['"]\]/g, "#$1");
  // Replace [@class="val"] with .val (if single class) or [class="val"]
  css = css.replace(/\[@class=['"]([^'" ]+)['"]\]/g, ".$1");
  // Replace [@attr="val"] with [attr="val"]
  css = css.replace(/\[@([a-zA-Z0-9_-]+)(=['"][^'"]*['"])?\]/g, "[$1$2]");
  // Replace contains(@class, 'val') with [class*='val']
  css = css.replace(/\[contains\(@([a-zA-Z0-9_-]+),\s*['"]([^'"]+)['"]\)\]/g, "[$1*='$2']");
  return css;
}
