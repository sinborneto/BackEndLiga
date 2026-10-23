import { createApp } from "./app.js";
import { LigaPokemonService } from "./services/liga-pokemon.service.js";
import { CatalogService } from "./services/catalog.service.js";
const service = new LigaPokemonService();
const catalog = new CatalogService();
const server = createApp(service, catalog).listen(
  Number(process.env.PORT ?? 3000),
  () =>
    console.log(
      "API disponível em http://localhost:" + String(process.env.PORT ?? 3000),
    ),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(1), 15000);
  timer.unref();
  server.close(async () => {
    await Promise.all([service.close(), catalog.close()]);
    clearTimeout(timer);
  });
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
