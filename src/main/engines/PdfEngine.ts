import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import type { PdfImageFormat, PdfPageSize } from "../types/conversion.js";

type ProgressCallback = (progress: number, message: string) => void;
type CreateNamedOutputPath = (baseName: string, extension: string) => Promise<string>;
const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

export class PdfEngine {
  async imagesToPdf(
    inputPaths: string[],
    outputPath: string,
    pageSize: PdfPageSize,
    onProgress: ProgressCallback
  ): Promise<void> {
    const pdfDoc = await PDFDocument.create();

    for (const [index, inputPath] of inputPaths.entries()) {
      onProgress(
        Math.round((index / Math.max(1, inputPaths.length)) * 80) + 5,
        `이미지 ${index + 1}/${inputPaths.length}장을 PDF에 추가하는 중입니다.`
      );
      const imageBytes = await readFile(inputPath);
      const metadata = await sharp(imageBytes).metadata();
      const width = metadata.width || 595;
      const height = metadata.height || 842;
      const extension = path.extname(inputPath).toLowerCase();
      const embeddedImage =
        extension === ".png"
          ? await pdfDoc.embedPng(imageBytes)
          : await pdfDoc.embedJpg(await sharp(imageBytes).jpeg({ quality: 95 }).toBuffer());
      const [pageWidth, pageHeight] = this.resolvePageSize(pageSize, width, height);
      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      const scaled = embeddedImage.scaleToFit(pageWidth, pageHeight);
      page.drawImage(embeddedImage, {
        x: (pageWidth - scaled.width) / 2,
        y: (pageHeight - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height
      });
    }

    const bytes = await pdfDoc.save();
    await writeFile(outputPath, bytes);
    onProgress(95, "PDF 파일을 저장했습니다.");
  }

  async pdfToImages(
    inputPath: string,
    imageFormat: PdfImageFormat,
    scale: 1 | 2 | 3,
    quality: number,
    createOutputPath: CreateNamedOutputPath,
    onProgress: ProgressCallback
  ): Promise<string[]> {
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
    const data = new Uint8Array(await readFile(inputPath));
    const document = await pdfjs.getDocument({ data }).promise;
    const baseName = path.basename(inputPath, path.extname(inputPath));
    const outputPaths: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(
        Math.round(((pageNumber - 1) / Math.max(1, document.numPages)) * 85) + 5,
        `PDF ${pageNumber}/${document.numPages}페이지를 이미지로 렌더링 중입니다.`
      );
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context as never,
        viewport
      }).promise;

      const pageSuffix = String(pageNumber).padStart(3, "0");
      const outputPath = await createOutputPath(`${baseName}_page_${pageSuffix}`, imageFormat);
      const pngBuffer = canvas.toBuffer("image/png");
      const outputBuffer =
        imageFormat === "jpg"
          ? await sharp(pngBuffer).flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer()
          : pngBuffer;
      await writeFile(outputPath, outputBuffer);
      outputPaths.push(outputPath);
    }

    onProgress(95, "PDF 페이지 이미지를 저장했습니다.");
    return outputPaths;
  }

  private resolvePageSize(pageSize: PdfPageSize, imageWidth: number, imageHeight: number): [number, number] {
    if (pageSize === "a4_portrait") return A4_PORTRAIT;
    if (pageSize === "a4_landscape") return A4_LANDSCAPE;
    return [imageWidth, imageHeight];
  }
}
