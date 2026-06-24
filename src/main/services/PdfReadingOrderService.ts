export interface PdfReadingOrderLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  pdfFontId?: string;
  pdfFontName?: string;
  sourceIndex?: number;
  color?: string;
}

interface PdfTextFragment extends PdfReadingOrderLine {
  sourceIndex: number;
  right: number;
  bottom: number;
  centerY: number;
}

interface PdfLineBucket {
  fragments: PdfTextFragment[];
  x: number;
  y: number;
  right: number;
  bottom: number;
  centerY: number;
  avgHeight: number;
  avgFontSize: number;
}

export function extractPdfReadingOrderLines(
  pdfjs: any,
  page: any,
  textContent: any,
  layoutScale = 1
): PdfReadingOrderLine[] {
  const fragments = extractPdfTextFragments(pdfjs, page, textContent, layoutScale);
  return orderPdfTextFragmentsLeftToRightTopToBottom(fragments);
}

export function extractPdfReadingOrderFragments(
  pdfjs: any,
  page: any,
  textContent: any,
  layoutScale = 1
): PdfReadingOrderLine[] {
  return extractPdfTextFragments(pdfjs, page, textContent, layoutScale)
    .sort(compareFragmentsByReadingRow)
    .map(toReadingOrderLine)
    .filter((line) => line.text.trim().length > 0);
}

function extractPdfTextFragments(
  pdfjs: any,
  page: any,
  textContent: any,
  layoutScale: number
): PdfTextFragment[] {
  const viewport = page.getViewport({ scale: 1 });
  const rawItems = Array.isArray(textContent.items) ? textContent.items : [];
  return rawItems
    .map((item: any, sourceIndex: number): PdfTextFragment | undefined => {
      const text = normalizePdfText(typeof item?.str === "string" ? item.str : "");
      if (!text.trim() || !Array.isArray(item.transform)) return undefined;

      const transformed = pdfjs.Util.transform(viewport.transform, item.transform);
      const horizontalScale = Math.hypot(Number(transformed[0]) || 0, Number(transformed[1]) || 0);
      const verticalScale = Math.hypot(Number(transformed[2]) || 0, Number(transformed[3]) || 0);
      const fontSize = Math.max(verticalScale, horizontalScale, 1);
      const rawWidth = Math.max(Number(item.width) || text.length * fontSize * 0.48, fontSize * 0.25);
      const measuredHeight = Math.max(Number(item.height) || fontSize, fontSize * 0.72);
      const rawHeight = clamp(measuredHeight, fontSize * 0.55, fontSize * 1.18);
      const ascentRatio = getPdfFontAscentRatio(textContent, item.fontName);
      const baselineY = Number(transformed[5]) || 0;
      const left = clamp(Number(transformed[4]) || 0, 0, viewport.width);
      const top = clamp(baselineY - rawHeight * ascentRatio, 0, viewport.height);
      const width = rawWidth * layoutScale;
      const height = rawHeight * layoutScale;
      const x = left * layoutScale;
      const y = top * layoutScale;

      return {
        text,
        x,
        y,
        width,
        height,
        fontSize: fontSize * layoutScale,
        fontFamily: getPdfFontFamily(textContent, item.fontName),
        fontWeight: getPdfFontWeight(textContent, item.fontName),
        fontStyle: getPdfFontStyle(textContent, item.fontName),
        pdfFontId: typeof item.fontName === "string" ? item.fontName : undefined,
        sourceIndex,
        right: x + width,
        bottom: y + height,
        centerY: y + height / 2
      };
    })
    .filter(Boolean) as PdfTextFragment[];
}

export function orderPdfTextFragmentsLeftToRightTopToBottom(
  fragments: PdfTextFragment[]
): PdfReadingOrderLine[] {
  if (fragments.length === 0) return [];

  const sorted = [...fragments].sort(compareFragmentsByReadingRow);
  const buckets: PdfLineBucket[] = [];

  for (const fragment of sorted) {
    const bucket = findBestLineBucket(buckets, fragment);
    if (!bucket) {
      buckets.push(createLineBucket(fragment));
      continue;
    }
    bucket.fragments.push(fragment);
    refreshLineBucket(bucket);
  }

  return buckets
    .sort(compareLineBuckets)
    .map(composeReadingLine)
    .filter((line) => line.text.trim().length > 0);
}

function findBestLineBucket(buckets: PdfLineBucket[], fragment: PdfTextFragment): PdfLineBucket | undefined {
  let best: PdfLineBucket | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const bucket of buckets) {
    const distance = Math.abs(fragment.centerY - bucket.centerY);
    const tolerance = Math.max(2.5, Math.min(18, Math.max(fragment.height, bucket.avgHeight) * 0.62));
    const overlapRatio = getVerticalOverlapRatio(fragment, bucket);
    const sameLine = distance <= tolerance || overlapRatio >= 0.5;

    if (sameLine && distance < bestDistance) {
      best = bucket;
      bestDistance = distance;
    }
  }

  return best;
}

function createLineBucket(fragment: PdfTextFragment): PdfLineBucket {
  return {
    fragments: [fragment],
    x: fragment.x,
    y: fragment.y,
    right: fragment.right,
    bottom: fragment.bottom,
    centerY: fragment.centerY,
    avgHeight: fragment.height,
    avgFontSize: fragment.fontSize
  };
}

