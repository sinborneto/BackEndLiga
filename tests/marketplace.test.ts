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
  it("aceita várias opções por atributo e combina os quatro filtros", () => {
    const offers = mapOffers([
      {id:1,lj_id:1,qualid:2,extras:2,idioma:8,preco:10},
      {id:2,lj_id:2,qualid:5,extras:0,idioma:2,preco:20},
      {id:3,lj_id:3,qualid:2,extras:2,idioma:8,preco:30},
      {id:4,lj_id:4,preco:40},
    ], {"1":{lj_uf:"PR"},"2":{lj_uf:"SP"},"3":{lj_uf:"RJ"}}, context());
    const result = resultSchema.parse({card:{name:"teste",number:null,edition:null},source:"Liga Pokémon",collectedAt:"2026-10-23T12:00:00.000Z",totalOffers:4,offers,diagnostics:{pricesDecoded:4,pricesPending:0,stocksDecoded:0,stocksPending:4,messages:[]}});
    const query = querySchema.parse({card:"teste",quality:"NM,HP",finish:"foil, normal",language:"português, INGLÊS",state:"pr, SP"});
    expect(filterResult(result,query).offers.map(offer=>offer.offerId)).toEqual([1,2]);
    expect(filterResult(result,{...query,quality:"NM",state:"SP"}).offers).toEqual([]);
    expect(filterResult(result,querySchema.parse({card:"teste"})).totalOffers).toBe(4);
  });
  it("mantém vitrine da Liga e redirecionamento oficial para o produto na loja separados", () => {
    const offers = mapOffers([
      {id:33426078,lj_id:242400}, {id:2,lj_id:3,sellType:2}, {id:-1,lj_id:3},
    ], {}, context());
    expect(offers[0].url).toContain("view=mp%2Fshowcase%2Fhome");
    expect(offers[0].storeUrl).toBe("https://www.ligapokemon.com.br/b/?p=e33426078");
    expect(offers[1].storeUrl).toBeNull(); expect(offers[2].storeUrl).toBeNull();
  });
  it("usa o logotipo do comparador e mantém ausência sem inventar imagens", () => {
    const offers = mapOffers([
      {id:1,lj_id:1}, {id:2,lj_id:2}, {id:3,lj_id:3}, {id:4,lj_id:4},
    ], {
      "1": {lj_path: "242400_1773702831.jpg", lj_avatar: "outro-avatar.jpg"},
      "2": {lj_avatar: "somente-avatar.jpg"},
      "3": {lj_path: "https://example.com/logo.jpg"},
      "4": {lj_path: "../logo.jpg"},
    }, context());
    expect(offers.map(offer => offer.storeLogoUrl)).toEqual([
      "https://repositorio.sbrauble.com/arquivos/up/ecom/comparador/242400_1773702831.jpg", null, null, null,
    ]);
    const real = mapOffers(fixture.raw.offers, fixture.raw.stores, context());
    expect(real[0].storeLogoUrl).toBe("https://repositorio.sbrauble.com/arquivos/up/ecom/comparador/242400_1773702831.jpg");
  });
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
    [3, "SP"],
    [4, "MP"],
    [5, "HP"],
    [6, "D"],
    [99, null],
  ])("qualidade %s", (c, label) => {
    expect(mapQuality(c)).toBe(label);
    expect(mapQuality(String(c))).toBe(label);
  });
  it("mapeia condições das ofertas e filtra por SP, MP, HP e D", () => {
    const raw = [
      { id: 1, lj_id: 1, qualid: 3, preco: 5 },
      { id: 2, lj_id: 1, qualid: "4", preco: 4 },
      { id: 3, lj_id: 1, qualid: 5, preco: 199 },
      { id: 4, lj_id: 1, qualid: "6", preco: 5 },
      { id: 5, lj_id: 1, qualid: 99, preco: 1 },
    ];
    const offers = mapOffers(raw, {}, context());
    expect(offers.map(o => [o.quality, o.qualityCode])).toEqual([
      ["SP", 3], ["MP", "4"], ["HP", 5], ["D", "6"], [null, 99],
    ]);
    const result = resultSchema.parse({
      card: { name: "Pikachu", number: null, edition: null },
      source: "Liga Pokémon", collectedAt: "2026-10-23T12:00:00.000Z",
      totalOffers: offers.length, offers,
      diagnostics: { pricesDecoded: 5, pricesPending: 0, stocksDecoded: 0, stocksPending: 5, messages: [] },
    });
    for (const [index, quality] of ["SP", "MP", "HP", "D"].entries()) {
      const filtered = filterResult(result, querySchema.parse({ card: "Pikachu", quality: quality.toLowerCase() }));
      expect(filtered.totalOffers).toBe(1);
      expect(filtered.offers[0]).toMatchObject({ offerId: index + 1, quality });
    }
    expect(result.offers).toHaveLength(5);
    const combined = filterResult(result, querySchema.parse({ card: "Pikachu", quality: " sp, HP,sp " }));
    expect(combined.offers.map(o => o.quality)).toEqual(["SP", "HP"]);
    expect(combined.totalOffers).toBe(2);
    expect(querySchema.parse({ card: "Pikachu", quality: " sp, HP,sp " }).quality).toBe("SP,HP");
    expect(querySchema.safeParse({ card: "Pikachu", quality: "NM,INVALID" }).success).toBe(false);
    expect(mapQuality(null)).toBeNull();
    expect(mapQuality(undefined)).toBeNull();
  });
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
