import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  async renderPage(
    inputPath: string,
    pageNumber: number,
    scale: 1 | 2 | 3
  ): Promise<{ pageNumber: number; pageCount: number; pngBuffer: Buffer }> {
    if (!this.isAvailable()) {
      throw new Error("Electron PDFium renderer is not available in this process.");
    }

    const electron = await importRuntime<ElectronModule>("electron");
    await electron.app.whenReady();

    const sourceBytes = await readFile(inputPath);
    const sourcePdf = await PDFDocument.load(sourceBytes);
    const pageCount = sourcePdf.getPageCount();
    const safePageNumber = Math.max(1, Math.min(pageCount, Math.trunc(pageNumber) || 1));
    const pageIndex = safePageNumber - 1;
    const win = new electron.BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      backgroundColor: "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        offscreen: true,
        backgroundThrottling: false
      }
    });

    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    try {
      const sourcePage = sourcePdf.getPage(pageIndex);
      const singlePagePath = await this.createSinglePagePdfPath(sourcePdf, pageIndex);
      let pngBuffer: Buffer;
      try {
        pngBuffer = await this.captureSinglePageWithRetry(
          electron,
          win,
          singlePagePath,
          {
            pageNumber: 1,
            width: sourcePage.getWidth(),
            height: sourcePage.getHeight(),
            rotation: sourcePage.getRotation().angle,
            scale
          }
        );
      } finally {
        await this.cleanupSinglePagePdf(singlePagePath);
      }
      return { pageNumber: safePageNumber, pageCount, pngBuffer };
    } finally {
      if (win.webContents.debugger.isAttached()) {
        try {
          win.webContents.debugger.detach();
        } catch {
          // Ignore detach failures while the hidden renderer is closing.
        }
      }
      win.destroy();
    }
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
    const win = new electron.BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
      backgroundColor: "#ffffff",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        offscreen: true,
        backgroundThrottling: false
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

        const sourcePage = sourcePdf.getPage(pageIndex);
        const singlePagePath = await this.createSinglePagePdfPath(sourcePdf, pageIndex);
        let pngBuffer: Buffer;
        try {
          pngBuffer = await this.captureSinglePageWithRetry(
            electron,
            win,
            singlePagePath,
            {
              pageNumber: 1,
              width: sourcePage.getWidth(),
              height: sourcePage.getHeight(),
              rotation: sourcePage.getRotation().angle,
              scale
            }
          );
        } finally {
          await this.cleanupSinglePagePdf(singlePagePath);
        }
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
    }
  }

  private async createSinglePagePdfPath(sourcePdf: PDFDocument, pageIndex: number): Promise<string> {
    const singlePagePdf = await PDFDocument.create();
    const [copiedPage] = await singlePagePdf.copyPages(sourcePdf, [pageIndex]);
    singlePagePdf.addPage(copiedPage);
    const tempDir = await mkdtemp(path.join(tmpdir(), "convert-smith-pdfium-"));
    const tempPath = path.join(tempDir, "page.pdf");
    await writeFile(tempPath, await singlePagePdf.save({ useObjectStreams: false }));
    return tempPath;
  }

  private async cleanupSinglePagePdf(tempPath: string): Promise<void> {
    try {
      await rm(path.dirname(tempPath), { recursive: true, force: true });
    } catch {
      // Temporary cleanup failure should not fail a completed render.
    }
  }

  private async captureSinglePage(
    electron: ElectronModule,
    win: BrowserWindow,
    pdfPath: string,
    page: { pageNumber: number; width: number; height: number; rotation: number; scale: 1 | 2 | 3 },
    attempt: number
  ): Promise<Buffer> {
    const isSideways = Math.abs(page.rotation) % 180 === 90;
    const displayWidth = isSideways ? page.height : page.width;
    const displayHeight = isSideways ? page.width : page.height;
    const viewport = this.getViewportSize(displayWidth, displayHeight, page.scale);
    const zoomPercent = page.scale * 75;
    const url = `${pathToFileURL(pdfPath).toString()}#page=${page.pageNumber}&zoom=${zoomPercent}&toolbar=0&navpanes=0`;

    if (!win.webContents.debugger.isAttached()) {
      win.webContents.debugger.attach();
    }
    win.setBounds({ width: viewport.width, height: viewport.height });
    await win.webContents.debugger.sendCommand("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await this.loadPdfViewerUrl(win, url);
    await this.delay(3200 + page.scale * 520 + (attempt - 1) * 1400);

    await this.captureViewportPng(win);
    await this.delay(1200 + attempt * 420);

    const fullCapture = await this.captureViewportPng(win);
    const expectedWidth = Math.ceil(displayWidth * page.scale);
    const expectedHeight = Math.ceil(displayHeight * page.scale);
    const bounds = await this.resolvePageBounds(fullCapture, expectedWidth, expectedHeight);
    return sharp(fullCapture).extract(bounds).png().toBuffer();
  }

  private async captureViewportPng(win: BrowserWindow): Promise<Buffer> {
    const result = (await win.webContents.debugger.sendCommand("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false
    })) as { data: string };
    return Buffer.from(result.data, "base64");
  }

  private async loadPdfViewerUrl(win: BrowserWindow, url: string): Promise<void> {
    try {
      await Promise.race([
        win.loadURL(url),
        this.delay(8500).then(() => undefined)
      ]);
    } catch {
      // Some Electron PDF Viewer loads do not report a normal load completion.
      // Continue to the timed paint/capture phase and let image validation decide.
    }
  }

  private async captureSinglePageWithRetry(
    electron: ElectronModule,
    win: BrowserWindow,
    pdfPath: string,
    page: { pageNumber: number; width: number; height: number; rotation: number; scale: 1 | 2 | 3 }
  ): Promise<Buffer> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RENDER_ATTEMPTS; attempt += 1) {
      try {
        if (attempt > 1) {
          await this.delay(450 * attempt);
        }
        return await this.captureSinglePage(electron, win, pdfPath, page, attempt);
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

  private async resolvePageBounds(
    imageBuffer: Buffer,
    expectedWidth: number,
    expectedHeight: number
  ): Promise<PageBounds> {
    try {
      const detected = await this.findPdfPageBounds(imageBuffer);
      await this.assertReadablePageCrop(imageBuffer, detected, expectedWidth, expectedHeight);
      return detected;
    } catch {
      const topCentered = await this.createTopCenteredPageBounds(imageBuffer, expectedWidth, expectedHeight);
      try {
        await this.assertReadablePageCrop(imageBuffer, topCentered, expectedWidth, expectedHeight);
        return topCentered;
      } catch {
        const centered = await this.createCenteredPageBounds(imageBuffer, expectedWidth, expectedHeight);
        await this.assertReadablePageCrop(imageBuffer, centered, expectedWidth, expectedHeight);
        return centered;
      }
    }
  }

  private async createTopCenteredPageBounds(
    imageBuffer: Buffer,
    expectedWidth: number,
    expectedHeight: number
  ): Promise<PageBounds> {
    const metadata = await sharp(imageBuffer).metadata();
    const fullWidth = metadata.width || expectedWidth;
    const fullHeight = metadata.height || expectedHeight;
    const width = Math.max(1, Math.min(fullWidth, expectedWidth));
    const height = Math.max(1, Math.min(fullHeight, expectedHeight));
    const left = Math.max(0, Math.round((fullWidth - width) / 2));
    const topMargin = Math.max(0, Math.min(fullHeight - height, Math.round(Math.min(96, expectedHeight * 0.035))));
    return {
      left,
      top: topMargin,
      width: Math.min(width, Math.max(1, fullWidth - left)),
      height: Math.min(height, Math.max(1, fullHeight - topMargin))
    };
  }

  private async createCenteredPageBounds(
    imageBuffer: Buffer,
    expectedWidth: number,
    expectedHeight: number
  ): Promise<PageBounds> {
    const metadata = await sharp(imageBuffer).metadata();
    const width = Math.max(1, Math.min(metadata.width || expectedWidth, expectedWidth));
    const height = Math.max(1, Math.min(metadata.height || expectedHeight, expectedHeight));
    const left = Math.max(0, Math.round(((metadata.width || width) - width) / 2));
    const top = Math.max(0, Math.round(((metadata.height || height) - height) / 2));
    return {
      left,
      top,
      width: Math.min(width, Math.max(1, (metadata.width || width) - left)),
      height: Math.min(height, Math.max(1, (metadata.height || height) - top))
    };
  }

  private async assertReadablePageCrop(
    imageBuffer: Buffer,
    bounds: PageBounds,
    expectedWidth: number,
    expectedHeight: number
  ): Promise<void> {
    if (bounds.width < expectedWidth * 0.62 || bounds.height < expectedHeight * 0.62) {
      throw new Error("PDF 페이지 영역이 너무 작게 감지되었습니다.");
    }

    const expectedAspect = expectedWidth / Math.max(1, expectedHeight);
    const detectedAspect = bounds.width / Math.max(1, bounds.height);
    const aspectDelta = Math.abs(detectedAspect - expectedAspect) / Math.max(0.01, expectedAspect);
    if (aspectDelta > 0.055) {
      throw new Error("PDF 페이지 캡처 비율이 원본 페이지와 맞지 않습니다.");
    }

    const { data, info } = await sharp(imageBuffer)
      .extract(bounds)
      .removeAlpha()
      .resize({ width: 80, height: 80, fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let brightnessTotal = 0;
    let lightPixels = 0;
    const pixelCount = Math.max(1, info.width * info.height);
    for (let offset = 0; offset < data.length; offset += info.channels) {
      const brightness = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
      brightnessTotal += brightness;
      if (brightness > 210) lightPixels += 1;
    }
    const averageBrightness = brightnessTotal / pixelCount;
    const lightRatio = lightPixels / pixelCount;
    if (averageBrightness < 120 || lightRatio < 0.08) {
      throw new Error("PDF 페이지가 아직 정상적으로 렌더링되지 않았습니다.");
    }
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
