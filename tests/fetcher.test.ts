import { describe, it, expect, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { decodeBody, fetchPage } from "../src/crawl/fetcher.js";

describe("decodeBody", () => {
  it("uses the Content-Type charset", () => {
    const bytes = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café" in windows-1252
    expect(decodeBody(bytes, "text/html; charset=windows-1252")).toBe("café");
  });

  it("falls back to <meta charset> when the header has none", () => {
    const html = Buffer.concat([Buffer.from('<meta charset="iso-8859-1"><p>'), Buffer.from([0xe9]), Buffer.from("</p>")]);
    expect(decodeBody(html, "text/html")).toContain("<p>é</p>");
  });

  it("defaults to UTF-8 and survives unknown labels", () => {
    expect(decodeBody(Buffer.from("naïve"), "text/html")).toBe("naïve");
    expect(decodeBody(Buffer.from("naïve"), "text/html; charset=bogus-xyz")).toBe("naïve");
  });
});

describe("fetchPage body handling", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/loop-a" || req.url === "/loop-b") {
        res.writeHead(302, { Location: req.url === "/loop-a" ? "/loop-b" : "/loop-a" });
        res.end();
        return;
      }
      if (req.url === "/hop") {
        res.writeHead(301, { Location: "/utf8" });
        res.end("moved permanently body");
        return;
      }
      // Chunked (no Content-Length): size must be counted in bytes, not UTF-16 units.
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.write("<p>");
      res.end("日本語</p>");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("counts bytes, not characters, when Content-Length is absent", async () => {
    const res = await fetchPage(`${base}/utf8`);
    expect(res.html).toBe("<p>日本語</p>");
    expect(res.contentLengthBytes).toBe(Buffer.byteLength("<p>日本語</p>"));
  });

  it("follows redirects and records the first hop code", async () => {
    const res = await fetchPage(`${base}/hop`);
    expect(res.status).toBe(200);
    expect(res.redirectStatusCode).toBe(301);
    expect(res.redirectChain).toEqual([`${base}/hop`, `${base}/utf8`]);
  });

  it("keeps the repeated hop in a loop's chain so the loop check can see it", async () => {
    const res = await fetchPage(`${base}/loop-a`);
    expect(res.status).toBe(311);
    expect(res.redirectChain).toEqual([`${base}/loop-a`, `${base}/loop-b`, `${base}/loop-a`]);
  });
});
