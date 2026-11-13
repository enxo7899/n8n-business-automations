// Reproducible README screenshots of the demo page. Run `npm run dev` in another terminal, then `npm run screenshots`.
import { createRequire } from "node:module";
const { chromium, devices } = createRequire(import.meta.url)("playwright");
const base = process.env.BASE || "http://localhost:5176/";
const out = process.env.OUT || "docs";
const browser = await chromium.launch();
const errors = [];
async function shot(name, url, { device, viewport = { width: 1400, height: 1000 }, full = false, clip, before } = {}) {
  const ctx = await browser.newContext(device ? { ...devices[device] } : { viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(base + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if (before) await before(page);
  await (clip ? page.locator(clip) : page).screenshot({ path: `${out}/${name}.png`, fullPage: full && !clip });
  await ctx.close();
}
await shot("demo-overview", "?run=0,1,2", { viewport: { width: 1400, height: 1500 } });
await shot("demo-rule-override", "?run=2", { clip: "#enqExec" });
await shot("demo-invoice", "?tab=inv&invoice=1", { clip: "#tab-inv" });
await shot("demo-mobile", "?run=1", { device: "iPhone 13", full: true });
await browser.close();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("no console errors");
