import { z } from "zod";
export const cardChoiceSchema = z
  .object({
    name: z.string().min(1),
    number: z.string(),
    edition: z.string(),
    kind: z.enum(["card", "product"]).default("card"),
    available: z.boolean().nullable().optional(),
    productCode: z.string().nullable().optional(),
    displayName: z.string().optional(),
    editionName: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
    url: z.string().optional(),
  })
  .refine((choice) =>
    choice.kind === "product"
      ? !!choice.productCode && !!choice.url
      : !!choice.number && !!choice.edition,
  );
export type CardChoice = z.infer<typeof cardChoiceSchema>;
