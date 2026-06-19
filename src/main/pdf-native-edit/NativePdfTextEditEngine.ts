import { readFile, unlink } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { DebugLogService } from "../services/DebugLogService.js";
import {
  fitPdfEditorFontSize,
  parsePdfEditorRgb,
  PdfEditorFontService,
  wrapPdfEditorText
} from "../services/PdfEditorFontService.js";
import type { PdfEditorEdit } from "../types/conversion.js";
import { PdfContentStreamParser } from "./PdfContentStreamParser.js";
import { PdfContentStreamWriter } from "./PdfContentStreamWriter.js";
import { PdfEditCapabilityService } from "./PdfEditCapabilityService.js";
import { PdfEditVerificationService } from "./PdfEditVerificationService.js";
import { PdfFontMapResolver } from "./PdfFontMapResolver.js";
import { PdfTextOperatorScanner } from "./PdfTextOperatorScanner.js";
import type {
  NativePdfEditCapability,
  NativePdfEditFallbackReason,
  NativePdfEditRequest,
  NativePdfEditResult
} from "./types.js";

export class NativePdfTextEditEngine {
  constructor(
    private readonly parser = new PdfContentStreamParser(),
    private readonly scanner = new PdfTextOperatorScanner(),
    private readonly fontResolver = new PdfFontMapResolver(),
    private readonly capabilityService = new PdfEditCapabilityService(),
    private readonly writer = new PdfContentStreamWriter(),
    private readonly verification = new PdfEditVerificationService(),
    private readonly fontService = new PdfEditorFontService(),
    private readonly debugLog = new DebugLogService()
  ) {}

  async trySave(request: NativePdfEditRequest): Promise<NativePdfEditResult> {
    try {
      const sourceBytes = await readFile(request.sourcePath);
      const pdfDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
      this.fontService.reset();
      pdfDoc.registerFontkit(fontkit as Parameters<PDFDocument["registerFontkit"]>[0]);
      const textEditRequests = request.edits.filter((edit) => edit.action === "replace" || edit.action === "delete");
      const additions = request.edits.filter((edit) => edit.action === "add" && String(edit.replacementText || "").trim());
      if (textEditRequests.length === 0 && additions.length === 0) {
        return this.fallback(request, "non_replace_edit", "저장할 텍스트 편집 내용이 없습니다.");
      }

      let streams = this.parser.parseDocument(pdfDoc);
      let capabilities: NativePdfEditCapability[] = [];
      if (textEditRequests.length > 0) {
        const parserFailure = streams.find((stream) => stream.unsupportedReason)?.unsupportedReason;
        if (parserFailure) {
          return this.fallback(request, parserFailure, `content stream parser reported ${parserFailure}`);
        }

        const pageFonts = this.fontResolver.resolve(streams);
        const spans = this.scanner.scan(streams, pageFonts);
        if (spans.length === 0) {
          return this.fallback(request, "image_only_pdf", "수정 가능한 PDF 텍스트 출력 연산자를 찾지 못했습니다.");
        }

        capabilities = this.capabilityService.assess(textEditRequests, spans, pageFonts);
        if (capabilities.some((capability) => !capability.directEditable)) {
          return this.fallback(request, undefined, undefined, capabilities);
        }
      } else {
        streams = [];
      }

      const patches = this.writer.createPatches(capabilities);
      await this.applyAdditions(pdfDoc, additions);
      await this.writer.write(pdfDoc, streams, patches, request.outputPath);

      const verification = await this.verification.verify({
        outputPath: request.outputPath,
        expectedReplacementTexts: request.edits
          .filter((edit) => edit.action !== "delete")
          .map((edit) => edit.replacementText || "")
      });
      if (!verification.ok) {
        await removeIfExists(request.outputPath);
        return this.fallback(request, "verification_failed", verification.details || verification.message, capabilities);
      }

      await this.debugLog.write({
        scope: "pdf-native-edit",
        message: "Native PDF text edit succeeded.",
        filePath: request.sourcePath,
        data: {
          outputPath: request.outputPath,
          editCount: request.edits.length,
          patchCount: patches.length,
          addedTextCount: additions.length
        }
      });

      return {
        mode: "native_text_edit",
        outputPath: request.outputPath,
        ...countEdits(request.edits),
        warnings: [],
        capabilities: [...capabilities, ...additionCapabilities(additions)]
      };
    } catch (error) {
      await removeIfExists(request.outputPath);
      const reason = isEncryptedError(error) ? "encrypted_pdf" : "native_patch_failed";
      return this.fallback(request, reason, error instanceof Error ? error.message : String(error), undefined, error);
    }
  }