function refreshLineBucket(bucket: PdfLineBucket): void {
  bucket.x = Math.min(...bucket.fragments.map((fragment) => fragment.x));
  bucket.y = Math.min(...bucket.fragments.map((fragment) => fragment.y));
  bucket.right = Math.max(...bucket.fragments.map((fragment) => fragment.right));
  bucket.bottom = Math.max(...bucket.fragments.map((fragment) => fragment.bottom));
  bucket.avgHeight =
    bucket.fragments.reduce((sum, fragment) => sum + fragment.height, 0) / Math.max(1, bucket.fragments.length);
  bucket.avgFontSize =
    bucket.fragments.reduce((sum, fragment) => sum + fragment.fontSize, 0) / Math.max(1, bucket.fragments.length);
  bucket.centerY = bucket.fragments.reduce((sum, fragment) => sum + fragment.centerY, 0) / bucket.fragments.length;
}

function compareFragmentsByReadingRow(a: PdfTextFragment, b: PdfTextFragment): number {
  const tolerance = Math.max(2.5, Math.min(18, Math.max(a.height, b.height) * 0.62));
  if (Math.abs(a.centerY - b.centerY) > tolerance) return a.centerY - b.centerY;
  if (Math.abs(a.x - b.x) > 0.5) return a.x - b.x;
  return a.sourceIndex - b.sourceIndex;
}

function compareLineBuckets(a: PdfLineBucket, b: PdfLineBucket): number {
  const tolerance = Math.max(2.5, Math.min(18, Math.max(a.avgHeight, b.avgHeight) * 0.62));
  if (Math.abs(a.centerY - b.centerY) > tolerance) return a.centerY - b.centerY;
  if (Math.abs(a.x - b.x) > 0.5) return a.x - b.x;
  return a.fragments[0].sourceIndex - b.fragments[0].sourceIndex;
}

function composeReadingLine(bucket: PdfLineBucket): PdfReadingOrderLine {
  const fragments = [...bucket.fragments].sort((a, b) => {
    if (Math.abs(a.x - b.x) > 0.5) return a.x - b.x;
    return a.sourceIndex - b.sourceIndex;
  });
  let text = "";
  let previousRight = fragments[0]?.x ?? 0;

  for (const fragment of fragments) {
    const part = fragment.text.trim();
    if (!part) continue;

    if (!text) {
      text = part;
      previousRight = fragment.right;
      continue;
    }

    const gap = fragment.x - previousRight;
    text += buildVisualGap(gap, bucket.avgFontSize) + part;
    previousRight = Math.max(previousRight, fragment.right);
  }

  return {
    text,
    x: bucket.x,
    y: bucket.y,
    width: Math.max(1, bucket.right - bucket.x),
    height: Math.max(1, bucket.bottom - bucket.y),
    fontSize: Math.max(1, bucket.avgFontSize),
    fontFamily: fragments.find((fragment) => fragment.fontFamily)?.fontFamily,
    fontWeight: fragments.find((fragment) => fragment.fontWeight)?.fontWeight,
    fontStyle: fragments.find((fragment) => fragment.fontStyle)?.fontStyle,
    pdfFontId: fragments.find((fragment) => fragment.pdfFontId)?.pdfFontId,
    pdfFontName: fragments.find((fragment) => fragment.pdfFontName)?.pdfFontName,
    sourceIndex: fragments[0]?.sourceIndex
  };
}

function toReadingOrderLine(fragment: PdfTextFragment): PdfReadingOrderLine {
  return {
    text: fragment.text,
    x: fragment.x,
    y: fragment.y,
    width: fragment.width,
    height: fragment.height,
    fontSize: fragment.fontSize,
    fontFamily: fragment.fontFamily,
    fontWeight: fragment.fontWeight,
    fontStyle: fragment.fontStyle,
    pdfFontId: fragment.pdfFontId,
    pdfFontName: fragment.pdfFontName,
    sourceIndex: fragment.sourceIndex,
    color: fragment.color
  };
}

function buildVisualGap(gap: number, fontSize: number): string {
  if (gap <= fontSize * 0.16) return "";
  const spaceWidth = Math.max(3, fontSize * 0.38);
  const count = clamp(Math.round(gap / spaceWidth), 1, 16);
  return " ".repeat(count);
}

function getVerticalOverlapRatio(fragment: PdfTextFragment, bucket: PdfLineBucket): number {
  const overlap = Math.max(0, Math.min(fragment.bottom, bucket.bottom) - Math.max(fragment.y, bucket.y));
  return overlap / Math.max(1, Math.min(fragment.height, bucket.avgHeight));
}

function normalizePdfText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\s+/g, " ");
}

function getPdfFontFamily(textContent: any, fontName?: string): string | undefined {
  if (!fontName || !textContent?.styles?.[fontName]) return undefined;
  const fontFamily = textContent.styles[fontName].fontFamily;
  return typeof fontFamily === "string" && fontFamily.trim() ? fontFamily : undefined;
}

function getPdfFontWeight(textContent: any, fontName?: string): string | undefined {
  if (!fontName || !textContent?.styles?.[fontName]) return undefined;
  const weight = textContent.styles[fontName].fontWeight;
  return typeof weight === "string" && weight.trim() ? weight : undefined;
}

function getPdfFontStyle(textContent: any, fontName?: string): string | undefined {
  if (!fontName || !textContent?.styles?.[fontName]) return undefined;
  const style = textContent.styles[fontName].fontStyle;
  return typeof style === "string" && style.trim() ? style : undefined;
}

function getPdfFontAscentRatio(textContent: any, fontName?: string): number {
  if (!fontName || !textContent?.styles?.[fontName]) return 0.8;
  const style = textContent.styles[fontName];
  const ascent = Number(style?.ascent);
  if (Number.isFinite(ascent) && ascent > 0) return clamp(ascent, 0.55, 1.05);
  const descent = Number(style?.descent);
  if (Number.isFinite(descent) && descent < 0) return clamp(1 + descent, 0.55, 1.05);
  return 0.8;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
