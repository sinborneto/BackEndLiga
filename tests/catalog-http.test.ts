import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PortalHttpClient } from "../src/utils/portal-http.js";
import { PortalLimit, PortalPacer } from "../src/services/portal-limit.js";
import { sharedPortalLimit } from "../src/services/portal-limit.js";
import type { BrowserPool } from "../src/utils/browser.js";
import type { Page } from "playwright";
import { ApiError } from "../src/types/card.types.js";
import { CatalogService, parseCatalogEditions, parseCatalogCards } from "../src/services/catalog.service.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
const url = "https://www.ligapokemon.com.br/?view=cards/edicoes";
const editionsHtml = `<script>let jsonEditions = ${JSON.stringify({
  main: [{ id: "804", acronym: "30C", name: "Test", nameen: "Pok&eacute;mon", namept: "Celebra&ccedil;&atilde;o", dtrelease: "2026-09-16", idgrouped: "0", icon: "" }], aux: {},
})}; throw new Error('never execute');</script>`;
const card = { id: 1, idE: 804, nEN: "Nidoran Female (#002/128)", nPT: "Nidoran F&ecirc;mea", sN: "002", sC: "GW", iR: 17, sP: "", precoMenor: "0.85", precoMaior: "0" };
const cardsHtml = `<script>var cardsjson = ${JSON.stringify([card])};
edc.filters.push({'field':['nEN','nPT'], 'limit':0});
edc.filters.push({'field':'iR','options':[{'id':[17],'label':'Ilustra&ccedil;&atilde;o Rara'}]});
edc.filters.push({'field':'sC','options':[{'id':['G'],'label':'Planta'},{'id':['W'],'label':'&Aacute;gua'}]});
throw new Error('never execute');</script>`;
const limit = () => new PortalLimit(600000, 0, new PortalPacer());

function browserFixture(html: string) {
  const page = {
    goto: vi.fn().mockResolvedValue({ status: () => 200, ok: () => true }),
    title: async () => "Catálogo",
    content: async () => html,
  } as unknown as Page;
  const run = vi.fn(async (task: (page: Page) => Promise<unknown>) => task(page));
  const close = vi.fn().mockResolvedValue(undefined);
  return { browser: { run, close } as unknown as Pick<BrowserPool, "run" | "close">, run, close };
}

it.each(["connection", "missing-data"])("tenta Playwright uma vez quando HTTP falha por %s e compartilha o resultado", async (failure) => {
  vi.spyOn(sharedPortalLimit, "beforeRequest").mockResolvedValue(undefined);
  const directory = mkdtempSync(join(tmpdir(), "catalog-fallback-"));
  const request = failure === "connection"
    ? vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"))
    : vi.fn<typeof fetch>().mockResolvedValue(new Response("<html>Carregando...</html>"));
  const fixture = browserFixture(editionsHtml);
  const service = new CatalogService(directory, new PortalHttpClient(limit(), request), fixture.browser);
  try {
    const [first, duplicate] = await Promise.all([service.getEditions(), service.getEditions()]);
    expect(first).toEqual(parseCatalogEditions(editionsHtml));
    expect(duplicate).toEqual(first);
    expect(await service.getEditions()).toEqual(first);
    expect(request).toHaveBeenCalledTimes(1);
    expect(fixture.run).toHaveBeenCalledTimes(1);
  } finally {
    await service.close();
    expect(fixture.close).toHaveBeenCalledTimes(1);
    rmSync(directory, { recursive: true, force: true });
  }
});

