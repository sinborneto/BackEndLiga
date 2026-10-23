import { z } from "zod";
import { BrowserPool } from "../utils/browser.js";
import { QueryCache } from "../utils/cache.js";
import { ApiError } from "../types/card.types.js";

export interface Edition {
  id: string;
  code: string;
  name: string;
  nameEn: string;
  year: number;
  releasedAt: string | null;
  parentId: string | null;
  imageUrl: string | null;
  url: string;
}
export interface CatalogCard {
  id: string;
  name: string;
  nameEn: string;
  number: string;
  rarity: string | null;
  energies: string[];
  imageUrl: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  url: string;
}
export interface EditionCards {
  edition: Edition;
  cards: CatalogCard[];
  collectedAt: string;
}
export interface CatalogProvider {
  getEditions(): Promise<Edition[]>;
  getCards(id: string): Promise<EditionCards>;
}

const rawEdition = z.object({
  id: z.string(),
  acronym: z.string(),
  name: z.string(),
  nameen: z.string(),
  namept: z.string(),
  dtrelease: z.string(),
  idgrouped: z.string(),
  icon: z.string(),
});
const rawCard = z.object({
  id: z.union([z.number(), z.string()]),
  nEN: z.string(),
  nPT: z.string(),
  sN: z.string(),
  sC: z.string().nullable(),
  iR: z.number(),
  idE: z.number(),
  sP: z.string(),
  precoMenor: z.union([z.string(), z.number()]).nullable().optional(),
  precoMaior: z.union([z.string(), z.number()]).nullable().optional(),
});

