import type { PdfEditorEdit } from "../types/conversion.js";
import type { NativePdfEditFallbackReason, NativePdfTextSpan } from "./types.js";

export interface PdfTextSpanMatch {
  span?: NativePdfTextSpan;
  reason?: NativePdfEditFallbackReason;
  detail?: string;
}

export class PdfTextSpanMatcher {
  match(edit: PdfEditorEdit, spans: NativePdfTextSpan[]): PdfTextSpanMatch {
    const originalText = normalizeText(edit.originalText);
    if (!originalText) {
      return { reason: "text_span_not_found", detail: "원본 텍스트가 비어 있습니다." };
    }

    const candidates = spans.filter(
      (span) => span.pageNumber === edit.pageNumber && normalizeText(span.decodedText) === originalText
    );
    if (candidates.length === 0) {
      return { reason: "text_span_not_found", detail: "PDF content stream에서 같은 텍스트 span을 찾지 못했습니다." };
    }

    const targetX = edit.coverX ?? edit.x;
    const targetY = edit.coverY ?? edit.y;
    const scored = candidates
      .map((span) => ({
        span,
        score: scoreSpan(span, targetX, targetY, edit.fontSize)
      }))
      .sort((left, right) => left.score - right.score);

    const best = scored[0];
    const tolerance = Math.max(14, edit.fontSize * 2.5, Math.min(edit.width, 80));
    if (best.score > tolerance) {
      return {
        reason: "text_span_not_found",
        detail: `좌표가 가까운 텍스트 span이 없습니다. distance=${best.score.toFixed(2)}`
      };
    }

    const second = scored[1];
    if (second && Math.abs(second.score - best.score) < 2) {
      return {
        reason: "ambiguous_text_span",
        detail: "같은 텍스트 후보가 너무 가까워 직접 수정 대상을 확정하지 않았습니다."
      };
    }

    return { span: best.span };
  }
}

function scoreSpan(span: NativePdfTextSpan, targetX: number, targetY: number, fontSize: number): number {
  const dx = span.estimatedX - targetX;
  const dy = span.estimatedY - targetY;
  const fontPenalty = Math.abs((span.fontSize || fontSize) - fontSize) * 1.5;
  return Math.hypot(dx, dy) + fontPenalty;
}

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}
