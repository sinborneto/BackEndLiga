import { it, expect, vi, afterEach } from "vitest";
import type { Server } from "node:http";
import fixture from "./fixtures/articuno.json";
import fingerprints from "../glyph-fingerprints.json";
import { mapOffers } from "../src/services/marketplace.service.js";
import {
  BatchPricesService,
  cardKey,
  statistics,
} from "../src/services/batch-prices.service.js";
import { createBatchSchema } from "../src/types/batch.types.js";
import {
  ApiError,
  querySchema,
  type Result,
  type CardQuery,
} from "../src/types/card.types.js";
import { QueryCache } from "../src/utils/cache.js";
import { createApp } from "../src/app.js";
import type { PriceService } from "../src/app.js";
const batchSchema = createBatchSchema();
const result = (): Result => ({
  card: { name: "Articuno", number: "132/128", edition: "30C" },
  source: "Liga Pokémon",
  collectedAt: new Date().toISOString(),
  totalOffers: 81,
  offers: mapOffers(fixture.raw.offers, fixture.raw.stores, {
    ...fixture.ctx,
    fingerprints,
    diagnostics: [],
  }),
  diagnostics: {
    pricesDecoded: 81,
    pricesPending: 0,
    stocksDecoded: 81,
    stocksPending: 0,
    messages: [],
  },
});
const success = () => ({ getPrices: vi.fn(async () => result()) });
it("consulta duas cartas válidas preservando todas as ofertas e ordem", async () => {
  const service = success();
  const response = await new BatchPricesService(service).getPrices(
    batchSchema.parse({
      cards: ["Articuno (132/128)", "Chandelure (137/128)"],
    }),
  );
  expect(response.summary).toMatchObject({
    requestedCards: 2,
    successfulCards: 2,
    failedCards: 0,
    totalOffers: 162,
  });
  expect(response.results.map((r) => r.query)).toEqual([
    "Articuno (132/128)",
    "Chandelure (137/128)",
  ]);
  expect(response.results[0]).toMatchObject({
    status: "success",
    totalOffers: 81,
    diagnostics: { pricesDecoded: 81 },
  });
});
it("normaliza três cartas em formatos mistos e espaços extras", async () => {
  const input = batchSchema.parse({
    cards: [
      "  Articuno   (132/128)  ",
      { name: " Chandelure ", number: "137/128", edition: "30C" },
      "Pikachu (025/198)",
    ],
  });
  expect(input.cards.map((c) => c.query)).toEqual([
    "Articuno (132/128)",
    "Chandelure (137/128)",
    "Pikachu (025/198)",
  ]);
  expect(
    (await new BatchPricesService(success()).getPrices(input)).summary
      .successfulCards,
  ).toBe(3);
});
it.each([false, true])(
  "continua com uma ou todas as cartas inexistentes: %s",
  async (all) => {
    const service = {
      getPrices: vi.fn(async (q: CardQuery) => {
        if (all || q.card === "Inexistente")
          throw new ApiError(404, "CARD_NOT_FOUND", "Carta não encontrada.");
        return result();
      }),
    };
    const response = await new BatchPricesService(service).getPrices(
      batchSchema.parse({ cards: ["Articuno", "Inexistente", "Chandelure"] }),
    );
    expect(response.summary.failedCards).toBe(all ? 3 : 1);
    expect(response.results[1]).toMatchObject({
      status: "error",
      error: { code: "CARD_NOT_FOUND" },
    });
  },
);
it("aplica filtros globais, sobrescrevendo somente propriedades individuais explícitas", async () => {
  const service = success();
  const response = await new BatchPricesService(service).getPrices(
    batchSchema.parse({
      cards: [
        { name: "Articuno", number: "132/128", filters: { maxPrice: 45 } },
        { name: "Chandelure", number: "137/128", filters: { minStock: 2 } },
      ],
      filters: {
        quality: "NM",
        finish: "Foil",
        maxPrice: 60,
        sort: "price_desc",
      },
    }),
  );
  for (const r of response.results) {
    expect(r.status).toBe("success");
    if (r.status !== "success") continue;
    expect(
      r.offers.every(
        (o) => o.quality === "NM" && o.finish === "Foil" && o.price! <= 60,
      ),
    ).toBe(true);
    expect(r.offers.map((o) => o.price)).toEqual(
      r.offers.map((o) => o.price).sort((a, b) => b! - a!),
    );
  }
  const first = response.results[0],
    second = response.results[1];
  if (first.status === "success")
    expect(first.offers.every((o) => o.price! <= 45)).toBe(true);
  if (second.status === "success")
    expect(second.offers.every((o) => o.stock! >= 2)).toBe(true);
});
it("deduplica formatos equivalentes, mas mantém resultados e filtros separados", async () => {
  const service = success();
  const response = await new BatchPricesService(service).getPrices(
    batchSchema.parse({
      cards: [
        "Articuno (132/128)",
        { name: "Articuno", number: "132/128", filters: { maxPrice: 45 } },
        "articuno (132/128)",
      ],
    }),
  );
  expect(service.getPrices).toHaveBeenCalledTimes(1);
  expect(response.results).toHaveLength(3);
  const a = response.results[0],
    b = response.results[1];
  if (a.status === "success" && b.status === "success")
    expect(a.totalOffers).toBeGreaterThan(b.totalOffers);
});
it("limita concorrência inclusive entre dois lotes simultâneos", async () => {
  let active = 0,
    max = 0;
  const service = {
    getPrices: vi.fn(async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return result();
    }),
  };
  const batch = new BatchPricesService(service, 3);
  await Promise.all([
    batch.getPrices(batchSchema.parse({ cards: ["a", "b", "c", "d"] })),
    batch.getPrices(batchSchema.parse({ cards: ["e", "f", "g", "h"] })),
  ]);
  expect(max).toBe(3);
  expect(active).toBe(0);
});
it("calcula estatísticas apenas com valores conhecidos e mantém leilões", () => {
  const offers = result()
    .offers.slice(0, 4)
    .map((o, i) => ({
      ...o,
      price: [10, 20, 40, null][i],
      stock: [1, null, 3, null][i],
      storeId: [1, 1, 2, null][i],
    }));
  expect(statistics(offers)).toEqual({
    minPrice: 10,
    maxPrice: 40,
    averagePrice: 23.33,
    medianPrice: 20,
    totalStock: 4,
    unknownStockOffers: 2,
    storesCount: 2,
  });
  expect(statistics(offers.slice(0, 2)).medianPrice).toBe(15);
  expect(statistics([])).toEqual({
    minPrice: null,
    maxPrice: null,
    averagePrice: null,
    medianPrice: null,
    totalStock: 0,
    unknownStockOffers: 0,
    storesCount: 0,
  });
  expect(offers[3]).toMatchObject({ price: null, stock: null, storeId: null });
});
it("uma falha de timeout não interrompe o lote nem bloqueia a fila", async () => {
  const service = {
    getPrices: async (q: CardQuery) => {
      if (q.card === "lenta")
        throw new ApiError(504, "PORTAL_TIMEOUT", "Tempo limite");
      return result();
    },
  };
  const batch = new BatchPricesService(service, 1);
  const response = await batch.getPrices(
    batchSchema.parse({ cards: ["lenta", "ok"] }),
  );
  expect(response.summary).toMatchObject({
    successfulCards: 1,
    failedCards: 1,
  });
  expect(response.results[0]).toMatchObject({
    status: "error",
    error: { code: "PORTAL_TIMEOUT" },
  });
});
it.each([
  {},
  { cards: [] },
  { cards: [""] },
  { cards: [{ name: " " }] },
  { cards: ["ok"], filters: { minStock: -1 } },
  { cards: ["ok"], filters: { maxPrice: "40" } },
  { cards: ["ok"], filters: { minPrice: 60, maxPrice: 50 } },
  { cards: Array.from({ length: 21 }, () => "ok") },
])("rejeita lote inválido: %j", (input) =>
  expect(batchSchema.safeParse(input).success).toBe(false),
);
it("limite de cartas é configurável e valida intervalo após sobrescrita", () => {
  expect(createBatchSchema(1).safeParse({ cards: ["a", "b"] }).success).toBe(
    false,
  );
  expect(
    batchSchema.safeParse({
      cards: [{ name: "ok", filters: { minPrice: 10 } }],
      filters: { minPrice: 60, maxPrice: 50 },
    }).success,
  ).toBe(true);
});
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
});
async function start(service: PriceService) {
  const server = createApp(service).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error();
  return `http://127.0.0.1:${address.port}`;
}
it("endpoint individual e lote compartilham cache sem alterar contrato individual", async () => {
  const cache = new QueryCache<Result>();
  const load = vi.fn(async () => result());
  const service = { getPrices: (q: CardQuery) => cache.get(cardKey(q), load) };
  const url = await start(service);
  const first = await fetch(
    url + "/api/cards/prices?card=Articuno%20(132%2F128)",
  );
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({
    source: "Liga Pokémon",
    totalOffers: 81,
  });
  const response = await fetch(url + "/api/cards/prices/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cards: [{ name: "Articuno", number: "132/128" }, "Chandelure (137/128)"],
    }),
  });
  expect(response.status).toBe(200);
  expect((await response.json()).summary).toMatchObject({
    successfulCards: 2,
    totalOffers: 162,
  });
  expect(load).toHaveBeenCalledTimes(2);
});
it("retorna 400 para JSON inválido e lote inválido", async () => {
  const service = success(),
    url = await start(service);
  for (const body of ["{", '{"cards":[]}']) {
    const response = await fetch(url + "/api/cards/prices/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(response.status).toBe(400);
  }
  expect(service.getPrices).not.toHaveBeenCalled();
});
it("chaves de cache ignoram filtros e normalizam número inferido", () =>
  expect(cardKey(querySchema.parse({ card: "Articuno (132/128)" }))).toBe(
    cardKey(
      querySchema.parse({
        card: "Articuno (132/128)",
        number: "132/128",
        maxPrice: 10,
      }),
    ),
  ));
