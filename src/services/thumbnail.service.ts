import sharp from "sharp";
import { ApiError } from "../types/card.types.js";
export class ThumbnailService {
  private readonly cache = new Map<string, Buffer>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private bytes = 0;
  constructor(private readonly download: typeof fetch = fetch) {}
  get(source: string): Promise<Buffer> {
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw new ApiError(400, "INVALID_IMAGE", "Imagem inválida.");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "repositorio.sbrauble.com" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      !/^\/+arquivos\/(?:in\/pokemon_bkp\/(?:cd|ed)\/|up\/prod\/).+\.(?:jpe?g|png|webp)$/i.test(
        url.pathname,
      )
    )
      throw new ApiError(
        400,
        "INVALID_IMAGE",
        "Origem de imagem não permitida.",
      );
    const key = url.href;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const job = this.render(key)
      .then((buffer) => {
        while (
          this.bytes + buffer.length > 20 * 1024 * 1024 &&
          this.cache.size
        ) {
          const first = this.cache.keys().next().value!;
          this.bytes -= this.cache.get(first)!.length;
          this.cache.delete(first);
        }
        this.cache.set(key, buffer);
        this.bytes += buffer.length;
        return buffer;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }
  private async render(url: string) {
    if (this.active >= 2) {
      if (this.queue.length >= 40)
        throw new ApiError(
          503,
          "IMAGE_BUSY",
          "Aguarde o carregamento das imagens.",
        );
      await new Promise<void>((resolve) => this.queue.push(resolve));
    } else this.active++;
    try {
      const response = await this.download(url, {
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
      if (
        !response.ok ||
        !response.body ||
        !/^image\/(?:jpeg|png|webp)/i.test(
          response.headers.get("content-type") ?? "",
        )
      )
        throw new ApiError(502, "IMAGE_UNAVAILABLE", "Imagem indisponível.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new ApiError(413, "IMAGE_TOO_LARGE", "Imagem muito grande.");
        }
        chunks.push(part.value);
      }
      return await sharp(Buffer.concat(chunks), { limitInputPixels: 16000000 })
        .rotate()
        .resize({
          width: 240,
          height: 336,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 78, effort: 3 })
        .toBuffer();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}
