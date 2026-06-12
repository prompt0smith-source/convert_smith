import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type { BrowserWindow } from "electron";

type ProgressCallback = (progress: number, message: string) => void;
type PageCallback = (pageNumber: number, pngBuffer: Buffer) => Promise<void>;
type ElectronModule = typeof import("electron");
const MAX_RENDER_ATTEMPTS = 3;

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

interface PageBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export class PdfiumRenderService {
  isAvailable(): boolean {
    return Boolean(process.versions.electron);
  }

  async renderPages(
    inputPath: string,
    scale: 1 | 2 | 3,
    onProgress: ProgressCallback,
    onPage: PageCallback
  ): Promise<void> {
    if (!this.isAvailable()) {
      throw new Error("Electron PDFium renderer is not available in this process.");
    }

    const electron = await importRuntime<ElectronModule>("electron");
    await electron.app.whenReady();

    const sourceBytes = await readFile(inputPath);
    const sourcePdf = await PDFDocument.load(sourceBytes);
    const pageCount = sourcePdf.getPageCount();
    const tempDir = await mkdtemp(path.join(tmpdir(), "convert-smith-pdfium-"));
    const win = new electron.BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      backgroundColor: "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        offscreen: true
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    try {
      for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
        const pageNumber = pageIndex + 1;
        onProgress(
          Math.round((pageIndex / Math.max(1, pageCount)) * 85) + 5,
          `PDF ${pageNumber}/${pageCount}페이지를 원본 렌더러로 이미지화하고 있습니다.`
        );

        const singlePagePath = await this.writeSinglePagePdf(sourcePdf, pageIndex, tempDir);
        const sourcePage = sourcePdf.getPage(pageIndex);
        const pngBuffer = await this.captureSinglePageWithRetry(
          electron,
          win,
          singlePagePath,
          {
            width: sourcePage.getWidth(),
            height: sourcePage.getHeight(),
            rotation: sourcePage.getRotation().angle,
            scale
          }
        );
        await onPage(pageNumber, pngBuffer);
      }
    } catch (error) {
      throw new Error(
        [
          "PDF 원본 렌더링에 실패했습니다. 글꼴이나 배치가 깨진 결과를 만들지 않기 위해 변환을 중단했습니다.",
          error instanceof Error ? error.message : String(error)
        ].join("\n")
      );
    } finally {
      if (win.webContents.debugger.isAttached()) {
        try {
          win.webContents.debugger.detach();
        } catch {
          // Ignore detach failures while the hidden renderer is closing.
        }
      }
      win.destroy();
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async writeSinglePagePdf(sourcePdf: PDFDocument, pageIndex: number, tempDir: string): Promise<string> {
    const singlePagePdf = await PDFDocument.create();
    const [copiedPage] = await singlePagePdf.copyPages(sourcePdf, [pageIndex]);
    singlePagePdf.addPage(copiedPage);
    const outputPath = path.join(tempDir, `page-${String(pageIndex + 1).padStart(4, "0")}.pdf`);
    await writeFile(outputPath, await singlePagePdf.save());
    return outputPath;
  }

  private async captureSinglePage(
    electron: ElectronModule,
    win: BrowserWindow,
    singlePagePath: string,
    page: { width: number; height: number; rotation: number; scale: 1 | 2 | 3 },
    attempt: number
  ): Promise<Buffer> {
    const isSideways = Math.abs(page.rotation) % 180 === 90;
    const displayWidth = isSideways ? page.height : page.width;
    const displayHeight = isSideways ? page.width : page.height;
    const viewport = this.getViewportSize(displayWidth, displayHeight, page.scale);
    const zoomPercent = page.scale * 75;
    const url = `${pathToFileURL(singlePagePath).toString()}#page=1&zoom=${zoomPercent}&toolbar=0&navpanes=0`;

    await win.loadURL(url);
    if (!win.webContents.debugger.isAttached()) {
      win.webContents.debugger.attach();
    }
    await win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await this.delay(900 + page.scale * 150 + (attempt - 1) * 650);

    const result = (await win.webContents.debugger.sendCommand("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true
    })) as { data: string };
    const fullCapture = Buffer.from(result.data, "base64");
    const bounds = await this.findPdfPageBounds(fullCapture);
    return sharp(fullCapture).extract(bounds).png().toBuffer();
  }

