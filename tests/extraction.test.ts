import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, type Browser } from "playwright";
import { extractStructures } from "../src/extractors/cards.extractor.js";
import {
  resolveCard,
  buildCardUrl,
  extractCardMedia,
} from "../src/services/card-search.service.js";
import { querySchema } from "../src/types/card.types.js";
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});
it("extrai 81 ofertas sem renderização no DOM", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<title>Articuno (132/128)</title><h1>Articuno (132/128)</h1><span class="sigla-edition">30C</span>',
    );
    await page.evaluate(() => {
      window.cards_stock = Array.from({ length: 81 }, (_, i) => ({
        id: i + 1,
        lj_id: 7,
      }));
      window.cards_stores = { "7": { lj_name: "Loja teste" } };
    });
    expect((await extractStructures(page)).offers).toHaveLength(81);
    expect(
      await resolveCard(
        page,
        querySchema.parse({ card: "Articuno (132/128)" }),
      ),
    ).toMatchObject({ edition: "30C" });
  } finally {
    await page.close();
  }
});
it("detecta carta inexistente no conteúdo", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent("<p>Nenhuma carta encontrada</p>");
    await expect(
      resolveCard(page, querySchema.parse({ card: "Inexistente" })),
    ).rejects.toMatchObject({ status: 404 });
  } finally {
    await page.close();
  }
});
it("retorna candidatos de várias edições", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<a href="https://www.ligapokemon.com.br/?view=cards/card&card=Pikachu%20(1/10)">Pikachu 1/10</a><a href="https://www.ligapokemon.com.br/?view=cards/card&card=Pikachu%20(2/10)">Pikachu 2/10</a>',
    );
    await expect(
      resolveCard(page, querySchema.parse({ card: "Pikachu" })),
    ).rejects.toMatchObject({ status: 409 });
  } finally {
    await page.close();
  }
});
it("detecta timeout de inicialização", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent("<p>carregando</p>");
    await expect(
      page.waitForFunction(() => Array.isArray(window.cards_stock), null, {
        timeout: 100,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  } finally {
    await page.close();
  }
});
it("monta URL com caracteres reservados", () => {
  expect(
    new URL(buildCardUrl("Mr. Mime (1/10)")).searchParams.get("card"),
  ).toBe("Mr. Mime (1/10)");
});

it("normaliza número separado e número no nome para a mesma busca no portal", () => {
  const inline = querySchema.parse({ card: "Pikachu (1/9)" });
  const separate = querySchema.parse({ card: "Pikachu", number: "1/9" });
  expect(separate).toEqual(inline);
  expect(new URL(buildCardUrl(separate.card)).searchParams.get("card")).toBe("Pikachu (1/9)");
  expect(querySchema.parse({ card: "Pikachu (1/9)", number: "1/9" }).card).toBe("Pikachu (1/9)");
  expect(querySchema.parse({ card: "Pikachu", number: "025/165" }).card).toBe("Pikachu (025/165)");
  expect(querySchema.parse({ card: "Pikachu", number: "25" }).card).toBe("Pikachu (25)");
  expect(querySchema.safeParse({ card: "Pikachu (1/9)", number: "12/17" }).success).toBe(false);
});

it("confirma no DOM a identidade ignorando zeros à esquerda", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<title>Pikachu (01/09)</title><h1>Pikachu (01/09)</h1><span class="sigla-edition">WC</span>');
    await page.evaluate(() => { window.cards_stock = []; });
    await expect(resolveCard(page, querySchema.parse({ card: "Pikachu", number: "001/009" }))).resolves.toMatchObject({ name: "Pikachu", edition: "WC" });
    await expect(resolveCard(page, querySchema.parse({ card: "Pikachu", number: "1/10" }))).rejects.toMatchObject({ code: "CARD_UNVERIFIED" });
  } finally { await page.close(); }
});

it("extrai imagem principal e o endereço real da carta, sem usar anúncios", async () => {
  const page = await browser.newPage();
  const url = buildCardUrl("Articuno (132/128)");
  try {
    await page.route("**/*", route => route.request().resourceType() === "document"
      ? route.fulfill({ contentType: "text/html", body: '<img src="https://example.com/banner.jpg"><img id="featuredImage" src="//repositorio.sbrauble.com/cartas/articuno.jpg">' })
      : route.abort());
    await page.goto(url);
    expect(await extractCardMedia(page)).toEqual({ imageUrl: "https://repositorio.sbrauble.com/cartas/articuno.jpg", url });
    await page.locator("#featuredImage").evaluate(el => el.setAttribute("src", "https://example.com/other.jpg"));
    expect(await extractCardMedia(page)).toEqual({ imageUrl: null, url });
  } finally { await page.close(); }
});

it("ausência da imagem não impede retornar a página da carta", async () => {
  const page = await browser.newPage();
  const url = buildCardUrl("Pikachu (025/165)");
  try {
    await page.route("**/*", route => route.fulfill({ contentType: "text/html", body: '<img src="https://example.com/banner.jpg">' }));
    await page.goto(url);
    expect(await extractCardMedia(page)).toEqual({ imageUrl: null, url });
    await page.goto("about:blank");
    expect(await extractCardMedia(page)).toEqual({ imageUrl: null, url: null });
  } finally { await page.close(); }
});
