import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, type Browser } from "playwright";
import { extractStructures } from "../src/extractors/cards.extractor.js";
import {
  resolveCard,
  buildCardUrl,
  extractCardMedia,
  loadCandidatePages,
} from "../src/services/card-search.service.js";
import { querySchema } from "../src/types/card.types.js";
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});
it("carrega todas as páginas da busca e inclui produtos indisponíveis entre as opções", async () => {
  const page = await browser.newPage();
  let requests = 0;
  try {
    await page.route("https://www.ligapokemon.com.br/**", (route) => {
      if (route.request().method() === "POST") {
        requests++;
        return route.fulfill({
          json: {
            html: `<div class="mtg-single"><a href="https://www.ligapokemon.com.br/?view=prod/view&pcode=123&prod=Articuno+Tin"><img class="main-card" data-src="//repositorio.sbrauble.com/tin.jpg"></a><div class="mtg-names">Lata Articuno</div><p>Produto indisponível</p></div>`,
            nextPage: "0",
          },
        });
      }
      return route.fulfill({
        contentType: "text/html",
        body: `<div class="mtg-single"><a href="https://www.ligapokemon.com.br/?view=cards/card&card=Articuno%20(1/9)&ed=TEST&num=1">Articuno</a></div><input onclick="mcards.nextPage(40)" type="button"><script>window.mcards={page:1,nextPage:async function(){const data=await fetch('/ajax/cards/main.php',{method:'POST'}).then(r=>r.json());document.body.insertAdjacentHTML('beforeend',data.html);document.querySelector('input').remove();window.mcards.page++;}};</script>`,
      });
    });
    await page.goto("https://www.ligapokemon.com.br/");
    await loadCandidatePages(page);
    expect(requests).toBe(1);
    await expect(
      resolveCard(page, querySchema.parse({ card: "Articuno" })),
    ).rejects.toMatchObject({
      code: "AMBIGUOUS_CARD",
      details: [
        { kind: "card", edition: "TEST" },
        {
          kind: "product",
          productCode: "123",
          available: false,
          displayName: "Lata Articuno",
          url: expect.stringContaining("prod/view"),
        },
      ],
    });
  } finally {
    await page.close();
  }
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

it("retorna cards com imagens e edições, deduplicando links e ignorando sugestões de outras cartas", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      ["CLF", "CLK"]
        .map(
          (edition) =>
            `<div class="mtg-single"><a href="https://www.ligapokemon.com.br/?view=cards/card&card=VS+Seeker%20(021/032)&ed=${edition}&num=021"><img class="main-card" data-src="//repositorio.sbrauble.com/${edition}.jpg"></a><div class="mtg-name">Explorador VS</div><a class="edition-name">Deck ${edition}</a><a href="https://www.ligapokemon.com.br/?view=cards/card&card=VS+Seeker%20(021/032)&ed=${edition}&num=021">VS Seeker</a></div>`,
        )
        .join("") +
        '<a href="https://www.ligapokemon.com.br/?view=cards/card&card=Judge%20(21/32)&ed=10A&num=21">Judge</a>',
    );
    await expect(
      resolveCard(
        page,
        querySchema.parse({ card: "VS Seeker", number: "21/32" }),
      ),
    ).rejects.toMatchObject({
      code: "AMBIGUOUS_CARD",
      details: [
        {
          name: "VS Seeker",
          displayName: "Explorador VS",
          number: "021/032",
          edition: "CLF",
          editionName: "Deck CLF",
          imageUrl: "https://repositorio.sbrauble.com/CLF.jpg",
        },
        {
          name: "VS Seeker",
          displayName: "Explorador VS",
          number: "021/032",
          edition: "CLK",
          editionName: "Deck CLK",
          imageUrl: "https://repositorio.sbrauble.com/CLK.jpg",
        },
      ],
    });
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

it("envia edição e número aos parâmetros oficiais da Liga para cartas do catálogo", async () => {
  const page = await browser.newPage();
  const query = querySchema.parse({
    card: "VS Seeker",
    edition: "CLF",
    number: "021/032",
  });
  const url = buildCardUrl(query.card, query.edition, query.number);
  const params = new URL(url).searchParams;
  expect(params.get("card")).toBe("VS Seeker (021/032)");
  expect(params.get("ed")).toBe("CLF");
  expect(params.get("num")).toBe("021");
  try {
    await page.route("**/*", (route) => {
      const requested = new URL(route.request().url()).searchParams;
      return route.fulfill({
        contentType: "text/html",
        body:
          requested.get("ed") === "CLF" && requested.get("num") === "021"
            ? '<title>Explorador VS / VS Seeker (021/032)</title><h1>Explorador VS (021/032)</h1><p>VS Seeker</p><span class="sigla-edition">CLF</span><script>window.cards_stock=[];</script>'
            : '<a href="https://www.ligapokemon.com.br/?view=cards/card&card=Judge%20(21/32)&ed=10A&num=21">Judge</a>',
      });
    });
    await page.goto(url);
    await expect(resolveCard(page, query)).resolves.toMatchObject({
      name: "VS Seeker",
      number: "021/032",
      edition: "CLF",
    });
    await expect(
      resolveCard(page, { ...query, edition: "OTHER" }),
    ).rejects.toMatchObject({ code: "EDITION_UNVERIFIED" });
  } finally {
    await page.close();
  }
  expect(
    new URL(buildCardUrl("VS Seeker (21/32)")).searchParams.has("ed"),
  ).toBe(false);
});

it("normaliza número separado e número no nome para a mesma busca no portal", () => {
  const inline = querySchema.parse({ card: "Pikachu (1/9)" });
  const separate = querySchema.parse({ card: "Pikachu", number: "1/9" });
  expect(separate).toEqual(inline);
  expect(new URL(buildCardUrl(separate.card)).searchParams.get("card")).toBe(
    "Pikachu (1/9)",
  );
  expect(querySchema.parse({ card: "Pikachu (1/9)", number: "1/9" }).card).toBe(
    "Pikachu (1/9)",
  );
  expect(querySchema.parse({ card: "Pikachu", number: "025/165" }).card).toBe(
    "Pikachu (025/165)",
  );
  expect(querySchema.parse({ card: "Pikachu", number: "25" }).card).toBe(
    "Pikachu (25)",
  );
  expect(
    querySchema.safeParse({ card: "Pikachu (1/9)", number: "12/17" }).success,
  ).toBe(false);
});

it("confirma no DOM a identidade ignorando zeros à esquerda", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(
      '<title>Pikachu (01/09)</title><h1>Pikachu (01/09)</h1><span class="sigla-edition">WC</span>',
    );
    await page.evaluate(() => {
      window.cards_stock = [];
    });
    await expect(
      resolveCard(
        page,
        querySchema.parse({ card: "Pikachu", number: "001/009" }),
      ),
    ).resolves.toMatchObject({ name: "Pikachu", edition: "WC" });
    await expect(
      resolveCard(page, querySchema.parse({ card: "Pikachu", number: "1/10" })),
    ).rejects.toMatchObject({ code: "CARD_UNVERIFIED" });
  } finally {
    await page.close();
  }
});

