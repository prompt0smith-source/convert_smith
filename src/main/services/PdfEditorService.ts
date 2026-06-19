import path from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createPdfjsDocumentOptions } from "./PdfjsAssetService.js";
import { applyLocalFontMatches, warmPdfPageFonts } from "./LocalFontMatchService.js";
import { extractPdfReadingOrderFragments } from "./PdfReadingOrderService.js";
import { applyPdfTextColors } from "./PdfTextColorService.js";
import { FileSignatureService } from "./FileSignatureService.js";
import { ValidationService } from "./ValidationService.js";
import { DependencyService } from "./DependencyService.js";
import { NativePdfTextEditEngine } from "../pdf-native-edit/NativePdfTextEditEngine.js";
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
  private readonly nativeTextEdit = new NativePdfTextEditEngine();

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

    throw new Error(
      [
        "PDF 내부 텍스트를 직접 수정하지 못해 저장을 중단했습니다.",
        "기존 텍스트 위를 흰 영역으로 가리고 새 텍스트를 얹는 방식은 더 이상 사용하지 않습니다.",
        ...nativeResult.warnings
      ].join("\n")
    );
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

function roundPoint(value: number): number {
  return Math.round(value * 100) / 100;
}
