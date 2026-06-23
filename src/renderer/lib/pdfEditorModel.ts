import type { PdfEditorEdit, PdfEditorGraphicLineItem, PdfEditorImageItem, PdfEditorTextItem } from "../../main/types/conversion";

export interface PdfEditorBoxGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PendingPdfEditorAddition {
  id: string;
  pageNumber: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
}

export const DEFAULT_PDF_EDITOR_ADDITION: Omit<PendingPdfEditorAddition, "id" | "pageNumber"> = {
  text: "",
  x: 72,
  y: 72,
  width: 240,
  height: 22,
  fontSize: 11,
  color: "000000"
};

export function createPdfEditorAddition(
  pageNumber: number,
  count: number,
  pageSize?: { width: number; height: number }
): PendingPdfEditorAddition {
  const x = pageSize ? Math.max(16, Math.round(pageSize.width * 0.18)) : DEFAULT_PDF_EDITOR_ADDITION.x;
  const y = pageSize ? Math.max(16, Math.round(pageSize.height * 0.18)) : DEFAULT_PDF_EDITOR_ADDITION.y;
  return {
    ...DEFAULT_PDF_EDITOR_ADDITION,
    id: `add-${Date.now()}-${count}`,
    pageNumber: Math.max(1, Math.trunc(pageNumber) || 1),
    x,
    y
  };
}

export function countPdfEditorChanges(
  items: PdfEditorTextItem[],
  drafts: Record<string, string>,
  deletedIds: Set<string>,
  additions: PendingPdfEditorAddition[],
  geometryOverrides: Record<string, PdfEditorBoxGeometry> = {},
  lineGeometryOverrides: Record<string, PdfEditorGraphicLineItem> = {},
  imageGeometryOverrides: Record<string, PdfEditorImageItem> = {}
): number {
  const edited = items.filter(
    (item) =>
      deletedIds.has(item.id) ||
      (drafts[item.id] !== undefined && drafts[item.id] !== item.text) ||
      hasGeometryOverride(item, geometryOverrides[item.id])
  ).length;
  const added = additions.filter((item) => item.text.trim()).length;
  return edited + added + Object.keys(lineGeometryOverrides).length + Object.keys(imageGeometryOverrides).length;
}

export function buildPdfEditorEdits(
  items: PdfEditorTextItem[],
  drafts: Record<string, string>,
  deletedIds: Set<string>,
  additions: PendingPdfEditorAddition[],
  geometryOverrides: Record<string, PdfEditorBoxGeometry> = {},
  sourceLines: PdfEditorGraphicLineItem[] = [],
  lineGeometryOverrides: Record<string, PdfEditorGraphicLineItem> = {},
  sourceImages: PdfEditorImageItem[] = [],
  imageGeometryOverrides: Record<string, PdfEditorImageItem> = {}
): PdfEditorEdit[] {
  const edits: PdfEditorEdit[] = [];
  for (const item of items) {
    const geometry = geometryOverrides[item.id] || item;

    if (deletedIds.has(item.id)) {
      const cover = createCoverGeometry(item);
      edits.push({
        action: "delete",
        pageNumber: item.pageNumber,
        sourceIndex: item.sourceIndex,
        nativeSpanId: item.nativeSpanId,
        saveMode: "delete_original",
        originalText: item.text,
        originalX: item.x,
        originalY: item.y,
        originalWidth: item.width,
        originalHeight: item.height,
        coverX: cover.x,
        coverY: cover.y,
        coverWidth: cover.width,
        coverHeight: cover.height,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        fontWeight: item.fontWeight,
        fontStyle: item.fontStyle,
        color: item.color
      });
      continue;
    }

    const draft = drafts[item.id];
    const geometryChanged = hasGeometryOverride(item, geometryOverrides[item.id]);
    if ((draft !== undefined && draft !== item.text) || geometryChanged) {
      const cover = createCoverGeometry(item);
      edits.push({
        action: "replace",
        pageNumber: item.pageNumber,
        sourceIndex: item.sourceIndex,
        nativeSpanId: item.nativeSpanId,
        saveMode: geometryChanged ? "neutralize_and_insert" : "direct_replace",
        originalText: item.text,
        replacementText: draft ?? item.text,
        originalX: item.x,
        originalY: item.y,
        originalWidth: item.width,
        originalHeight: item.height,
        coverX: cover.x,
        coverY: cover.y,
        coverWidth: cover.width,
        coverHeight: cover.height,
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        fontWeight: item.fontWeight,
        fontStyle: item.fontStyle,
        color: item.color
      });
    }
  }

  for (const addition of additions) {
    if (!addition.text.trim()) continue;
    edits.push({
      action: "add",
      pageNumber: Math.max(1, Math.trunc(addition.pageNumber)),
      saveMode: "add_text",
      replacementText: addition.text,
      x: addition.x,
      y: addition.y,
      width: addition.width,
      height: addition.height,
      fontSize: addition.fontSize,
      color: addition.color
    });
  }

  for (const [lineId, adjusted] of Object.entries(lineGeometryOverrides)) {
    const original = sourceLines.find((line) => line.id === lineId);
    if (!original || !hasLineGeometryOverride(original, adjusted)) continue;
    const cover = createLineCoverGeometry(original);
    edits.push({
      action: "line",
      pageNumber: original.pageNumber,
      saveMode: "unsupported",
      coverX: cover.x,
      coverY: cover.y,
      coverWidth: cover.width,
      coverHeight: cover.height,
      x: adjusted.x,
      y: adjusted.y,
      width: adjusted.width,
      height: adjusted.height,
      fontSize: 10,
      x1: adjusted.x1,
      y1: adjusted.y1,
      x2: adjusted.x2,
      y2: adjusted.y2,
      strokeWidth: adjusted.strokeWidth,
      dashArray: adjusted.dashArray,
      dashPhase: adjusted.dashPhase
    });
  }

  for (const [imageId, adjusted] of Object.entries(imageGeometryOverrides)) {
    const original = sourceImages.find((image) => image.id === imageId);
    if (!original || !original.imageDataBase64 || !hasGeometryOverride(original, adjusted)) continue;
    edits.push({
      action: "image",
      pageNumber: original.pageNumber,
      saveMode: "unsupported",
      coverX: original.x,
      coverY: original.y,
      coverWidth: original.width,
      coverHeight: original.height,
      x: adjusted.x,
      y: adjusted.y,
      width: adjusted.width,
      height: adjusted.height,
      fontSize: 10,
      imageDataBase64: original.imageDataBase64,
      mimeType: original.mimeType || "image/png"
    });
  }

  return edits;
}

