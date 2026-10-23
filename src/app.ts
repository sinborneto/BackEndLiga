import express from "express";
import rateLimit from "express-rate-limit";
import {
  ApiError,
  querySchema,
  type CardQuery,
  type Result,
} from "./types/card.types.js";
import { filterResult } from "./services/marketplace.service.js";
import { BatchPricesService } from "./services/batch-prices.service.js";
import { createBatchSchema } from "./types/batch.types.js";
import type { CatalogProvider } from "./services/catalog.service.js";
export interface PriceService {
  getPrices(q: CardQuery): Promise<Result>;
}
export function createApp(service: PriceService, catalog?: CatalogProvider) {
  const positive = (value: string | undefined, fallback: number) => {
    const n = Number(value ?? fallback);
    if (!Number.isInteger(n) || n < 1)
      throw new Error("Configuração de lote deve ser um inteiro positivo");
    return n;
  };
  const batchSchema = createBatchSchema(
    positive(process.env.BATCH_MAX_CARDS, 20),
  );
  const batchService = new BatchPricesService(
    service,
    positive(process.env.BATCH_CONCURRENCY, 3),
  );
  const app = express();
  app.disable("x-powered-by");
  app.use(rateLimit({ windowMs: 60000, limit: 30 }));
  app.use(express.json({ limit: "128kb" }));
  app.post("/api/cards/prices/batch", async (req, res, next) => {
    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "INVALID_BATCH", details: parsed.error.flatten() });
      return;
    }
    try {
      res.json(await batchService.getPrices(parsed.data));
    } catch (error) {
      next(error);
    }
  });
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/editions", async (_req, res, next) => {
    try {
      if (!catalog)
        throw new ApiError(
          503,
          "CATALOG_UNAVAILABLE",
          "Catálogo indisponível.",
        );
      res.json({ editions: await catalog.getEditions() });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/editions/:id/cards", async (req, res, next) => {
    try {
      if (!/^\d{1,6}$/.test(req.params.id))
        throw new ApiError(
          400,
          "INVALID_EDITION",
          "Identificador de edição inválido.",
        );
      if (!catalog)
        throw new ApiError(
          503,
          "CATALOG_UNAVAILABLE",
          "Catálogo indisponível.",
        );
      res.json(await catalog.getCards(req.params.id));
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/cards/prices", async (req, res, next) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "INVALID_QUERY", details: parsed.error.flatten() });
      return;
    }
    try {
      res.json(filterResult(await service.getPrices(parsed.data), parsed.data));
    } catch (e) {
      next(e);
    }
  });
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      void _next;
      if (error instanceof SyntaxError && "body" in error) {
        res
          .status(400)
          .json({ error: "INVALID_JSON", message: "JSON inválido." });
        return;
      }
      if (error instanceof ApiError) {
        res.status(error.status).json({
          error: error.code,
          message: error.message,
          details: error.details,
        });
      } else {
        console.error(error);
        res.status(502).json({
          error: "UPSTREAM_FAILURE",
          message: "Não foi possível consultar o portal.",
        });
      }
    },
  );
  return app;
}
