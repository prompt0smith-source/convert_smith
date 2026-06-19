import path from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { createPdfjsDocumentOptions } from "./PdfjsAssetService.js";
import { applyLocalFontMatches, warmPdfPageFonts } from "./LocalFontMatchService.js";
import { extractPdfReadingOrderFragments } from "./PdfReadingOrderService.js";
import { applyPdfTextColors } from "./PdfTextColorService.js";
import { FileSignatureService } from "./FileSignatureService.js";
import { ValidationService } from "./ValidationService.js";
import { DependencyService } from "./DependencyService.js";
import { NativePdfTextEditEngine } from "../pdf-native-edit/NativePdfTextEditEngine.js";
import { PdfEditVerificationService } from "../pdf-native-edit/PdfEditVerificationService.js";
import {
  containsNonWinAnsi,
  parsePdfEditorRgb,
  PdfEditorFontService,
  wrapPdfEditorText
} from "./PdfEditorFontService.js";
import type {
  PdfEditorEdit,
  PdfEditorPageSize,
  PdfEditorSaveResult,
  PdfEditorTextItem,
  PdfEditorTextLayer,
  StartPdfEditorSavePayload
} from "../types/conversion.js";

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

export class PdfEditorService {
  private readonly dependencies = new DependencyService();
  private readonly signatures = new FileSignatureService();
  private readonly validation = new ValidationService(this.signatures, this.dependencies.getFfprobePath());
  private readonly fonts = new PdfEditorFontService();
  private readonly nativeTextEdit = new NativePdfTextEditEngine();
  private readonly editVerification = new PdfEditVerificationService();

