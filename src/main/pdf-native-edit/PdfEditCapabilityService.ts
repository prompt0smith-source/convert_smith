import type { PdfEditorEdit } from "../types/conversion.js";
import { PdfTextSpanMatcher } from "./PdfTextSpanMatcher.js";
import type {
  NativePdfEditCapability,
  NativePdfEditFallbackReason,
  NativePdfTextSpan,
  PdfFontMap
} from "./types.js";

export class PdfEditCapabilityService {
  constructor(private readonly matcher = new PdfTextSpanMatcher()) {}

  assess(
    edits: PdfEditorEdit[],
    spans: NativePdfTextSpan[],
    pageFonts: Map<number, PdfFontMap>
  ): NativePdfEditCapability[] {
    return edits.map((edit) => this.assessEdit(edit, spans, pageFonts));
  }

  private assessEdit(
    edit: PdfEditorEdit,
    spans: NativePdfTextSpan[],
    pageFonts: Map<number, PdfFontMap>
  ): NativePdfEditCapability {
    const replacementText = String(edit.replacementText || "").normalize("NFC");

    if (edit.action !== "replace") {
      return this.reject(edit, "non_replace_edit", "추가/삭제 편집은 기존 표면 편집 방식으로 저장합니다.");
    }
    if (!replacementText.trim()) {
      return this.reject(edit, "non_replace_edit", "빈 문자열 치환은 삭제 편집과 같아 표면 편집으로 저장합니다.");
    }
    if (/\r|\n/.test(replacementText)) {
      return this.reject(edit, "replacement_too_long", "여러 줄 치환은 원래 텍스트 객체에 안전하게 넣지 않습니다.");
    }
    if (hasGeometryChange(edit)) {
      return this.reject(edit, "geometry_changed", "텍스트 위치나 영역이 변경되어 content stream 직접 치환을 사용하지 않습니다.");
    }

    const match = this.matcher.match(edit, spans);
    if (!match.span) {
      return this.reject(edit, match.reason || "text_span_not_found", match.detail);
    }

    const span = match.span;
    if (span.operator !== "Tj") {
      return this.reject(edit, "multi_operator_text", "TJ 배열로 나뉜 텍스트는 1차 네이티브 엔진에서 직접 수정하지 않습니다.", span);
    }
    if (span.encodedKind === "array") {
      return this.reject(edit, "multi_operator_text", "여러 문자열 조각으로 구성된 텍스트입니다.", span);
    }
    if (hasComplexTransform(span.transformMatrix)) {
      return this.reject(edit, "rotated_or_complex_transform", "회전/기울임/복합 변환이 있는 텍스트입니다.", span);
    }
    if (!span.fontResourceName) {
      return this.reject(edit, "unsupported_font_encoding", "텍스트 출력 시점의 폰트 리소스를 확인하지 못했습니다.", span);
    }

    const fontInfo = pageFonts.get(edit.pageNumber)?.get(span.fontResourceName);
    if (!fontInfo) {
      return this.reject(edit, "unsupported_font_encoding", "페이지 폰트 리소스에서 해당 폰트를 찾지 못했습니다.", span);
    }
    if (!fontInfo.hasToUnicode && !fontInfo.supportsSimpleAnsiText) {
      return this.reject(edit, "no_to_unicode_map", "ToUnicode CMap이 없고 단순 ANSI 폰트로도 판단되지 않습니다.", span);
    }
    if (fontInfo.isSubset || !fontInfo.supportsSimpleAnsiText) {
      return this.reject(edit, "unsupported_font_encoding", "subset 또는 복합 폰트라 새 문자열의 glyph encoding을 보장하지 않습니다.", span);
    }

    const originalText = String(edit.originalText || "").normalize("NFC");
    if (!isSimpleAnsi(originalText) || !isSimpleAnsi(replacementText)) {
      return this.reject(edit, "unsupported_font_encoding", "1차 네이티브 엔진은 단순 ANSI 텍스트만 직접 치환합니다.", span);
    }
    if (replacementText.length > originalText.length) {
      return this.reject(edit, "replacement_too_long", "새 텍스트가 원래 텍스트보다 길어 레이아웃 변형 위험이 있습니다.", span);
    }
    if (ansiBytes(replacementText).length > span.encodedBytes.length) {
      return this.reject(edit, "replacement_too_long", "새 문자열을 같은 encoding으로 쓰면 원래 byte 길이를 초과합니다.", span);
    }

    return {
      edit,
      directEditable: true,
      matchedSpan: span
    };
  }

  private reject(
    edit: PdfEditorEdit,
    reason: NativePdfEditFallbackReason,
    detail?: string,
    matchedSpan?: NativePdfTextSpan
  ): NativePdfEditCapability {
    return {
      edit,
      directEditable: false,
      reason,
      detail,
      matchedSpan
    };
  }
}

function hasGeometryChange(edit: PdfEditorEdit): boolean {
  if (edit.coverX === undefined || edit.coverY === undefined || edit.coverWidth === undefined || edit.coverHeight === undefined) {
    return false;
  }
  return (
    Math.abs(edit.x - edit.coverX) > 0.5 ||
    Math.abs(edit.y - edit.coverY) > 0.5 ||
    Math.abs(edit.width - edit.coverWidth) > 0.5 ||
    Math.abs(edit.height - edit.coverHeight) > 0.5
  );
}

function hasComplexTransform(matrix: NativePdfTextSpan["transformMatrix"]): boolean {
  const [, b, c, d] = matrix;
  return Math.abs(b) > 0.001 || Math.abs(c) > 0.001 || d <= 0;
}

function isSimpleAnsi(value: string): boolean {
  return Array.from(value).every((char) => {
    const code = char.charCodeAt(0);
    return code >= 0x20 && code <= 0x7e;
  });
}

function ansiBytes(value: string): Uint8Array {
  return new Uint8Array(Array.from(value, (char) => char.charCodeAt(0) & 0xff));
}
