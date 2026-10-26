import { it, expect, vi, afterEach } from "vitest";
import type { Page, Response } from "playwright";
import { PortalLimit, PortalPacer } from "../src/services/portal-limit.js";
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

it("respeita Retry-After em data HTTP e não reduz esperas maiores que uma hora", () => {
  vi.useFakeTimers();
  const limit = new PortalLimit();
  const until = new Date(Date.now() + 7200000).toUTCString();
  expect(() => limit.check({
    status: () => 503,
    headers: () => ({ "retry-after": until }),
  } as unknown as Response)).toThrow(expect.objectContaining({ code: "PORTAL_RATE_LIMITED" }));
  expect(() => limit.check({
    status: () => 429,
    headers: () => ({ "retry-after": "60" }),
  } as unknown as Response)).toThrow();
  vi.advanceTimersByTime(3600000);
  expect(() => limit.assertAvailable()).toThrow();
  vi.advanceTimersByTime(3600000);
  expect(() => limit.assertAvailable()).not.toThrow();
});

it("espaça operações de serviços diferentes na mesma fila", async () => {
  vi.useFakeTimers();
  const pacer = new PortalPacer();
  const catalog = new PortalLimit(600000, 1500, pacer);
  const search = new PortalLimit(600000, 1500, pacer);
  const starts: number[] = [];
  const start = Date.now();
  const requests = [catalog, search, catalog].map((limit) =>
    limit.beforeRequest().then(() => starts.push(Date.now() - start)),
  );
  await vi.advanceTimersByTimeAsync(0);
  expect(starts).toEqual([0]);
  await vi.advanceTimersByTimeAsync(1499);
  expect(starts).toEqual([0]);
  await vi.advanceTimersByTimeAsync(1501);
  await Promise.all(requests);
  expect(starts).toEqual([0, 1500, 3000]);
});

it("cancela operações em espera quando detecta bloqueio e recupera a fila após o cooldown", async () => {
  vi.useFakeTimers();
  const limit = new PortalLimit(10000, 1500, new PortalPacer());
  await limit.beforeRequest();
  const queued = expect(limit.beforeRequest()).rejects.toMatchObject({ code: "PORTAL_BLOCKED" });
  await vi.advanceTimersByTimeAsync(0);
  await expect(limit.checkBlocked({
    title: async () => "Attention Required!",
  } as unknown as Page)).rejects.toMatchObject({ code: "PORTAL_BLOCKED" });
  await vi.advanceTimersByTimeAsync(1500);
  await queued;
  await vi.advanceTimersByTimeAsync(8500);
  await expect(limit.beforeRequest()).resolves.toBeUndefined();
});
