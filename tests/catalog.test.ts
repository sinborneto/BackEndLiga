import { afterEach, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { ApiError } from "../src/types/card.types.js";
import {
  assignedJson,
  catalogImage,
  mapCatalogCard,
  type Edition,
} from "../src/services/catalog.service.js";

const edition: Edition = {
  id: "804",
  code: "30C",
  name: "Celebração de 30 Anos",
  nameEn: "30th Celebration",
  year: 2026,
  releasedAt: "2026-09-16",
  parentId: null,
  imageUrl: null,
  url: "https://www.ligapokemon.com.br/?view=cards/search&card=edid=804%20ed=30C",
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  servers.length = 0;
});

it("lê JSON completo com ponto e vírgula, colchetes e aspas no nome sem executar código", () => {
  const value = {
    main: [{ name: 'Coleção &ccedil; [especial] "teste"' }],
    aux: { "804": [{ name: "variante" }] },
  };
  expect(
    assignedJson(
      `let jsonEditions = ${JSON.stringify(value)}; alert('não executar');`,
      "jsonEditions",
    ),
  ).toEqual(value);
  expect(() =>
    assignedJson("var cardsjson = alert(1);", "cardsjson"),
  ).toThrow();
});
it("preserva número completo e nome inglês para buscar ofertas e mapeia múltiplas energias", () => {
  const card = mapCatalogCard(
    {
      id: 1,
      idE: 804,
      nEN: "Alolan Exeggutor (#002/128)",
      nPT: "Exeggutor de Alola",
      sN: "002",
      sC: "GW",
      iR: 17,
      sP: "//arquivos/in/pokemon_bkp/cd/804/test.jpg",
      precoMenor: "0.85",
      precoMaior: "0",
    },
    edition,
    [
      { field: "iR", options: [{ id: [17], label: "Ilustração Rara" }] },
      {
        field: "sC",
        options: [
          { id: ["G"], label: "Planta" },
          { id: ["W"], label: "Água" },
        ],
      },
    ],
  );
  expect(card).toMatchObject({
    nameEn: "Alolan Exeggutor",
    number: "002/128",
    rarity: "Ilustração Rara",
    energies: ["Planta", "Água"],
    minPrice: 0.85,
    maxPrice: null,
    imageUrl:
      "https://repositorio.sbrauble.com/arquivos/in/pokemon_bkp/cd/804/test.jpg",
  });
  const query = new URL(card.url).searchParams;
  expect(query.get("card")).toBe("Alolan Exeggutor (002/128)");
  expect(query.get("ed")).toBe("30C");
});
it("recusa imagens de origens externas e protocolos inseguros", () => {
  expect(catalogImage("https://example.com/x.jpg")).toBeNull();
  expect(catalogImage("javascript:alert(1)")).toBeNull();
  expect(catalogImage("http://repositorio.sbrauble.com/x.jpg")).toBeNull();
});
it("expõe edições e cartas e rejeita identificadores inválidos antes da coleta", async () => {
  const cards = vi.fn(async (id: string) => {
    if (id !== "804")
      throw new ApiError(404, "EDITION_NOT_FOUND", "Edição não encontrada.");
    return { edition, cards: [], collectedAt: new Date().toISOString() };
  });
  const prices = vi.fn();
  const server = createApp(
    { getPrices: prices },
    { getEditions: async () => [edition], getCards: cards },
  ).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  const base = `http://127.0.0.1:${addr.port}`;
  expect(await fetch(`${base}/api/editions`).then((r) => r.json())).toEqual({
    editions: [edition],
  });
  expect(
    await fetch(`${base}/api/editions/804/cards`).then((r) => r.json()),
  ).toMatchObject({ edition, cards: [] });
  expect((await fetch(`${base}/api/editions/abc/cards`)).status).toBe(400);
  expect((await fetch(`${base}/api/editions/999/cards`)).status).toBe(404);
  expect(cards).toHaveBeenCalledTimes(2);
  expect(prices).not.toHaveBeenCalled();
});

it("identifica o transporte HTTP nas respostas do catálogo, inclusive em bloqueios", async () => {
  const server = createApp({ getPrices: vi.fn() }, {
    transport: "http",
    getEditions: async () => { throw new ApiError(503, "PORTAL_BLOCKED", "aguarde"); },
    getCards: async () => { throw new ApiError(503, "PORTAL_BLOCKED", "aguarde"); },
  }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  for (const path of ["/api/editions", "/api/editions/804/cards"]) {
    const response = await fetch(`http://127.0.0.1:${addr.port}${path}`);
    expect(response.status).toBe(503);
    expect(response.headers.get("x-catalog-transport")).toBe("http");
  }
});
