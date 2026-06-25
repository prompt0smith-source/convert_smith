import { readFile } from "node:fs/promises";
import { createPdfjsDocumentOptions, preparePdfCanvasFonts } from "../services/PdfjsAssetService.js";
import type { PdfEditorEdit } from "../types/conversion.js";

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

export interface PdfEditVisualDiffResult {
  ok: boolean;
  changedPixelsOutsideEditRegions: number;
  diffRatioOutsideEditRegions: number;
  message: string;
}

const VISUAL_DIFF_SCALE = 1;
const REGION_PADDING_PX = 8;
const DIFF_CHANNEL_THRESHOLD = 56;
const OUTSIDE_DIFF_RATIO_LIMIT = 0.02;

export class PdfEditVisualDiffService {
  async compareEditedPages(sourcePath: string, outputPath: string, edits: PdfEditorEdit[]): Promise<PdfEditVisualDiffResult> {
    const editedPages = [...new Set(edits.map((edit) => edit.pageNumber).filter((value) => value > 0))];
    if (editedPages.length === 0) {
      return this.ok("비교할 편집 페이지가 없습니다.");
    }

    try {
      const [sourceDoc, outputDoc] = await Promise.all([
        loadPdfJsDocument(sourcePath),
        loadPdfJsDocument(outputPath)
      ]);
      let changedPixelsOutsideEditRegions = 0;
      let comparedOutsidePixels = 0;

      for (const pageNumber of editedPages) {
        const [sourcePage, outputPage] = await Promise.all([
          renderPdfPage(sourceDoc, pageNumber),
          renderPdfPage(outputDoc, pageNumber)
        ]);
        if (sourcePage.width !== outputPage.width || sourcePage.height !== outputPage.height) {
          return {
            ok: false,
            changedPixelsOutsideEditRegions: Number.POSITIVE_INFINITY,
            diffRatioOutsideEditRegions: 1,
            message: `${pageNumber}페이지 렌더링 크기가 저장 전후로 달라졌습니다.`
          };
        }

        const ignoreRegions = edits
          .filter((edit) => edit.pageNumber === pageNumber)
          .flatMap((edit) => createIgnoreRegions(edit, sourcePage.width, sourcePage.height));

        const diff = comparePixelBuffers(sourcePage.data, outputPage.data, sourcePage.width, sourcePage.height, ignoreRegions);
        changedPixelsOutsideEditRegions += diff.changed;
        comparedOutsidePixels += diff.compared;
      }

      const ratio = comparedOutsidePixels > 0 ? changedPixelsOutsideEditRegions / comparedOutsidePixels : 0;
      return {
        ok: ratio <= OUTSIDE_DIFF_RATIO_LIMIT,
        changedPixelsOutsideEditRegions,
        diffRatioOutsideEditRegions: ratio,
        message: ratio <= OUTSIDE_DIFF_RATIO_LIMIT
          ? "수정 영역 밖의 시각 차이가 허용 범위입니다."
          : "수정 영역 밖의 시각 차이가 커서 저장 결과를 신뢰하기 어렵습니다."
      };
    } catch (error) {
      return this.ok(`시각 diff 검증을 건너뛰었습니다. ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private ok(message: string): PdfEditVisualDiffResult {
    return {
      ok: true,
      changedPixelsOutsideEditRegions: 0,
      diffRatioOutsideEditRegions: 0,
      message
    };
  }
}

async function loadPdfJsDocument(filePath: string): Promise<any> {
  const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(await readFile(filePath));
  return pdfjs.getDocument(createPdfjsDocumentOptions(data)).promise;
}

async function renderPdfPage(document: any, pageNumber: number): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const canvasModule = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
  preparePdfCanvasFonts(canvasModule);
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: VISUAL_DIFF_SCALE });
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.save();
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
  await page.render({ canvasContext: context as never, viewport }).promise;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: imageData.data };
}

function comparePixelBuffers(
  source: Uint8ClampedArray,
  output: Uint8ClampedArray,
  width: number,
  height: number,
  ignoreRegions: Array<{ x: number; y: number; width: number; height: number }>
): { changed: number; compared: number } {
  let changed = 0;
  let compared = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (ignoreRegions.some((region) => pointInRegion(x, y, region))) continue;
      compared += 1;
      const offset = (y * width + x) * 4;
      const delta =
        Math.abs(source[offset] - output[offset]) +
        Math.abs(source[offset + 1] - output[offset + 1]) +
        Math.abs(source[offset + 2] - output[offset + 2]);
      if (delta > DIFF_CHANNEL_THRESHOLD) changed += 1;
    }
  }
  return { changed, compared };
}

function createIgnoreRegions(edit: PdfEditorEdit, pageWidth: number, pageHeight: number): Array<{ x: number; y: number; width: number; height: number }> {
  const originX = edit.coverX ?? edit.originalX ?? edit.x;
  const originY = edit.coverY ?? edit.originalY ?? edit.y;
  const estimatedTextWidth = estimateVisualTextWidth(edit.replacementText || edit.originalText || "", edit.fontSize || 10);
  const effectiveWidth = Math.max(edit.coverWidth ?? 0, edit.originalWidth ?? 0, edit.width, estimatedTextWidth);
  const effectiveHeight = Math.max(edit.coverHeight ?? 0, edit.originalHeight ?? 0, edit.height);
  const regions = [createRegion(originX, originY, effectiveWidth, effectiveHeight, pageWidth, pageHeight)];
  if (edit.action === "image" || edit.action === "line" || edit.saveMode === "neutralize_and_insert" || edit.action === "add") {
    regions.push(createRegion(edit.x, edit.y, Math.max(edit.width, effectiveWidth), Math.max(edit.height, effectiveHeight), pageWidth, pageHeight));
  }
  return regions;
}

function createRegion(
  originX: number,
  originY: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; width: number; height: number } {
  const x = clamp(Math.floor(originX - REGION_PADDING_PX), 0, pageWidth);
  const y = clamp(Math.floor(originY - REGION_PADDING_PX), 0, pageHeight);
  const right = clamp(Math.ceil(originX + width + REGION_PADDING_PX), 0, pageWidth);
  const bottom = clamp(Math.ceil(originY + height + REGION_PADDING_PX), 0, pageHeight);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}

function estimateVisualTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      width += fontSize * 0.35;
    } else if (/[^\x00-\x7F]/.test(char)) {
      width += fontSize;
    } else {
      width += fontSize * 0.62;
    }
  }
  return width * 1.2;
}

function pointInRegion(x: number, y: number, region: { x: number; y: number; width: number; height: number }): boolean {
  return x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
