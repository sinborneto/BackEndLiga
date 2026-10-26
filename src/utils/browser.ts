import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { ApiError } from "../types/card.types.js";

export class BrowserPool {
  private browser?: Promise<Browser>;
  private context?: Promise<BrowserContext>;
  private active = 0;
  private waiters: Array<() => void> = [];
  private queuedLimit = 20;
  constructor(
    private limit = 3,
    private timeout = 45000,
    private cardTimeout = Number(process.env.CARD_TIMEOUT_MS ?? 60000),
  ) {
    if (
      ![limit, timeout, cardTimeout].every((n) => Number.isInteger(n) && n > 0)
    )
      throw new Error("Limites do navegador devem ser inteiros positivos");
  }
  async run<T>(fn: (page: Page) => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      if (this.waiters.length >= this.queuedLimit)
        throw new Error("Fila de consultas cheia");
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    } else this.active++;
    let page: Page | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      page = await (await this.session()).newPage();
      page.setDefaultTimeout(this.timeout);
      page.setDefaultNavigationTimeout(this.timeout);
      return await Promise.race([
        fn(page),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new ApiError(
                  504,
                  "PORTAL_TIMEOUT",
                  "Tempo limite individual da carta excedido.",
                ),
              ),
            this.cardTimeout,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      try {
        await page?.close();
      } finally {
        const next = this.waiters.shift();
        if (next) next();
        else this.active--;
      }
    }
  }
  private session(): Promise<BrowserContext> {
    this.context ??= (async () => {
      this.browser ??= chromium.launch({ headless: true }).then((browser) => {
        browser.once("disconnected", () => {
          this.browser = undefined;
          this.context = undefined;
        });
        return browser;
      }).catch((error) => {
        this.browser = undefined;
        throw error;
      });
      const context = await (await this.browser).newContext({ locale: "pt-BR" });
      context.once("close", () => { this.context = undefined; });
      return context;
    })().catch((error) => {
      this.context = undefined;
      throw error;
    });
    return this.context;
  }
  async close() {
    await (await this.browser)?.close();
  }
}
