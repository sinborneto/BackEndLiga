import { z } from "zod";
import { normalizeCardNumber } from "../utils/card-number.js";
export const qualityFilterSchema = z.string().trim()
  .regex(/^(?:M|NM|SP|MP|HP|D)(?:\s*,\s*(?:M|NM|SP|MP|HP|D))*$/i, "Condições válidas: M, NM, SP, MP, HP e D, separadas por vírgula.")
  .transform(value => [...new Set(value.toUpperCase().split(",").map(item => item.trim()))].join(","));
export const querySchema = z
  .object({
    card: z.string().trim().min(1).max(200),
    edition: z.string().trim().min(1).max(40).optional(),
    number: z
      .string()
      .trim()
      .regex(/^\d+(?:\/\d+)?$/)
      .optional(),
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
    const embedded = /\((\d+(?:\/\d+)?)\)\s*$/.exec(query.card)?.[1];
    if (query.number && embedded && normalizeCardNumber(query.number) !== normalizeCardNumber(embedded)) {
      ctx.addIssue({ code: "custom", path: ["number"], message: "O número no nome da carta difere do campo number." });
    }
  })
  .transform(query => {
    const embedded = /\((\d+(?:\/\d+)?)\)\s*$/.exec(query.card)?.[1];
    const number = query.number ?? embedded;
    const name = query.card.replace(/\s*\(\d+(?:\/\d+)?\)\s*$/, "").trim();
    return { ...query, card: number ? `${name} (${number})` : query.card, ...(number ? { number } : {}) };
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
});
export type Offer = z.infer<typeof offerSchema>;
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
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: unknown = null,
  ) {
    super(message);
  }
}