function hasGeometryOverride(item: PdfEditorBoxGeometry, geometry?: PdfEditorBoxGeometry): boolean {
  if (!geometry) return false;
  return (
    Math.abs(item.x - geometry.x) > 0.1 ||
    Math.abs(item.y - geometry.y) > 0.1 ||
    Math.abs(item.width - geometry.width) > 0.1 ||
    Math.abs(item.height - geometry.height) > 0.1
  );
}

function createCoverGeometry(item: PdfEditorTextItem): PdfEditorBoxGeometry {
  const padX = Math.max(0.25, item.fontSize * 0.025);
  const coverHeight = Math.min(
    item.height,
    Math.max(item.fontSize * 0.82, item.height * 0.58, 1)
  );
  const topInset = Math.max(0, (item.height - coverHeight) * 0.56);
  return {
    x: Math.max(0, item.x - padX),
    y: Math.max(0, item.y + topInset),
    width: item.width + padX * 2,
    height: coverHeight
  };
}

function hasLineGeometryOverride(original: PdfEditorGraphicLineItem, adjusted?: PdfEditorGraphicLineItem): boolean {
  if (!adjusted) return false;
  return (
    Math.abs(original.x1 - adjusted.x1) > 0.1 ||
    Math.abs(original.y1 - adjusted.y1) > 0.1 ||
    Math.abs(original.x2 - adjusted.x2) > 0.1 ||
    Math.abs(original.y2 - adjusted.y2) > 0.1 ||
    Math.abs(original.strokeWidth - adjusted.strokeWidth) > 0.1 ||
    !dashPatternsEqual(original.dashArray, adjusted.dashArray) ||
    Math.abs((original.dashPhase || 0) - (adjusted.dashPhase || 0)) > 0.1
  );
}

function dashPatternsEqual(a?: number[], b?: number[]): boolean {
  const left = a || [];
  const right = b || [];
  if (left.length !== right.length) return false;
  return left.every((value, index) => Math.abs(value - right[index]) <= 0.1);
}

function createLineCoverGeometry(line: PdfEditorGraphicLineItem): PdfEditorBoxGeometry {
  const pad = Math.max(1.5, line.strokeWidth * 1.8);
  const x = Math.min(line.x1, line.x2) - pad;
  const y = Math.min(line.y1, line.y2) - pad;
  return {
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.abs(line.x2 - line.x1) + pad * 2,
    height: Math.abs(line.y2 - line.y1) + pad * 2
  };
}
