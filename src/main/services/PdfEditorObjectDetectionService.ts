import { extractPdfPlacedImages } from "./PdfImageExtractionService.js";
import type {
  PdfEditorGraphicLineItem,
  PdfEditorImageItem,
  PdfEditorTableItem
} from "../types/conversion.js";

interface PdfEditorPageObjects {
  images: PdfEditorImageItem[];
  lines: PdfEditorGraphicLineItem[];
  tables: PdfEditorTableItem[];
}

interface RawLineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
  dashArray?: number[];
  dashPhase?: number;
}

interface RawPathSegments {
  strokeSegments: RawLineSegment[];
  fillLineSegments: RawLineSegment[];
}

interface Point {
  x: number;
  y: number;
}

export async function extractPdfEditorPageObjects(
  pdfjs: any,
  page: any,
  pageNumber: number
): Promise<PdfEditorPageObjects> {
  const [images, lines] = await Promise.all([
    extractEditorImages(pdfjs, page, pageNumber),
    extractEditorGraphicLines(pdfjs, page, pageNumber)
  ]);

  return {
    images,
    lines,
    tables: detectTableCandidates(pageNumber, lines)
  };
}

async function extractEditorImages(pdfjs: any, page: any, pageNumber: number): Promise<PdfEditorImageItem[]> {
  try {
    const images = await extractPdfPlacedImages(pdfjs, page, 1);
    return images.map((image, index) => ({
      id: `p${pageNumber}-image-${index}-${sanitizeId(image.id)}`,
      pageNumber,
      x: roundPoint(image.x),
      y: roundPoint(image.y),
      width: roundPoint(image.width),
      height: roundPoint(image.height),
      imageDataBase64: image.data.toString("base64"),
      mimeType: "image/png"
    }));
  } catch {
    return [];
  }
}

async function extractEditorGraphicLines(
  pdfjs: any,
  page: any,
  pageNumber: number
): Promise<PdfEditorGraphicLineItem[]> {
  try {
    const viewport = page.getViewport({ scale: 1 });
    const operatorList = await page.getOperatorList();
    const ops = pdfjs.OPS;
    const matrixStack: number[][] = [];
    const lineWidthStack: number[] = [];
    const dashStack: Array<{ dashArray?: number[]; dashPhase?: number }> = [];
    const segments: RawLineSegment[] = [];
    let currentMatrix = [1, 0, 0, 1, 0, 0];
    let currentLineWidth = 1;
    let currentDashArray: number[] | undefined;
    let currentDashPhase = 0;
    let pendingPath: RawLineSegment[] = [];
    let pendingFillLines: RawLineSegment[] = [];

    for (let index = 0; index < operatorList.fnArray.length; index += 1) {
      const fn = operatorList.fnArray[index];
      const args = operatorList.argsArray[index];

      if (fn === ops.save) {
        matrixStack.push([...currentMatrix]);
        lineWidthStack.push(currentLineWidth);
        dashStack.push({ dashArray: currentDashArray ? [...currentDashArray] : undefined, dashPhase: currentDashPhase });
        continue;
      }
      if (fn === ops.restore) {
        currentMatrix = matrixStack.pop() || [1, 0, 0, 1, 0, 0];
        currentLineWidth = lineWidthStack.pop() || 1;
        const dash = dashStack.pop();
        currentDashArray = dash?.dashArray;
        currentDashPhase = dash?.dashPhase || 0;
        continue;
      }
      if (fn === ops.transform && Array.isArray(args)) {
        currentMatrix = pdfjs.Util.transform(currentMatrix, args);
        continue;
      }
      if (fn === ops.setLineWidth && Array.isArray(args)) {
        currentLineWidth = Math.max(0.2, Number(args[0]) || 1);
        continue;
      }
      if (fn === ops.setDash && Array.isArray(args)) {
        currentDashArray = Array.isArray(args[0])
          ? args[0].map((value: unknown) => Number(value)).filter((value: number) => Number.isFinite(value) && value > 0)
          : undefined;
        currentDashPhase = Number.isFinite(Number(args[1])) ? Number(args[1]) : 0;
        continue;
      }
      if (fn === ops.constructPath) {
        const nextPath = readConstructedPathSegments(pdfjs, ops, viewport, currentMatrix, args, currentLineWidth, currentDashArray, currentDashPhase);
        pendingPath.push(...nextPath.strokeSegments);
        pendingFillLines.push(...nextPath.fillLineSegments);
        continue;
      }
      if (isFillStrokeOperator(ops, fn)) {
        segments.push(...pendingFillLines, ...pendingPath);
        pendingPath = [];
        pendingFillLines = [];
        continue;
      }
      if (isStrokeOperator(ops, fn)) {
        segments.push(...pendingPath);
        pendingPath = [];
        pendingFillLines = [];
        continue;
      }
      if (isFillOperator(ops, fn)) {
        segments.push(...pendingFillLines);
        pendingPath = [];
        pendingFillLines = [];
        continue;
      }
      if (isPathResetOperator(ops, fn)) {
        pendingPath = [];
        pendingFillLines = [];
      }
    }

    return dedupeRawLineSegments(segments)
      .map((segment, index) => toGraphicLine(pageNumber, segment, index))
      .filter((line) => Math.max(line.width, line.height) >= 8);
  } catch {
    return [];
  }
}

