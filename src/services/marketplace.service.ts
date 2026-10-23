import type {
  CardQuery,
  Offer,
  RawOffer,
  Result,
} from "../types/card.types.js";
import {
  decodePrice,
  decodeStock,
  type SpriteContext,
} from "../extractors/sprite.decoder.js";
import { mapQuality, mapFinish, mapLanguage } from "../mappers/attributes.js";
const numeric = (v: unknown) => {
  const n = typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v) ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const code = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? v : null;
export function mapOffers(
  raw: RawOffer[],
  stores: Record<string, Record<string, unknown>>,
  ctx: SpriteContext,
): Offer[] {
  return raw.map((o) => {
    if (o.sellType === 2)
      ctx.diagnostics.push(
        "Registro de leilão preservado sem preço unitário/estoque de loja; campos de lance não são tratados como preço atual.",
      );
    const s = stores[String(o.lj_id)] ?? {};
    const url = new URL("https://www.ligapokemon.com.br/");
    url.search = new URLSearchParams({
      view: "mp/showcase/home",
      id: String(o.lj_id),
      tcg: String(o.id),
    }).toString();
    const original = numeric(o.preco);
    const final = numeric(o.precoFinal);
    return {
      offerId: o.id ?? null,
      storeId: o.lj_id ?? null,
      store: text(s.lj_name ?? s.nome ?? s.name ?? s.lj_nome),
      city: text(s.lj_cidade ?? s.cidade ?? s.city),
      state: text(s.lj_uf ?? s.estado ?? s.uf ?? s.state ?? o.lj_uf),
      price:
        final ?? original ?? (o.precoCss ? decodePrice(o.precoCss, ctx) : null),
      originalPrice: final !== null ? original : null,
      stock:
        numeric(o.quant) ?? (o.quantCss ? decodeStock(o.quantCss, ctx) : null),
      quality: mapQuality(o.qualid),
      qualityCode: code(o.qualid),
      finish: mapFinish(o.extras),
      finishCode: code(o.extras),
      language: mapLanguage(o.idioma),
      languageCode: code(o.idioma),
      url: o.id != null && o.lj_id != null ? url.href : null,
    };
  });
}
export function filterResult(result: Result, q: CardQuery): Result {
  const offers = result.offers.filter(
    (o) =>
      (!q.quality || o.quality?.toLowerCase() === q.quality.toLowerCase()) &&
      (!q.finish || o.finish?.toLowerCase() === q.finish.toLowerCase()) &&
      (!q.language || o.language?.toLowerCase() === q.language.toLowerCase()) &&
      (!q.state || o.state?.toLowerCase() === q.state.toLowerCase()) &&
      (q.minStock === undefined ||
        (o.stock !== null && o.stock >= q.minStock)) &&
      (q.minPrice === undefined ||
        (o.price !== null && o.price >= q.minPrice)) &&
      (q.maxPrice === undefined || (o.price !== null && o.price <= q.maxPrice)),
  );
  offers.sort((a, b) => {
    const x = q.sort === "stock_desc" ? a.stock : a.price,
      y = q.sort === "stock_desc" ? b.stock : b.price;
    return x === null
      ? y === null
        ? 0
        : 1
      : y === null
        ? -1
        : q.sort === "price_asc"
          ? x - y
          : y - x;
  });
  return { ...result, offers, totalOffers: offers.length };
}