it("extrai imagem principal e o endereço real da carta, sem usar anúncios", async () => {
  const page = await browser.newPage();
  const url = buildCardUrl("Articuno (132/128)");
  try {
    await page.route("**/*", (route) =>
      route.request().resourceType() === "document"
        ? route.fulfill({
            contentType: "text/html",
            body: '<img src="https://example.com/banner.jpg"><img id="featuredImage" src="//repositorio.sbrauble.com/cartas/articuno.jpg">',
          })
        : route.abort(),
    );
    await page.goto(url);
    expect(await extractCardMedia(page)).toEqual({
      imageUrl: "https://repositorio.sbrauble.com/cartas/articuno.jpg",
      url,
    });
    await page
      .locator("#featuredImage")
      .evaluate((el) =>
        el.setAttribute("src", "https://example.com/other.jpg"),
      );
    expect(await extractCardMedia(page)).toEqual({ imageUrl: null, url });
  } finally {
    await page.close();
  }
});

it("ausência da imagem não impede retornar a página da carta", async () => {
  const page = await browser.newPage();
  const url = buildCardUrl("Pikachu (025/165)");
  try {
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<img src="https://example.com/banner.jpg">',
      }),
    );
    await page.goto(url);
    expect(await extractCardMedia(page)).toEqual({ imageUrl: null, url });
    await page.goto("about:blank");
    expect(await extractCardMedia(page)).toEqual({ imageUrl: null, url: null });
  } finally {
    await page.close();
  }
});