function dedupeRawLineSegments(segments: RawLineSegment[]): RawLineSegment[] {
  const seen = new Set<string>();
  const result: RawLineSegment[] = [];
  for (const segment of segments) {
    const key = [
      Math.round(segment.x1 * 2) / 2,
      Math.round(segment.y1 * 2) / 2,
      Math.round(segment.x2 * 2) / 2,
      Math.round(segment.y2 * 2) / 2,
      Math.round(segment.strokeWidth * 2) / 2,
      segment.dashArray?.join(",") || "",
      Math.round((segment.dashPhase || 0) * 2) / 2
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(segment);
  }
  return result;
}

function readConstructedPathSegments(
  pdfjs: any,
  ops: Record<string, number>,
  viewport: any,
  matrix: number[],
  args: any,
  strokeWidth: number,
  dashArray?: number[],
  dashPhase = 0
): RawPathSegments {
  const pathOps = Array.isArray(args?.[0]) ? args[0] : [];
  const coords = Array.isArray(args?.[1]) ? args[1] : [];
  const strokeSegments: RawLineSegment[] = [];
  const fillLineSegments: RawLineSegment[] = [];
  let offset = 0;
  let current: Point | undefined;
  let pathStart: Point | undefined;

  for (const op of pathOps) {
    if (op === ops.moveTo) {
      current = toViewportPoint(pdfjs, viewport, matrix, Number(coords[offset]), Number(coords[offset + 1]));
      pathStart = current;
      offset += 2;
      continue;
    }
    if (op === ops.lineTo) {
      const next = toViewportPoint(pdfjs, viewport, matrix, Number(coords[offset]), Number(coords[offset + 1]));
      if (current) strokeSegments.push(createRawLineSegment(current.x, current.y, next.x, next.y, strokeWidth, dashArray, dashPhase));
      current = next;
      offset += 2;
      continue;
    }
    if (op === ops.rectangle) {
      const x = Number(coords[offset]);
      const y = Number(coords[offset + 1]);
      const width = Number(coords[offset + 2]);
      const height = Number(coords[offset + 3]);
      const points = [
        toViewportPoint(pdfjs, viewport, matrix, x, y),
        toViewportPoint(pdfjs, viewport, matrix, x + width, y),
        toViewportPoint(pdfjs, viewport, matrix, x + width, y + height),
        toViewportPoint(pdfjs, viewport, matrix, x, y + height)
      ];
      for (let index = 0; index < points.length; index += 1) {
        const start = points[index];
        const end = points[(index + 1) % points.length];
        strokeSegments.push(createRawLineSegment(start.x, start.y, end.x, end.y, strokeWidth, dashArray, dashPhase));
      }
      const thinFillLine = createThinFilledRectangleLine(points, strokeWidth);
      if (thinFillLine) fillLineSegments.push(thinFillLine);
      current = points[0];
      pathStart = points[0];
      offset += 4;
      continue;
    }
    if (op === ops.curveTo) {
      current = toViewportPoint(pdfjs, viewport, matrix, Number(coords[offset + 4]), Number(coords[offset + 5]));
      offset += 6;
      continue;
    }
    if (op === ops.curveTo2) {
      current = toViewportPoint(pdfjs, viewport, matrix, Number(coords[offset + 2]), Number(coords[offset + 3]));
      offset += 4;
      continue;
    }
    if (op === ops.curveTo3) {
      current = toViewportPoint(pdfjs, viewport, matrix, Number(coords[offset + 2]), Number(coords[offset + 3]));
      offset += 4;
      continue;
    }
    if (op === ops.closePath) {
      if (current && pathStart) {
        strokeSegments.push(createRawLineSegment(current.x, current.y, pathStart.x, pathStart.y, strokeWidth, dashArray, dashPhase));
        current = pathStart;
      }
    }
  }

  return { strokeSegments, fillLineSegments };
}

function createRawLineSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  strokeWidth: number,
  dashArray?: number[],
  dashPhase = 0
): RawLineSegment {
  return {
    x1,
    y1,
    x2,
    y2,
    strokeWidth,
    dashArray: dashArray?.length ? [...dashArray] : undefined,
    dashPhase
  };
}

