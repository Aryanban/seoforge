import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import { axeIssues, accessibilityChecks } from "../src/checks/accessibility.js";
import { renderUrl, isRenderAvailable, closeSharedBrowser } from "../src/crawl/renderer.js";

describe("axe-core issues", () => {
  const violation = { id: "image-alt", impact: "critical" as const, help: "Images must have alternative text", helpUrl: "https://dequeuniversity.com/rules/axe/4.11/image-alt", nodes: 2, targets: ["img"] };

  it("maps impact to severity and keeps the rule id", () => {
    const [i] = axeIssues([violation, { ...violation, id: "region", impact: "moderate" }], "https://a.test/");
    expect(i).toMatchObject({ id: "axe_image-alt", severity: "Error", category: "Accessibility", details: { count: 2 } });
    expect(axeIssues([{ ...violation, impact: "serious" }], "u")[0].severity).toBe("Warning");
  });

  it("replaces the static rules when axe results exist", () => {
    const ctx: any = { html: `<html><body><img src="a.png"></body></html>`, pageUrl: "u", status: 200 };
    expect(accessibilityChecks(ctx).issues.some((i) => !i.id.startsWith("axe_"))).toBe(true);
    expect(accessibilityChecks({ ...ctx, axe: [] }).issues).toEqual([]);
  });
});

describe("axe-core in render mode", async () => {
  const available = await isRenderAvailable().then(async (ok) => {
    if (!ok) return false;
    // Playwright installed but no browser binary: skip rather than fail.
    const r = await renderUrl("data:text/html,<p>x</p>", { timeoutMs: 5000 });
    return !r.errorMessage;
  });
  afterAll(() => closeSharedBrowser());

  it.skipIf(!available)("finds real violations in a rendered page", async () => {
    const server = http.createServer((_q, r) =>
      r.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><html><head><title>t</title></head><body><main><img src="x.png"><button></button></main></body></html>`)
    );
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const res = await renderUrl(`http://127.0.0.1:${(server.address() as any).port}/`, { axe: true });
    server.close();
    const ids = (res.axe ?? []).map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining(["image-alt", "button-name", "html-has-lang"]));
  }, 30000);
});
