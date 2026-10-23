import { chromium } from "playwright";
import {
  extractStructures,
  extractSprites,
} from "../src/extractors/cards.extractor.js";
import { mkdir, writeFile } from "node:fs/promises";
import { buildCardUrl } from "../src/services/card-search.service.js";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const url = buildCardUrl(process.argv[2] ?? "Articuno (132/128)");
  const response = await page.goto(url, {
    timeout: 45000,
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () => Array.isArray(window.cards_stock) && window.cards_stores != null,
    {},
    { timeout: 45000 },
  );
  const raw = await extractStructures(page);
  const ctx = await extractSprites(page, raw.offers, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/inspection.json",
    JSON.stringify({ status: response?.status(), raw, ctx }, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        status: response?.status(),
        count: raw.offers.length,
        first: raw.offers.slice(0, 2),
        store: Object.values(raw.stores)[0],
        glyphs: ctx.glyphs,
        diagnostics: ctx.diagnostics,
      },
      null,
      2,
    ),
  );
  const classes = Object.keys(ctx.glyphs);
  await page.evaluate((classes) => {
    for (const style of document.querySelectorAll("body style"))
      document.head.append(style);
    document.body.innerHTML = "";
    const root = document.createElement("div");
    root.style.cssText = "background:white;color:black;padding:20px";
    for (const cls of classes) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;gap:20px;height:35px;align-items:center";
      const label = document.createElement("span");
      label.textContent = cls;
      label.style.width = "300px";
      const glyph = document.createElement("div");
      glyph.className = cls;
      glyph.innerHTML = "&nbsp;";
      row.append(label, glyph);
      root.append(row);
    }
    document.body.append(root);
  }, classes);
  await page.evaluate(async () => {
    const images = [
      ...new Set(
        Array.from(document.querySelectorAll("div"))
          .map((e) => getComputedStyle(e).backgroundImage)
          .filter((s) => s.startsWith("url(")),
      ),
    ];
    await Promise.all(
      images.map(
        (s) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = s.slice(4, -1).replace(/^["']|["']$/g, "");
          }),
      ),
    );
  });
  await page.screenshot({ path: "artifacts/glyphs.png", fullPage: true });
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
}
