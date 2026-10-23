import { chromium, type Browser, type Page } from "playwright";
import { ApiError } from "../types/card.types.js";
export class BrowserPool {
  private browser?: Promise<Browser>;
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
    let context;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      this.browser ??= chromium.launch({ headless: true }).catch((e) => {
        this.browser = undefined;
        throw e;
      });
      context = await (await this.browser).newContext({ locale: "pt-BR" });
      const page = await context.newPage();
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
        await context?.close();
      } finally {
        const next = this.waiters.shift();
        if (next) next();
        else this.active--;
      }
    }
  }
  async close() {
    await (await this.browser)?.close();
  }
}
