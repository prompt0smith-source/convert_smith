import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { setFillingColor } from "pdf-lib/cjs/api/colors";
import {
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rotateAndSkewTextRadiansAndTranslate,
  setCharacterSqueeze,
  setFontAndSize,
  showText
} from "pdf-lib/cjs/api/operators";
import type PDFName from "pdf-lib/cjs/core/objects/PDFName";
import fontkit from "@pdf-lib/fontkit";
import { createPdfjsDocumentOptions, preparePdfCanvasFonts } from "./PdfjsAssetService.js";
import { applyLocalFontMatches, warmPdfPageFonts } from "./LocalFontMatchService.js";
import { extractPdfReadingOrderFragments } from "./PdfReadingOrderService.js";
import { applyPdfTextColors } from "./PdfTextColorService.js";
import { extractPdfEditorPageObjects } from "./PdfEditorObjectDetectionService.js";
import { PdfNativeEditOrchestrator } from "../pdf-native-edit/PdfNativeEditOrchestrator.js";
import { FileSignatureService } from "./FileSignatureService.js";
import { ValidationService } from "./ValidationService.js";
import { DependencyService } from "./DependencyService.js";
import {
  containsNonWinAnsi,
  parsePdfEditorRgb,
  PdfEditorFontService,
  wrapPdfEditorText
} from "./PdfEditorFontService.js";
import type {
  PdfEditorEdit,
  PdfEditorPagePreview,
  PdfEditorPageSize,
  PdfEditorSaveResult,
  PdfEditorTextItem,
  PdfEditorTextLayer,
  StartPdfEditorSavePayload
} from "../types/conversion.js";

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

const MIN_TEXT_SQUEEZE_PERCENT = 55;
const MAX_TEXT_SQUEEZE_PERCENT = 100;
const TEXT_LAYER_DETAIL_TIMEOUT_MS = 45000;
const PDF_EDITOR_PAGE_STEP_TIMEOUT_MS = 8000;

export class PdfEditorService {
  private readonly dependencies = new DependencyService();
  private readonly signatures = new FileSignatureService();
  private readonly validation = new ValidationService(this.signatures, this.dependencies.getFfprobePath());
  private readonly fonts = new PdfEditorFontService();
  private readonly nativeTextEditor = new PdfNativeEditOrchestrator();
  private readonly previewTempDirs: string[] = [];

  async getTextLayer(inputPath: string): Promise<PdfEditorTextLayer> {
    const sourcePath = await this.validatePdfInput(inputPath);
    const data = new Uint8Array(await readFile(sourcePath));
    const fallbackLayer = await this.createBasicTextLayer(sourcePath, data);

    try {
      return await withTimeout(
        this.extractDetailedTextLayer(sourcePath, data, fallbackLayer),
        TEXT_LAYER_DETAIL_TIMEOUT_MS,
        "PDF 텍스트/객체 분석 시간이 오래 걸려 기본 Viewer 모드로 열었습니다."
      );
    } catch (error) {
      return {
        ...fallbackLayer,
        warnings: [
          "PDF 텍스트/객체 분석에 실패해 기본 Viewer 모드로 열었습니다. 원본 PDF 미리보기와 외부 앱 열기는 계속 사용할 수 있습니다.",
          error instanceof Error ? error.message : String(error)
        ].filter(Boolean)
      };
    }
  }

  private async createBasicTextLayer(sourcePath: string, data: Uint8Array): Promise<PdfEditorTextLayer> {
    const pdfDoc = await PDFDocument.load(data, { ignoreEncryption: false });
    const pageSizes: PdfEditorPageSize[] = pdfDoc.getPages().map((page, index) => ({
      pageNumber: index + 1,
      width: roundPoint(page.getWidth()),
      height: roundPoint(page.getHeight())
    }));

    return {
      path: sourcePath,
      name: path.basename(sourcePath),
      pageCount: pageSizes.length,
      pageSizes,
      items: [],
      images: [],
      lines: [],
      tables: []
    };
  }

