import type { Response } from "playwright";
import { ApiError } from "../types/card.types.js";

// Share the cooldown across searches so retries do not prolong a portal limit.
export class PortalLimit {
  private until = 0;
  assertAvailable() {
    if (Date.now() < this.until)
      throw new ApiError(
        503,
        "PORTAL_RATE_LIMITED",
        "A Liga limitou temporariamente as consultas. Aguarde antes de tentar novamente.",
        { retryAfter: Math.ceil((this.until - Date.now()) / 1000) },
      );
  }
  check(response: Response | null) {
    if (response?.status() !== 429) return;
    const seconds = Number(response.headers()["retry-after"]);
    this.until =
      Date.now() +
      (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 60) *
        1000;
    this.assertAvailable();
  }
}
