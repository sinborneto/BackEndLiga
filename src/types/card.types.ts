import { z } from "zod";
import {
  normalizeCardNumber,
  cardNumberPattern,
  embeddedCardNumber,
} from "../utils/card-number.js";
export const qualityFilterSchema = z
  .string()
  .trim()
  .regex(
    /^(?:M|NM|SP|MP|HP|D)(?:\s*,\s*(?:M|NM|SP|MP|HP|D))*$/i,
    "Condições válidas: M, NM, SP, MP, HP e D, separadas por vírgula.",
  )
  .transform((value) =>
    [
      ...new Set(
        value
          .toUpperCase()
          .split(",")
          .map((item) => item.trim()),
      ),
    ].join(","),
  );
export const querySchema = z
  .object({
    card: z.string().trim().min(1).max(200),
    edition: z.string().trim().min(1).max(40).optional(),
    number: z.string().trim().max(40).regex(cardNumberPattern).optional(),
    quality: qualityFilterSchema.optional(),
    finish: z.string().optional(),
    language: z.string().optional(),
    state: z.string().optional(),
    minStock: z.coerce.number().int().nonnegative().optional(),
    minPrice: z.coerce.number().nonnegative().optional(),
    maxPrice: z.coerce.number().nonnegative().optional(),
    sort: z
      .enum(["price_asc", "price_desc", "stock_desc"])
      .default("price_asc"),
  })
  .refine(
    (q) =>
      q.minPrice === undefined ||
      q.maxPrice === undefined ||
      q.minPrice <= q.maxPrice,
    { message: "minPrice deve ser menor ou igual a maxPrice" },
  )
  .superRefine((query, ctx) => {
    const embedded = embeddedCardNumber(query.card);
    if (
      query.number &&
      embedded &&
      normalizeCardNumber(query.number) !== normalizeCardNumber(embedded)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["number"],
        message: "O número no nome da carta difere do campo number.",
      });
    }
  })
  .transform((query) => {
    const embedded = embeddedCardNumber(query.card);
    const number = query.number ?? embedded;
    const name = embedded
      ? query.card.replace(/\s*\([^)]*\)\s*$/, "").trim()
      : query.card;
    return {
      ...query,
      card: number ? `${name} (${number})` : query.card,
      ...(number ? { number } : {}),
    };
  });
export type CardQuery = z.infer<typeof querySchema>;
export type RawOffer = {
  id: number;
  lj_id: number;
  preco?: number | null;
  precoFinal?: number | null;
  precoCss?: string | null;
  quant?: number | null;
  quantCss?: string | null;
  qualid?: number | string;
  extras?: number | string;
  idioma?: number | string;
  [key: string]: unknown;
};
export const offerSchema = z.object({
  offerId: z.number().int().nullable(),
  storeId: z.number().int().nullable(),
  store: z.string().nullable(),
  storeLogoUrl: z.url().nullable().optional(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  price: z.number().nonnegative().nullable(),
  originalPrice: z.number().nonnegative().nullable(),
  stock: z.number().int().nonnegative().nullable(),
  quality: z.string().nullable(),
  qualityCode: z.union([z.number(), z.string()]).nullable(),
  finish: z.string().nullable(),
  finishCode: z.union([z.number(), z.string()]).nullable(),
  language: z.string().nullable(),
  languageCode: z.union([z.number(), z.string()]).nullable(),
  url: z.url().nullable(),
  storeUrl: z.url().nullable().optional(),
});
export type Offer = z.infer<typeof offerSchema>;
export const auctionSchema = z.object({
  auctionId: z.number().int().nullable(),
  title: z.string().nullable(),
  bidPrice: z.number().nonnegative().nullable(),
  fixedPrice: z.number().nonnegative().nullable(),
  bidIncrement: z.number().nonnegative().nullable(),
  bids: z.number().int().nonnegative().nullable(),
  endsAt: z.iso.datetime().nullable(),
  seller: z.string().nullable(),
  sellerUrl: z.url().nullable(),
  state: z.string().nullable(),
  referencesCount: z.number().int().nonnegative().nullable(),
  positivePercent: z.number().min(0).max(100).nullable(),
  acceptsLigaSegura: z.boolean().nullable(),
  quality: z.string().nullable(),
  finish: z.string().nullable(),
  language: z.string().nullable(),
  url: z.url().nullable(),
});
export type Auction = z.infer<typeof auctionSchema>;
export const resultSchema = z.object({
  card: z.object({
    name: z.string(),
    number: z.string().nullable(),
    edition: z.string().nullable(),
    imageUrl: z.url().nullable().optional(),
    url: z.url().nullable().optional(),
  }),
  source: z.literal("Liga Pokémon"),
  totalOffers: z.number().int(),
  collectedAt: z.iso.datetime(),
  offers: z.array(offerSchema),
  auctions: z.array(auctionSchema).optional(),
  totalAuctions: z.number().int().nonnegative().optional(),
  diagnostics: z.object({
    pricesDecoded: z.number(),
    pricesPending: z.number(),
    stocksDecoded: z.number(),
    stocksPending: z.number(),
    messages: z.array(z.string()),
  }),
});
export type Result = z.infer<typeof resultSchema>;
export class ApiError extends Error {
  pagination?: { nextCursor: string | null };
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}