function createThinFilledRectangleLine(points: Point[], fallbackStrokeWidth: number): RawLineSegment | undefined {
  const left = Math.min(...points.map((point) => point.x));
  const right = Math.max(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const bottom = Math.max(...points.map((point) => point.y));
  const width = right - left;
  const height = bottom - top;
  const thinLimit = Math.max(0.75, Math.min(5.5, Math.max(width, height) * 0.04));
  if (width >= 8 && height > 0 && height <= thinLimit) {
    const y = top + height / 2;
    return createRawLineSegment(left, y, right, y, Math.max(fallbackStrokeWidth, height), undefined, 0);
  }
  if (height >= 8 && width > 0 && width <= thinLimit) {
    const x = left + width / 2;
    return createRawLineSegment(x, top, x, bottom, Math.max(fallbackStrokeWidth, width), undefined, 0);
  }
  return undefined;
}

function toViewportPoint(pdfjs: any, viewport: any, matrix: number[], x: number, y: number): Point {
  const pagePoint = pdfjs.Util.applyTransform([finiteNumber(x, 0), finiteNumber(y, 0)], matrix);
  const viewportPoint = pdfjs.Util.applyTransform(pagePoint, viewport.transform);
  return {
    x: roundPoint(viewportPoint[0]),
    y: roundPoint(viewportPoint[1])
  };
}

function toGraphicLine(pageNumber: number, segment: RawLineSegment, index: number): PdfEditorGraphicLineItem {
  const left = Math.min(segment.x1, segment.x2);
  const top = Math.min(segment.y1, segment.y2);
  const rawWidth = Math.abs(segment.x2 - segment.x1);
  const rawHeight = Math.abs(segment.y2 - segment.y1);
  const strokeWidth = Math.max(0.6, segment.strokeWidth);
  const width = Math.max(strokeWidth, rawWidth);
  const height = Math.max(strokeWidth, rawHeight);
  const orientation =
    rawHeight <= Math.max(1.5, rawWidth * 0.08)
      ? "horizontal"
      : rawWidth <= Math.max(1.5, rawHeight * 0.08)
        ? "vertical"
        : "diagonal";

  return {
    id: `p${pageNumber}-line-${index}`,
    pageNumber,
    x: roundPoint(left),
    y: roundPoint(top),
    width: roundPoint(width),
    height: roundPoint(height),
    x1: roundPoint(segment.x1),
    y1: roundPoint(segment.y1),
    x2: roundPoint(segment.x2),
    y2: roundPoint(segment.y2),
    strokeWidth: roundPoint(strokeWidth),
    dashArray: segment.dashArray?.map(roundPoint),
    dashPhase: segment.dashPhase ? roundPoint(segment.dashPhase) : undefined,
    orientation
  };
}

function detectTableCandidates(pageNumber: number, lines: PdfEditorGraphicLineItem[]): PdfEditorTableItem[] {
  const structuralLines = lines.filter(
    (line) =>
      (line.orientation === "horizontal" && line.width >= 18) ||
      (line.orientation === "vertical" && line.height >= 18)
  );
  if (structuralLines.length < 4) return [];

  const groups: PdfEditorGraphicLineItem[][] = [];
  const visited = new Set<string>();

  for (const line of structuralLines) {
    if (visited.has(line.id)) continue;
    const group: PdfEditorGraphicLineItem[] = [];
    const queue = [line];
    visited.add(line.id);

    while (queue.length) {
      const current = queue.shift();
      if (!current) continue;
      group.push(current);

      for (const candidate of structuralLines) {
        if (visited.has(candidate.id)) continue;
        if (linesAreConnected(current, candidate)) {
          visited.add(candidate.id);
          queue.push(candidate);
        }
      }
    }

    groups.push(group);
  }

  return groups
    .map((group, index) => toTableCandidate(pageNumber, group, index))
    .filter((table): table is PdfEditorTableItem => Boolean(table));
}

function toTableCandidate(
  pageNumber: number,
  lines: PdfEditorGraphicLineItem[],
  index: number
): PdfEditorTableItem | undefined {
  const horizontal = lines.filter((line) => line.orientation === "horizontal");
  const vertical = lines.filter((line) => line.orientation === "vertical");
  if (horizontal.length < 2 || vertical.length < 2) return undefined;

  const left = Math.min(...lines.map((line) => line.x));
  const top = Math.min(...lines.map((line) => line.y));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const bottom = Math.max(...lines.map((line) => line.y + line.height));
  const width = right - left;
  const height = bottom - top;
  if (width < 32 || height < 18) return undefined;

  const rowCount = Math.max(1, uniqueCoordinates(horizontal.map((line) => line.y)).length - 1);
  const columnCount = Math.max(1, uniqueCoordinates(vertical.map((line) => line.x)).length - 1);

  return {
    id: `p${pageNumber}-table-${index}`,
    pageNumber,
    x: roundPoint(left),
    y: roundPoint(top),
    width: roundPoint(width),
    height: roundPoint(height),
    rowCount,
    columnCount,
    lineIds: lines.map((line) => line.id)
  };
}

function linesAreConnected(a: PdfEditorGraphicLineItem, b: PdfEditorGraphicLineItem): boolean {
  if (expandedBoxesIntersect(a, b, 3)) return true;
  if (a.orientation === "horizontal" && b.orientation === "vertical") return lineCrosses(a, b, 4);
  if (a.orientation === "vertical" && b.orientation === "horizontal") return lineCrosses(b, a, 4);
  return false;
}

function expandedBoxesIntersect(
  a: Pick<PdfEditorGraphicLineItem, "x" | "y" | "width" | "height">,
  b: Pick<PdfEditorGraphicLineItem, "x" | "y" | "width" | "height">,
  tolerance: number
): boolean {
  return !(
    a.x + a.width + tolerance < b.x ||
    b.x + b.width + tolerance < a.x ||
    a.y + a.height + tolerance < b.y ||
    b.y + b.height + tolerance < a.y
  );
}

function lineCrosses(
  horizontal: PdfEditorGraphicLineItem,
  vertical: PdfEditorGraphicLineItem,
  tolerance: number
): boolean {
  const hY = horizontal.y + horizontal.height / 2;
  const vX = vertical.x + vertical.width / 2;
  return (
    vX >= horizontal.x - tolerance &&
    vX <= horizontal.x + horizontal.width + tolerance &&
    hY >= vertical.y - tolerance &&
    hY <= vertical.y + vertical.height + tolerance
  );
}

function isStrokeOperator(ops: Record<string, number>, fn: number): boolean {
  return (
    fn === ops.stroke ||
    fn === ops.closeStroke
  );
}

function isFillStrokeOperator(ops: Record<string, number>, fn: number): boolean {
  return (
    fn === ops.fillStroke ||
    fn === ops.eoFillStroke
  );
}

function isFillOperator(ops: Record<string, number>, fn: number): boolean {
  return (
    fn === ops.fill ||
    fn === ops.eoFill
  );
}

function isPathResetOperator(ops: Record<string, number>, fn: number): boolean {
  return (
    fn === ops.endPath ||
    fn === ops.clip ||
    fn === ops.eoClip
  );
}

function uniqueCoordinates(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.every((existing) => Math.abs(existing - value) > 3)) result.push(value);
  }
  return result;
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "image";
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function roundPoint(value: number): number {
  return Math.round(value * 100) / 100;
}
