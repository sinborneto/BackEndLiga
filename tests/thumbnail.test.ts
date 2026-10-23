import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { ThumbnailService } from "../src/services/thumbnail.service.js";
const url =
  "https://repositorio.sbrauble.com/arquivos/in/pokemon_bkp/cd/442/card.jpg";
it("gera miniatura WebP limitada e compartilha download e conversão de imagens repetidas", async () => {
  const source = await sharp({
    create: { width: 700, height: 980, channels: 3, background: "#355a32" },
  })
    .png()
    .toBuffer();
  const download = vi.fn(
    async () =>
      new Response(new Uint8Array(source), {
        headers: { "content-type": "image/png" },
      }),
  );
  const service = new ThumbnailService(download);
  const [a, b] = await Promise.all([service.get(url), service.get(url)]);
  const metadata = await sharp(a).metadata();
  expect(metadata).toMatchObject({ format: "webp", width: 240, height: 336 });
  expect(a.equals(b)).toBe(true);
  expect((await service.get(url)).equals(a)).toBe(true);
  expect(download).toHaveBeenCalledOnce();
});
it.each([
  "http://repositorio.sbrauble.com/arquivos/in/pokemon_bkp/cd/1/x.jpg",
  "https://example.com/x.jpg",
  "https://repositorio.sbrauble.com/secret",
  "https://user:pass@repositorio.sbrauble.com/arquivos/in/pokemon_bkp/cd/1/x.jpg",
])("rejeita origem e caminho não autorizados: %s", (source) => {
  const download = vi.fn();
  const service = new ThumbnailService(download);
  expect(() => service.get(source)).toThrow();
  expect(download).not.toHaveBeenCalled();
});
