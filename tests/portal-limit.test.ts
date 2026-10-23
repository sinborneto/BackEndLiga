import { it, expect, vi, afterEach } from "vitest";
import type { Response } from "playwright";
import { PortalLimit } from "../src/services/portal-limit.js";
afterEach(() => vi.useRealTimers());
it("respeita o limite da Liga antes de abrir outra busca e libera após a espera", () => {
  vi.useFakeTimers();
  const limit = new PortalLimit();
  expect(() => limit.check({ status: () => 200 } as Response)).not.toThrow();
  expect(() =>
    limit.check({
      status: () => 429,
      headers: () => ({ "retry-after": "120" }),
    } as unknown as Response),
  ).toThrow(
    expect.objectContaining({ code: "PORTAL_RATE_LIMITED", status: 503 }),
  );
  expect(() => limit.assertAvailable()).toThrow();
  vi.advanceTimersByTime(120000);
  expect(() => limit.assertAvailable()).not.toThrow();
});
