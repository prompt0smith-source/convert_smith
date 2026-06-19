import type { PdfEditorEdit, PdfEditorTextItem } from "../../main/types/conversion";

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
  geometryOverrides: Record<string, PdfEditorBoxGeometry> = {}
): number {
  const edited = items.filter(
    (item) =>
      deletedIds.has(item.id) ||
      (drafts[item.id] !== undefined && drafts[item.id] !== item.text) ||
      hasGeometryOverride(item, geometryOverrides[item.id])
  ).length;
  const added = additions.filter((item) => item.text.trim()).length;
  return edited + added;
}

export function buildPdfEditorEdits(
  items: PdfEditorTextItem[],
  drafts: Record<string, string>,
  deletedIds: Set<string>,
  additions: PendingPdfEditorAddition[],
  geometryOverrides: Record<string, PdfEditorBoxGeometry> = {}
): PdfEditorEdit[] {
  const edits: PdfEditorEdit[] = [];
  for (const item of items) {
    const geometry = geometryOverrides[item.id] || item;

    if (deletedIds.has(item.id)) {
      edits.push({
        action: "delete",
        pageNumber: item.pageNumber,
        originalText: item.text,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        color: item.color
      });
      continue;
    }

    const draft = drafts[item.id];
    if ((draft !== undefined && draft !== item.text) || hasGeometryOverride(item, geometryOverrides[item.id])) {
      edits.push({
        action: "replace",
        pageNumber: item.pageNumber,
        originalText: item.text,
        replacementText: draft ?? item.text,
        coverX: item.x,
        coverY: item.y,
        coverWidth: item.width,
        coverHeight: item.height,
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
        fontSize: item.fontSize,
        fontFamily: item.fontFamily,
        color: item.color
      });
    }
  }

  for (const addition of additions) {
    if (!addition.text.trim()) continue;
    edits.push({
      action: "add",
      pageNumber: Math.max(1, Math.trunc(addition.pageNumber)),
      replacementText: addition.text,
      x: addition.x,
      y: addition.y,
      width: addition.width,
      height: addition.height,
      fontSize: addition.fontSize,
      color: addition.color
    });
  }

  return edits;
}

function hasGeometryOverride(item: PdfEditorTextItem, geometry?: PdfEditorBoxGeometry): boolean {
  if (!geometry) return false;
  return (
    Math.abs(item.x - geometry.x) > 0.1 ||
    Math.abs(item.y - geometry.y) > 0.1 ||
    Math.abs(item.width - geometry.width) > 0.1 ||
    Math.abs(item.height - geometry.height) > 0.1
  );
}
