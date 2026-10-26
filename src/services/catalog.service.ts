import { z } from "zod";
import { load } from "cheerio";
import { decodeHTML } from "entities";
import JSON5 from "json5";
import { PortalHttpClient } from "../utils/portal-http.js";
import { BrowserPool } from "../utils/browser.js";
import { sharedPortalLimit } from "./portal-limit.js";
import { join } from "node:path";
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
  // Set when the portal failed and a saved copy was served (ISO date of the copy).
  stale?: string;
}
export interface CatalogProvider {
  readonly transport?: "http" | "http+playwright";
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
const filterSchema = z.object({
  field: z.union([z.string(), z.array(z.string())]),
  options: z.array(z.object({ label: z.string(), id: z.array(z.union([z.string(), z.number()])) })).optional(),
});
function scriptsFrom(html: string) {
  const $ = load(html);
  return $("script").map((_index, script) => $(script).text()).get();
}
// Extract data literals only. Function calls and other JavaScript are never executed.
function filterLiteral(script: string, start: number) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let i = start; i < script.length; i++) {
    const char = script[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
    } else if (char === "'" || char === '"') quote = char;
    else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") {
      if (--depth === 0) return JSON5.parse(script.slice(start, i + 1)) as unknown;
    }
  }
  throw new Error("Filtro do catálogo incompleto");
}
export function parseCatalogEditions(html: string): Edition[] {
  const script = scriptsFrom(html).find((text) => /\bjsonEditions\s*=/.test(text));
  if (!script) throw new ApiError(502, "CATALOG_UNAVAILABLE", "Não foi possível carregar as edições da Liga.");
  const data = z.object({ main: z.array(rawEdition), aux: z.record(z.string(), z.array(rawEdition)).default({}) })
    .parse(assignedJson(script, "jsonEditions"));
  return [...new Map([...data.main, ...Object.values(data.aux).flat()].map((e) => [e.id, {
    id: e.id,
    code: e.acronym,
    name: decodeHTML(e.namept || e.name || e.nameen).replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))),
    nameEn: decodeHTML(e.nameen),
    year: Number(e.dtrelease.slice(0, 4)) || 0,
    releasedAt: /^\d{4}-\d{2}-\d{2}/.test(e.dtrelease) ? e.dtrelease.slice(0, 10) : null,
    parentId: e.idgrouped === "0" ? null : e.idgrouped,
    imageUrl: catalogImage(e.icon),
    url: `https://www.ligapokemon.com.br/?${new URLSearchParams({ view: "cards/search", card: `edid=${e.id} ed=${e.acronym}` })}`,
  } satisfies Edition])).values()];
}
export function parseCatalogCards(html: string, edition: Edition): CatalogCard[] {
  const scripts = scriptsFrom(html);
  const script = scripts.find((text) => /\bcardsjson\s*=/.test(text));
  if (!script) throw new ApiError(502, "CATALOG_UNAVAILABLE", "Não foi possível carregar as cartas desta edição.");
  const rows = z.array(rawCard).parse(assignedJson(script, "cardsjson"));
  if (rows.some((card) => String(card.idE) !== edition.id))
    throw new ApiError(502, "CATALOG_UNAVAILABLE", "A Liga retornou cartas de outra edição.");
  const filters = scripts.flatMap((text) => [...text.matchAll(/\bedc\.filters\.push\s*\(\s*/g)].flatMap((match) => {
    const value = filterSchema.parse(filterLiteral(text, match.index! + match[0].length));
    return typeof value.field === "string" ? [{
      field: value.field,
      options: value.options?.map((option) => ({ ...option, label: decodeHTML(option.label) })),
    }] : [];
  }));
  if (!["iR", "sC"].every((field) => filters.some((filter) => filter.field === field)))
    throw new ApiError(502, "CATALOG_UNAVAILABLE", "O HTML não contém os filtros de raridade e energia do catálogo.");
  return rows.map((card) => mapCatalogCard({ ...card, nPT: decodeHTML(card.nPT), nEN: decodeHTML(card.nEN) }, edition, filters));
}
export class CatalogService implements CatalogProvider {
  readonly transport = "http+playwright" as const;
  // Editions and card lists rarely change: keep them on disk and serve the
  // last copy when the portal is unavailable.
  private readonly editions: QueryCache<Edition[]>;
  private readonly cards: QueryCache<EditionCards>;
  constructor(
    cacheDir = process.env.CACHE_DIR ?? ".cache",
    private readonly http = new PortalHttpClient(),
    private readonly browser: Pick<BrowserPool, "run" | "close"> = new BrowserPool(2),
  ) {
    this.editions = new QueryCache<Edition[]>(86400000, 1, {
      file: join(cacheDir, "editions.json"),
      stale: (value) => value,
    });
    this.cards = new QueryCache<EditionCards>(21600000, 300, {
      file: join(cacheDir, "edition-cards.json"),
      stale: (value, savedAt) => ({ ...value, stale: savedAt.toISOString() }),
    });
  }
  getEditions(): Promise<Edition[]> {
    return this.editions.get("all", () => this.collect(
      "https://www.ligapokemon.com.br/?view=cards/edicoes", parseCatalogEditions,
    ));
  }
  async getCards(id: string): Promise<EditionCards> {
    const edition = (await this.getEditions()).find((e) => e.id === id);
    if (!edition)
      throw new ApiError(404, "EDITION_NOT_FOUND", "Edição não encontrada.");
    return this.cards.get(id, async () => ({
      edition,
      cards: await this.collect(edition.url, (html) => parseCatalogCards(html, edition)),
      collectedAt: new Date().toISOString(),
    }));
  }
  private async collect<T>(url: string, parse: (html: string) => T): Promise<T> {
    try {
      return parse(await this.http.get(url));
    } catch (error) {
      if (error instanceof ApiError && (
        error.status < 500 || ["PORTAL_BLOCKED", "PORTAL_RATE_LIMITED", "PORTAL_BUSY"].includes(error.code)
      )) throw error;
      sharedPortalLimit.assertAvailable();
      return this.browser.run(async (page) => {
        await sharedPortalLimit.beforeRequest();
        const response = await page.goto(url, { waitUntil: "domcontentloaded" });
        sharedPortalLimit.check(response);
        await sharedPortalLimit.checkBlocked(page);
        if (!response?.ok())
          throw new ApiError(502, "PORTAL_HTTP_ERROR", "O portal retornou um erro HTTP na consulta pelo navegador.", { status: response?.status() });
        try {
          return parse(await page.content());
        } catch (parseError) {
          if (parseError instanceof ApiError) throw parseError;
          throw new ApiError(502, "CATALOG_UNAVAILABLE", "Não foi possível interpretar o catálogo por HTTP nem pelo navegador.");
        }
      }).catch((browserError: unknown) => {
        if (browserError instanceof ApiError) throw browserError;
        if (browserError instanceof Error && browserError.name === "TimeoutError")
          throw new ApiError(504, "PORTAL_TIMEOUT", "Tempo limite na consulta alternativa pelo navegador.");
        throw new ApiError(502, "CATALOG_UNAVAILABLE", "Não foi possível consultar o catálogo por HTTP nem pelo navegador.");
      });
    }
  }
  close() {
    this.editions.flush();
    this.cards.flush();
    return this.browser.close();
  }
}
