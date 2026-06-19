import type { PdfEditorEdit } from "../types/conversion.js";
import { encodeTextWithCMap } from "./PdfToUnicodeCMap.js";
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

    if (edit.action !== "replace" && edit.action !== "delete") {
      return this.reject(edit, "non_replace_edit", "텍스트 추가는 기존 텍스트 치환 대상이 아닙니다.");
    }
    if (edit.action === "replace" && /\r|\n/.test(replacementText)) {
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

    const originalText = String(edit.originalText || "").normalize("NFC");
    if (fontInfo.supportsToUnicodeEncoding && fontInfo.toUnicodeMap) {
      if (edit.action === "replace" && encodeTextWithCMap(replacementText, fontInfo.toUnicodeMap) === undefined) {
        return this.reject(
          edit,
          "unsupported_font_encoding",
          "새 텍스트에 현재 PDF 폰트 subset에 없는 glyph가 포함되어 있습니다.",
          span
        );
      }
      return {
        edit,
        directEditable: true,
        matchedSpan: span
      };
    }

    if (fontInfo.isSubset || !fontInfo.supportsSimpleAnsiText) {
      return this.reject(edit, "unsupported_font_encoding", "subset 또는 복합 폰트라 새 문자열의 glyph encoding을 보장하지 않습니다.", span);
    }

    if (!isSimpleAnsi(originalText) || (edit.action === "replace" && !isSimpleAnsi(replacementText))) {
      return this.reject(edit, "unsupported_font_encoding", "단순 ANSI 폰트에서 표현할 수 없는 텍스트입니다.", span);
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