// Read only a JSON literal from the published script; never evaluate script text.
export function assignedJson(script: string, variable: string): unknown {
  const assignment = new RegExp(`\\b${variable}\\s*=\\s*`).exec(script);
  if (!assignment) throw new Error(`Dados ausentes: ${variable}`);
  const start = assignment.index + assignment[0].length;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let i = start; i < script.length; i++) {
    const char = script[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") {
      if (--depth === 0) return JSON.parse(script.slice(start, i + 1));
    }
  }
  throw new Error(`JSON incompleto: ${variable}`);
}
export function catalogImage(path: string): string | null {
  if (!path.trim()) return null;
  try {
    const url = new URL(
      path.startsWith("//arquivos/")
        ? `https://repositorio.sbrauble.com/${path.slice(2)}`
        : path,
      "https://www.ligapokemon.com.br/",
    );
    return url.protocol === "https:" &&
      ["repositorio.sbrauble.com", "www.ligapokemon.com.br"].includes(
        url.hostname,
      )
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function mapCatalogCard(
  card: z.infer<typeof rawCard>,
  edition: Edition,
  filters: Array<{
    field: string;
    options?: Array<{ label: string; id: Array<string | number> }>;
  }>,
): CatalogCard {
  const label = (field: string, id: string | number) =>
    filters
      .find((f) => f.field === field)
      ?.options?.find((o) => o.id.includes(id))?.label ?? null;
  const number = card.nEN.match(/\(#?([^()]+)\)\s*$/)?.[1] ?? card.sN;
  const nameEn = card.nEN.replace(/\s*\(#?[^()]+\)\s*$/, "").trim();
  const url = new URL("https://www.ligapokemon.com.br/");
  url.search = new URLSearchParams({
    view: "cards/card",
    card: `${nameEn} (${number})`,
    ed: edition.code,
    num: card.sN,
  }).toString();
  const price = (value: string | number | null | undefined) =>
    value != null && Number.isFinite(Number(value)) && Number(value) > 0
      ? Number(value)
      : null;
  return {
    id: `${card.idE}-${card.id}-${card.sN}`,
    name: card.nPT || nameEn,
    nameEn,
    number,
    rarity: label("iR", card.iR),
    energies: [
      ...new Set(
        (card.sC ?? "")
          .split("")
          .flatMap((c) => (label("sC", c) ? [label("sC", c)!] : [])),
      ),
    ],
    imageUrl: catalogImage(card.sP),
    minPrice: price(card.precoMenor),
    maxPrice: price(card.precoMaior),
    url: url.href,
  };
}
export class CatalogService implements CatalogProvider {
  private readonly pool = new BrowserPool(2);
  private readonly editions = new QueryCache<Edition[]>(3600000, 1);
  private readonly cards = new QueryCache<EditionCards>();
  getEditions(): Promise<Edition[]> {
    return this.editions.get("all", () =>
      this.pool.run(async (page) => {
        await page.goto("https://www.ligapokemon.com.br/?view=cards/edicoes", {
          waitUntil: "domcontentloaded",
        });
        const script = await page
          .locator("script")
          .allTextContents()
          .then((s) => s.find((t) => t.includes("let jsonEditions =")));
        if (!script)
          throw new ApiError(
            502,
            "CATALOG_UNAVAILABLE",
            "Não foi possível carregar as edições da Liga.",
          );
        const data = assignedJson(script, "jsonEditions") as {
          main: unknown[];
          aux: Record<string, unknown[]>;
        };
        const rows = z
          .array(rawEdition)
          .parse([...data.main, ...Object.values(data.aux ?? {}).flat()]);
        const decoded = await page.evaluate((rows) => {
          return rows.map((e) => {
            const el = document.createElement("textarea");
            el.innerHTML = e.namept || e.name || e.nameen;
            const name = el.value.replace(
              /\\u([0-9a-f]{4})/gi,
              (_, h: string) => String.fromCharCode(parseInt(h, 16)),
            );
            el.innerHTML = e.nameen;
            return { ...e, name, nameen: el.value };
          });
        }, rows);
        return [
          ...new Map(
            decoded.map((e) => [
              e.id,
              {
                id: e.id,
                code: e.acronym,
                name: e.name,
                nameEn: e.nameen,
                year: Number(e.dtrelease.slice(0, 4)) || 0,
                releasedAt: /^\d{4}-\d{2}-\d{2}/.test(e.dtrelease)
                  ? e.dtrelease.slice(0, 10)
                  : null,
                parentId: e.idgrouped === "0" ? null : e.idgrouped,
                imageUrl: catalogImage(e.icon),
                url: `https://www.ligapokemon.com.br/?${new URLSearchParams({ view: "cards/search", card: `edid=${e.id} ed=${e.acronym}` })}`,
              } satisfies Edition,
            ]),
          ).values(),
        ];
      }),
    );
  }
  async getCards(id: string): Promise<EditionCards> {
    const edition = (await this.getEditions()).find((e) => e.id === id);
    if (!edition)
      throw new ApiError(404, "EDITION_NOT_FOUND", "Edição não encontrada.");
    return this.cards.get(id, () =>
      this.pool.run(async (page) => {
        await page.goto(edition.url, { waitUntil: "domcontentloaded" });
        const script = await page
          .locator("script")
          .allTextContents()
          .then((s) => s.find((t) => t.includes("var cardsjson =")));
        if (!script)
          throw new ApiError(
            502,
            "CATALOG_UNAVAILABLE",
            "Não foi possível carregar as cartas desta edição.",
          );
        const rows = z.array(rawCard).parse(assignedJson(script, "cardsjson"));
        if (rows.some((c) => String(c.idE) !== id))
          throw new Error("A Liga retornou cartas de outra edição");
        const filters = await page.evaluate(() => {
          const data = (
            window as unknown as {
              edc: {
                filters: Array<{
                  field: string;
                  options?: Array<{
                    label: string;
                    id: Array<string | number>;
                  }>;
                }>;
              };
            }
          ).edc.filters;
          return data
            .filter((f) => typeof f.field === "string")
            .map((f) => ({
              ...f,
              options: f.options?.map((o) => {
                const el = document.createElement("textarea");
                el.innerHTML = o.label;
                return { ...o, label: el.value };
              }),
            }));
        });
        return {
          edition,
          cards: rows.map((c) => mapCatalogCard(c, edition, filters)),
          collectedAt: new Date().toISOString(),
        };
      }),
    );
  }
  close() {
    return this.pool.close();
  }
}
