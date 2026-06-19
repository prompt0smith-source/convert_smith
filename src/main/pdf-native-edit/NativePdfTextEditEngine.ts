import { readFile, unlink } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { DebugLogService } from "../services/DebugLogService.js";
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
    private readonly debugLog = new DebugLogService()
  ) {}

  async trySave(request: NativePdfEditRequest): Promise<NativePdfEditResult> {
    try {
      const sourceBytes = await readFile(request.sourcePath);
      const pdfDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: false });
      const streams = this.parser.parseDocument(pdfDoc);
      const parserFailure = streams.find((stream) => stream.unsupportedReason)?.unsupportedReason;
      if (parserFailure) {
        return this.fallback(request, parserFailure, `content stream parser reported ${parserFailure}`);
      }

      const spans = this.scanner.scan(streams);
      if (spans.length === 0) {
        return this.fallback(request, "image_only_pdf", "수정 가능한 PDF 텍스트 출력 연산자를 찾지 못했습니다.");
      }

      const pageFonts = this.fontResolver.resolve(streams);
      const capabilities = this.capabilityService.assess(request.edits, spans, pageFonts);
      if (capabilities.some((capability) => !capability.directEditable)) {
        return this.fallback(request, undefined, undefined, capabilities);
      }

      const patches = this.writer.createPatches(capabilities);
      await this.writer.write(pdfDoc, streams, patches, request.outputPath);

      const verification = await this.verification.verify({
        outputPath: request.outputPath,
        expectedReplacementTexts: request.edits.map((edit) => edit.replacementText || "")
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
          patchCount: patches.length
        }
      });

      return {
        mode: "native_text_edit",
        outputPath: request.outputPath,
        ...countEdits(request.edits),
        warnings: [],
        capabilities
      };
    } catch (error) {
      await removeIfExists(request.outputPath);
      const reason = isEncryptedError(error) ? "encrypted_pdf" : "native_patch_failed";
      return this.fallback(request, reason, error instanceof Error ? error.message : String(error), undefined, error);
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
      message: "Native PDF text edit fell back to surface overlay.",
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
      mode: "surface_overlay_edit",
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
    "이 PDF는 내부 텍스트 직접 수정이 어려워 표면 편집 방식으로 저장했습니다.",
    ...Array.from(reasonLines, (line) => `직접 편집 불가 사유: ${line}`)
  ];
}

function fallbackReasonLabel(reason: NativePdfEditFallbackReason): string {
  const labels: Record<NativePdfEditFallbackReason, string> = {
    image_only_pdf: "텍스트 객체를 찾지 못한 PDF입니다.",
    text_span_not_found: "요청한 원본 텍스트와 일치하는 PDF 텍스트 span을 찾지 못했습니다.",
    no_to_unicode_map: "폰트의 ToUnicode CMap을 확인하지 못했습니다.",
    unsupported_font_encoding: "현재 폰트 encoding으로 새 문자열을 안전하게 쓸 수 없습니다.",
    replacement_too_long: "새 텍스트가 원래 텍스트 영역보다 길어질 수 있습니다.",
    multi_operator_text: "텍스트가 여러 PDF 연산자 또는 TJ 배열로 나뉘어 있습니다.",
    rotated_or_complex_transform: "회전 또는 복합 변환이 적용된 텍스트입니다.",
    parser_failed: "PDF content stream 파싱에 실패했습니다.",
    encrypted_pdf: "암호화된 PDF입니다.",
    unsupported_content_stream: "지원하지 않는 content stream 구조입니다.",
    non_replace_edit: "추가/삭제 편집은 네이티브 직접 수정 대상이 아닙니다.",
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
    // Best-effort cleanup. The surface overlay fallback will use the same output path.
  }
}