it("não inicia navegador se HTTP entrega dados válidos", async () => {
  const directory = mkdtempSync(join(tmpdir(), "catalog-http-only-"));
  const fixture = browserFixture(editionsHtml);
  const service = new CatalogService(directory,
    new PortalHttpClient(limit(), vi.fn<typeof fetch>().mockResolvedValue(new Response(editionsHtml))), fixture.browser);
  try {
    await service.getEditions();
    expect(fixture.run).not.toHaveBeenCalled();
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it.each(["PORTAL_BLOCKED", "PORTAL_RATE_LIMITED", "PORTAL_BUSY"])("não troca de método ao receber %s", async (code) => {
  const directory = mkdtempSync(join(tmpdir(), "catalog-paused-"));
  const fixture = browserFixture(editionsHtml);
  const http = new PortalHttpClient(limit());
  vi.spyOn(http, "get").mockRejectedValue(new ApiError(503, code, "aguarde"));
  const service = new CatalogService(directory, http, fixture.browser);
  try {
    await expect(service.getEditions()).rejects.toMatchObject({ code });
    expect(fixture.run).not.toHaveBeenCalled();
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("propaga a falha do segundo método sem repetir indefinidamente", async () => {
  vi.spyOn(sharedPortalLimit, "beforeRequest").mockResolvedValue(undefined);
  const directory = mkdtempSync(join(tmpdir(), "catalog-both-failed-"));
  const fixture = browserFixture("<html>sem dados</html>");
  const request = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
  const service = new CatalogService(directory, new PortalHttpClient(limit(), request), fixture.browser);
  try {
    await expect(service.getEditions()).rejects.toMatchObject({ code: "CATALOG_UNAVAILABLE" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(fixture.run).toHaveBeenCalledTimes(1);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("lê catálogo e rótulos do HTML sem navegador ou execução dos scripts", () => {
  const [edition] = parseCatalogEditions(editionsHtml);
  expect(edition).toMatchObject({ name: "Celebração", nameEn: "Pokémon" });
  expect(parseCatalogCards(cardsHtml, edition)).toMatchObject([{
    name: "Nidoran Fêmea", number: "002/128", rarity: "Ilustração Rara", energies: ["Planta", "Água"], minPrice: 0.85, maxPrice: null,
  }]);
  expect(() => parseCatalogCards(cardsHtml.replace("'field':'sC'", "'field':'unknown'"), edition)).toThrow();
  expect(() => parseCatalogCards(cardsHtml.replace('"idE":804', '"idE":999'), edition)).toThrow();
  expect(() => parseCatalogCards(cardsHtml.replace("'label':'Planta'", "'label':globalThis.hacked=true"), edition)).toThrow();
});

it("consulta o portal com fetch e não aceita redirecionamentos automáticos", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(editionsHtml));
  const http = new PortalHttpClient(limit(), request);
  expect(await http.get(url)).toBe(editionsHtml);
  expect(request).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }));
  await expect(http.get("https://example.com/")).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([429, 503])("respeita Retry-After de HTTP %s e não insiste durante a pausa", async (status) => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status, headers: { "retry-after": "120" } }));
  const http = new PortalHttpClient(limit(), request);
  await expect(http.get(url)).rejects.toMatchObject({ code: "PORTAL_RATE_LIMITED", details: { retryAfter: 120 } });
  await expect(http.get(url)).rejects.toMatchObject({ code: "PORTAL_RATE_LIMITED" });
  expect(request).toHaveBeenCalledTimes(1);
});

it("identifica página de verificação mesmo com status 200 e compartilha cooldown", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response("<title>Just a moment...</title>"));
  const shared = limit();
  await expect(new PortalHttpClient(shared, request).get(url)).rejects.toMatchObject({ code: "PORTAL_BLOCKED" });
  await expect(new PortalHttpClient(shared, request).get(url)).rejects.toMatchObject({ code: "PORTAL_BLOCKED" });
  expect(request).toHaveBeenCalledTimes(1);
});

it("distingue HTTP inválido, erro de rede e timeout", async () => {
  await expect(new PortalHttpClient(limit(), vi.fn<typeof fetch>().mockResolvedValue(new Response("bad", { status: 500 }))).get(url))
    .rejects.toMatchObject({ code: "PORTAL_HTTP_ERROR", details: { status: 500 } });
  await expect(new PortalHttpClient(limit(), vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"))).get(url))
    .rejects.toMatchObject({ code: "PORTAL_CONNECTION_FAILED" });
  const slow = vi.fn<typeof fetch>().mockImplementation(async (_url, options) => new Promise((_resolve, reject) => {
    options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
  }));
  await expect(new PortalHttpClient(limit(), slow, 20).get(url)).rejects.toMatchObject({ code: "PORTAL_TIMEOUT" });
});

it("mantém o contrato do catálogo, deduplica consultas e usa cópia salva quando HTTP falha", async () => {
  vi.useFakeTimers();
  const directory = mkdtempSync(join(tmpdir(), "catalog-http-"));
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(editionsHtml))
    .mockResolvedValueOnce(new Response(cardsHtml))
    .mockResolvedValue(new Response("<title>Attention Required!</title>", { status: 403 }));
  const service = new CatalogService(directory, new PortalHttpClient(limit(), request));
  try {
    const [first, duplicate] = await Promise.all([service.getCards("804"), service.getCards("804")]);
    expect(duplicate).toEqual(first);
    expect(request).toHaveBeenCalledTimes(2);
    expect(first.cards).toHaveLength(1);
    vi.advanceTimersByTime(86400001);
    expect(await service.getCards("804")).toMatchObject({ cards: first.cards, stale: expect.any(String) });
    expect(request).toHaveBeenCalledTimes(3);
  } finally {
    await service.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
