import { PNG } from "pngjs";
import { createHash } from "node:crypto";
export function fingerprint(
  buffer: Buffer,
  position: string,
  width: string,
  height: string,
  size: string,
): string | undefined {
  if (size !== "auto") return;
  const xy = /^(-?\d+)px (-?\d+)px$/.exec(position);
  if (!xy) return;
  const x = -Number(xy[1]),
    y = -Number(xy[2]),
    w = Number.parseInt(width),
    h = Number.parseInt(height);
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) return;
  try {
    const png = PNG.sync.read(buffer);
    if (x < 0 || y < 0 || x + w > png.width || y + h > png.height) return;
    const pixels = Buffer.alloc(w * h * 4);
    for (let row = 0; row < h; row++)
      png.data.copy(
        pixels,
        row * w * 4,
        ((y + row) * png.width + x) * 4,
        ((y + row) * png.width + x + w) * 4,
      );
    return createHash("sha256")
      .update(`${w}x${h}:`)
      .update(pixels)
      .digest("hex");
  } catch {
    return;
  }
}
