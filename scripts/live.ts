import { LigaPokemonService } from "../src/services/liga-pokemon.service.js";
import { querySchema } from "../src/types/card.types.js";
import { writeFile, mkdir } from "node:fs/promises";
const service = new LigaPokemonService();
try {
  const result = await service.getPrices(
    querySchema.parse({
      card: process.argv[2] ?? "Articuno (132/128)",
      edition: process.argv[3] ?? (process.argv[2] ? undefined : "30C"),
    }),
  );
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/live-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        card: result.card,
        totalOffers: result.totalOffers,
        diagnostics: result.diagnostics,
        first: result.offers[0],
      },
      null,
      2,
    ),
  );
} finally {
  await service.close();
}
