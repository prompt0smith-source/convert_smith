import type { PDFDocument } from "pdf-lib";
import type { PdfEditorEdit } from "../types/conversion.js";
import { formatUnsupportedReason, type PdfEditPlanItem } from "./PdfEditCapabilityService.js";
import { PdfContentStreamWriter } from "./PdfContentStreamWriter.js";
import { PdfEditPlanService } from "./PdfEditPlanService.js";
import { PdfTextOperatorScanner, type PdfNativeTextSpan } from "./PdfTextOperatorScanner.js";

export interface PdfNativeTextInsertion {
  edit: PdfEditorEdit;
  mode: "neutralize_and_insert" | "add_text";
  reason?: string;
}

export interface PdfNativeTextEditResult {
  replacedCount: number;
  deletedCount: number;
  addedCount: number;
  neutralizedCount: number;
  insertions: PdfNativeTextInsertion[];
  warnings: string[];
  planItems: PdfEditPlanItem[];
}

interface PdfNativeTextGroupPlanItem {
  edit: PdfEditorEdit;
  spans: PdfNativeTextSpan[];
  mode: "delete_original" | "neutralize_and_insert" | "unsupported";
  reason?: string;
}

export class NativePdfTextEditEngine {
  private readonly scanner = new PdfTextOperatorScanner();
  private readonly planner = new PdfEditPlanService();
  private readonly writer = new PdfContentStreamWriter();

  scanTextSpans(pdfDoc: PDFDocument): PdfNativeTextSpan[] {
    return this.scanner.scanDocument(pdfDoc).spans;
  }

  applyTextEdits(pdfDoc: PDFDocument, edits: PdfEditorEdit[]): PdfNativeTextEditResult {
    const scan = this.scanner.scanDocument(pdfDoc);
    const groupPlan = this.createGroupEditPlan(edits, scan.spans);
    const groupedEditSet = new Set([
      ...groupPlan.items.map((item) => item.edit),
      ...groupPlan.unsupported.map((item) => item.edit)
    ]);
    const normalEdits = edits.filter((edit) => !groupedEditSet.has(edit));
    const plan = this.planner.createPlan(normalEdits, scan.spans);

    const unsupported = [...groupPlan.unsupported, ...plan.unsupported];
    if (unsupported.length > 0) {
      throw new Error(createUnsupportedEditMessage(unsupported));
    }

    const groupPlanItems = groupPlan.items.map(toEditPlanItem);
    const streamStateByKey = new Map(scan.streamStates.map((state) => [`${state.pageNumber}:${state.streamIndex}`, state]));
    const result: PdfNativeTextEditResult = {
      replacedCount: 0,
      deletedCount: 0,
      addedCount: 0,
      neutralizedCount: 0,
      insertions: [],
      warnings: [],
      planItems: [...groupPlanItems, ...plan.items]
    };

    for (const item of groupPlan.items) {
      if (item.mode === "unsupported") continue;
      for (const span of item.spans) {
        const state = streamStateByKey.get(`${span.pageNumber}:${span.streamIndex}`);
        if (!state) throw new Error("PDF 내부 텍스트 stream을 다시 찾지 못했습니다.");
        state.patches.push(this.scanner.createReplacementPatch(span, ""));
      }

      if (item.mode === "delete_original") {
        result.deletedCount += 1;
        continue;
      }

      result.neutralizedCount += 1;
      result.insertions.push({
        edit: { ...item.edit, saveMode: "neutralize_and_insert" },
        mode: "neutralize_and_insert",
        reason: item.reason
      });
    }

    for (const item of plan.items) {
      if (item.mode === "add_text") {
        result.insertions.push({ edit: { ...item.edit, saveMode: "add_text" }, mode: "add_text" });
        result.addedCount += 1;
        continue;
      }

      const span = item.span;
      if (!span) continue;
      const state = streamStateByKey.get(`${span.pageNumber}:${span.streamIndex}`);
      if (!state) throw new Error("PDF 내부 텍스트 stream을 다시 찾지 못했습니다.");

      if (item.mode === "delete_original") {
        state.patches.push(this.scanner.createReplacementPatch(span, ""));
        result.deletedCount += 1;
        continue;
      }

      if (item.mode === "direct_replace") {
        const replacement = (item.edit.replacementText || "").normalize("NFC");
        state.patches.push(this.scanner.createReplacementPatch(span, replacement));
        result.replacedCount += 1;
        continue;
      }

      if (item.mode === "neutralize_and_insert") {
        state.patches.push(this.scanner.createReplacementPatch(span, ""));
        result.neutralizedCount += 1;
        result.insertions.push({
          edit: { ...item.edit, saveMode: "neutralize_and_insert" },
          mode: "neutralize_and_insert",
          reason: item.reason
        });
      }
    }

    this.writer.applyPatchedStreams(pdfDoc, scan.streamStates);
    if (result.neutralizedCount > 0) {
      result.warnings.push("일부 텍스트는 원본 텍스트 명령을 비우고 새 글꼴의 실제 PDF 텍스트 객체로 다시 삽입했습니다.");
    }
    return result;
  }

