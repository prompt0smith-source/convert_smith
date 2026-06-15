import sharp from "sharp";
import { preparePdfCanvasFonts } from "./PdfjsAssetService.js";
import type { PdfPlacedImage } from "./PdfImageExtractionService.js";
import type { PdfReadingOrderLine } from "./PdfReadingOrderService.js";

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;
const BACKDROP_RENDER_SCALE = 2;

interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export async function renderPdfGraphicsBackdrop(
  page: any,
  textItems: PdfReadingOrderLine[],
  images: PdfPlacedImage[],
  layoutScale: number
): Promise<Buffer> {
  const { rendered, data, info } = await renderPageToRaw(page);
  const textMaskRects = textItems.map((item) => applyRenderedTextColor(data, info.width, info.height, item, layoutScale));
  const imageMaskRects = images.map((image) =>
    createMaskRect(data, info.width, info.height, toPixelBox(image, layoutScale, 4))
  );
  const maskRects = [...textMaskRects, ...imageMaskRects];
  if (maskRects.length === 0) return rendered;

  return sharp(rendered)
    .composite([
      {
        input: Buffer.from(createMaskSvg(info.width, info.height, maskRects))
      }
    ])
    .png()
    .toBuffer();
}

export async function applyPdfRenderedTextColors(
  page: any,
  textItems: PdfReadingOrderLine[],
  layoutScale: number
): Promise<void> {
  const { data, info } = await renderPageToRaw(page);
  for (const item of textItems) {
    applyRenderedTextColor(data, info.width, info.height, item, layoutScale);
  }
}

async function renderPageToRaw(
  page: any
): Promise<{ rendered: Buffer; data: Buffer; info: { width: number; height: number } }> {
  const canvasModule = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
  preparePdfCanvasFonts(canvasModule);
  const { createCanvas } = canvasModule;
  const viewport = page.getViewport({ scale: BACKDROP_RENDER_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  await page.render({
    canvasContext: context as never,
    viewport
  }).promise;

  const rendered = canvas.toBuffer("image/png");
  const { data, info } = await sharp(rendered).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rendered, data, info };
}

function applyRenderedTextColor(
  raw: Buffer,
  width: number,
  height: number,
  item: PdfReadingOrderLine,
  layoutScale: number
): PixelBox & Rgb {
  const rect = createMaskRect(raw, width, height, toPixelBox(item, layoutScale, 2));
  item.color = item.color || sampleForegroundColor(raw, width, height, rect) || getContrastingTextColor(rect);
  return rect;
}

function createMaskRect(raw: Buffer, width: number, height: number, box: PixelBox): PixelBox & Rgb {
  const clamped = clampPixelBox(box, width, height);
  return {
    ...clamped,
    ...sampleBackgroundColor(raw, width, height, clamped)
  };
}

function toPixelBox(
  box: Pick<PdfReadingOrderLine, "x" | "y" | "width" | "height">,
  layoutScale: number,
  padding: number
): PixelBox {
  const scale = BACKDROP_RENDER_SCALE / Math.max(layoutScale, 0.0001);
  return {
    x: Math.floor(box.x * scale - padding),
    y: Math.floor(box.y * scale - padding),
    width: Math.ceil(box.width * scale + padding * 2),
    height: Math.ceil(box.height * scale + padding * 2)
  };
}

function sampleBackgroundColor(raw: Buffer, width: number, height: number, box: PixelBox): Rgb {
  const samples: Rgb[] = [];
  const points = [
    [box.x - 2, box.y - 2],
    [box.x + box.width + 1, box.y - 2],
    [box.x - 2, box.y + box.height + 1],
    [box.x + box.width + 1, box.y + box.height + 1],
    [box.x + Math.round(box.width / 2), box.y - 2],
    [box.x + Math.round(box.width / 2), box.y + box.height + 1]
  ];

  for (const [x, y] of points) {
    samples.push(readPixel(raw, width, height, x, y));
  }

  return {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b))
  };
}

function readPixel(raw: Buffer, width: number, height: number, x: number, y: number): Rgb {
  const clampedX = clamp(Math.round(x), 0, width - 1);
  const clampedY = clamp(Math.round(y), 0, height - 1);
  const offset = (clampedY * width + clampedX) * 4;
  return {
    r: raw[offset],
    g: raw[offset + 1],
    b: raw[offset + 2]
  };
}

function createMaskSvg(width: number, height: number, rects: Array<PixelBox & Rgb>): string {
  const body = rects
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(
      (rect) =>
        `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" fill="${toHexColor(rect)}"/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;
}

function toHexColor({ r, g, b }: Rgb): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getContrastingTextColor({ r, g, b }: Rgb): string {
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance < 210 ? "FFFFFF" : "000000";
}

function sampleForegroundColor(raw: Buffer, width: number, height: number, box: PixelBox & Rgb): string | undefined {
  const clamped = clampPixelBox(box, width, height);
  if (clamped.width < 1 || clamped.height < 1) return undefined;

  const maxSamples = 5000;
  const step = Math.max(1, Math.floor(Math.sqrt((clamped.width * clamped.height) / maxSamples)));
  const pixels: Array<Rgb & { distance: number }> = [];

  for (let y = clamped.y; y < clamped.y + clamped.height; y += step) {
    for (let x = clamped.x; x < clamped.x + clamped.width; x += step) {
      const pixel = readPixel(raw, width, height, x, y);
      const distance = colorDistance(pixel, box);
      if (distance >= 28) pixels.push({ ...pixel, distance });
    }
  }

  if (pixels.length < 2) return undefined;

  pixels.sort((a, b) => b.distance - a.distance);
  const selected = pixels.slice(0, Math.max(2, Math.ceil(pixels.length * 0.45)));
  return `${toHex(median(selected.map((pixel) => pixel.r)))}${toHex(
    median(selected.map((pixel) => pixel.g))
  )}${toHex(median(selected.map((pixel) => pixel.b)))}`;
}

function colorDistance(a: Rgb, b: Rgb): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

function toHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
}

function clampPixelBox(box: PixelBox, width: number, height: number): PixelBox {
  const x = clamp(box.x, 0, width);
  const y = clamp(box.y, 0, height);
  const right = clamp(box.x + box.width, 0, width);
  const bottom = clamp(box.y + box.height, 0, height);
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y)
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 255;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
