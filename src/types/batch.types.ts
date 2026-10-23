import { z } from "zod";
import { querySchema, resultSchema, qualityFilterSchema } from "./card.types.js";
export const cleanText = (s: string) => s.trim().replace(/\s+/g, " ");
const name = z.string().transform(cleanText).pipe(z.string().min(1).max(200));
export const batchFiltersSchema = z
  .object({
    quality: qualityFilterSchema.optional(),
    finish: name.optional(),
    language: name.optional(),
    state: name.optional(),
    minStock: z.number().int().nonnegative().optional(),
    minPrice: z.number().nonnegative().optional(),
    maxPrice: z.number().nonnegative().optional(),
    sort: z.enum(["price_asc", "price_desc", "stock_desc"]).optional(),
  })
  .strict();
const itemSchema = z.union([
  name,
  z
    .object({
      name,
      number: z
        .string()
        .trim()
        .regex(/^\d+(?:\/\d+)?$/)
        .optional(),
      edition: z.string().trim().min(1).max(40).optional(),
      filters: batchFiltersSchema.optional(),
    })
    .strict(),
]);
export function createBatchSchema(maxCards = 20) {
  return z
    .object({
      cards: z.array(itemSchema).min(1).max(maxCards),
      filters: batchFiltersSchema.optional(),
    })
    .strict()
    .transform((input, ctx) => {
      const cards = input.cards.map((item, index) => {
        const object = typeof item === "string" ? { name: item } : item;
        const card = object.name;
        const query = querySchema.safeParse({
          card,
          number: object.number ?? /\((\d+(?:\/\d+)?)\)$/.exec(card)?.[1],
          edition: "edition" in object ? object.edition : undefined,
          ...input.filters,
          ...("filters" in object ? object.filters : {}),
        });
        if (!query.success) {
          for (const issue of query.error.issues)
            ctx.addIssue({
              code: "custom",
              message: issue.message,
              path: ["cards", index, ...issue.path],
            });
          return null;
        }
        return { query: query.data.card, input: query.data };
      });
      if (cards.some((c) => c === null)) return z.NEVER;
      return { cards: cards as Array<NonNullable<(typeof cards)[number]>> };
    });
}
export type BatchInput = z.infer<ReturnType<typeof createBatchSchema>>;
export const statisticsSchema = z.object({
  minPrice: z.number().nullable(),
  maxPrice: z.number().nullable(),
  averagePrice: z.number().nullable(),
  medianPrice: z.number().nullable(),
  totalStock: z.number(),
  unknownStockOffers: z.number().int(),
  storesCount: z.number().int(),
});
export const batchResultSchema = z.object({
  summary: z.object({
    requestedCards: z.number().int(),
    successfulCards: z.number().int(),
    failedCards: z.number().int(),
    totalOffers: z.number().int(),
    totalAuctions: z.number().int().nonnegative().optional(),
    durationMs: z.number().nonnegative(),
  }),
  results: z.array(
    z.discriminatedUnion("status", [
      resultSchema.extend({
        query: z.string(),
        status: z.literal("success"),
        statistics: statisticsSchema,
      }),
      z.object({
        query: z.string(),
        status: z.literal("error"),
        error: z.object({
          code: z.string(),
          message: z.string(),
          details: z.unknown().optional(),
        }),
      }),
    ]),
  ),
});
export type BatchResult = z.infer<typeof batchResultSchema>;
