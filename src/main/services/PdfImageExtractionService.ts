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
    if (fn === ops.paintImageXObject && Array.isArray(args) && typeof args[0] === "string") {
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
        height: Number(args[0].height) || undefined
      });
    }
  }

  const images: PdfPlacedImage[] = [];
  for (const placement of placements) {
    const image =
      placement.id.startsWith("inline_") && operatorList.argsArray[Number(placement.id.slice(7))]?.[0]
        ? operatorList.argsArray[Number(placement.id.slice(7))][0]
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
  const channels = getImageChannels(image, pdfjs);
  if (!channels) return undefined;

  return sharp(Buffer.from(image.data), {
    raw: {
      width: image.width,
      height: image.height,
      channels
    }
  })
    .png()
    .toBuffer();
}

function getImageChannels(image: any, pdfjs: any): 1 | 3 | 4 | undefined {
  if (image.kind === pdfjs.ImageKind.RGBA_32BPP) return 4;
  if (image.kind === pdfjs.ImageKind.RGB_24BPP) return 3;

  const pixelCount = Number(image.width) * Number(image.height);
  const dataLength = Number(image.data?.length) || 0;
  if (dataLength === pixelCount * 4) return 4;
  if (dataLength === pixelCount * 3) return 3;
  if (dataLength === pixelCount) return 1;
  return undefined;
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
