import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { QueryCache } from "../src/utils/cache.js";
import { ApiError } from "../src/types/card.types.js";
import { PortalLimit } from "../src/services/portal-limit.js";

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});
const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "liga-cache-"));
  dirs.push(dir);
  return join(dir, "cache.json");
};

it("mantém os dados em disco entre reinícios do processo", async () => {
  const file = tempFile();
  const first = new QueryCache<{ n: number }>(60000, 10, { file });
  await first.get("a", async () => ({ n: 1 }));
  first.flush();
  const fetch = vi.fn(async () => ({ n: 2 }));
  const second = new QueryCache<{ n: number }>(60000, 10, { file });
  expect(await second.get("a", fetch)).toEqual({ n: 1 });
  expect(fetch).not.toHaveBeenCalled();
});
it("usa a última cópia quando o portal falha, mas não esconde erros da consulta", async () => {
  vi.useFakeTimers();
  const cache = new QueryCache<{ n: number; stale?: string }>(1000, 10, {
    stale: (value, savedAt) => ({ ...value, stale: savedAt.toISOString() }),
  });
  await cache.get("a", async () => ({ n: 1 }));
  vi.advanceTimersByTime(2000);
  const blocked = new ApiError(503, "PORTAL_BLOCKED", "Bloqueado");
  expect(await cache.get("a", async () => Promise.reject(blocked))).toMatchObject({
    n: 1,
    stale: expect.any(String),
  });
  const notFound = new ApiError(404, "CARD_NOT_FOUND", "Carta não encontrada.");
  await expect(cache.get("a", async () => Promise.reject(notFound))).rejects.toBe(notFound);
  await expect(cache.get("b", async () => Promise.reject(blocked))).rejects.toBe(blocked);
});
it("reconhece a página de bloqueio e pausa todas as consultas ao portal", async () => {
  vi.useFakeTimers();
  const limit = new PortalLimit(600000);
  const page = (title: string) => ({ title: async () => title }) as unknown as Page;
  await expect(limit.checkBlocked(page("Liga Pokémon"))).resolves.toBeUndefined();
  await expect(limit.checkBlocked(page("Attention Required! | Cloudflare"))).rejects.toMatchObject({
    status: 503,
    code: "PORTAL_BLOCKED",
  });
  expect(() => limit.assertAvailable()).toThrow(expect.objectContaining({ code: "PORTAL_BLOCKED" }));
  vi.advanceTimersByTime(600000);
  expect(() => limit.assertAvailable()).not.toThrow();
});
