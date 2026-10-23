import type { Page } from "playwright";
import { createHash } from "node:crypto";
import { fingerprint } from "./pixel.fingerprint.js";
import type { RawOffer } from "../types/card.types.js";
import type { Glyph, SpriteProfile, SpriteContext } from "./sprite.decoder.js";
declare global {
  interface Window {
    cards_stock?: RawOffer[];
    cards_stores?: Record<string, Record<string, unknown>>;
  }
}
export async function extractStructures(page: Page) {
  return page.evaluate(() => ({
    offers: window.cards_stock ?? [],
    stores: window.cards_stores ?? {},
  }));
}
export async function extractSprites(
  page: Page,
  offers: RawOffer[],
  profiles: SpriteProfile[],
): Promise<SpriteContext> {
  const sequences = [
    ...new Set(
      offers.flatMap((o) =>
        [o.precoCss, o.quantCss]
          .filter((v): v is string => !!v)
          .flatMap((s) => s.split(";"))
          .filter((s) => s !== "V"),
      ),
    ),
  ];
  const styles = await page.evaluate((sequences) => {
    const root = document.createElement("div");
    root.style.cssText = "position:absolute;left:-10000px;top:0";
    document.body.append(root);
    try {
      return sequences.map((classes) => {
        const element = document.createElement("div");
        element.className = classes;
        element.innerHTML = "&nbsp;";
        root.append(element);
        const s = getComputedStyle(element);
        return {
          classes,
          key: classes.trim().split(/\s+/).sort().join(" "),
          image: s.backgroundImage,
          position: s.backgroundPosition,
          size: s.backgroundSize,
          width: s.width,
          height: s.height,
        };
      });
    } finally {
      root.remove();
    }
  }, sequences);
  const hashes = new Map<string, string>();
  const buffers = new Map<string, Buffer>();
  const diagnostics: string[] = [];
  for (const s of styles) {
    const match = /^url\(["']?(.*?)["']?\)$/.exec(s.image);
    if (!match) continue;
    const url = new URL(match[1], page.url());
    if (
      url.protocol !== "https:" ||
      !["www.ligapokemon.com.br", "repositorio.sbrauble.com"].includes(
        url.hostname,
      )
    ) {
      diagnostics.push("Origem de sprite não permitida: " + url.origin);
      continue;
    }
    if (hashes.has(s.image)) continue;
    try {
      const response = await page.request.get(url.href, { timeout: 10000 });
      if (response.ok()) {
        const buffer = await response.body();
        buffers.set(s.image, buffer);
        hashes.set(s.image, createHash("sha256").update(buffer).digest("hex"));
      }
    } catch {
      diagnostics.push("Falha ao baixar sprite");
    }
  }
  const glyphs: Record<string, Glyph> = {};
  for (const s of styles) {
    const hash = hashes.get(s.image);
    if (hash)
      glyphs[s.key] = {
        imageHash: hash,
        position: s.position,
        size: s.size,
        width: s.width,
        height: s.height,
        fingerprint: fingerprint(
          buffers.get(s.image)!,
          s.position,
          s.width,
          s.height,
          s.size,
        ),
      };
  }
  return { glyphs, profiles, diagnostics };
}
