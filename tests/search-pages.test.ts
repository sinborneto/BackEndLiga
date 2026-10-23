import { it, expect, vi } from "vitest";
import { chromium } from "playwright";
import { SearchPagesService } from "../src/services/search-pages.service.js";
import { PortalLimit } from "../src/services/portal-limit.js";
import { querySchema } from "../src/types/card.types.js";

it("pagina 20 itens sem buscar páginas futuras e compartilha chamadas simultâneas", async () => {
  let requests = 0;
  const cards = (start: number, end: number) =>
    Array.from(
      { length: end - start + 1 },
      (_, i) =>
        `<div class="mtg-single"><a href="https://www.ligapokemon.com.br/?view=cards/card&card=Pikachu+(${start + i}/100)&ed=TEST&num=${start + i}">Pikachu</a></div>`,
    ).join("");
  const service = new SearchPagesService(new PortalLimit(), async () => {
    const browser = await chromium.launch();
    const newContext = browser.newContext.bind(browser);
    vi.spyOn(browser, "newContext").mockImplementation(async (options) => {
      const context = await newContext(options);
      const newPage = context.newPage.bind(context);
      vi.spyOn(context, "newPage").mockImplementation(async () => {
        const page = await newPage();
        await page.route("**/*", (route) => {
          if (route.request().method() === "POST") {
            requests++;
            return route.fulfill({
              json: {
                html: requests === 1 ? cards(41, 80) : cards(81, 85),
                nextPage: requests === 1 ? "1" : "0",
              },
            });
          }
          return route.fulfill({
            contentType: "text/html",
            body:
              cards(1, 40) +
              `<input type="button" onclick="mcards.nextPage(40)"><script>window.mcards={page:1,nextPage:async()=>{const button=document.querySelector('input');button.style.display='none';const data=await fetch('/ajax/cards/main.php',{method:'POST'}).then(r=>r.json());document.body.insertAdjacentHTML('beforeend',data.html);mcards.page++;if(data.nextPage==='1')button.style.display='';else button.remove();}};</script>`,
          });
        });
        return page;
      });
      return context;
    });
    return browser;
  });
  try {
    const first = await service.first(querySchema.parse({ card: "Pikachu" }));
    expect(first?.details).toHaveLength(20);
    expect(requests).toBe(0);
    const second = await service.next(first!.pagination!.nextCursor!);
    expect(second.items).toHaveLength(20);
    expect(requests).toBe(0); // The portal's initial 40-item page already contains this batch.
    const [third, duplicate] = await Promise.all([
      service.next(second.nextCursor!),
      service.next(second.nextCursor!),
    ]);
    expect(third.items).toHaveLength(20);
    expect(duplicate).toEqual(third);
    expect(requests).toBe(1);
    const fourth = await service.next(third.nextCursor!);
    expect(fourth.items).toHaveLength(20);
    expect(requests).toBe(1);
    const last = await service.next(fourth.nextCursor!);
    expect(last.items).toHaveLength(5);
    expect(last.nextCursor).toBeNull();
    expect(requests).toBe(2);
    expect(await service.next(second.nextCursor!)).toEqual(third);
    expect(requests).toBe(2);
    await expect(service.next("invalid")).rejects.toMatchObject({
      code: "SEARCH_EXPIRED",
    });
  } finally {
    await service.close();
  }
});
