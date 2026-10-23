import { readFile } from "node:fs/promises";
import { z } from "zod";
import { BrowserPool } from "../utils/browser.js";
import { QueryCache } from "../utils/cache.js";
import {
  ApiError,
  resultSchema,
  type CardQuery,
  type Result,
} from "../types/card.types.js";
import {
  extractStructures,
  extractSprites,
} from "../extractors/cards.extractor.js";
import { buildCardUrl, resolveCard, extractCardMedia } from "./card-search.service.js";
import { mapOffers } from "./marketplace.service.js";
import { cardKey } from "./batch-prices.service.js";
const profilesSchema = z.array(
  z.object({
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size: z.string(),
    width: z.string(),
    height: z.string(),
    digits: z.record(z.string(), z.string().regex(/^\d$/)),
  }),
);
export class LigaPokemonService {
  constructor(
    private pool = new BrowserPool(
      Number(process.env.MAX_PAGES ?? 3),
      Number(process.env.PAGE_TIMEOUT_MS ?? 45000),
    ),
    private cache = new QueryCache<Result>(
      Number(process.env.CACHE_TTL_MS ?? 600000),
    ),
  ) {}
  getPrices(q: CardQuery) {
    const key = cardKey(q);
    return this.cache.get(key, () => this.collect(q));
  }
  private async collect(q: CardQuery): Promise<Result> {
    return this.pool.run(async (page) => {
      try {
        const response = await page.goto(buildCardUrl(q.card), {
          waitUntil: "domcontentloaded",
        });
        if (response?.status() === 403) {
          await page
            .waitForFunction(
              () =>
                Array.isArray(window.cards_stock) &&
                window.cards_stores != null,
            )
            .catch(() => undefined);
        }
        if (
          !response?.ok() &&
          !(await page.evaluate(
            () =>
              Array.isArray(window.cards_stock) && window.cards_stores != null,
          ))
        )
          throw new ApiError(
            502,
            "PORTAL_HTTP_ERROR",
            "O portal retornou um erro HTTP.",
            { status: response?.status() },
          );
        const card = await resolveCard(page, q);
        await page.waitForFunction(
          () =>
            Array.isArray(window.cards_stock) && window.cards_stores != null,
        );
        const raw = await extractStructures(page);
        const media = await extractCardMedia(page);
        const editions = [
          ...new Set(raw.offers.map((o) => o.idEdicao).filter(Boolean)),
        ];
        const numbers = [
          ...new Set(raw.offers.map((o) => o.num).filter(Boolean)),
        ];
        if (editions.length > 1 || numbers.length > 1)
          throw new ApiError(
            409,
            "AMBIGUOUS_CARD",
            "O portal retornou múltiplas cartas; informe edição e número.",
            { editions, numbers },
          );
        if (
          q.number &&
          numbers.length &&
          String(numbers[0]) !== q.number.split("/")[0]
        )
          throw new ApiError(
            409,
            "NUMBER_MISMATCH",
            "O número das ofertas difere do solicitado.",
          );
        const profiles = profilesSchema.parse(
          JSON.parse(
            await readFile(
              process.env.SPRITE_PROFILES_PATH ?? "sprite-profiles.json",
              "utf8",
            ),
          ),
        );
        const ctx = await extractSprites(page, raw.offers, profiles);
        ctx.fingerprints = z
          .record(z.string().regex(/^[a-f0-9]{64}$/), z.string().regex(/^\d$/))
          .parse(JSON.parse(await readFile("glyph-fingerprints.json", "utf8")));
        const offers = mapOffers(raw.offers, raw.stores, ctx);
        return resultSchema.parse({
          card: { ...card, ...media },
          source: "Liga Pokémon",
          totalOffers: offers.length,
          collectedAt: new Date().toISOString(),
          offers,
          diagnostics: {
            pricesDecoded: offers.filter((o) => o.price !== null).length,
            pricesPending: offers.filter((o) => o.price === null).length,
            stocksDecoded: offers.filter((o) => o.stock !== null).length,
            stocksPending: offers.filter((o) => o.stock === null).length,
            messages: [...new Set(ctx.diagnostics)],
          },
        });
      } catch (e) {
        if (e instanceof ApiError) throw e;
        if (e instanceof Error && e.name === "TimeoutError")
          throw new ApiError(
            504,
            "PORTAL_TIMEOUT",
            "Tempo limite aguardando os dados do marketplace.",
          );
        throw e;
      }
    });
  }
  close() {
    return this.pool.close();
  }
}
