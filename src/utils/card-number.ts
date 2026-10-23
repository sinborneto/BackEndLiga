// String normalization avoids precision loss for identifiers with many digits.
export function normalizeCardNumber(number: string): string {
  return number.split("/").map(part => part.replace(/^0+(?=\d)/, "")).join("/");
}
export function cardNumberVariants(number: string): string[] {
  const parts = normalizeCardNumber(number).split("/");
  return [...new Set([1, 2, 3].map(width => parts.map(part => part.padStart(width, "0")).join("/")))];
}
