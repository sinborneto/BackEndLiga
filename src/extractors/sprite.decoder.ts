export interface Glyph {
  imageHash: string;
  position: string;
  size: string;
  width: string;
  height: string;
  fingerprint?: string;
}
export interface SpriteProfile {
  sha256: string;
  size: string;
  width: string;
  height: string;
  digits: Record<string, string>;
}
export interface SpriteContext {
  glyphs: Record<string, Glyph>;
  profiles: SpriteProfile[];
  diagnostics: string[];
  fingerprints?: Record<string, string>;
}
export const classKey = (s: string) => s.trim().split(/\s+/).sort().join(" ");
function decode(
  css: string,
  ctx: SpriteContext,
  decimal: boolean,
): number | null {
  const parts = css.split(";");
  let text = "";
  for (const part of parts) {
    if (part === "V" && decimal) {
      text += ".";
      continue;
    }
    const glyph = ctx.glyphs[classKey(part)];
    const profile =
      glyph &&
      ctx.profiles.find(
        (p) =>
          p.sha256 === glyph.imageHash &&
          p.size === glyph.size &&
          p.width === glyph.width &&
          p.height === glyph.height,
      );
    const digit =
      profile?.digits[glyph?.position] ??
      (glyph?.fingerprint ? ctx.fingerprints?.[glyph.fingerprint] : undefined);
    if (!digit || !/^\d$/.test(digit)) {
      ctx.diagnostics.push(
        `Sprite não calibrado ou glifo desconhecido: ${part}`,
      );
      return null;
    }
    text += digit;
  }
  if (!(decimal ? /^\d+(?:\.\d{2})?$/ : /^\d+$/).test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(decimal ? Math.round(n * 100) : n) ? n : null;
}
export const decodePrice = (css: string, ctx: SpriteContext) =>
  decode(css, ctx, true);
export const decodeStock = (css: string, ctx: SpriteContext) =>
  decode(css, ctx, false);
