import sharp from "sharp";

export interface PdfPlacedImage {
  id: string;
  data: Buffer;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PendingImagePlacement {
  id: string;
  matrix: number[];
  width?: number;
  height?: number;
  inlineIndex?: number;
}

export async function extractPdfPlacedImages(
  pdfjs: any,
  page: any,
  layoutScale = 1
): Promise<PdfPlacedImage[]> {
  const viewport = page.getViewport({ scale: 1 });
  const operatorList = await page.getOperatorList();
  const ops = pdfjs.OPS;
  const placements: PendingImagePlacement[] = [];
  const matrixStack: number[][] = [];
  let currentMatrix = [1, 0, 0, 1, 0, 0];

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];

    if (fn === ops.save) {
      matrixStack.push([...currentMatrix]);
      continue;
    }
    if (fn === ops.restore) {
      currentMatrix = matrixStack.pop() || [1, 0, 0, 1, 0, 0];
      continue;
    }
    if (fn === ops.transform && Array.isArray(args)) {
      currentMatrix = pdfjs.Util.transform(currentMatrix, args);
      continue;
    }
    if (
      (fn === ops.paintImageXObject || fn === ops.paintJpegXObject) &&
      Array.isArray(args) &&
      typeof args[0] === "string"
    ) {
      placements.push({
        id: args[0],
        matrix: [...currentMatrix],
        width: Number(args[1]) || undefined,
        height: Number(args[2]) || undefined
      });
      continue;
    }
    if (fn === ops.paintInlineImageXObject && args?.[0]) {
      placements.push({
        id: `inline_${index}`,
        matrix: [...currentMatrix],
        width: Number(args[0].width) || undefined,
        height: Number(args[0].height) || undefined,
        inlineIndex: index
      });
      continue;
    }
    if (fn === ops.paintImageMaskXObject && args?.[0]) {
      placements.push({
        id: `mask_${index}`,
        matrix: [...currentMatrix],
        width: Number(args[0].width) || undefined,
        height: Number(args[0].height) || undefined,
        inlineIndex: index
      });
      continue;
    }
    if (
      fn === ops.paintImageXObjectRepeat &&
      Array.isArray(args) &&
      typeof args[0] === "string" &&
      Array.isArray(args[3])
    ) {
      for (let positionIndex = 0; positionIndex < args[3].length; positionIndex += 2) {
        placements.push({
          id: args[0],
          matrix: pdfjs.Util.transform(currentMatrix, [
            Number(args[1]) || 1,
            0,
            0,
            Number(args[2]) || 1,
            Number(args[3][positionIndex]) || 0,
            Number(args[3][positionIndex + 1]) || 0
          ]),
          width: undefined,
          height: undefined
        });
      }
    }
  }

  const images: PdfPlacedImage[] = [];
  for (const placement of placements) {
    try {
      const image =
        placement.inlineIndex !== undefined && operatorList.argsArray[placement.inlineIndex]?.[0]
          ? operatorList.argsArray[placement.inlineIndex][0]
          : await getPageImageObject(page, placement.id);
      if (!image?.data || !image.width || !image.height) continue;

      const data = await encodePdfImageAsPng(image, pdfjs);
      if (!data) continue;
      const box = getViewportBox(pdfjs, viewport, placement.matrix, layoutScale);
      if (box.width < 1 || box.height < 1) continue;

      images.push({
        id: placement.id,
        data,
        ...box
      });
    } catch {
      continue;
    }
  }

  return images;
}

function getPageImageObject(page: any, id: string): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      page.objs.get(id, resolve);
    } catch (error) {
      reject(error);
    }
  });
}

async function encodePdfImageAsPng(image: any, pdfjs: any): Promise<Buffer | undefined> {
  const normalized = normalizePdfImageData(image, pdfjs);
  if (!normalized) return undefined;
  const { data, channels } = normalized;
  if (!channels) return undefined;

  return sharp(data, {
    raw: {
      width: image.width,
      height: image.height,
      channels
    }
  })
    .png()
    .toBuffer();
}

function normalizePdfImageData(image: any, pdfjs: any): { data: Buffer; channels: 1 | 3 | 4 } | undefined {
  const width = Number(image.width);
  const height = Number(image.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return undefined;
  const source = Buffer.from(image.data || []);
  const pixelCount = width * height;
  if (image.kind === pdfjs.ImageKind.RGBA_32BPP && source.length >= pixelCount * 4) {
    return { data: source.subarray(0, pixelCount * 4), channels: 4 };
  }
  if (image.kind === pdfjs.ImageKind.RGB_24BPP && source.length >= pixelCount * 3) {
    return { data: source.subarray(0, pixelCount * 3), channels: 3 };
  }
  if (image.kind === pdfjs.ImageKind.GRAYSCALE_1BPP) {
    return { data: unpackOneBitGrayImage(source, width, height), channels: 1 };
  }

  if (source.length >= pixelCount * 4) return { data: source.subarray(0, pixelCount * 4), channels: 4 };
  if (source.length >= pixelCount * 3) return { data: source.subarray(0, pixelCount * 3), channels: 3 };
  if (source.length >= pixelCount) return { data: source.subarray(0, pixelCount), channels: 1 };
  if (source.length >= Math.ceil(pixelCount / 8)) return { data: unpackOneBitGrayImage(source, width, height), channels: 1 };
  return undefined;
}

function unpackOneBitGrayImage(source: Buffer, width: number, height: number): Buffer {
  const output = Buffer.alloc(width * height);
  const rowStride = Math.ceil(width / 8);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowStride;
    for (let x = 0; x < width; x += 1) {
      const byte = source[rowOffset + Math.floor(x / 8)] || 0;
      const bit = (byte >> (7 - (x % 8))) & 1;
      output[y * width + x] = bit ? 255 : 0;
    }
  }
  return output;
}

function getViewportBox(
  pdfjs: any,
  viewport: any,
  matrix: number[],
  layoutScale: number
): Pick<PdfPlacedImage, "x" | "y" | "width" | "height"> {
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ]
    .map((point) => pdfjs.Util.applyTransform(point, matrix))
    .map((point) => pdfjs.Util.applyTransform(point, viewport.transform));
  const xs = corners.map((point) => point[0] * layoutScale);
  const ys = corners.map((point) => point[1] * layoutScale);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}
