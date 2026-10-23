import type { Auction, RawOffer } from "../types/card.types.js";
import { mapFinish, mapLanguage, mapQuality } from "./attributes.js";
export const isAuction = (offer: RawOffer) => String(offer.sellType) === "2";
const number = (value: unknown): number | null => {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const positive = (value: unknown) => { const parsed = number(value); return parsed !== null && parsed > 0 ? parsed : null; };
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
function endsAt(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return null;
  // Portal countdown verified against Brasília time (UTC-03:00).
  const date = new Date(value.replace(" ", "T") + "-03:00");
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function mapAuctions(raw: RawOffer[], now = Date.now()): Auction[] {
  return raw.filter(isAuction).map(o => {
    const id = Number.isSafeInteger(o.id) && o.id > 0 ? o.id : null;
    const seller = text(o.owner);
    const references = [number(o.refP), number(o.refU), number(o.refN)];
    const referencesCount = references.every(value => value !== null) ? references.reduce<number>((sum,value)=>sum+(value ?? 0),0) : null;
    const bids = number(o.bids);
    const url = new URL("https://www.ligapokemon.com.br/");
    url.search = new URLSearchParams({view:"leilao/view",id:String(id)}).toString();
    const sellerUrl = new URL("https://www.ligapokemon.com.br/");
    sellerUrl.search = new URLSearchParams({view:"user",nick:seller ?? ""}).toString();
    return {
      auctionId:id,title:text(o.title),bidPrice:positive(o.price),fixedPrice:positive(o.priceFixed),bidIncrement:positive(o.priceInc),
      bids:bids !== null && Number.isInteger(bids) ? bids : null,
      endsAt:endsAt(o.dtEnd),seller,sellerUrl:seller ? sellerUrl.href : null,state:text(o.lj_uf),referencesCount,
      positivePercent:referencesCount ? Math.round(100 * references[0]! / referencesCount) : null,
      acceptsLigaSegura: [0,1,"0","1"].includes(o.acLS as number|string) ? String(o.acLS) === "1" : null,
      quality:mapQuality(o.qualid),finish:mapFinish(o.extras),language:mapLanguage(o.idioma),url:id !== null ? url.href : null,
    };
  }).filter(auction => auction.endsAt === null || Date.parse(auction.endsAt) > now);
}