  private createGroupEditPlan(
    edits: PdfEditorEdit[],
    spans: PdfNativeTextSpan[]
  ): { items: PdfNativeTextGroupPlanItem[]; unsupported: PdfEditPlanItem[] } {
    const spansById = new Map(spans.map((span) => [span.id, span]));
    const items: PdfNativeTextGroupPlanItem[] = [];
    const unsupported: PdfEditPlanItem[] = [];

    for (const edit of edits) {
      const ids = parseNativeSpanGroupIds(edit.nativeSpanId);
      if (!ids) continue;

      const groupSpans = ids.map((id) => spansById.get(id)).filter((span): span is PdfNativeTextSpan => Boolean(span));
      if (groupSpans.length !== ids.length) {
        unsupported.push({ edit, mode: "unsupported", reason: "native_span_group_not_found" });
        continue;
      }
      if (groupSpans.some((span) => !span.simplePatchable)) {
        unsupported.push({ edit, mode: "unsupported", reason: "multi_span_group_complex" });
        continue;
      }

      if (edit.action === "delete" || !(edit.replacementText || "").normalize("NFC")) {
        items.push({ edit, spans: groupSpans, mode: "delete_original" });
        continue;
      }

      const replacement = (edit.replacementText || "").normalize("NFC");
      if (/\r|\n/.test(replacement)) {
        unsupported.push({ edit, mode: "unsupported", reason: "multiline_replacement_not_supported" });
        continue;
      }

      items.push({
        edit,
        spans: groupSpans,
        mode: "neutralize_and_insert",
        reason: "multi_span_text_group"
      });
    }

    return { items, unsupported };
  }
}

function createUnsupportedEditMessage(items: PdfEditPlanItem[]): string {
  const details = items
    .slice(0, 6)
    .map((item, index) => {
      const title = summarizeEdit(item.edit);
      return `${index + 1}. ${title}: ${formatUnsupportedReason(item.reason)}`;
    })
    .join("\n");

  const hasImageOrLine = items.some((item) => item.reason === "image_or_line_native_patch_not_supported");
  const prefix = hasImageOrLine
    ? "이미지/선 객체의 직접 저장 편집은 아직 제한되어 있습니다. 시각적으로 덮어쓰는 방식은 사용하지 않았습니다."
    : "이 PDF 편집은 내부 구조상 안전하게 직접 저장하기 어렵습니다. 흰 박스 덮어쓰기 방식은 사용하지 않았습니다.";

  return [prefix, details ? `\n제한 항목:\n${details}` : undefined].filter(Boolean).join("\n");
}

function summarizeEdit(edit: PdfEditorEdit): string {
  const text = (edit.replacementText || edit.originalText || edit.action).replace(/\s+/g, " ").trim();
  return text.length > 24 ? `${text.slice(0, 24)}...` : text || edit.action;
}

function toEditPlanItem(item: PdfNativeTextGroupPlanItem): PdfEditPlanItem {
  return {
    edit: item.edit,
    mode: item.mode,
    span: item.spans[0],
    reason: item.reason
  };
}

function parseNativeSpanGroupIds(nativeSpanId: string | undefined): string[] | undefined {
  if (!nativeSpanId?.startsWith("group:")) return undefined;
  const ids = nativeSpanId
    .slice("group:".length)
    .split("|")
    .map((id) => id.trim())
    .filter(Boolean);
  return ids.length > 1 ? ids : undefined;
}