  async getTextLayer(inputPath: string): Promise<PdfEditorTextLayer> {
    const sourcePath = await this.validatePdfInput(inputPath);
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await readFile(sourcePath));
    const document = await pdfjs.getDocument(createPdfjsDocumentOptions(data)).promise;
    const items: PdfEditorTextItem[] = [];
    const pageSizes: PdfEditorPageSize[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      pageSizes.push({
        pageNumber,
        width: roundPoint(viewport.width),
        height: roundPoint(viewport.height)
      });
      const textContent = await page.getTextContent();
      const fragments = extractPdfReadingOrderFragments(pdfjs, page, textContent, 1);
      await applyPdfTextColors(pdfjs, page, textContent, fragments, { splitMixedColorText: true });
      await warmPdfPageFonts(page);
      await applyLocalFontMatches(page, fragments);

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
          color: fragment.color
        });
      });
    }

    return {
      path: sourcePath,
      name: path.basename(sourcePath),
      pageCount: document.numPages,
      pageSizes,
      items
    };
  }

  async saveTextEdits(payload: StartPdfEditorSavePayload): Promise<PdfEditorSaveResult> {
    const sourcePath = await this.validatePdfInput(payload.sourcePath);
    const outputDir = await this.validation.validateOutputDir(payload.outputDir);
    const edits = this.normalizeEdits(payload.edits);
    if (edits.length === 0) {
      throw new Error("저장할 PDF 텍스트 편집 내용이 없습니다.");
    }

    const targetOutputDir = payload.useDatedSubfolder ? await this.createDatedOutputDir(outputDir) : outputDir;
    const outputPath = await this.createUniqueOutputPath(
      targetOutputDir,
      payload.outputName?.trim() || `${path.basename(sourcePath, path.extname(sourcePath))}_edited`,
      "pdf"
    );

    const nativeResult = await this.nativeTextEdit.trySave({ sourcePath, outputPath, edits });
    if (nativeResult.mode === "native_text_edit" && nativeResult.outputPath) {
      return {
        outputPath: nativeResult.outputPath,
        editedCount: nativeResult.editedCount,
        deletedCount: nativeResult.deletedCount,
        addedCount: nativeResult.addedCount,
        warnings: Array.from(new Set(nativeResult.warnings)),
        mode: nativeResult.mode
      };
    }

    const pdfDoc = await PDFDocument.load(await readFile(sourcePath), { ignoreEncryption: false });
    pdfDoc.registerFontkit(fontkit);
    this.fonts.reset();

    let editedCount = 0;
    let deletedCount = 0;
    let addedCount = 0;
    const warnings = [
      ...nativeResult.warnings,
      "PDF 편집 저장은 원본 글꼴, 글자 크기, 줄 흐름을 유지할 수 없는 경우 결과 파일을 만들기 전에 중단합니다."
    ];

    for (const edit of edits) {
      const page = pdfDoc.getPage(edit.pageNumber - 1);
      const pageHeight = page.getHeight();
      const x = clamp(edit.x, 0, page.getWidth());
      const yTop = clamp(edit.y, 0, pageHeight);
      const width = clamp(edit.width, 1, page.getWidth());
      const height = clamp(edit.height, Math.max(6, edit.fontSize * 0.9), pageHeight);
      const pdfY = clamp(pageHeight - yTop - height, 0, pageHeight);
      const coverX = clamp(edit.coverX ?? edit.x, 0, page.getWidth());
      const coverYTop = clamp(edit.coverY ?? edit.y, 0, pageHeight);
      const coverWidth = clamp(edit.coverWidth ?? edit.width, 1, page.getWidth());
      const coverHeight = clamp(edit.coverHeight ?? edit.height, Math.max(6, edit.fontSize * 0.9), pageHeight);
      const coverPdfY = clamp(pageHeight - coverYTop - coverHeight, 0, pageHeight);
      const fontSize = clamp(edit.fontSize || 10, 5, 96);
      const replacement = (edit.replacementText || "").normalize("NFC");

      if (edit.action === "replace" || edit.action === "delete") {
        page.drawRectangle({
          x: Math.max(0, coverX - 1),
          y: Math.max(0, coverPdfY - 1),
          width: Math.min(page.getWidth() - Math.max(0, coverX - 1), coverWidth + 2),
          height: Math.min(pageHeight - Math.max(0, coverPdfY - 1), coverHeight + 2),
          color: rgb(1, 1, 1)
        });
      }

      if (edit.action !== "delete" && replacement.trim()) {
        const fontChoice = await this.fonts.resolveFont(pdfDoc, replacement, edit.fontFamily);

        if (edit.action === "replace") {
          this.assertSafeReplacement(edit, replacement, fontChoice.embedded, fontChoice.font, width, height, fontSize);
        } else if (!fontChoice.embedded && containsNonWinAnsi(replacement)) {
          throw new Error(
            "로컬 서체를 찾지 못해 PDF 저장을 중단했습니다. 글씨체가 바뀌는 결과를 만들지 않기 위해 원본 파일은 변경하지 않았습니다."
          );
        }

        const lines =
          edit.action === "replace"
            ? [replacement]
            : wrapPdfEditorText(fontChoice.font, replacement, Math.max(1, width), fontSize);
        const lineHeight = fontSize * 1.18;
        const color = parsePdfEditorRgb(edit.color);

        lines.forEach((line, index) => {
          page.drawText(line, {
            x,
            y: clamp(pdfY + height - fontSize - index * lineHeight, 0, pageHeight),
            size: fontSize,
            font: fontChoice.font,
            color
          });
        });
      }

      if (edit.action === "add") addedCount += 1;
      if (edit.action === "delete") deletedCount += 1;
      if (edit.action === "replace") editedCount += 1;
    }

    await writeFile(outputPath, await pdfDoc.save({ useObjectStreams: false }));
    const verification = await this.editVerification.verify({ outputPath });
    if (!verification.ok || !(await this.signatures.isPdf(outputPath))) {
      throw new Error(verification.details ? `${verification.message}\n${verification.details}` : verification.message);
    }

    return {
      outputPath,
      editedCount,
      deletedCount,
      addedCount,
      warnings: Array.from(new Set(warnings)),
      mode: "surface_overlay_edit"
    };
  }

  private normalizeEdits(edits: PdfEditorEdit[]): PdfEditorEdit[] {
    if (!Array.isArray(edits)) return [];
    return edits.flatMap((edit) => {
      if (!edit || !["replace", "delete", "add"].includes(edit.action)) return [];
      const pageNumber = Math.trunc(Number(edit.pageNumber));
      if (pageNumber < 1) return [];
      return [
        {
          ...edit,
          pageNumber,
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
          color: typeof edit.color === "string" ? edit.color : undefined
        }
      ];
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
        "원본 글꼴과 매칭되는 로컬 서체를 찾지 못해 PDF 저장을 중단했습니다. 글씨체가 바뀌는 결과를 만들지 않기 위해 원본 파일은 변경하지 않았습니다."
      );
    }

    if (/\r|\n/.test(replacement)) {
      throw new Error(
        "한 줄 텍스트를 여러 줄로 바꾸면 원본 줄 간격이 틀어질 수 있어 PDF 저장을 중단했습니다. 텍스트 추가 기능으로 별도 줄을 추가해주세요."
      );
    }

    const measuredWidth = font.widthOfTextAtSize(replacement, fontSize);
    if (measuredWidth > width * 1.02) {
      throw new Error(
        "수정한 텍스트가 원본 텍스트 영역보다 길어 글자 간격이나 형태가 틀어질 수 있습니다. 저장을 중단했고 원본 파일은 변경하지 않았습니다."
      );
    }

    if (fontSize > height * 1.35) {
      throw new Error(
        "원본 텍스트 영역의 높이를 안전하게 판단하지 못해 PDF 저장을 중단했습니다. 글씨 형태가 틀어지는 결과를 만들지 않았습니다."
      );
    }

    if (edit.originalText && containsNonWinAnsi(edit.originalText) && containsNonWinAnsi(replacement) && !edit.fontFamily) {
      throw new Error(
        "원본 한글 글꼴 정보를 확인하지 못해 PDF 저장을 중단했습니다. 글씨체가 바뀌는 결과를 만들지 않기 위해 원본 파일은 변경하지 않았습니다."
      );
    }
  }

  private async validatePdfInput(filePath: string): Promise<string> {
    const resolved = await this.validation.validateInputPath(filePath);
    if (path.extname(resolved).toLowerCase() !== ".pdf") {
      throw new Error("PDF 편집기에는 PDF 파일만 사용할 수 있습니다.");
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
