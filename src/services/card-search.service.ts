import type { Page } from "playwright";
import { ApiError, type CardQuery } from "../types/card.types.js";
import {
  normalizeCardNumber,
  embeddedCardNumber,
} from "../utils/card-number.js";
import { catalogImage } from "./catalog.service.js";
import { PortalLimit } from "./portal-limit.js";
export function buildCardUrl(card: string, edition?: string, number?: string) {
  const url = new URL("https://www.ligapokemon.com.br/");
  url.search = new URLSearchParams({
    view: "cards/card",
    tipo: "1",
    card,
    ...(edition ? { ed: edition } : {}),
    ...(edition && number ? { num: number.split("/")[0] } : {}),
  }).toString();
  return url.href;
}
export async function extractCardMedia(page: Page) {
  const image = await page.evaluate(
    () =>
      document
        .querySelector<HTMLImageElement>("#featuredImage")
        ?.getAttribute("src") ?? null,
  );
  const allowedUrl = (value: string | null, hosts: string[]) => {
    if (!value) return null;
    try {
      const url = new URL(value, page.url());
      return url.protocol === "https:" &&
        hosts.includes(url.hostname) &&
        !url.username &&
        !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  const url = allowedUrl(page.url(), [
    "www.ligapokemon.com.br",
    "ligapokemon.com.br",
  ]);
  const parsed = url ? new URL(url) : null;
  return {
    imageUrl: allowedUrl(image, [
      "repositorio.sbrauble.com",
      "www.ligapokemon.com.br",
      "ligapokemon.com.br",
    ]),
    url:
      parsed &&
      ["cards/card", "cards/search"].includes(
        parsed.searchParams.get("view") ?? "",
      ) &&
      parsed.searchParams.get("card")
        ? url
        : null,
  };
}
export async function resolveCard(
  page: Page,
  q: CardQuery,
  limit = new PortalLimit(),
  loadAll = true,
) {
  await limit.checkBlocked(page);
  if (loadAll) await loadCandidatePages(page, limit);
  const data = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText,
    links: Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ).map((a) => {
      const container = a.closest(".mtg-single") ?? a.closest(".card-item");
      const image = container?.querySelector("img.main-card");
      const priceText = container
        ?.querySelector(".price-min")
        ?.textContent?.trim();
      const price = priceText
        ? Number(
            priceText
              .replace(/[^\d,.]/g, "")
              .replace(/\./g, "")
              .replace(",", "."),
          )
        : null;
      return {
        label: a.innerText,
        url: a.href,
        displayName: (
          container?.querySelector(".mtg-name") ??
          container?.querySelector(".mtg-names")
        )?.textContent?.trim(),
        editionName:
          container?.querySelector(".edition-name")?.textContent?.trim() ??
          null,
        imageUrl:
          image?.getAttribute("data-src") ?? image?.getAttribute("src") ?? null,
        available: /indispon[ií]vel/i.test(container?.textContent ?? "")
          ? false
          : price === null
            ? null
            : price > 0,
      };
    }),
  }));
  if (
    /captcha|just a moment|access denied|verifique que você é humano/i.test(
      data.title,
    )
  )
    throw new ApiError(
      503,
      "PORTAL_BLOCKED",
      "O portal exige verificação. Nenhuma tentativa de contorno foi feita.",
    );
  const candidates = data.links
    .filter((l) => {
      try {
        const u = new URL(l.url);
        return (
          u.protocol === "https:" &&
          !u.username &&
          !u.password &&
          !l.url.endsWith("#") &&
          u.hostname === "www.ligapokemon.com.br" &&
          ((u.searchParams.get("view") === "cards/card" &&
            !!u.searchParams.get("card")) ||
            (u.searchParams.get("view") === "prod/view" &&
              !!u.searchParams.get("pcode") &&
              !!u.searchParams.get("prod")))
        );
      } catch {
        return false;
      }
    })
    .map((l) => {
      const params = new URL(l.url).searchParams;
      const product = params.get("view") === "prod/view";
      const card = (product ? params.get("prod") : params.get("card"))!;
      return {
        ...l,
        kind: product ? ("product" as const) : ("card" as const),
        productCode: product ? params.get("pcode") : null,
        name: product ? card : card.replace(/\s*\([^)]*\)\s*$/, "").trim(),
        number: product
          ? ""
          : (embeddedCardNumber(card) ?? params.get("num") ?? ""),
        edition: params.get("ed") ?? "",
        imageUrl: l.imageUrl ? catalogImage(l.imageUrl) : null,
      };
    })
    .filter(
      (l, i, all) =>
        all.findIndex(
          (x) =>
            x.name === l.name &&
            x.number === l.number &&
            x.edition === l.edition,
        ) === i,
    );
  // A seleção usa exclusivamente links publicados pelo portal, nunca parâmetros inventados.
  if (!(await page.evaluate(() => Array.isArray(window.cards_stock)))) {
    const name = q.card
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim()
      .toLowerCase();
    const relevant = candidates.filter(
      (c) =>
        (c.name.toLowerCase().includes(name) ||
          c.displayName?.toLowerCase().includes(name)) &&
        (!q.number ||
          normalizeCardNumber(c.number) === normalizeCardNumber(q.number)),
    );
    const matching = relevant.filter(
      (c) => !q.edition || c.edition.toLowerCase() === q.edition.toLowerCase(),
    );
    if (matching.length === 1 && matching[0].kind === "card") {
      await limit.beforeRequest();
      const response = await page.goto(matching[0].url, { waitUntil: "domcontentloaded" });
      limit.check(response);
      await limit.checkBlocked(page);
    } else if (relevant.length)
      throw new ApiError(
        409,
        "AMBIGUOUS_CARD",
        "Selecione uma edição e um número.",
        matching.length ? matching : relevant,
      );
    else if (candidates.length)
      throw new ApiError(
        404,
        "CARD_NOT_FOUND",
        "Nenhuma carta corresponde ao nome e número informados.",
      );
    else if (
      /nenhum resultado|carta não encontrada|nenhuma carta/i.test(data.text)
    )
      throw new ApiError(404, "CARD_NOT_FOUND", "Carta não encontrada.");
  }
  const name = q.card.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const number =
    q.number ??
    embeddedCardNumber(q.card) ??
    embeddedCardNumber(await page.title()) ??
    null;
  const normalizedBody = bodyNumberText(await page.locator("body").innerText());
  // Confirma a identificação na página; não usa o pedido como prova de edição.
  const body = await page.locator("body").innerText();
  if (q.edition && !body.toLowerCase().includes(q.edition.toLowerCase()))
    throw new ApiError(
      409,
      "EDITION_UNVERIFIED",
      "Não foi possível confirmar a edição solicitada.",
      candidates,
    );
  if (
    !body.toLowerCase().includes(name.toLowerCase()) ||
    (number && !normalizedBody.includes(normalizeCardNumber(number)))
  )
    throw new ApiError(
      502,
      "CARD_UNVERIFIED",
      "A página não confirmou a identidade da carta.",
      candidates,
    );
  const editionLabels = await page
    .locator('.sigla-edition, #details-screen-rarity a[href*="ed="]')
    .allTextContents();
  const edition = [
    ...new Set(editionLabels.map((s) => s.trim()).filter(Boolean)),
  ];
  if (
    q.edition &&
    (edition.length !== 1 ||
      edition[0].toLowerCase() !== q.edition.toLowerCase())
  )
    throw new ApiError(
      409,
      "EDITION_UNVERIFIED",
      "A edição identificada não corresponde ao pedido.",
      candidates,
    );
  if (edition.length > 1)
    throw new ApiError(
      409,
      "AMBIGUOUS_CARD",
      "Mais de uma edição identificada.",
      candidates,
    );
  return { name, number, edition: edition[0] ?? null };
}
export async function loadCandidatePages(
  page: Page,
  limit = new PortalLimit(),
  maxPages = 100,
) {
  const more = page.locator('input[onclick*="mcards.nextPage"]').first();
  for (let count = 0; await more.isVisible(); count++) {
    if (count >= 100)
      throw new ApiError(
        422,
        "SEARCH_TOO_BROAD",
        "Refine a busca por nome, número ou edição.",
      );
    await limit.beforeRequest();
    const previous = await page.evaluate(
      () =>
        (window as unknown as { mcards?: { page: number } }).mcards?.page ?? 0,
    );
    const responsePromise = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/ajax/cards/main.php" &&
        response.request().method() === "POST",
      { timeout: 15000 },
    );
    await more.click();
    const response = await responsePromise;
    limit.check(response);
    if (!response.ok())
      throw new ApiError(
        502,
        "SEARCH_INCOMPLETE",
        "Não foi possível carregar as versões da carta. Tente novamente mais tarde.",
      );
    const data = (await response.json()) as {
      error?: unknown;
      nextPage?: string | number;
    };
    if (
      !response.ok() ||
      data.error ||
      !["0", "1"].includes(String(data.nextPage))
    )
      throw new ApiError(
        502,
        "SEARCH_INCOMPLETE",
        "Não foi possível carregar todas as versões da carta. Tente novamente.",
      );
    await page.waitForFunction(
      (previous) =>
        ((window as unknown as { mcards?: { page: number } }).mcards?.page ??
          0) > previous,
      previous,
      { timeout: 15000 },
    );
    if (String(data.nextPage) === "0") return;
    await more.waitFor({ state: "visible", timeout: 15000 });
    if (count + 1 >= maxPages) return;
  }
}
function bodyNumberText(text: string): string[] {
  return [
    ...text.matchAll(
      /[A-Za-z]*\d+[A-Za-z]*(?:\/(?:[A-Za-z]*\d+[A-Za-z]*|∞))?/g,
    ),
  ].map((match) => normalizeCardNumber(match[0]));
}
