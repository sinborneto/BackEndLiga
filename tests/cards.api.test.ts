import { it, expect, afterEach } from "vitest";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { ApiError, type Result } from "../src/types/card.types.js";
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  servers.length = 0;
});
async function request(query: string, fetcher: () => Promise<Result>) {
  const server = createApp({ getPrices: fetcher }).listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((r) => server.once("listening", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error();
  return fetch(`http://127.0.0.1:${addr.port}/api/cards/prices${query}`);
}
it("valida parâmetros antes de consultar o portal", async () => {
  const response = await request("?card=&minStock=-1", async () => {
    throw Error("não deveria chamar");
  });
  expect(response.status).toBe(400);
});
it.each([
  [404, "CARD_NOT_FOUND"],
  [409, "AMBIGUOUS_CARD"],
  [504, "PORTAL_TIMEOUT"],
  [503, "PORTAL_BLOCKED"],
])("propaga erro %s sem inventar ofertas", async (status, code) => {
  const response = await request("?card=Articuno", async () => {
    throw new ApiError(status, code, "mensagem");
  });
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error: code });
});
