import { describe, it, expect } from "vitest";
import fixture from "./fixtures/articuno.json";
import fingerprints from "../glyph-fingerprints.json";
import {
  mapOffers,
  filterResult,
} from "../src/services/marketplace.service.js";
import {
  decodeStock,
  decodePrice,
  type SpriteContext,
} from "../src/extractors/sprite.decoder.js";
import {
  mapQuality,
  mapFinish,
  mapLanguage,
} from "../src/mappers/attributes.js";
import { querySchema, resultSchema } from "../src/types/card.types.js";
import { QueryCache } from "../src/utils/cache.js";
const context = (): SpriteContext => ({
  ...fixture.ctx,
  diagnostics: [],
  fingerprints,
});
describe("marketplace e sprites", () => {
  it("preserva leilão sem inventar loja, estoque ou preço unitário", () => {
    const ctx = context();
    const result = mapOffers(
      [
        {
          id: 5639374,
          lj_id: undefined as unknown as number,
          sellType: 2,
          price: "300.00",
        },
      ],
      {},
      ctx,
    );
    expect(result[0]).toMatchObject({
      offerId: 5639374,
      storeId: null,
      price: null,
      stock: null,
      url: null,
    });
    expect(ctx.diagnostics[0]).toContain("leilão");
  });
  it("decodifica todas as 81 ofertas reais preservadas em fixture", () => {
    const offers = mapOffers(fixture.raw.offers, fixture.raw.stores, context());
    expect(offers).toHaveLength(81);
    expect(offers.every((o) => o.price !== null && o.stock !== null)).toBe(
      true,
    );
    expect(offers[0]).toMatchObject({
      price: 39.9,
      stock: 1,
      store: "Gladiators TCG",
      state: "PR",
    });
  });
  it("distingue preço original, desconto, zero e strings numéricas do portal", () => {
    const offers = mapOffers(
      [
        { id: 1, lj_id: 1, preco: 69.99, precoFinal: 45.49 },
        { id: 2, lj_id: 1, preco: 20 },
        { id: 3, lj_id: 1, preco: 20, precoFinal: 0 },
        { id: 4, lj_id: 1, preco: "45.00", precoFinal: "44.55" },
      ],
      {},
      context(),
    );
    expect(offers.map((o) => [o.price, o.originalPrice])).toEqual([
      [45.49, 69.99],
      [20, null],
      [0, 20],
      [44.55, 45],
    ]);
  });
  it.each([
    [0, "Não definida"],
    [1, "M"],
    [2, "NM"],
    [99, null],
  ])("qualidade %s", (c, label) => expect(mapQuality(c)).toBe(label));
  it.each([
    [0, "Normal"],
    [2, "Foil"],
    [34, "Foil Alterada"],
    [99, null],
  ])("acabamento %s", (c, label) => expect(mapFinish(c)).toBe(label));
  it("preserva idiomas desconhecidos e mapeia rótulos confirmados", () => {
    expect(mapLanguage(99)).toBeNull();
    expect(mapLanguage(8)).toBe("Português");
    expect(mapLanguage(2)).toBe("Inglês");
    expect(mapLanguage(11)).toBe("Português / Inglês");
    expect(mapLanguage(0)).toBe("Não definido");
  });
  it("não agrupa ofertas iguais da mesma loja e mantém ausências", () => {
    const raw = { id: 1, lj_id: 7, preco: 20, idioma: "99" };
    const offers = mapOffers([raw, { ...raw, id: 2 }], {}, context());
    expect(offers).toHaveLength(2);
    expect(offers[0]).toMatchObject({
      store: null,
      stock: null,
      language: null,
      languageCode: "99",
    });
  });
  it("recusa sprite alterado e classes desconhecidas", () => {
    const ctx = context();
    expect(decodeStock("desconhecida", ctx)).toBeNull();
    ctx.fingerprints = {};
    expect(decodePrice(fixture.raw.offers[0].precoCss!, ctx)).toBeNull();
    expect(ctx.diagnostics.length).toBeGreaterThan(0);
  });
  it.each([1, 2, 5, 10, 25, 100])(
    "decodifica estoque com múltiplos dígitos: %s",
    (n) => {
      const ctx = context();
      const byDigit = Object.entries(ctx.glyphs).reduce<Record<string, string>>(
        (acc, [key, g]) => {
          const digit = g.fingerprint
            ? fingerprints[g.fingerprint as keyof typeof fingerprints]
            : undefined;
          if (digit) acc[digit] = key;
          return acc;
        },
        {},
      );
      expect(
        decodeStock(
          String(n)
            .split("")
            .map((c) => byDigit[c].split(" ").reverse().join(" "))
            .join(";"),
          ctx,
        ),
      ).toBe(n);
    },
  );
  it("valida perfil por hash, posição e geometria", () => {
    const ctx: SpriteContext = {
      glyphs: {
        a: {
          imageHash: "hash",
          position: "-1px -2px",
          size: "auto",
          width: "7px",
          height: "15px",
        },
      },
      profiles: [
        {
          sha256: "hash",
          size: "auto",
          width: "7px",
          height: "15px",
          digits: { "-1px -2px": "2" },
        },
      ],
      diagnostics: [],
    };
    expect(decodePrice("a;V;a;a", ctx)).toBe(2.22);
    ctx.glyphs.a.imageHash = "mudou";
    expect(decodeStock("a", ctx)).toBeNull();
  });
  it("filtra e ordena sem alterar cache; desconhecidos ficam no fim", () => {
    const offers = mapOffers(
      [
        { id: 1, lj_id: 1, preco: 60, quant: 2, extras: 2 },
        { id: 2, lj_id: 1, preco: 20, quant: 3, extras: 2 },
        { id: 3, lj_id: 1 },
      ],
      {},
      context(),
    );
    const result = resultSchema.parse({
      card: { name: "teste", number: null, edition: null },
      source: "Liga Pokémon",
      totalOffers: 3,
      collectedAt: new Date().toISOString(),
      offers,
      diagnostics: {
        pricesDecoded: 2,
        pricesPending: 1,
        stocksDecoded: 2,
        stocksPending: 1,
        messages: [],
      },
    });
    expect(
      filterResult(result, querySchema.parse({ card: "teste" })).offers.map(
        (o) => o.offerId,
      ),
    ).toEqual([2, 1, 3]);
    expect(
      filterResult(
        result,
        querySchema.parse({
          card: "teste",
          minStock: 2,
          maxPrice: 30,
          finish: "Foil",
        }),
      ).totalOffers,
    ).toBe(1);
    expect(result.offers[0].offerId).toBe(1);
  });
  it("coalesce consultas concorrentes e isola alterações", async () => {
    const cache = new QueryCache<{ value: number }>();
    let calls = 0;
    const fetch = async () => {
      calls++;
      return { value: 1 };
    };
    const [a, b] = await Promise.all([
      cache.get("a", fetch),
      cache.get("a", fetch),
    ]);
    a.value = 4;
    expect(b.value).toBe(1);
    expect(calls).toBe(1);
  });
});
