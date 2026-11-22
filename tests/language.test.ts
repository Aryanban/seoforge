import { describe, it, expect } from "vitest";
import * as cheerio from "cheerio";
import { detectContentLanguage, languageChecks } from "../src/checks/language.js";

const EN_TEXT =
  "Our team has spent the last decade building tools that help small businesses understand how their " +
  "customers find them online. We believe every website deserves clear pages, fast load times, and content " +
  "that answers the questions people are actually asking. This guide walks through the basics of search " +
  "visibility, from writing descriptive titles to organizing internal links so that crawlers can reach " +
  "every important page on your site without getting lost.";

const FR_TEXT =
  "Notre équipe a passé la dernière décennie à construire des outils qui aident les petites entreprises à " +
  "comprendre comment leurs clients les trouvent en ligne. Nous pensons que chaque site mérite des pages " +
  "claires, des temps de chargement rapides et un contenu qui répond aux questions que les gens se posent " +
  "vraiment. Ce guide présente les bases de la visibilité dans les moteurs de recherche, depuis la rédaction " +
  "de titres descriptifs jusqu'à l'organisation des liens internes pour que les robots puissent atteindre " +
  "chaque page importante de votre site.";

function ctxFor(html: string, status = 200): any {
  return {
    html,
    status,
    pageUrl: "https://example.com/page",
    $: cheerio.load(html),
  };
}

describe("detectContentLanguage", () => {
  it("detects English paragraphs as en", () => {
    expect(detectContentLanguage(EN_TEXT)).toBe("en");
  });

  it("detects French paragraphs as fr", () => {
    expect(detectContentLanguage(FR_TEXT)).toBe("fr");
  });

  it("returns undefined for text shorter than 300 chars", () => {
    expect(detectContentLanguage("Bonjour tout le monde, ceci est un court texte.")).toBeUndefined();
  });
});

describe("languageChecks", () => {
  it("flags <html lang='en'> when body text is French", () => {
    const html = `<html lang="en"><head><title>x</title></head><body><p>${FR_TEXT}</p></body></html>`;
    const { issues } = languageChecks(ctxFor(html));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      id: "lang_content_mismatch",
      severity: "Warning",
      category: "International",
      url: "https://example.com/page",
      details: { declared: "en", detected: "fr" },
    });
  });

  it("does not flag <html lang='fr-FR'> when body text is French", () => {
    const html = `<html lang="fr-FR"><head><title>x</title></head><body><p>${FR_TEXT}</p></body></html>`;
    expect(languageChecks(ctxFor(html)).issues).toHaveLength(0);
  });

  it("skips non-200 responses", () => {
    const html = `<html lang="en"><body><p>${FR_TEXT}</p></body></html>`;
    expect(languageChecks(ctxFor(html, 404)).issues).toHaveLength(0);
  });
});
