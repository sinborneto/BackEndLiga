import type { Page } from "playwright";
import { ApiError, type CardQuery } from "../types/card.types.js";
import { normalizeCardNumber } from "../utils/card-number.js";
export function buildCardUrl(card: string) {
  const url = new URL("https://www.ligapokemon.com.br/");
  url.search = new URLSearchParams({
    view: "cards/card",
    tipo: "1",
    card,
  }).toString();
  return url.href;
}
export async function extractCardMedia(page: Page) {
  const image = await page.evaluate(() => document.querySelector<HTMLImageElement>("#featuredImage")?.getAttribute("src") ?? null);
  const allowedUrl = (value: string | null, hosts: string[]) => {
    if (!value) return null;
    try {
      const url = new URL(value, page.url());
      return url.protocol === "https:" && hosts.includes(url.hostname) && !url.username && !url.password
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  const url = allowedUrl(page.url(), ["www.ligapokemon.com.br", "ligapokemon.com.br"]);
  const parsed = url ? new URL(url) : null;
  return {
    imageUrl: allowedUrl(image, ["repositorio.sbrauble.com", "www.ligapokemon.com.br", "ligapokemon.com.br"]),
    url: parsed && ["cards/card", "cards/search"].includes(parsed.searchParams.get("view") ?? "") && parsed.searchParams.get("card") ? url : null,
  };
}
export async function resolveCard(page: Page, q: CardQuery) {
  const data = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText,
    links: Array.from(
      document.querySelectorAll<HTMLAnchorElement>("a[href]"),
    ).map((a) => ({ label: a.innerText, url: a.href })),
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
          u.hostname === "www.ligapokemon.com.br" &&
          u.searchParams.get("view") === "cards/card" &&
          !!u.searchParams.get("card")
        );
      } catch {
        return false;
      }
    })
    .filter((l, i, all) => all.findIndex((x) => x.url === l.url) === i);
  // A seleção usa exclusivamente links publicados pelo portal, nunca parâmetros inventados.
  if (!(await page.evaluate(() => Array.isArray(window.cards_stock)))) {
    const matching = candidates.filter(
      (c) =>
        (!q.edition ||
          c.label.toLowerCase().includes(q.edition.toLowerCase()) ||
          new URL(c.url).searchParams.get("ed") === q.edition) &&
        (!q.number || [...c.label.matchAll(/\d+(?:\/\d+)?/g)].some(match => normalizeCardNumber(match[0]) === normalizeCardNumber(q.number!))),
    );
    if (matching.length === 1) {
      await page.goto(matching[0].url, { waitUntil: "domcontentloaded" });
    } else if (candidates.length)
      throw new ApiError(
        409,
        "AMBIGUOUS_CARD",
        "Selecione uma edição e um número.",
        candidates,
      );
    else if (
      /nenhum resultado|carta não encontrada|nenhuma carta/i.test(data.text)
    )
      throw new ApiError(404, "CARD_NOT_FOUND", "Carta não encontrada.");
  }
  const name = q.card.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const number =
    q.number ??
    /\((\d+\/\d+)\)/.exec(q.card)?.[1] ??
    /\((\d+\/\d+)\)/.exec(await page.title())?.[1] ??
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
function bodyNumberText(text: string): string[] {
  return [...text.matchAll(/\d+(?:\/\d+)?/g)].map(match => normalizeCardNumber(match[0]));
}
