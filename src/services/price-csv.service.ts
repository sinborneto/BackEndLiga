import { z } from "zod";
import { ApiError } from "../types/card.types.js";
import type { EditionCards } from "./catalog.service.js";

// Layout copied from the store's "Exportar estoque" CSV (30C, 26/10/2026):
// UTF-8 without BOM, CRLF between records, line breaks inside quoted headers.
export const csvLanguages = [
  "DE", "TW", "TK", "ES", "FR", "ID", "EN", "IT", "JP", "KO", "PL", "PT", "PTEN", "RU", "TH",
] as const;
export const csvQualities = ["M", "NM", "SP", "MP", "HP", "D"] as const;
export const csvExtras = [
  ["foil", "xls1", "Foil"],
  ["signed", "xls4", "Assinada"],
  ["promo", "xls7", "Promo"],
  ["textless", "xls8", "Textless"],
  ["altered", "xls5", "Alterada"],
  ["preRelease", "xls9", "Pre Release"],
  ["reverseFoil", "xls13", "Reverse Foil"],
  ["editionOne", "xls14", "Edition One"],
  ["shadowless", "xls15", "Shadowless"],
  ["oversize", "xls6", "Oversize"],
  ["staff", "xls26", "Staff"],
  ["misprint", "xls44", "Misprint"],
  ["shatteredHolo", "xls51", "Shattered Holo"],
  ["masterBall", "xls69", "Master Ball"],
  ["pokeballFoil", "xls70", "Pokeball Foil"],
] as const;
type ExtraKey = (typeof csvExtras)[number][0];
const text = z.string().trim().min(1).max(200);
const extraKeys = csvExtras.map(([key]) => key) as [ExtraKey, ...ExtraKey[]];

export const priceCsvSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            cardId: z.string().regex(/^\d{1,6}-\d{1,9}-[^\s,"]{1,20}$/),
            language: z.enum(csvLanguages).or(z.literal("")),
            quality: z.enum(csvQualities).or(z.literal("")),
            price: z.number().positive().max(1_000_000),
            existing: z.number().int().nonnegative().nullable().default(null),
            quantity: z.number().int().nullable().default(null),
            extras: z.array(z.enum(extraKeys)).max(csvExtras.length).default([]),
            stock: z.string().trim().max(60).default("Estoque Indefinido"),
            // Columns copied from the store export; used only when the catalog is unavailable.
            card: z
              .object({
                name: text,
                nameEn: text,
                rarity: z.string().trim().max(80),
                color: z.string().trim().max(40),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      // The store processes only the first thousand lines of each upload.
      .max(1000),
    edition: z
      .object({ code: z.string().trim().min(1).max(40), name: text })
      .strict()
      .optional(),
  })
  .strict();
export type PriceCsvInput = z.infer<typeof priceCsvSchema>;

// Rebuilds the edition from the export columns sent by the client.
export function exportedEdition(
  id: string,
  input: PriceCsvInput,
): EditionCards | null {
  if (!input.edition || input.rows.some((row) => !row.card)) return null;
  return {
    edition: {
      id,
      code: input.edition.code,
      name: input.edition.name,
      nameEn: input.edition.name,
      year: 0,
      releasedAt: null,
      parentId: null,
      imageUrl: null,
      url: "https://www.ligapokemon.com.br/",
    },
    cards: [
      ...new Map(
        input.rows.map((row) => [
          row.cardId,
          {
            id: row.cardId,
            name: row.card!.name,
            nameEn: row.card!.nameEn,
            number: row.cardId.split("-").slice(2).join("-"),
            rarity: row.card!.rarity || null,
            energies: row.card!.color ? [row.card!.color] : [],
            imageUrl: null,
            minPrice: null,
            maxPrice: null,
            url: "https://www.ligapokemon.com.br/",
          },
        ]),
      ).values(),
    ],
    collectedAt: new Date().toISOString(),
  };
}

// The export writes card names without diacritics ("Substituicao", "Poke Tablet").
export const plainName = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const price = (value: number) => value.toFixed(2).replace(".", ",");
export function buildPriceCsv(data: EditionCards, input: PriceCsvInput): string {
  const cards = new Map(data.cards.map((card) => [card.id, card]));
  if (input.rows.some((row) => !row.cardId.startsWith(`${data.edition.id}-`)))
    throw new ApiError(
      400,
      "UNKNOWN_CARDS",
      "Há cartas que não pertencem a esta edição.",
    );
  const unknown = input.rows.filter((row) => !cards.has(row.cardId));
  if (unknown.length)
    throw new ApiError(
      400,
      "UNKNOWN_CARDS",
      "Há cartas que não pertencem a esta edição.",
      unknown.map((row) => row.cardId),
    );
  const header = [
    ",".repeat(15) + csvExtras.map(([, code]) => quote(code)).join(","),
    [
      "Tipo", "Edição ID", "Edição Sigla", "Carta ID", "Número", "Edição", "Raridade", "Cor",
      "Nome da Carta", "Nome da Carta EN",
      "Idioma\n(DE, TW, TK, ES, FR, ID, EN, IT, JP, KO, PL, PT, PTEN, RU, TH)",
      "Qualidade\n(M, NM, SP, MP, HP, D)",
      "Quantidade Existente", "Quantidade Para Somar/Subtrair", "Preço",
      ...csvExtras.map(([, , label]) => `${label}\n(0 ou 1)`),
      "Estoque",
    ]
      .map(quote)
      .join(","),
  ];
  const lines = input.rows.map((row) => {
    const card = cards.get(row.cardId)!;
    const [, , ligaId, number] = /^(\d+)-(\d+)-(.+)$/.exec(row.cardId)!;
    return [
      quote("2"),
      quote(data.edition.id),
      quote(data.edition.code),
      quote(ligaId),
      quote(number),
      quote(data.edition.name),
      quote(card.rarity ?? ""),
      quote(card.energies[0] ?? ""),
      quote(plainName(card.name)),
      quote(plainName(card.nameEn)),
      quote(row.language),
      quote(row.quality),
      quote(row.existing === null ? "" : String(row.existing)),
      row.quantity === null ? "" : quote(String(row.quantity)),
      quote(price(row.price)),
      ...csvExtras.map(([key]) => quote(row.extras.includes(key) ? "1" : "")),
      quote(row.stock),
    ].join(",");
  });
  return [...header, ...lines].join("\r\n") + "\r\n";
}
