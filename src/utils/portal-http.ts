import { load } from "cheerio";
import { ApiError } from "../types/card.types.js";
import { sharedPortalLimit, type PortalLimit } from "../services/portal-limit.js";
import { ConcurrencyLimiter } from "./concurrency.js";

export class PortalHttpClient {
  private readonly concurrency = new ConcurrencyLimiter(2);
  private queued = 0;
  constructor(
    private readonly limit: PortalLimit = sharedPortalLimit,
    private readonly request: typeof fetch = fetch,
    private readonly timeout = Number(process.env.PAGE_TIMEOUT_MS ?? 45000),
  ) {
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647)
      throw new Error("Timeout HTTP deve ser um inteiro positivo até 2147483647");
  }
  async get(url: string): Promise<string> {
    const target = new URL(url);
    if (target.protocol !== "https:" || target.hostname !== "www.ligapokemon.com.br" || target.username || target.password || target.port)
      throw new Error("URL HTTP fora do portal permitido");
    this.limit.assertAvailable();
    if (this.queued >= 22)
      throw new ApiError(503, "PORTAL_BUSY", "Fila de consultas ao portal cheia.");
    this.queued++;
    try {
      return await this.concurrency.run(async () => {
        await this.limit.beforeRequest();
        const signal = AbortSignal.timeout(this.timeout);
        try {
          const response = await this.request(target.href, {
            signal,
            redirect: "error",
            headers: { "Accept": "text/html", "Accept-Language": "pt-BR,pt;q=0.9" },
          });
          try {
            this.limit.checkStatus(response.status, response.headers.get("retry-after") ?? undefined);
          } catch (error) {
            await response.body?.cancel().catch(() => undefined);
            throw error;
          }
          const html = await response.text();
          this.limit.checkBlockedTitle(load(html)("title").text());
          if (!response.ok)
            throw new ApiError(502, "PORTAL_HTTP_ERROR", "O portal retornou um erro HTTP.", { status: response.status });
          return html;
        } catch (error) {
          if (error instanceof ApiError) throw error;
          if (signal.aborted)
            throw new ApiError(504, "PORTAL_TIMEOUT", "Tempo limite da consulta HTTP ao portal excedido.");
          throw new ApiError(502, "PORTAL_CONNECTION_FAILED", "Não foi possível conectar ao portal por HTTP direto.");
        }
      });
    } finally {
      this.queued--;
    }
  }
}
