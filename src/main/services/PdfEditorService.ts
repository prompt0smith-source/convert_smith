import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { createPdfjsDocumentOptions, preparePdfCanvasFonts } from "./PdfjsAssetService.js";
import { applyLocalFontMatches, warmPdfPageFonts } from "./LocalFontMatchService.js";
import { extractPdfReadingOrderFragments } from "./PdfReadingOrderService.js";
import { applyPdfTextColors } from "./PdfTextColorService.js";
import { extractPdfEditorPageObjects } from "./PdfEditorObjectDetectionService.js";
import { NativePdfTextEditEngine } from "../pdf-native-edit/NativePdfTextEditEngine.js";
import { NativePdfObjectEditEngine } from "../pdf-native-edit/NativePdfObjectEditEngine.js";
import { PdfEditVerificationService } from "../pdf-native-edit/PdfEditVerificationService.js";
import type { PdfNativeTextSpan } from "../pdf-native-edit/PdfTextOperatorScanner.js";
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

const TEXT_LAYER_DETAIL_TIMEOUT_MS = 45000;
const PDF_EDITOR_PAGE_STEP_TIMEOUT_MS = 8000;

export class PdfEditorService {
  private readonly dependencies = new DependencyService();
  private readonly signatures = new FileSignatureService();
  private readonly validation = new ValidationService(this.signatures, this.dependencies.getFfprobePath());
  private readonly fonts = new PdfEditorFontService();
  private readonly nativeTextEditor = new NativePdfTextEditEngine();
  private readonly nativeObjectEditor = new NativePdfObjectEditEngine();
  private readonly editVerification = new PdfEditVerificationService();
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

    await runBestEffortStep(
      async () => {
        const pdfDoc = await PDFDocument.load(await readFile(sourcePath), { ignoreEncryption: false });
        const nativeSpans = this.nativeTextEditor.scanTextSpans(pdfDoc);
        attachNativeSpanMetadata(items, nativeSpans, warnings);
      },
      PDF_EDITOR_PAGE_STEP_TIMEOUT_MS,
      warnings,
      "PDF 내부 텍스트 명령 매칭을 건너뛰었습니다."
    );

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
    await mkdir(targetOutputDir, { recursive: true });
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
    const warnings = [
      "텍스트 수정/삭제는 원본 PDF content stream의 텍스트 명령을 우선 직접 수정합니다. 원본 글꼴로 새 문자를 표현할 수 없을 때만 원본 텍스트 명령을 비우고 로컬 글꼴을 임베드한 실제 PDF 텍스트 객체를 같은 위치에 삽입합니다. 흰 배경 덮어쓰기 방식은 사용하지 않습니다."
    ];

    const textEdits = edits.filter((edit) => edit.action !== "image" && edit.action !== "line");
    const objectEdits = edits.filter((edit) => edit.action === "image" || edit.action === "line");

    if (textEdits.length > 0) {
      const nativeResult = this.nativeTextEditor.applyTextEdits(pdfDoc, textEdits);
      editedCount += nativeResult.replacedCount + nativeResult.neutralizedCount;
      deletedCount += nativeResult.deletedCount;
      addedCount += nativeResult.addedCount;
      warnings.push(...nativeResult.warnings);

      for (const insertion of nativeResult.insertions) {
        await this.insertReplacementFontText(pdfDoc, insertion.edit);
        if (insertion.mode === "neutralize_and_insert") editedCount += 1;
      }
    }

    if (objectEdits.length > 0) {
      const objectResult = this.nativeObjectEditor.applyObjectEdits(pdfDoc, objectEdits);
      editedCount +=
        objectResult.movedImageCount +
        objectResult.duplicatedImageCount +
        objectResult.movedLineCount +
        objectResult.duplicatedLineCount;
      deletedCount += objectResult.deletedImageCount + objectResult.deletedLineCount;
      warnings.push(...objectResult.warnings);
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await pdfDoc.save({ useObjectStreams: false }));
    if (!(await this.signatures.isPdf(outputPath))) {
      throw new Error("PDF 편집 결과 검증에 실패했습니다. 결과 파일이 정상 PDF가 아닙니다.");
    }
    const verification = await this.editVerification.verifyNativeTextEdit(sourcePath, outputPath, textEdits);
    warnings.push(...verification.warnings);
    if (!verification.ok) {
      await rm(outputPath, { force: true }).catch(() => undefined);
      throw new Error(verification.message || "PDF 편집 결과 검증에 실패했습니다.");
    }

