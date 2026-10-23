import { ApiError, type CardQuery, type Result } from "../types/card.types.js";
import {
  cardNumberVariants,
  normalizeCardNumber,
  embeddedCardNumber,
} from "../utils/card-number.js";
import { cardChoiceSchema, type CardChoice } from "../types/card-choice.js";

export async function collectNumberVariants(
  query: CardQuery,
  collect: (query: CardQuery) => Promise<Result>,
): Promise<Result> {
  const number = query.number ?? embeddedCardNumber(query.card);
  if (!number) return collect(query);
  const name = query.card.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const outcomes = await Promise.allSettled(
    cardNumberVariants(number).map((number) =>
      collect({ ...query, card: `${name} (${number})`, number }),
    ),
  );
  const successes = outcomes.flatMap((outcome) =>
    outcome.status === "fulfilled" ? [outcome.value] : [],
  );
  const failures: unknown[] = outcomes.flatMap((outcome) =>
    outcome.status === "rejected" ? [outcome.reason as unknown] : [],
  );
  const blocked = failures.find(
    (error) => error instanceof ApiError && error.code === "PORTAL_BLOCKED",
  );
  if (blocked) throw blocked;
  const choices = [
    ...failures.flatMap((error) =>
      error instanceof ApiError &&
      error.status === 409 &&
      Array.isArray(error.details)
        ? error.details
        : [],
    ),
    ...successes.map((result) => result.card),
  ].flatMap((item: unknown) => {
    const parsed = cardChoiceSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
  const unique = [
    ...new Map(
      choices.map((choice: CardChoice) => [
        JSON.stringify([
          choice.name.toLowerCase(),
          normalizeCardNumber(choice.number),
          choice.edition.toLowerCase(),
        ]),
        choice,
      ]),
    ).values(),
  ];
  if (unique.length > 1 || (!successes.length && unique.length))
    throw new ApiError(
      409,
      "AMBIGUOUS_CARD",
      "Escolha a versão da carta para consultar as ofertas.",
      unique,
    );
  if (!successes.length)
    throw (
      failures.find(
        (error) => !(error instanceof ApiError) || error.status !== 404,
      ) ?? failures[0]
    );
  const identities = new Set(
    successes.map((result) =>
      JSON.stringify([
        result.card.name.trim().toLowerCase(),
        result.card.number ? normalizeCardNumber(result.card.number) : null,
        result.card.edition?.toLowerCase() ?? null,
      ]),
    ),
  );
  if (identities.size > 1)
    throw new ApiError(
      409,
      "AMBIGUOUS_CARD",
      "As variações de numeração identificaram cartas ou edições diferentes. Informe a edição.",
      successes.map((result) => result.card),
    );
  // Each response remains intact; never merge offers from different lookups.
  return successes[0];
}
