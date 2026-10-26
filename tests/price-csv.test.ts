import { afterEach, expect, it } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { ApiError } from "../src/types/card.types.js";
import {
  buildPriceCsv,
  priceCsvSchema,
} from "../src/services/price-csv.service.js";
import type {
  CatalogCard,
  EditionCards,
} from "../src/services/catalog.service.js";

const card = (id: string, name: string, nameEn: string, extra: Partial<CatalogCard> = {}): CatalogCard => ({
  id,
  name,
  nameEn,
  number: `${id.split("-")[2]}/128`,
  rarity: "Comum",
  energies: ["Água"],
  imageUrl: null,
  minPrice: null,
  maxPrice: null,
  url: "https://www.ligapokemon.com.br/",
  ...extra,
});
const data: EditionCards = {
  edition: {
    id: "804",
    code: "30C",
    name: "Celebração de 30 Anos",
    nameEn: "30th Celebration",
    year: 2026,
    releasedAt: "2026-09-16",
    parentId: null,
    imageUrl: null,
    url: "https://www.ligapokemon.com.br/",
  },
  cards: [
    card("804-48-018", "Articuno", "Articuno"),
    card("804-360-127", "Substituição", "Switch", { energies: ["Incolor"] }),
    card("804-8018-126", "Poké Tablet", "Poké Pad", { energies: ["Incolor"] }),
  ],
  collectedAt: "2026-10-26T12:00:00.000Z",
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  servers.length = 0;
});

it("reproduz o layout exportado pela loja, inclusive cabeçalhos e nomes sem acento", () => {
  const csv = buildPriceCsv(
    data,
    priceCsvSchema.parse({
      rows: [
        { cardId: "804-48-018", language: "PT", quality: "NM", price: 4.9, existing: 1, extras: ["foil"] },
        { cardId: "804-360-127", language: "PT", quality: "NM", price: 10, quantity: 0, extras: ["foil", "promo"] },
        { cardId: "804-8018-126", language: "", quality: "", price: 15 },
      ],
    }),
  );
  const lines = csv.split("\r\n");
  expect(lines[0]).toBe(
    ',,,,,,,,,,,,,,,"xls1","xls4","xls7","xls8","xls5","xls9","xls13","xls14","xls15","xls6","xls26","xls44","xls51","xls69","xls70"',
  );
  expect(lines[1]).toContain('"Idioma\n(DE, TW, TK, ES, FR, ID, EN, IT, JP, KO, PL, PT, PTEN, RU, TH)"');
  expect(lines[1].endsWith('"Pokeball Foil\n(0 ou 1)","Estoque"')).toBe(true);
  // Same text as the Articuno row of the store export.
  expect(lines[2]).toBe(
    '"2","804","30C","48","018","Celebração de 30 Anos","Comum","Água","Articuno","Articuno","PT","NM","1",,"4,90","1","","","","","","","","","","","","","","","Estoque Indefinido"',
  );
  expect(lines[3]).toContain('"Substituicao","Switch","PT","NM","","0","10,00","1","","1",');
  expect(lines[4]).toContain('"Poke Tablet","Poke Pad","","","",,"15,00"');
  expect(lines.at(-1)).toBe("");
});
it("valida cartas da edição e limites antes de gerar o arquivo", async () => {
  const server = createApp(
    { getPrices: async () => { throw new Error(); } },
    { getEditions: async () => [data.edition], getCards: async () => data },
  ).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  const post = (body: unknown, id = "804") =>
    fetch(`http://127.0.0.1:${addr.port}/api/editions/${id}/price-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const ok = await post({ rows: [{ cardId: "804-48-018", language: "PT", quality: "NM", price: 2 }] });
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toContain("text/csv");
  expect(ok.headers.get("content-disposition")).toContain("precos-30C.csv");
  expect(await ok.text()).toContain('"2,00"');
  const unknown = await post({ rows: [{ cardId: "804-1-001", language: "PT", quality: "NM", price: 2 }] });
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toMatchObject({ error: "UNKNOWN_CARDS", details: ["804-1-001"] });
  expect((await post({ rows: [{ cardId: "804-48-018", language: "XX", quality: "NM", price: 2 }] })).status).toBe(400);
  expect((await post({ rows: [{ cardId: "804-48-018", language: "PT", quality: "NM", price: 0 }] })).status).toBe(400);
  const many = Array.from({ length: 1001 }, () => ({ cardId: "804-48-018", language: "PT", quality: "NM", price: 2 }));
  expect((await post({ rows: many })).status).toBe(400);
  expect((await post({ rows: [] }, "abc")).status).toBe(400);
});
it("gera o CSV com as colunas do arquivo exportado quando a Liga está indisponível", async () => {
  const blocked = new ApiError(503, "PORTAL_BLOCKED", "Bloqueado");
  const server = createApp(
    { getPrices: async () => { throw blocked; } },
    { getEditions: async () => { throw blocked; }, getCards: async () => { throw blocked; } },
  ).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  const post = (body: unknown) =>
    fetch(`http://127.0.0.1:${addr.port}/api/editions/804/price-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const row = { cardId: "804-360-127", language: "PT", quality: "NM", price: 9, extras: ["foil"] };
  const card = { name: "Substituicao", nameEn: "Switch", rarity: "Comum", color: "Incolor" };
  const edition = { code: "30C", name: "Celebração de 30 Anos" };
  const ok = await post({ rows: [{ ...row, card }], edition });
  expect(ok.status).toBe(200);
  expect((await ok.text()).split("\r\n")[2]).toBe(
    '"2","804","30C","360","127","Celebração de 30 Anos","Comum","Incolor","Substituicao","Switch","PT","NM","",,"9,00","1","","","","","","","","","","","","","","","Estoque Indefinido"',
  );
  expect((await post({ rows: [row], edition })).status).toBe(503);
  expect((await post({ rows: [{ ...row, cardId: "805-360-127", card }], edition })).status).toBe(400);
});
