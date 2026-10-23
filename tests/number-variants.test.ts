import { expect, it, vi } from "vitest";
import {
  cardNumberVariants,
  normalizeCardNumber,
} from "../src/utils/card-number.js";
import { collectNumberVariants } from "../src/services/number-variants.service.js";
import {
  ApiError,
  querySchema,
  type Result,
  type CardQuery,
} from "../src/types/card.types.js";
import { cardKey } from "../src/services/batch-prices.service.js";
const result = (query: CardQuery, edition = "WC"): Result => ({
  card: { name: "Pikachu", number: query.number ?? null, edition },
  source: "Liga Pokémon",
  totalOffers: 0,
  offers: [],
  collectedAt: "2026-10-23T12:00:00.000Z",
  diagnostics: {
    pricesDecoded: 0,
    pricesPending: 0,
    stocksDecoded: 0,
    stocksPending: 0,
    messages: [],
  },
});
it.each(["1/9", "01/09", "001/009"])(
  "testa todas as formas a partir de %s mesmo após um sucesso",
  async (number) => {
    const collect = vi.fn(async (query: CardQuery) => result(query));
    await collectNumberVariants(
      querySchema.parse({ card: "Pikachu", number }),
      collect,
    );
    expect(collect.mock.calls.map(([query]) => query.card)).toEqual([
      "Pikachu (1/9)",
      "Pikachu (01/09)",
      "Pikachu (001/009)",
    ]);
  },
);
it("mantém dígitos significativos e não faz requisições idênticas", () => {
  expect(cardNumberVariants("25/165")).toEqual(["25/165", "025/165"]);
  expect(cardNumberVariants("132/128")).toEqual(["132/128"]);
  expect(cardNumberVariants("001")).toEqual(["1", "01", "001"]);
  expect(normalizeCardNumber("000/009")).toBe("0/9");
  expect(normalizeCardNumber("00012345678901234567890/09")).toBe(
    "12345678901234567890/9",
  );
});
it.each(["051m/222", "TG01/TG30", "097/∞", "SM120/250"])(
  "preserva o código de coleção %s sem inventar zeros",
  (number) => {
    const query = querySchema.parse({ card: "Articuno", number });
    expect(query.card).toBe(`Articuno (${number})`);
    expect(cardNumberVariants(number)).toEqual([number]);
    expect(querySchema.parse({ card: query.card }).number).toBe(number);
  },
);
it("compartilha cache e aceita zeros equivalentes nos dois campos", () => {
  const queries = ["1/9", "01/09", "001/009"].map((number) =>
    querySchema.parse({ card: "Pikachu", number }),
  );
  expect(new Set(queries.map(cardKey)).size).toBe(1);
  expect(
    querySchema.safeParse({ card: "Pikachu (01/09)", number: "001/009" })
      .success,
  ).toBe(true);
  expect(
    querySchema.safeParse({ card: "Pikachu (01/09)", number: "001/010" })
      .success,
  ).toBe(false);
});
it("encontra a forma com três dígitos quando as outras não existem", async () => {
  const collect = vi.fn(async (query: CardQuery) => {
    if (query.number !== "001/009")
      throw new ApiError(404, "CARD_NOT_FOUND", "Não encontrada");
    return result(query);
  });
  expect(
    (
      await collectNumberVariants(
        querySchema.parse({ card: "Pikachu", number: "1/9" }),
        collect,
      )
    ).card.number,
  ).toBe("001/009");
  expect(collect).toHaveBeenCalledTimes(3);
});

it("preserva as escolhas da variante correta quando a primeira não encontra a carta", async () => {
  const details = ["CLF", "CLK"].map((edition) => ({
    name: "VS Seeker",
    number: "021/032",
    edition,
    imageUrl: `https://repositorio.sbrauble.com/${edition}.jpg`,
  }));
  await expect(
    collectNumberVariants(
      querySchema.parse({ card: "VS Seeker", number: "021/032" }),
      async (q) => {
        if (q.number === "21/32")
          throw new ApiError(404, "CARD_NOT_FOUND", "Nenhuma carta");
        throw new ApiError(
          409,
          "AMBIGUOUS_CARD",
          "Escolha",
          details.concat(details),
        );
      },
    ),
  ).rejects.toMatchObject({ code: "AMBIGUOUS_CARD", details });
});
it("não mistura edições diferentes nem ignora bloqueios do portal", async () => {
  const query = querySchema.parse({ card: "Pikachu", number: "1/9" });
  await expect(
    collectNumberVariants(query, async (q) =>
      result(q, q.number === "1/9" ? "WC" : "OTHER"),
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    collectNumberVariants(query, async (q) => {
      if (q.number === "01/09")
        throw new ApiError(503, "PORTAL_BLOCKED", "Bloqueado");
      return result(q);
    }),
  ).rejects.toMatchObject({ status: 503 });
});
it("preserva falhas e não cria variações sem numeração", async () => {
  const collect = vi.fn(async () => {
    throw new ApiError(404, "CARD_NOT_FOUND", "Não encontrada");
  });
  await expect(
    collectNumberVariants(
      querySchema.parse({ card: "Pikachu", number: "1/9" }),
      collect,
    ),
  ).rejects.toMatchObject({ status: 404 });
  const withoutNumber = vi.fn(async (q: CardQuery) => result(q));
  await collectNumberVariants(
    querySchema.parse({ card: "Pikachu" }),
    withoutNumber,
  );
  expect(withoutNumber).toHaveBeenCalledTimes(1);
});