  private async captureSinglePageWithRetry(
    electron: ElectronModule,
    win: BrowserWindow,
    singlePagePath: string,
    page: { width: number; height: number; rotation: number; scale: 1 | 2 | 3 }
  ): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt += 1) {
      try {
        if (attempt > 1) {
          await this.delay(450 * attempt);
        }
        return await this.captureSinglePage(electron, win, singlePagePath, page, attempt);
      } catch (error) {
        lastError = error;
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`PDF 페이지 렌더링을 ${MAX_RENDER_ATTEMPTS}회 확인했지만 안정적인 페이지 영역을 찾지 못했습니다.\n${detail}`);
  }

  private getViewportSize(pageWidth: number, pageHeight: number, scale: 1 | 2 | 3): { width: number; height: number } {
    const pagePixelWidth = Math.ceil(pageWidth * scale);
    const pagePixelHeight = Math.ceil(pageHeight * scale);
    const horizontalMargin = Math.max(420, Math.round(pagePixelWidth * 0.35));
    const verticalMargin = Math.max(420, Math.round(pagePixelHeight * 0.22));
    return {
      width: Math.min(12000, Math.max(900, pagePixelWidth + horizontalMargin)),
      height: Math.min(16000, Math.max(900, pagePixelHeight + verticalMargin))
    };
  }

  private async findPdfPageBounds(imageBuffer: Buffer): Promise<PageBounds> {
    const { data, info } = await sharp(imageBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const background = this.averageCornerColor(data, info.width, info.height, info.channels);
    const isPagePixel = (x: number, y: number): boolean => {
      const offset = (y * info.width + x) * info.channels;
      return this.colorDistance(
        { r: data[offset], g: data[offset + 1], b: data[offset + 2] },
        background
      ) > 18;
    };

    let bestRun = { length: 0, x1: 0, x2: info.width - 1, y: 0 };
    for (let y = 0; y < info.height; y += 1) {
      let start = -1;
      for (let x = 0; x <= info.width; x += 1) {
        const pagePixel = x < info.width && isPagePixel(x, y);
        if (pagePixel && start < 0) start = x;
        if ((!pagePixel || x === info.width) && start >= 0) {
          const length = x - start;
          if (length > bestRun.length) {
            bestRun = { length, x1: start, x2: x - 1, y };
          }
          start = -1;
        }
      }
    }

    if (bestRun.length < 40) {
      throw new Error("PDF 페이지 영역을 찾지 못했습니다.");
    }

    let left = bestRun.x1;
    let right = bestRun.x2;
    const minRowPixels = Math.floor((right - left + 1) * 0.55);
    let top = 0;
    let bottom = info.height - 1;

    for (let y = 0; y < info.height; y += 1) {
      let count = 0;
      for (let x = left; x <= right; x += 1) {
        if (isPagePixel(x, y)) count += 1;
      }
      if (count >= minRowPixels) {
        top = y;
        break;
      }
    }

    for (let y = info.height - 1; y >= 0; y -= 1) {
      let count = 0;
      for (let x = left; x <= right; x += 1) {
        if (isPagePixel(x, y)) count += 1;
      }
      if (count >= minRowPixels) {
        bottom = y;
        break;
      }
    }

    const height = Math.max(1, bottom - top + 1);
    const minColumnPixels = Math.floor(height * 0.55);
    for (let x = left; x <= right; x += 1) {
      let count = 0;
      for (let y = top; y <= bottom; y += 1) {
        if (isPagePixel(x, y)) count += 1;
      }
      if (count >= minColumnPixels) {
        left = x;
        break;
      }
    }

    for (let x = right; x >= left; x -= 1) {
      let count = 0;
      for (let y = top; y <= bottom; y += 1) {
        if (isPagePixel(x, y)) count += 1;
      }
      if (count >= minColumnPixels) {
        right = x;
        break;
      }
    }

    const pad = 2;
    const cropLeft = Math.max(0, left - pad);
    const cropTop = Math.max(0, top - pad);
    return {
      left: cropLeft,
      top: cropTop,
      width: Math.min(info.width - cropLeft, right - left + 1 + pad * 2),
      height: Math.min(info.height - cropTop, bottom - top + 1 + pad * 2)
    };
  }

  private averageCornerColor(data: Buffer, width: number, height: number, channels: number): Rgb {
    const samples: Rgb[] = [];
    const size = 12;
    const corners = [
      [0, 0],
      [Math.max(0, width - size), 0],
      [0, Math.max(0, height - size)],
      [Math.max(0, width - size), Math.max(0, height - size)]
    ];
    for (const [startX, startY] of corners) {
      for (let y = startY; y < Math.min(height, startY + size); y += 1) {
        for (let x = startX; x < Math.min(width, startX + size); x += 1) {
          const offset = (y * width + x) * channels;
          samples.push({ r: data[offset], g: data[offset + 1], b: data[offset + 2] });
        }
      }
    }
    const total = samples.reduce(
      (sum, sample) => ({
        r: sum.r + sample.r,
        g: sum.g + sample.g,
        b: sum.b + sample.b
      }),
      { r: 0, g: 0, b: 0 }
    );
    const count = Math.max(1, samples.length);
    return {
      r: total.r / count,
      g: total.g / count,
      b: total.b / count
    };
  }

  private colorDistance(a: Rgb, b: Rgb): number {
    return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
