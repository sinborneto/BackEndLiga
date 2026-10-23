import { randomUUID } from "node:crypto";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { ApiError, type CardQuery } from "../types/card.types.js";
import { cardChoiceSchema } from "../types/card-choice.js";
import {
  buildCardUrl,
  resolveCard,
  loadCandidatePages,
} from "./card-search.service.js";
import { PortalLimit } from "./portal-limit.js";

type Choice = ReturnType<typeof cardChoiceSchema.parse>;
type Session = {
  context: BrowserContext;
  page: Page;
  query: CardQuery;
  items: Choice[];
  more: boolean;
  expires: number;
  busy?: Promise<void>;
};
export class SearchPagesService {
  private browser?: Promise<Browser>;
  private readonly sessions = new Map<string, Session>();
  private readonly pending = new Map<string, Promise<ApiError | null>>();
  private readonly queries = new Map<string, string>();
  private readonly cleanup = setInterval(
    () => void this.expire(),
    30000,
  ).unref();
  constructor(
    private readonly limit: PortalLimit,
    private readonly launch: () => Promise<Browser> = () => chromium.launch(),
  ) {}
  async first(query: CardQuery): Promise<ApiError | null> {
    const key = query.card.toLowerCase();
    const existing = this.queries.get(key);
    if (existing && (this.sessions.get(existing)?.expires ?? 0) > Date.now())
      return this.choiceError(existing);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = this.open(query)
        .then((id) => {
          if (!id) return null;
          this.queries.set(key, id);
          return this.choiceError(id);
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return pending;
  }
  private async open(query: CardQuery) {
    await this.expire();
    this.limit.assertAvailable();
    if (this.sessions.size + this.pending.size >= 4) {
      const oldest = [...this.sessions].find(([, session]) => !session.busy);
      if (oldest) {
        this.sessions.delete(oldest[0]);
        await oldest[1].context.close();
      }
    }
    if (this.sessions.size + this.pending.size >= 4)
      throw new ApiError(
        503,
        "SEARCH_BUSY",
        "Aguarde uma busca terminar e tente novamente.",
      );
    this.browser ??= this.launch().catch((error) => {
      this.browser = undefined;
      throw error;
    });
    const context = await (await this.browser).newContext({ locale: "pt-BR" });
    try {
      // Search choices only require markup and scripts, never full-resolution images or ads.
      await context.route("**/*", (route) => {
        const request = route.request();
        return ["image", "font", "media"].includes(request.resourceType())
          ? route.abort()
          : route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const response = await page.goto(buildCardUrl(query.card), {
        waitUntil: "domcontentloaded",
      });
      this.limit.check(response);
      if (!response?.ok())
        throw new ApiError(
          502,
          "PORTAL_HTTP_ERROR",
          "O portal retornou um erro HTTP.",
        );
      const session: Session = {
        context,
        page,
        query,
        items: [],
        more: false,
        expires: Date.now() + 180000,
      };
      await this.read(session);
      if (!session.items.length) {
        await context.close();
        return null;
      }
      const id = randomUUID();
      this.sessions.set(id, session);
      return id;
    } catch (error) {
      await context.close();
      throw error;
    }
  }
  private async read(session: Session) {
    try {
      await resolveCard(session.page, session.query, this.limit, false);
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        error.code !== "AMBIGUOUS_CARD" ||
        !Array.isArray(error.details)
      )
        throw error;
      session.items = error.details.flatMap((item) => {
        const result = cardChoiceSchema.safeParse(item);
        return result.success ? [result.data] : [];
      });
    }
    session.more = await session.page
      .locator('input[onclick*="mcards.nextPage"]')
      .first()
      .isVisible();
  }
  private choiceError(id: string) {
    const session = this.sessions.get(id)!;
    const error = new ApiError(
      409,
      "AMBIGUOUS_CARD",
      "Selecione uma carta.",
      session.items.slice(0, 20),
    );
    error.pagination = {
      nextCursor: session.items.length > 20 || session.more ? `${id}:20` : null,
    };
    return error;
  }
  async next(cursor: string) {
    const match = /^([a-f0-9-]{36}):(\d{1,5})$/.exec(cursor);
    const session = match ? this.sessions.get(match[1]) : undefined;
    if (!match || !session || session.expires < Date.now())
      throw new ApiError(
        410,
        "SEARCH_EXPIRED",
        "Esta busca expirou. Pesquise novamente.",
      );
    const offset = Number(match[2]);
    if (offset < 20 || offset > session.items.length)
      throw new ApiError(400, "INVALID_CURSOR", "Página inválida.");
    if (offset >= session.items.length && session.more) {
      session.busy ??= (async () => {
        this.limit.assertAvailable();
        await loadCandidatePages(session.page, this.limit, 1);
        await this.read(session);
      })()
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === "TimeoutError")
            throw new ApiError(
              504,
              "PORTAL_TIMEOUT",
              "A Liga demorou para enviar a próxima página.",
            );
          throw error;
        })
        .finally(() => {
          session.busy = undefined;
        });
      await session.busy;
    }
    session.expires = Date.now() + 180000;
    const items = session.items.slice(offset, offset + 20);
    const next = offset + items.length;
    return {
      items,
      nextCursor:
        next < session.items.length || session.more
          ? `${match[1]}:${next}`
          : null,
    };
  }
  private async expire() {
    for (const [id, session] of this.sessions) {
      if (session.expires > Date.now() || session.busy) continue;
      this.sessions.delete(id);
      await session.context.close();
    }
    for (const [query, id] of this.queries)
      if (!this.sessions.has(id)) this.queries.delete(query);
  }
  async close() {
    clearInterval(this.cleanup);
    await (await this.browser)?.close();
  }
}