    return {
      outputPath,
      editedCount,
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
      dataUrl: `data:image/png;base64,${pngBuffer.toString("base64")}`,
      renderer: "pdfjs"
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
          nativeSpanId: typeof edit.nativeSpanId === "string" ? edit.nativeSpanId.slice(0, 120) : undefined,
          nativeObjectId: typeof edit.nativeObjectId === "string" ? edit.nativeObjectId.slice(0, 160) : undefined,
          sourceObjectId: typeof edit.sourceObjectId === "string" ? edit.sourceObjectId.slice(0, 160) : undefined,
          objectEditMode: edit.objectEditMode === "delete" || edit.objectEditMode === "move" || edit.objectEditMode === "duplicate"
            ? edit.objectEditMode
            : undefined,
          saveMode: typeof edit.saveMode === "string" ? edit.saveMode : undefined,
          originalText: String(edit.originalText || "").slice(0, 5000),
          replacementText: String(edit.replacementText || "").slice(0, 5000),
          originalX: edit.originalX === undefined ? undefined : finiteNumber(edit.originalX, 0),
          originalY: edit.originalY === undefined ? undefined : finiteNumber(edit.originalY, 0),
          originalWidth: edit.originalWidth === undefined ? undefined : finiteNumber(edit.originalWidth, 1),
          originalHeight: edit.originalHeight === undefined ? undefined : finiteNumber(edit.originalHeight, 12),
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
    const baselineY = edit.saveMode === "add_text" || edit.action === "add"
      ? pdfY + height - fontSize
      : pdfY;

    this.assertSafeReplacement(
      edit,
      replacement,
      fontChoice.embedded,
      fontChoice.font,
      width,
      height,
      fontSize,
      page.getWidth(),
      x
    );

    drawEditorTextLine({
      page,
      font: fontChoice.font,
      text: replacement,
      x,
      y: clamp(baselineY, 0, pageHeight),
      fontSize,
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
    fontSize: number,
    pageWidth: number,
    x: number
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
    const usesInsertedTextObject =
      edit.saveMode === "neutralize_and_insert" || edit.saveMode === "add_text" || edit.action === "add";
    const pageRemainingWidth = Math.max(1, pageWidth - x);
    if (usesInsertedTextObject && measuredWidth > pageRemainingWidth * 1.02) {
      throw new Error(
        "수정한 텍스트가 페이지 오른쪽 경계를 넘어갈 수 있어 PDF 저장을 중단했습니다. 텍스트 칸을 줄이거나 위치를 조정해주세요."
      );
    }

    if (!usesInsertedTextObject && edit.action !== "add" && measuredWidth > width * 1.04) {
      throw new Error(
        "수정한 텍스트가 원본 텍스트 영역보다 길어 글씨체나 자간이 변형될 수 있습니다. 강제로 압축하지 않고 저장을 중단했습니다."
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

function drawEditorTextLine({
  page,
  font,
  text,
  x,
  y,
  fontSize,
  color
}: {
  page: any;
  font: PDFFont;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: ReturnType<typeof rgb>;
}): void {
  page.drawText(text, { x, y, size: fontSize, font, color });
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

function attachNativeSpanMetadata(
  items: PdfEditorTextItem[],
  spans: PdfNativeTextSpan[],
  warnings: string[]
): void {
  const usedSpanIds = new Set<string>();
  const spansByPageAndText = new Map<string, PdfNativeTextSpan[]>();
  const spansByPage = new Map<number, PdfNativeTextSpan[]>();
  for (const span of spans) {
    const key = createNativeMatchKey(span.pageNumber, span.normalizedText);
    const bucket = spansByPageAndText.get(key) || [];
    bucket.push(span);
    spansByPageAndText.set(key, bucket);

    const pageBucket = spansByPage.get(span.pageNumber) || [];
    pageBucket.push(span);
    spansByPage.set(span.pageNumber, pageBucket);
  }
  for (const pageSpans of spansByPage.values()) {
    pageSpans.sort((a, b) => a.order - b.order);
  }

  let mappedCount = 0;
  for (const item of items) {
    const normalizedText = normalizeNativeMatchText(item.text);
    const candidates = (spansByPageAndText.get(createNativeMatchKey(item.pageNumber, normalizedText)) || [])
      .filter((span) => !usedSpanIds.has(span.id));

    const match = chooseNativeSpanMatch(candidates, item.sourceIndex);
    if (!match) {
      const groupMatch = chooseNativeSpanGroupMatch(
        spansByPage.get(item.pageNumber) || [],
        item.text,
        item.sourceIndex,
        usedSpanIds
      );
      if (groupMatch) {
        const ids = groupMatch.map((span) => span.id);
        for (const span of groupMatch) usedSpanIds.add(span.id);
        mappedCount += 1;
        item.nativeSpanId = `group:${ids.join("|")}`;
        item.editCapability = "neutralize_and_insert";
        item.editCapabilityReason = "multi_span_text_group";
        item.nativeFontResourceName = groupMatch[0]?.fontResourceName;
        item.nativeTextEncoding = groupMatch.some((span) => span.encoding === "to_unicode_cmap")
          ? "to_unicode_cmap"
          : "simple_ansi";
        continue;
      }

      item.editCapability = "not_editable";
      item.editCapabilityReason = candidates.length > 1 ? "ambiguous_text_span" : "text_span_not_found";
      continue;
    }

    usedSpanIds.add(match.id);
    mappedCount += 1;
    item.nativeSpanId = match.id;
    item.editCapability = match.encoding === "simple_ansi" ? "direct" : "neutralize_and_insert";
    item.editCapabilityReason = match.encoding === "simple_ansi" ? undefined : "to_unicode_cmap_may_need_insert";
    item.nativeFontResourceName = match.fontResourceName;
    item.nativeTextEncoding = match.encoding;
  }

  if (items.length > 0 && mappedCount === 0) {
    warnings.push("PDF 내부 텍스트 명령과 UI 텍스트를 안전하게 매칭하지 못했습니다. 일부 항목은 보기 전용으로 동작할 수 있습니다.");
  }
}

function chooseNativeSpanMatch(candidates: PdfNativeTextSpan[], sourceIndex: number | undefined): PdfNativeTextSpan | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  if (sourceIndex === undefined) return undefined;

  const ranked = [...candidates]
    .map((span) => ({ span, distance: Math.abs(span.order - sourceIndex) }))
    .sort((a, b) => a.distance - b.distance);
  if (ranked.length < 2) return ranked[0]?.span;
  if (ranked[0].distance === ranked[1].distance) return undefined;
  if (ranked[0].distance > 16) return undefined;
  return ranked[0].span;
}

function chooseNativeSpanGroupMatch(
  pageSpans: PdfNativeTextSpan[],
  text: string,
  sourceIndex: number | undefined,
  usedSpanIds: Set<string>
): PdfNativeTextSpan[] | undefined {
  const normalizedTarget = normalizeNativeMatchText(text);
  const compactTarget = normalizeCompactNativeMatchText(text);
  if (!normalizedTarget || compactTarget.length < 2) return undefined;

  const matches: Array<{ spans: PdfNativeTextSpan[]; distance: number; compactDistance: number }> = [];
  const maxGroupSize = Math.min(8, pageSpans.length);

  for (let start = 0; start < pageSpans.length; start += 1) {
    const group: PdfNativeTextSpan[] = [];
    for (let offset = 0; offset < maxGroupSize && start + offset < pageSpans.length; offset += 1) {
      const span = pageSpans[start + offset];
      if (usedSpanIds.has(span.id)) break;
      group.push(span);
      if (group.length < 2) continue;

      const joined = group.map((item) => item.text).join(" ");
      const normalizedJoined = normalizeNativeMatchText(joined);
      const compactJoined = normalizeCompactNativeMatchText(joined);
      if (normalizedJoined !== normalizedTarget && compactJoined !== compactTarget) continue;

      const firstOrder = group[0].order;
      const lastOrder = group[group.length - 1].order;
      const midpointOrder = (firstOrder + lastOrder) / 2;
      matches.push({
        spans: [...group],
        distance: sourceIndex === undefined ? 0 : Math.abs(midpointOrder - sourceIndex),
        compactDistance: Math.abs(compactJoined.length - compactTarget.length)
      });
    }
  }

  if (matches.length === 0) return undefined;
  matches.sort((a, b) => a.distance - b.distance || a.compactDistance - b.compactDistance || a.spans.length - b.spans.length);
  if (matches.length > 1 && sourceIndex !== undefined && Math.abs(matches[0].distance - matches[1].distance) < 0.01) {
    return undefined;
  }
  if (sourceIndex !== undefined && matches[0].distance > 24) return undefined;
  return matches[0].spans;
}

function createNativeMatchKey(pageNumber: number, text: string): string {
  return `${pageNumber}:${normalizeNativeMatchText(text)}`;
}

function normalizeNativeMatchText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\s+/g, " ").trim().normalize("NFC");
}

function normalizeCompactNativeMatchText(text: string): string {
  return normalizeNativeMatchText(text).replace(/\s+/g, "");
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