  private async applyAdditions(pdfDoc: PDFDocument, additions: PdfEditorEdit[]): Promise<void> {
    if (additions.length === 0) return;

    for (const addition of additions) {
      const pageIndex = Math.trunc(addition.pageNumber) - 1;
      if (pageIndex < 0 || pageIndex >= pdfDoc.getPageCount()) {
        throw new Error("추가 텍스트의 페이지 번호가 PDF 범위를 벗어났습니다.");
      }

      const page = pdfDoc.getPage(pageIndex);
      const pageHeight = page.getHeight();
      const x = clamp(addition.x, 0, page.getWidth());
      const yTop = clamp(addition.y, 0, pageHeight);
      const text = String(addition.replacementText || "").normalize("NFC");
      const { font } = await this.fontService.resolveFont(pdfDoc, text, addition.fontFamily);
      const maxWidth = clamp(addition.width, 8, page.getWidth() - x);
      const fontSize = fitPdfEditorFontSize(font, text, maxWidth, addition.fontSize || 10);
      const height = clamp(addition.height, Math.max(6, fontSize * 0.9), pageHeight);
      const maxLines = Math.max(1, Math.floor(height / (fontSize * 1.18)));
      const lines = wrapPdfEditorText(font, text, maxWidth, fontSize)
        .filter((line) => line.trim())
        .slice(0, maxLines);
      const color = parsePdfEditorRgb(addition.color);
      const lineHeight = fontSize * 1.18;

      lines.forEach((line, index) => {
        page.drawText(line, {
          x,
          y: clamp(pageHeight - yTop - fontSize - index * lineHeight, 0, pageHeight),
          size: fontSize,
          font,
          color
        });
      });
    }
  }

  private async fallback(
    request: NativePdfEditRequest,
    reason?: NativePdfEditFallbackReason,
    detail?: string,
    capabilities?: NativePdfEditCapability[],
    error?: unknown
  ): Promise<NativePdfEditResult> {
    const finalCapabilities =
      capabilities ||
      request.edits.map((edit) => ({
        edit,
        directEditable: false,
        reason: reason || "native_patch_failed",
        detail
      }));
    const warnings = buildFallbackWarnings(finalCapabilities, reason, detail);

    await this.debugLog.write({
      scope: "pdf-native-edit",
      message: "Native PDF text edit failed without surface overlay fallback.",
      filePath: request.sourcePath,
      data: {
        outputPath: request.outputPath,
        reasons: finalCapabilities.map((capability) => ({
          reason: capability.reason,
          detail: capability.detail,
          pageNumber: capability.edit.pageNumber,
          action: capability.edit.action,
          originalText: capability.edit.originalText,
          replacementText: capability.edit.replacementText
        })),
        reason,
        detail
      },
      error
    });

    return {
      mode: "failed",
      ...countEdits(request.edits),
      warnings,
      capabilities: finalCapabilities
    };
  }
}

function countEdits(edits: PdfEditorEdit[]): { editedCount: number; deletedCount: number; addedCount: number } {
  return {
    editedCount: edits.filter((edit) => edit.action === "replace").length,
    deletedCount: edits.filter((edit) => edit.action === "delete").length,
    addedCount: edits.filter((edit) => edit.action === "add").length
  };
}

function buildFallbackWarnings(
  capabilities: NativePdfEditCapability[],
  fallbackReason?: NativePdfEditFallbackReason,
  detail?: string
): string[] {
  const reasonLines = new Set<string>();
  for (const capability of capabilities) {
    const reason = capability.reason || fallbackReason;
    if (!reason) continue;
    const label = fallbackReasonLabel(reason);
    reasonLines.add(capability.detail ? `${label}: ${capability.detail}` : label);
  }
  if (reasonLines.size === 0 && fallbackReason) {
    reasonLines.add(detail ? `${fallbackReasonLabel(fallbackReason)}: ${detail}` : fallbackReasonLabel(fallbackReason));
  }

  return [
    "이 PDF는 내부 텍스트 직접 수정이 어려워 저장을 중단했습니다.",
    "기존 텍스트를 덮어쓰는 표면 편집 방식은 사용하지 않습니다.",
    ...Array.from(reasonLines, (line) => `직접 편집 불가 사유: ${line}`)
  ];
}

function fallbackReasonLabel(reason: NativePdfEditFallbackReason): string {
  const labels: Record<NativePdfEditFallbackReason, string> = {
    image_only_pdf: "텍스트 객체를 찾지 못한 PDF입니다.",
    text_span_not_found: "요청한 원본 텍스트와 일치하는 PDF 텍스트 span을 찾지 못했습니다.",
    no_to_unicode_map: "폰트의 ToUnicode CMap을 확인하지 못했습니다.",
    unsupported_font_encoding: "현재 폰트 encoding으로 새 문자열을 안전하게 쓸 수 없습니다.",
    replacement_too_long: "여러 줄 치환은 직접 수정 대상이 아닙니다.",
    multi_operator_text: "텍스트가 여러 PDF 연산자 또는 TJ 배열로 나뉘어 있습니다.",
    rotated_or_complex_transform: "회전 또는 복합 변환이 적용된 텍스트입니다.",
    parser_failed: "PDF content stream 파싱에 실패했습니다.",
    encrypted_pdf: "암호화된 PDF입니다.",
    unsupported_content_stream: "지원하지 않는 content stream 구조입니다.",
    non_replace_edit: "지원하지 않는 PDF 편집 동작입니다.",
    geometry_changed: "텍스트 위치 또는 영역 변경이 포함되어 있습니다.",
    ambiguous_text_span: "같은 후보가 여러 개라 직접 수정 대상을 확정하지 못했습니다.",
    native_patch_failed: "content stream patch 생성 또는 저장에 실패했습니다.",
    verification_failed: "저장 후 PDF 검증에 실패했습니다."
  };
  return labels[reason];
}

function isEncryptedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /encrypted|encrypt/i.test(message);
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // Best-effort cleanup. The failed native edit must not leave a partial output file.
  }
}

function additionCapabilities(additions: PdfEditorEdit[]): NativePdfEditCapability[] {
  return additions.map((edit) => ({
    edit,
    directEditable: true,
    detail: "새 PDF 텍스트 객체를 추가했습니다."
  }));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
