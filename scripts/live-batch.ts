import { writeFile, mkdir } from "node:fs/promises";
import { createApp } from "../src/app.js";
import { LigaPokemonService } from "../src/services/liga-pokemon.service.js";
import { batchResultSchema } from "../src/types/batch.types.js";
const service = new LigaPokemonService();
const server = createApp(service).listen(0, "127.0.0.1");
try {
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Sem porta");
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/cards/prices/batch`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cards: [
          { name: "Articuno", number: "132/128", edition: "30C" },
          { name: "Chandelure", number: "137/128", edition: "30C" },
        ],
      }),
    },
  );
  if (!response.ok) throw Error(`${response.status}: ${await response.text()}`);
  const result = batchResultSchema.parse(await response.json());
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/live-batch-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        summary: result.summary,
        results: result.results.map((r) =>
          r.status === "success"
            ? {
                query: r.query,
                status: r.status,
                card: r.card,
                totalOffers: r.totalOffers,
                diagnostics: r.diagnostics,
              }
            : { query: r.query, status: r.status, error: r.error },
        ),
      },
      null,
      2,
    ),
  );
  if (result.summary.failedCards) process.exitCode = 1;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await service.close();
}
