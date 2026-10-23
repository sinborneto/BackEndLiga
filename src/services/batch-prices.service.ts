import type { PriceService } from "../app.js";
import {
  ApiError,
  type CardQuery,
  type Offer,
  type Result,
} from "../types/card.types.js";
import {
  batchResultSchema,
  type BatchInput,
  type BatchResult,
} from "../types/batch.types.js";
import { ConcurrencyLimiter } from "../utils/concurrency.js";
import { filterResult } from "./marketplace.service.js";
import { normalizeCardNumber } from "../utils/card-number.js";
export function cardKey(q: CardQuery) {
  const number = q.number ?? /\((\d+(?:\/\d+)?)\)\s*$/.exec(q.card)?.[1];
  return JSON.stringify([
    (number ? q.card.replace(/\s*\(\d+(?:\/\d+)?\)\s*$/, "") : q.card).trim().replace(/\s+/g, " ").toLowerCase(),
    q.edition?.toLowerCase() ?? "",
    number ? normalizeCardNumber(number) : "",
  ]);
}
export function statistics(offers: Offer[]) {
  const prices = offers
    .flatMap((o) =>
      o.price !== null && Number.isFinite(o.price) && o.price >= 0
        ? [o.price]
        : [],
    )
    .sort((a, b) => a - b);
  const middle = Math.floor(prices.length / 2);
  return {
    minPrice: prices[0] ?? null,
    maxPrice: prices.at(-1) ?? null,
    averagePrice: prices.length
      ? Math.round((prices.reduce((a, b) => a + b, 0) / prices.length) * 100) /
        100
      : null,
    medianPrice: prices.length
      ? prices.length % 2
        ? prices[middle]
        : (prices[middle - 1] + prices[middle]) / 2
      : null,
    totalStock: offers.reduce(
      (sum, o) =>
        sum +
        (o.stock !== null && Number.isFinite(o.stock) && o.stock >= 0
          ? o.stock
          : 0),
      0,
    ),
    unknownStockOffers: offers.filter((o) => o.stock === null).length,
    storesCount: new Set(
      offers.flatMap((o) => (o.storeId === null ? [] : [o.storeId])),
    ).size,
  };
}
type Outcome =
  | { value: Result }
  | { error: { code: string; message: string; details?: unknown } };
export class BatchPricesService {
  private limiter: ConcurrencyLimiter;
  constructor(
    private service: PriceService,
    private concurrency = 3,
  ) {
    this.limiter = new ConcurrencyLimiter(concurrency);
  }
  async getPrices(batch: BatchInput): Promise<BatchResult> {
    const start = performance.now();
    const jobs = new Map<string, CardQuery>();
    for (const item of batch.cards) jobs.set(cardKey(item.input), item.input);
    const entries = [...jobs];
    const outcomes = new Map<string, Outcome>();
    let cursor = 0;
    const worker = async () => {
      while (cursor < entries.length) {
        const [key, input] = entries[cursor++];
        const outcome: Outcome = await this.limiter.run(async () => {
          try {
            return { value: await this.service.getPrices(input) };
          } catch (error) {
            return {
              error:
                error instanceof ApiError
                  ? {
                      code: error.code,
                      message: error.message,
                      details: error.details,
                    }
                  : {
                      code: "UPSTREAM_FAILURE",
                      message: "Não foi possível consultar o portal.",
                    },
            };
          }
        });
        outcomes.set(key, outcome);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.concurrency, entries.length) },
        worker,
      ),
    );
    const results: BatchResult["results"] = batch.cards.map((item) => {
      const outcome = outcomes.get(cardKey(item.input))!;
      if ("error" in outcome)
        return { query: item.query, status: "error", error: outcome.error };
      const filtered = filterResult(outcome.value, item.input);
      return {
        ...filtered,
        query: item.query,
        status: "success",
        statistics: statistics(filtered.offers),
      };
    });
    const successful = results.filter((r) => r.status === "success");
    return batchResultSchema.parse({
      summary: {
        requestedCards: results.length,
        successfulCards: successful.length,
        failedCards: results.length - successful.length,
        totalOffers: successful.reduce((sum, r) => sum + r.totalOffers, 0),
        durationMs: Math.round(performance.now() - start),
      },
      results,
    });
  }
}
