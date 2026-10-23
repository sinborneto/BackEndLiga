// String normalization avoids precision loss for identifiers with many digits.
export function normalizeCardNumber(number: string): string {
  return number
    .split("/")
    .map((part) => part.replace(/^0+(?=\d)/, ""))
    .join("/")
    .toUpperCase();
}
export function cardNumberVariants(number: string): string[] {
  if (!/^\d+(?:\/\d+)?$/.test(number)) return [number];
  const parts = normalizeCardNumber(number).split("/");
  return [
    ...new Set(
      [1, 2, 3].map((width) =>
        parts.map((part) => part.padStart(width, "0")).join("/"),
      ),
    ),
  ];
}
export const cardNumberPattern =
  /^(?=[A-Za-z0-9/∞]*\d)[A-Za-z0-9]+(?:\/(?:[A-Za-z0-9]+|∞))?$/;
export function embeddedCardNumber(card: string): string | undefined {
  const value = /\(([^()]+)\)\s*$/.exec(card)?.[1];
  return value && cardNumberPattern.test(value) ? value : undefined;
}
