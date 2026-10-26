import { it, expect } from "vitest";
import { BrowserPool } from "../src/utils/browser.js";
import type { BrowserContext, Page } from "playwright";
it("fecha a página no timeout individual e libera a próxima consulta", async () => {
  const pool = new BrowserPool(1, 1000, 300);
  let timedOutPage: Page | undefined;
  try {
    await expect(
      pool.run(async (page) => {
        timedOutPage = page;
        await page.waitForFunction(() => false, null, { timeout: 2000 });
      }),
    ).rejects.toMatchObject({ code: "PORTAL_TIMEOUT" });
    expect(timedOutPage?.isClosed()).toBe(true);
    await expect(
      pool.run(async (page) => {
        await page.setContent("<p>ok</p>");
        return page.locator("p").innerText();
      }),
    ).resolves.toBe("ok");
  } finally {
    await pool.close();
  }
});

it("reutiliza a sessão entre coletas, preservando cookies e fechando somente a página", async () => {
  const pool = new BrowserPool(1, 1000, 2000);
  let session: BrowserContext | undefined;
  let firstPage: Page | undefined;
  try {
    await pool.run(async (page) => {
      firstPage = page;
      session = page.context();
      await session.addCookies([{ name: "session-test", value: "ok", url: "https://www.ligapokemon.com.br/" }]);
    });
    expect(firstPage?.isClosed()).toBe(true);
    await pool.run(async (page) => {
      expect(page.context()).toBe(session);
      expect(await page.context().cookies("https://www.ligapokemon.com.br/")).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "session-test", value: "ok" })]),
      );
    });
    expect(session?.pages()).toHaveLength(0);
  } finally {
    await pool.close();
  }
});

it("compartilha a inicialização da sessão em consultas concorrentes e recupera contexto fechado", async () => {
  const pool = new BrowserPool(2, 1000, 2000);
  try {
    const contexts = await Promise.all([
      pool.run(async (page) => page.context()),
      pool.run(async (page) => page.context()),
    ]);
    expect(contexts[0]).toBe(contexts[1]);
    await contexts[0].close();
    await pool.run(async (page) => {
      expect(page.context()).not.toBe(contexts[0]);
      await page.setContent("<p>ok</p>");
      expect(await page.locator("p").innerText()).toBe("ok");
    });
  } finally {
    await pool.close();
  }
});