  private async extractDetailedTextLayer(
    sourcePath: string,
    data: Uint8Array,
    fallbackLayer: PdfEditorTextLayer
  ): Promise<PdfEditorTextLayer> {
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await withTimeout<any>(
      pdfjs.getDocument(createPdfjsDocumentOptions(data)).promise,
      PDF_EDITOR_PAGE_STEP_TIMEOUT_MS,
      "PDF.js 문서 로딩 시간이 초과되었습니다."
    );
    const items: PdfEditorTextItem[] = [];
    const pageSizes: PdfEditorPageSize[] = [...fallbackLayer.pageSizes];
    const images: PdfEditorTextLayer["images"] = [];
    const lines: PdfEditorTextLayer["lines"] = [];
    const tables: PdfEditorTextLayer["tables"] = [];
    const warnings: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      try {
        const page = await withTimeout<any>(
          document.getPage(pageNumber),
          PDF_EDITOR_PAGE_STEP_TIMEOUT_MS,
          `PDF ${pageNumber}페이지 로딩 시간이 초과되었습니다.`
        );
        const viewport = page.getViewport({ scale: 1 });
        upsertPageSize(pageSizes, {
          pageNumber,
          width: roundPoint(viewport.width),
          height: roundPoint(viewport.height)
        });

        const textContent = await withTimeout(
          page.getTextContent(),
          PDF_EDITOR_PAGE_STEP_TIMEOUT_MS,
          `PDF ${pageNumber}페이지 텍스트 추출 시간이 초과되었습니다.`
        );
        const fragments = extractPdfReadingOrderFragments(pdfjs, page, textContent, 1);

        await runBestEffortStep(
          () => applyPdfTextColors(pdfjs, page, textContent, fragments, { splitMixedColorText: true }),
          PDF_EDITOR_PAGE_STEP_TIMEOUT_MS,
          warnings,
          `${pageNumber}페이지 색상 정보 분석을 건너뛰었습니다.`
        );
        await runBestEffortStep(
          () => warmPdfPageFonts(page),
          PDF_EDITOR_PAGE_STEP_TIMEOUT_MS,
          warnings,
          `${pageNumber}페이지 글꼴 준비를 건너뛰었습니다.`
        );
        await runBestEffortStep(
          () => applyLocalFontMatches(page, fragments),
          PDF_EDITOR_PAGE_STEP_TIMEOUT_MS,
          warnings,
          `${pageNumber}페이지 로컬 글꼴 매칭을 건너뛰었습니다.`
        );

        fragments.forEach((fragment, index) => {
          const text = fragment.text.normalize("NFC").trim();
          if (!text) return;
          items.push({
            id: `p${pageNumber}-s${fragment.sourceIndex ?? index}-${index}`,
            pageNumber,
            sourceIndex: fragment.sourceIndex,
            text,
            x: roundPoint(fragment.x),
            y: roundPoint(fragment.y),
            width: roundPoint(fragment.width),
            height: roundPoint(fragment.height),
            fontSize: roundPoint(fragment.fontSize),
            fontFamily: fragment.fontFamily,
            fontWeight: fragment.fontWeight,
            fontStyle: fragment.fontStyle,
            color: fragment.color
          });
        });

        await runBestEffortStep(
          async () => {
            const objects = await extractPdfEditorPageObjects(pdfjs, page, pageNumber);
            images.push(...objects.images);
            lines.push(...objects.lines);
            tables.push(...objects.tables);
          },
          PDF_EDITOR_PAGE_STEP_TIMEOUT_MS,
          warnings,
          `${pageNumber}페이지 객체 인식을 건너뛰었습니다.`
        );
      } catch (error) {
        warnings.push(
          `${pageNumber}페이지 분석을 건너뛰었습니다: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return {
      path: sourcePath,
      name: path.basename(sourcePath),
      pageCount: document.numPages,
      pageSizes,
      items,
      images,
      lines,
      tables,
      warnings: warnings.length ? Array.from(new Set(warnings)).slice(0, 8) : undefined
    };
  }

  async saveTextEdits(payload: StartPdfEditorSavePayload): Promise<PdfEditorSaveResult> {
    const sourcePath = await this.validatePdfInput(payload.sourcePath);
    const outputDir = await this.validation.validateOutputDir(payload.outputDir);
    const edits = this.normalizeEdits(payload.edits);
    if (edits.length === 0) {
      throw new Error("저장할 PDF 편집 내용이 없습니다.");
    }

    const targetOutputDir = payload.useDatedSubfolder ? await this.createDatedOutputDir(outputDir) : outputDir;
    const outputPath = await this.createUniqueOutputPath(
      targetOutputDir,
      payload.outputName?.trim() || `${path.basename(sourcePath, path.extname(sourcePath))}_edited`,
      "pdf"
    );

    const pdfDoc = await PDFDocument.load(await readFile(sourcePath), { ignoreEncryption: false });
    pdfDoc.registerFontkit(fontkit);
    this.fonts.reset();

    let editedCount = 0;
    let deletedCount = 0;
    let addedCount = 0;
    let lineEditedCount = 0;
    let imageEditedCount = 0;
    const warnings = [
      "텍스트 수정/삭제는 원본 PDF content stream의 텍스트 명령을 우선 직접 수정합니다. 원본 글꼴로 새 문자를 표현할 수 없을 때만 원본 텍스트 명령을 비우고 로컬 글꼴을 임베드한 실제 PDF 텍스트 객체를 같은 위치에 삽입합니다. 흰 배경 덮어쓰기 방식은 사용하지 않습니다."
    ];

    const directTextEdits = edits.filter((edit) => edit.action === "replace" || edit.action === "delete");
    if (directTextEdits.length > 0) {
      const nativeResult = this.nativeTextEditor.applyTextEdits(pdfDoc, directTextEdits);
      editedCount += nativeResult.replacedCount;
      deletedCount += nativeResult.deletedCount;
      warnings.push(...nativeResult.warnings);

      for (const insertion of nativeResult.replacementFontInsertions) {
        await this.insertReplacementFontText(pdfDoc, insertion.edit);
        editedCount += 1;
      }
    }

    for (const edit of edits.filter((item) => item.action !== "replace" && item.action !== "delete")) {
      const page = pdfDoc.getPage(edit.pageNumber - 1);
      const pageHeight = page.getHeight();
      const x = clamp(edit.x, 0, page.getWidth());
      const yTop = clamp(edit.y, 0, pageHeight);
      const width = clamp(edit.width, 1, page.getWidth());
      const minimumHeight = edit.action === "image" || edit.action === "line"
        ? 1
        : Math.max(6, edit.fontSize * 0.9);
      const height = clamp(edit.height, minimumHeight, pageHeight);
      const pdfY = clamp(pageHeight - yTop - height, 0, pageHeight);
      const minimumCoverHeight = edit.coverHeight === undefined && edit.action !== "line"
        ? Math.max(6, edit.fontSize * 0.9)
        : 0.4;
      const coverX = clamp(edit.coverX ?? edit.x, 0, page.getWidth());
      const coverYTop = clamp(edit.coverY ?? edit.y, 0, pageHeight);
      const coverWidth = clamp(edit.coverWidth ?? edit.width, 1, page.getWidth());
      const coverHeight = clamp(edit.coverHeight ?? edit.height, minimumCoverHeight, pageHeight);
      const coverPdfY = clamp(pageHeight - coverYTop - coverHeight, 0, pageHeight);
      const fontSize = clamp(edit.fontSize || 10, 5, 96);
      const replacement = (edit.replacementText || "").normalize("NFC");

      if (edit.action === "image") {
        if (!edit.imageDataBase64) {
          throw new Error("이동할 이미지 데이터를 찾지 못해 PDF 저장을 중단했습니다.");
        }

        page.drawRectangle({
          x: coverX,
          y: coverPdfY,
          width: Math.min(page.getWidth() - coverX, coverWidth),
          height: Math.min(pageHeight - coverPdfY, coverHeight),
          color: rgb(1, 1, 1)
        });

        const imageBytes = Buffer.from(edit.imageDataBase64, "base64");
        const embeddedImage = await pdfDoc.embedPng(imageBytes);
        page.drawImage(embeddedImage, {
          x,
          y: pdfY,
          width: Math.min(page.getWidth() - x, width),
          height: Math.min(pageHeight - pdfY, height)
        });
        imageEditedCount += 1;
        continue;
      }

      if (edit.action === "line") {
        page.drawRectangle({
          x: coverX,
          y: coverPdfY,
          width: Math.min(page.getWidth() - coverX, coverWidth),
          height: Math.min(pageHeight - coverPdfY, coverHeight),
          color: rgb(1, 1, 1)
        });
        page.drawLine({
          start: {
            x: clamp(edit.x1 ?? edit.x, 0, page.getWidth()),
            y: clamp(pageHeight - (edit.y1 ?? edit.y), 0, pageHeight)
          },
          end: {
            x: clamp(edit.x2 ?? edit.x + edit.width, 0, page.getWidth()),
            y: clamp(pageHeight - (edit.y2 ?? edit.y + edit.height), 0, pageHeight)
          },
          thickness: clamp(edit.strokeWidth ?? 1, 0.2, 24),
          color: rgb(0, 0, 0),
          dashArray: edit.dashArray?.length ? edit.dashArray.map((value) => clamp(value, 0.1, 200)) : undefined,
          dashPhase: edit.dashPhase === undefined ? undefined : clamp(edit.dashPhase, 0, 200)
        });
        lineEditedCount += 1;
        continue;
      }

      if (edit.action !== "delete" && replacement.trim()) {
        const fontChoice = await this.fonts.resolveFont(pdfDoc, replacement, edit.fontFamily, edit.fontWeight, edit.fontStyle);

        if (edit.action === "replace") {
          this.assertSafeReplacement(edit, replacement, fontChoice.embedded, fontChoice.font, width, height, fontSize);
        } else if (!fontChoice.embedded && containsNonWinAnsi(replacement)) {
          throw new Error(
            "로컬 서체를 찾지 못해 PDF 저장을 중단했습니다. 글꼴이 바뀐 결과를 만들지 않기 위해 원본 파일은 변경하지 않았습니다."
          );
        }

        const lines =
          edit.action === "replace"
            ? [replacement]
            : wrapPdfEditorText(fontChoice.font, replacement, Math.max(1, width), fontSize);
        const lineHeight = fontSize * 1.18;
        const color = parsePdfEditorRgb(edit.color);

        lines.forEach((line, index) => {
          const baselineY =
            edit.action === "replace"
              ? pdfY - index * lineHeight
              : pdfY + height - fontSize - index * lineHeight;
          drawFittedEditorTextLine({
            page,
            font: fontChoice.font,
            text: line,
            x,
            y: clamp(baselineY, 0, pageHeight),
            fontSize,
            maxWidth: Math.max(1, width),
            color
          });
        });
      }

      if (edit.action === "add") addedCount += 1;
    }

    await writeFile(outputPath, await pdfDoc.save({ useObjectStreams: false }));
    if (!(await this.signatures.isPdf(outputPath))) {
      throw new Error("PDF 편집 결과 검증에 실패했습니다. 결과 파일이 정상 PDF가 아닙니다.");
    }

    return {
      outputPath,
      editedCount: editedCount + lineEditedCount + imageEditedCount,
      deletedCount,
      addedCount,
      warnings: Array.from(new Set(warnings))
    };
  }

  async previewTextEdits(payload: StartPdfEditorSavePayload): Promise<PdfEditorSaveResult> {
    const tempDir = await mkdtemp(path.join(tmpdir(), "convert-smith-pdf-editor-preview-"));
    try {
      const result = await this.saveTextEdits({
        ...payload,
        outputDir: tempDir,
        outputName: "preview",
        useDatedSubfolder: false
      });
      this.previewTempDirs.push(tempDir);
      this.cleanupOldPreviewDirs();
      return result;
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async getPagePreview(inputPath: string, pageNumber: number, scale: 1 | 2 | 3 = 2): Promise<PdfEditorPagePreview> {
    const sourcePath = await this.validatePdfInput(inputPath);
    const safeScale = ([1, 2, 3] as const).includes(scale) ? scale : 2;
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const canvasModule = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
    preparePdfCanvasFonts(canvasModule);
    const data = new Uint8Array(await readFile(sourcePath));
    const document = await pdfjs.getDocument(createPdfjsDocumentOptions(data)).promise;
    const safePageNumber = Math.max(1, Math.min(document.numPages, Math.trunc(pageNumber) || 1));
    const page = await document.getPage(safePageNumber);
    const viewport = page.getViewport({ scale: safeScale });
    const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    context.save();
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.restore();
    await page.render({
      canvasContext: context as never,
      viewport
    }).promise;
    const pngBuffer = canvas.toBuffer("image/png");
    return {
      path: sourcePath,
      pageNumber: safePageNumber,
      pageCount: document.numPages,
      scale: safeScale,
      dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`
    };
  }

  private cleanupOldPreviewDirs(): void {
    while (this.previewTempDirs.length > 8) {
      const oldDir = this.previewTempDirs.shift();
      if (oldDir) void rm(oldDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private normalizeEdits(edits: PdfEditorEdit[]): PdfEditorEdit[] {
    if (!Array.isArray(edits)) return [];
    return edits.flatMap((edit) => {
      if (!edit || !["replace", "delete", "add", "line", "image"].includes(edit.action)) return [];
      const pageNumber = Math.trunc(Number(edit.pageNumber));
      if (pageNumber < 1) return [];
      return [
        {
          ...edit,
          pageNumber,
          sourceIndex: edit.sourceIndex === undefined ? undefined : Math.trunc(finiteNumber(edit.sourceIndex, 0)),
          originalText: String(edit.originalText || "").slice(0, 5000),
          replacementText: String(edit.replacementText || "").slice(0, 5000),
          coverX: edit.coverX === undefined ? undefined : finiteNumber(edit.coverX, 0),
          coverY: edit.coverY === undefined ? undefined : finiteNumber(edit.coverY, 0),
          coverWidth: edit.coverWidth === undefined ? undefined : finiteNumber(edit.coverWidth, 1),
          coverHeight: edit.coverHeight === undefined ? undefined : finiteNumber(edit.coverHeight, 12),
          x: finiteNumber(edit.x, 0),
          y: finiteNumber(edit.y, 0),
          width: finiteNumber(edit.width, 1),
          height: finiteNumber(edit.height, 12),
          fontSize: finiteNumber(edit.fontSize, 10),
          fontFamily: typeof edit.fontFamily === "string" ? edit.fontFamily : undefined,
          fontWeight: typeof edit.fontWeight === "string" ? edit.fontWeight : undefined,
          fontStyle: typeof edit.fontStyle === "string" ? edit.fontStyle : undefined,
          color: typeof edit.color === "string" ? edit.color : undefined,
          x1: edit.x1 === undefined ? undefined : finiteNumber(edit.x1, 0),
          y1: edit.y1 === undefined ? undefined : finiteNumber(edit.y1, 0),
          x2: edit.x2 === undefined ? undefined : finiteNumber(edit.x2, 0),
          y2: edit.y2 === undefined ? undefined : finiteNumber(edit.y2, 0),
          strokeWidth: edit.strokeWidth === undefined ? undefined : finiteNumber(edit.strokeWidth, 1),
          dashArray: Array.isArray(edit.dashArray)
            ? edit.dashArray.map((value) => finiteNumber(value, 0)).filter((value) => value > 0).slice(0, 16)
            : undefined,
          dashPhase: edit.dashPhase === undefined ? undefined : finiteNumber(edit.dashPhase, 0),
          imageDataBase64: typeof edit.imageDataBase64 === "string" ? edit.imageDataBase64 : undefined,
          mimeType: edit.mimeType === "image/png" ? edit.mimeType : undefined
        }
      ];
    });
  }

  private async insertReplacementFontText(pdfDoc: PDFDocument, edit: PdfEditorEdit): Promise<void> {
    const page = pdfDoc.getPage(edit.pageNumber - 1);
    const pageHeight = page.getHeight();
    const x = clamp(edit.x, 0, page.getWidth());
    const yTop = clamp(edit.y, 0, pageHeight);
    const width = clamp(edit.width, 1, page.getWidth());
    const height = clamp(edit.height, Math.max(6, edit.fontSize * 0.9), pageHeight);
    const pdfY = clamp(pageHeight - yTop - height, 0, pageHeight);
    const fontSize = clamp(edit.fontSize || 10, 5, 96);
    const replacement = (edit.replacementText || "").normalize("NFC");

    if (/\r|\n/.test(replacement)) {
      throw new Error(
        "한 줄 텍스트를 여러 줄로 바꾸면 원본 줄 간격이 틀어질 수 있어 PDF 저장을 중단했습니다. 텍스트 추가 기능으로 별도 줄을 추가해주세요."
      );
    }

    const fontChoice = await this.fonts.resolveEmbeddedFont(
      pdfDoc,
      replacement,
      edit.fontFamily,
      edit.fontWeight,
      edit.fontStyle
    );
    const color = parsePdfEditorRgb(edit.color);
    drawFittedEditorTextLine({
      page,
      font: fontChoice.font,
      text: replacement,
      x,
      y: pdfY,
      fontSize,
      maxWidth: Math.max(1, width),
      color
    });
  }

  private assertSafeReplacement(
    edit: PdfEditorEdit,
    replacement: string,
    fontEmbedded: boolean,
    font: PDFFont,
    width: number,
    height: number,
    fontSize: number
  ): void {
    if (!fontEmbedded) {
      throw new Error(
        "원본 글꼴과 매칭되는 로컬 서체를 찾지 못해 PDF 저장을 중단했습니다. 글꼴이 바뀐 결과를 만들지 않기 위해 원본 파일은 변경하지 않았습니다."
      );
    }

    if (/\r|\n/.test(replacement)) {
      throw new Error(
        "한 줄 텍스트를 여러 줄로 바꾸면 원본 줄 간격이 틀어질 수 있어 PDF 저장을 중단했습니다. 텍스트 추가 기능으로 별도 줄을 추가해주세요."
      );
    }

    const measuredWidth = font.widthOfTextAtSize(replacement, fontSize);
    const squeeze = calculateTextSqueezePercent(measuredWidth, width);
    if (measuredWidth * (squeeze / 100) > width * 1.04) {
      throw new Error(
        "수정한 텍스트가 원본 텍스트 영역보다 길어 글자 간격이나 형태가 틀어질 수 있습니다. 저장을 중단했고 원본 파일은 변경하지 않았습니다."
      );
    }

    if (fontSize > height * 1.35) {
      throw new Error(
        "원본 텍스트 영역의 높이를 안전하게 판단하지 못해 PDF 저장을 중단했습니다. 글자 형태가 틀어진 결과를 만들지 않기 위한 조치입니다."
      );
    }

    if (edit.originalText && containsNonWinAnsi(edit.originalText) && containsNonWinAnsi(replacement) && !edit.fontFamily) {
      throw new Error(
        "원본 한글 글꼴 정보를 확인하지 못해 PDF 저장을 중단했습니다. 글꼴이 바뀐 결과를 만들지 않기 위해 원본 파일은 변경하지 않았습니다."
      );
    }
  }

  private async validatePdfInput(filePath: string): Promise<string> {
    const resolved = await this.validation.validateInputPath(filePath);
    if (path.extname(resolved).toLowerCase() !== ".pdf") {
      throw new Error("PDF 편집기에서는 PDF 파일만 사용할 수 있습니다.");
    }
    if (!(await this.signatures.isPdf(resolved))) {
      throw new Error("PDF 파일 검증에 실패했습니다.");
    }
    return resolved;
  }

  private async createDatedOutputDir(outputDir: string): Promise<string> {
    const date = new Date();
    const folderName = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    const datedOutputDir = path.join(outputDir, folderName);
    await mkdir(datedOutputDir, { recursive: true });
    return datedOutputDir;
  }

  private async createUniqueOutputPath(outputDir: string, rawBaseName: string, extension: string): Promise<string> {
    const safeBaseName = sanitizeBaseName(rawBaseName);
    const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
    let candidate = path.join(outputDir, `${safeBaseName}${normalizedExtension}`);
    let index = 1;
    while (await exists(candidate)) {
      candidate = path.join(outputDir, `${safeBaseName}_${String(index).padStart(3, "0")}${normalizedExtension}`);
      index += 1;
    }
    return candidate;
  }
}

function drawFittedEditorTextLine({
  page,
  font,
  text,
  x,
  y,
  fontSize,
  maxWidth,
  color
}: {
  page: any;
  font: PDFFont;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  maxWidth: number;
  color: ReturnType<typeof rgb>;
}): void {
  const measuredWidth = font.widthOfTextAtSize(text, fontSize);
  const squeeze = calculateTextSqueezePercent(measuredWidth, maxWidth);
  if (Math.abs(squeeze - 100) < 0.5) {
    page.drawText(text, { x, y, size: fontSize, font, color });
    return;
  }

  const pageRuntime = page as {
    setOrEmbedFont: (font: PDFFont) => { oldFont?: PDFFont; newFontKey: PDFName };
    getContentStream: () => { push: (...operators: unknown[]) => void };
    setFont: (font: PDFFont) => void;
    resetFont: () => void;
  };
  const fontState = pageRuntime.setOrEmbedFont(font);
  pageRuntime.getContentStream().push(
    pushGraphicsState(),
    beginText(),
    setFillingColor(color),
    setFontAndSize(fontState.newFontKey, fontSize),
    setCharacterSqueeze(squeeze),
    rotateAndSkewTextRadiansAndTranslate(0, 0, 0, x, y),
    showText(font.encodeText(text)),
    setCharacterSqueeze(100),
    endText(),
    popGraphicsState()
  );

  if (fontState.oldFont) {
    pageRuntime.setFont(fontState.oldFont);
  } else {
    pageRuntime.resetFont();
  }
}

function calculateTextSqueezePercent(measuredWidth: number, targetWidth: number): number {
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0 || !Number.isFinite(targetWidth) || targetWidth <= 0) {
    return 100;
  }
  return clamp((targetWidth / measuredWidth) * 100, MIN_TEXT_SQUEEZE_PERCENT, MAX_TEXT_SQUEEZE_PERCENT);
}

function sanitizeBaseName(baseName: string): string {
  const sanitized = baseName
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || "edited_pdf";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function roundPoint(value: number): number {
  return Math.round(value * 100) / 100;
}

function upsertPageSize(pageSizes: PdfEditorPageSize[], nextPageSize: PdfEditorPageSize): void {
  const index = pageSizes.findIndex((item) => item.pageNumber === nextPageSize.pageNumber);
  if (index >= 0) {
    pageSizes[index] = nextPageSize;
    return;
  }
  pageSizes.push(nextPageSize);
  pageSizes.sort((a, b) => a.pageNumber - b.pageNumber);
}

async function runBestEffortStep(
  step: () => Promise<void>,
  timeoutMs: number,
  warnings: string[],
  warningMessage: string
): Promise<void> {
  try {
    await withTimeout(step(), timeoutMs, warningMessage);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnings.push(detail && detail !== warningMessage ? `${warningMessage} ${detail}` : warningMessage);
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
