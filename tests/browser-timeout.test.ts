import { it, expect } from "vitest";
import { BrowserPool } from "../src/utils/browser.js";
import type { Page } from "playwright";
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
