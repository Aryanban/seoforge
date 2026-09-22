import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync("src/publishing/posting-sites.json", "utf8"));
const header = `// AUTO-GENERATED from posting-sites.json (BeyondSEO catalog, MIT, Beyond Tahir).
// 206 publishing/backlink sources with DR provenance and guidance-review status.
// Do not edit by hand; regenerate via: node scripts/gen-posting-sites.mjs
import type { PostingSite } from "./types.js";

export const POSTING_SITES: readonly PostingSite[] = `;
writeFileSync("src/publishing/posting-sites.data.ts", header + JSON.stringify(data, null, 1) + ";\n");
console.log("wrote src/publishing/posting-sites.data.ts", data.length, "entries");
