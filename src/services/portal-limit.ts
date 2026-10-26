import type { Page, Response } from "playwright";
import { ApiError } from "../types/card.types.js";

// Cloudflare interstitials ("Attention Required!", "Just a moment...") and similar checks.
export const blockedTitle =
  /attention required|just a moment|captcha|access denied|verifique que você é humano/i;

// Every explicit portal navigation and pagination action shares this queue.
export class PortalPacer {
  private queue: Promise<void> = Promise.resolve();
  private nextStart = 0;
  wait(interval: number, assertAvailable: () => void) {
    const turn = this.queue.then(async () => {
      assertAvailable();
      const delay = Math.max(0, this.nextStart - Date.now());
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      // Another request may have detected a block while this one was waiting.
      assertAvailable();
      this.nextStart = Date.now() + interval;
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }
}
const sharedPortalPacer = new PortalPacer();

// Share the cooldown across searches so retries do not prolong a portal limit.
export class PortalLimit {
  private until = 0;
  private reason: "rate" | "blocked" = "rate";
  constructor(
    private blockCooldown = Number(process.env.PORTAL_BLOCK_COOLDOWN_MS ?? 600000),
    private interval = Number(process.env.PORTAL_MIN_INTERVAL_MS ?? 1500),
    private pacer = sharedPortalPacer,
  ) {
    if (!Number.isInteger(blockCooldown) || blockCooldown <= 0)
      throw new Error("Cooldown do portal deve ser um inteiro positivo");
    if (!Number.isInteger(interval) || interval < 0)
      throw new Error("Intervalo entre consultas deve ser um inteiro não negativo");
  }
  beforeRequest() {
    return this.pacer.wait(this.interval, () => this.assertAvailable());
  }
  assertAvailable() {
    if (Date.now() < this.until)
      throw this.reason === "blocked"
        ? new ApiError(
            503,
            "PORTAL_BLOCKED",
            "A Liga bloqueou temporariamente as consultas automatizadas. Nenhuma tentativa de contorno é feita; aguarde antes de tentar novamente.",
            { retryAfter: Math.ceil((this.until - Date.now()) / 1000) },
          )
        : new ApiError(
            503,
            "PORTAL_RATE_LIMITED",
            "A Liga limitou temporariamente as consultas. Aguarde antes de tentar novamente.",
            { retryAfter: Math.ceil((this.until - Date.now()) / 1000) },
          );
  }
  check(response: Response | null) {
    if (!response) return;
    const status = response.status();
    if (status !== 429 && status !== 503) return;
    this.checkStatus(status, response.headers()["retry-after"]);
  }
  checkStatus(status: number, retryAfter?: string) {
    if (status !== 429 && status !== 503) return;
    if (status === 503 && !retryAfter) return;
    const seconds = retryAfter && /^\d+$/.test(retryAfter.trim())
      ? Number(retryAfter)
      : NaN;
    const date = retryAfter ? Date.parse(retryAfter) : NaN;
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Number.isFinite(date) ? date - Date.now() : 60000;
    this.pause("rate", Math.max(1000, ms));
    this.assertAvailable();
  }
  // Stops all portal requests for a while instead of insisting on a block page.
  async checkBlocked(page: Page) {
    this.checkBlockedTitle(await page.title().catch(() => ""));
  }
  checkBlockedTitle(title: string) {
    if (!blockedTitle.test(title)) return;
    this.pause("blocked", this.blockCooldown);
    this.assertAvailable();
  }
  private pause(reason: "rate" | "blocked", ms: number) {
    if (Date.now() + ms <= this.until) return;
    this.reason = reason;
    this.until = Date.now() + ms;
  }
}
// Catalog and offers share one cooldown: both hit the same portal.
export const sharedPortalLimit = new PortalLimit();
