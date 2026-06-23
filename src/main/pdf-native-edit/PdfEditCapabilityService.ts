import type { PdfEditorEdit } from "../types/conversion.js";
import type { PdfNativeTextSpan } from "./PdfTextOperatorScanner.js";

export type PdfNativeSaveMode =
  | "direct_replace"
  | "delete_original"
  | "neutralize_and_insert"
  | "add_text"
  | "unsupported";

export interface PdfEditPlanItem {
  edit: PdfEditorEdit;
  mode: PdfNativeSaveMode;
  span?: PdfNativeTextSpan;
  reason?: string;
}

export class PdfEditCapabilityService {
  classify(edit: PdfEditorEdit, span?: PdfNativeTextSpan): PdfEditPlanItem {
    if (edit.action === "line" || edit.action === "image") {
      return {
        edit,
        mode: "unsupported",
        reason: "image_or_line_native_patch_not_supported"
      };
    }

    if (edit.action === "add") {
      const replacement = (edit.replacementText || "").normalize("NFC");
      if (!replacement.trim()) return { edit, mode: "unsupported", reason: "empty_addition" };
      if (/\r|\n/.test(replacement)) return { edit, mode: "unsupported", reason: "multiline_addition_not_supported" };
      return { edit, mode: "add_text" };
    }

    if (!span) {
      return { edit, mode: "unsupported", reason: edit.nativeSpanId ? "native_span_not_found" : "native_span_not_mapped" };
    }

    if (!span.simplePatchable) {
      return { edit, mode: "unsupported", reason: "complex_text_operator" };
    }

    if (edit.action === "delete") {
      return { edit, span, mode: "delete_original" };
    }

    const replacement = (edit.replacementText || "").normalize("NFC");
    if (!replacement) {
      return { edit, span, mode: "delete_original" };
    }

    if (/\r|\n/.test(replacement)) {
      return { edit, span, mode: "unsupported", reason: "multiline_replacement_not_supported" };
    }

    if (edit.saveMode === "neutralize_and_insert" || hasGeometryChange(edit)) {
      return { edit, span, mode: "neutralize_and_insert", reason: "geometry_changed" };
    }

    if (span.fontCodec.canEncode(replacement)) {
      return { edit, span, mode: "direct_replace" };
    }

    return { edit, span, mode: "neutralize_and_insert", reason: "original_font_cannot_encode_replacement" };
  }
}

export function formatUnsupportedReason(reason?: string): string {
  const map: Record<string, string> = {
    native_span_not_found: "PDF 내부 텍스트 명령을 다시 찾지 못했습니다.",
    native_span_not_mapped: "PDF 내부 텍스트 명령과 안전하게 연결되지 않았습니다.",
    complex_text_operator: "PDF 내부 텍스트 명령 구조가 복잡합니다.",
    multiline_replacement_not_supported: "한 줄 텍스트를 여러 줄로 바꾸는 저장은 아직 제한됩니다.",
    multiline_addition_not_supported: "여러 줄 추가 텍스트 저장은 아직 제한됩니다.",
    empty_addition: "추가 텍스트가 비어 있습니다.",
    image_or_line_native_patch_not_supported: "이미지/선 객체의 직접 저장 편집은 아직 제한되어 있습니다.",
    original_font_cannot_encode_replacement: "원본 글꼴로 새 문자를 표현할 수 없습니다.",
    geometry_changed: "텍스트 위치나 크기가 변경되었습니다."
  };
  return map[reason || ""] || reason || "지원하지 않는 편집입니다.";
}

function hasGeometryChange(edit: PdfEditorEdit): boolean {
  if (edit.originalX === undefined || edit.originalY === undefined) return false;
  return (
    Math.abs(edit.x - edit.originalX) > 0.1 ||
    Math.abs(edit.y - edit.originalY) > 0.1 ||
    Math.abs(edit.width - (edit.originalWidth ?? edit.width)) > 0.1 ||
    Math.abs(edit.height - (edit.originalHeight ?? edit.height)) > 0.1
  );
}
