import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { PDFDocument } from "pdf-lib";
import type { PdfSignatureStampOptions } from "../types/conversion.js";
import { PdfiumRenderService } from "../services/PdfiumRenderService.js";

type ProgressCallback = (progress: number, message: string) => void;

interface SignatureStampResult {
  outputPaths: string[];
  warnings: string[];
}

export class PdfSignatureStampEngine {
  private readonly pdfium = new PdfiumRenderService();

  async stamp(
    sourcePath: string,
    outputPath: string,
    options: PdfSignatureStampOptions,
    onProgress: ProgressCallback
  ): Promise<SignatureStampResult> {
    const stampedPdfBytes = await this.createStampedPdfBytes(sourcePath, options, onProgress);

    if (!options.flattenSignedPages) {
      await writeFile(outputPath, stampedPdfBytes);
      onProgress(92, "서명 스탬프 PDF를 저장했습니다.");
      return { outputPaths: [outputPath], warnings: [] };
    }

    if (!this.pdfium.isAvailable()) {
      await writeFile(outputPath, stampedPdfBytes);
      onProgress(92, "서명 스탬프 PDF를 저장했습니다.");
      return {
        outputPaths: [outputPath],
        warnings: ["현재 실행 환경에서는 서명 페이지 이미지화가 불가능해 일반 스탬프 방식으로 저장했습니다."]
      };
    }

    const tempDir = await mkdtemp(path.join(tmpdir(), "convert-smith-signature-"));
    const stampedPath = path.join(tempDir, "stamped.pdf");
    try {
      await writeFile(stampedPath, stampedPdfBytes);
      await this.flattenSignedPages(stampedPath, outputPath, options, onProgress);
      onProgress(92, "서명된 페이지를 이미지형 페이지로 저장했습니다.");
      return { outputPaths: [outputPath], warnings: [] };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async createStampedPdfBytes(
    sourcePath: string,
    options: PdfSignatureStampOptions,
    onProgress: ProgressCallback
  ): Promise<Uint8Array> {
    onProgress(20, "PDF와 서명 이미지를 읽는 중입니다.");
    const pdf = await PDFDocument.load(await readFile(sourcePath), { ignoreEncryption: false });
    const imageBytes = await readFile(options.signatureImagePath);
    const extension = path.extname(options.signatureImagePath).toLowerCase();
    const signatureImage =
      extension === ".png" ? await pdf.embedPng(imageBytes) : await pdf.embedJpg(imageBytes);
    const signedPages = this.normalizePages(options.pages, pdf.getPageCount());

    for (const [index, pageNumber] of signedPages.entries()) {
      const page = pdf.getPage(pageNumber - 1);
      const { x, y, width, height } = this.getPlacementBox(
        page.getWidth(),
        page.getHeight(),
        signatureImage.width,
        signatureImage.height,
        options
      );
      page.drawImage(signatureImage, {
        x,
        y,
        width,
        height,
        opacity: options.opacity
      });
      onProgress(
        30 + Math.round(((index + 1) / Math.max(1, signedPages.length)) * 35),
        `서명 스탬프를 ${pageNumber}페이지에 삽입하는 중입니다.`
      );
    }

    return pdf.save();
  }

  private async flattenSignedPages(
    stampedPath: string,
    outputPath: string,
    options: PdfSignatureStampOptions,
    onProgress: ProgressCallback
  ): Promise<void> {
    // This is visual flattening only. It is not a cryptographic or certificate-backed tamper-proof signature.
    const stampedPdf = await PDFDocument.load(await readFile(stampedPath), { ignoreEncryption: false });
    const signedPages = new Set(this.normalizePages(options.pages, stampedPdf.getPageCount()));
    const renderedPages = new Map<number, Buffer>();

    await this.pdfium.renderPages(stampedPath, options.renderScale, onProgress, async (pageNumber, pngBuffer) => {
      if (signedPages.has(pageNumber)) {
        renderedPages.set(pageNumber, pngBuffer);
      }
    });

    const target = await PDFDocument.create();
    for (let pageNumber = 1; pageNumber <= stampedPdf.getPageCount(); pageNumber += 1) {
      const sourcePage = stampedPdf.getPage(pageNumber - 1);
      const renderedPng = renderedPages.get(pageNumber);
      if (renderedPng) {
        const page = target.addPage([sourcePage.getWidth(), sourcePage.getHeight()]);
        const image = await target.embedPng(renderedPng);
        page.drawImage(image, {
          x: 0,
          y: 0,
          width: page.getWidth(),
          height: page.getHeight()
        });
      } else {
        const [copiedPage] = await target.copyPages(stampedPdf, [pageNumber - 1]);
        target.addPage(copiedPage);
      }
    }

    await writeFile(outputPath, await target.save());
  }

  private getPlacementBox(
    pageWidth: number,
    pageHeight: number,
    imageWidth: number,
    imageHeight: number,
    options: PdfSignatureStampOptions
  ): { x: number; y: number; width: number; height: number } {
    const placement = options.placement;
    const x = (pageWidth * placement.xPercent) / 100;
    const yTop = (pageHeight * placement.yPercent) / 100;
    const width = Math.max(1, (pageWidth * placement.widthPercent) / 100);
    const imageRatio = imageWidth / Math.max(1, imageHeight);
    const height =
      placement.keepAspectRatio || !placement.heightPercent
        ? width / imageRatio
        : Math.max(1, (pageHeight * placement.heightPercent) / 100);
    return {
      x: Math.min(Math.max(0, x), Math.max(0, pageWidth - 1)),
      y: Math.min(Math.max(0, pageHeight - yTop - height), Math.max(0, pageHeight - 1)),
      width: Math.min(width, pageWidth),
      height: Math.min(height, pageHeight)
    };
  }

  private normalizePages(pages: number[], pageCount: number): number[] {
    const seen = new Set<number>();
    const result: number[] = [];
    for (const page of pages) {
      const pageNumber = Math.trunc(Number(page));
      if (pageNumber < 1 || pageNumber > pageCount || seen.has(pageNumber)) continue;
      seen.add(pageNumber);
      result.push(pageNumber);
    }
    return result;
  }
}
