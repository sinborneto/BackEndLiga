import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, type Browser } from "playwright";
import { extractStructures } from "../src/extractors/cards.extractor.js";
import {
  resolveCard,
  buildCardUrl,
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
