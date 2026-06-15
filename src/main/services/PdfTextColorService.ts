import type { PdfReadingOrderLine } from "./PdfReadingOrderService.js";

interface PdfTextColorEntry {
  text: string;
  color: string;
}

interface PdfTextColorSegment extends PdfTextColorEntry {
  startRatio: number;
  endRatio: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const DEFAULT_TEXT_COLOR = "000000";

export async function applyPdfTextColors(
  pdfjs: any,
  page: any,
  textContent: any,
  textItems: PdfReadingOrderLine[],
  options: { splitMixedColorText?: boolean } = {}
): Promise<void> {
  const segmentsBySourceIndex = await extractTextColorSegmentsBySourceIndex(pdfjs, page, textContent);

  for (let index = 0; index < textItems.length; index += 1) {
    const item = textItems[index];
    if (typeof item.sourceIndex !== "number") continue;
    const segments = segmentsBySourceIndex.get(item.sourceIndex);
    if (!segments?.length) continue;

    if (options.splitMixedColorText && segments.length > 1) {
      const splitItems = segments
        .filter((segment) => segment.text.trim().length > 0)
        .map((segment) => createSplitTextItem(item, segment));
      if (splitItems.length > 0) {
        textItems.splice(index, 1, ...splitItems);
        index += splitItems.length - 1;
      }
      continue;
    }

    item.color = segments[0].color;
  }
}

async function extractTextColorSegmentsBySourceIndex(
  pdfjs: any,
  page: any,
  textContent: any
): Promise<Map<number, PdfTextColorSegment[]>> {
  const entries = await extractTextColorEntries(pdfjs, page);
  const segmentsBySourceIndex = new Map<number, PdfTextColorSegment[]>();
  const rawItems = Array.isArray(textContent?.items) ? textContent.items : [];
  let entryIndex = 0;
  let remainingEntryText = entries[0]?.text || "";

  for (let sourceIndex = 0; sourceIndex < rawItems.length; sourceIndex += 1) {
    const text = normalizeText(typeof rawItems[sourceIndex]?.str === "string" ? rawItems[sourceIndex].str : "");
    if (!text.trim()) continue;

    while (entryIndex < entries.length && !remainingEntryText.trim()) {
      entryIndex += 1;
      remainingEntryText = entries[entryIndex]?.text || "";
    }

    const entry = entries[entryIndex];
    if (!entry) break;

    const consumed = consumeEntryTextSegments(entries, entryIndex, remainingEntryText, text);
    if (consumed.segments.length > 0) {
      segmentsBySourceIndex.set(sourceIndex, consumed.segments);
    } else {
      segmentsBySourceIndex.set(sourceIndex, [{ text, color: entry.color, startRatio: 0, endRatio: 1 }]);
    }
    ({ entryIndex, remainingEntryText } = consumed);
  }

  return segmentsBySourceIndex;
}

async function extractTextColorEntries(pdfjs: any, page: any): Promise<PdfTextColorEntry[]> {
  const operatorList = await page.getOperatorList();
  const ops = pdfjs.OPS;
  const entries: PdfTextColorEntry[] = [];
  const colorStack: string[] = [];
  let currentFillColor = DEFAULT_TEXT_COLOR;

  for (let index = 0; index < operatorList.fnArray.length; index += 1) {
    const fn = operatorList.fnArray[index];
    const args = operatorList.argsArray[index];

    if (fn === ops.save) {
      colorStack.push(currentFillColor);
      continue;
    }
    if (fn === ops.restore) {
      currentFillColor = colorStack.pop() || DEFAULT_TEXT_COLOR;
      continue;
    }

    const nextFillColor = readFillColor(pdfjs, fn, args);
    if (nextFillColor) {
      currentFillColor = nextFillColor;
      continue;
    }

    if (isTextShowOperator(ops, fn)) {
      const text = normalizeText(extractShownText(args));
      if (text.trim()) entries.push({ text, color: currentFillColor });
    }
  }

  return entries;
}

function readFillColor(pdfjs: any, fn: number, args: any): string | undefined {
  const ops = pdfjs.OPS;
  if (fn === ops.setFillRGBColor) {
    return toHexColor({
      r: normalizeColorComponent(readArg(args, 0)),
      g: normalizeColorComponent(readArg(args, 1)),
      b: normalizeColorComponent(readArg(args, 2))
    });
  }
  if (fn === ops.setFillGray) {
    const gray = normalizeColorComponent(readArg(args, 0));
    return toHexColor({ r: gray, g: gray, b: gray });
  }
  if (fn === ops.setFillCMYKColor) {
    return toHexColor(cmykToRgb(readArg(args, 0), readArg(args, 1), readArg(args, 2), readArg(args, 3)));
  }
  if (fn === ops.setFillColor && args) {
    const values = Array.isArray(args) ? args : Object.values(args);
    if (values.length === 1) {
      const gray = normalizeColorComponent(Number(values[0]));
      return toHexColor({ r: gray, g: gray, b: gray });
    }
    if (values.length >= 3) {
      return toHexColor({
        r: normalizeColorComponent(Number(values[0])),
        g: normalizeColorComponent(Number(values[1])),
        b: normalizeColorComponent(Number(values[2]))
      });
    }
  }

  return undefined;
}

function isTextShowOperator(ops: Record<string, number>, fn: number): boolean {
  return (
    fn === ops.showText ||
    fn === ops.showSpacedText ||
    fn === ops.nextLineShowText ||
    fn === ops.nextLineSetSpacingShowText
  );
}

function extractShownText(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return "";
  if (Array.isArray(value)) return value.map(extractShownText).join("");
  if (typeof value.unicode === "string") return value.unicode;
  return "";
}

function consumeEntryTextSegments(
  entries: PdfTextColorEntry[],
  entryIndex: number,
  remainingEntryText: string,
  itemText: string
): { entryIndex: number; remainingEntryText: string; segments: PdfTextColorSegment[] } {
  let remainingItemText = itemText;
  let nextIndex = entryIndex;
  let nextEntryText = remainingEntryText;
  let consumedLength = 0;
  const totalLength = Math.max(1, itemText.length);
  const segments: PdfTextColorSegment[] = [];

  while (remainingItemText && nextIndex < entries.length) {
    if (!nextEntryText) {
      nextIndex += 1;
      nextEntryText = entries[nextIndex]?.text || "";
      continue;
    }

    if (nextEntryText.startsWith(remainingItemText)) {
      segments.push(createTextSegment(remainingItemText, entries[nextIndex].color, consumedLength, totalLength));
      consumedLength += remainingItemText.length;
      nextEntryText = nextEntryText.slice(remainingItemText.length);
      remainingItemText = "";
      continue;
    }

    if (remainingItemText.startsWith(nextEntryText)) {
      segments.push(createTextSegment(nextEntryText, entries[nextIndex].color, consumedLength, totalLength));
      consumedLength += nextEntryText.length;
      remainingItemText = remainingItemText.slice(nextEntryText.length);
      nextIndex += 1;
      nextEntryText = entries[nextIndex]?.text || "";
      continue;
    }

    segments.push(createTextSegment(remainingItemText, entries[nextIndex].color, consumedLength, totalLength));
    consumedLength += remainingItemText.length;
    nextIndex += 1;
    nextEntryText = entries[nextIndex]?.text || "";
    remainingItemText = "";
  }

  return { entryIndex: nextIndex, remainingEntryText: nextEntryText, segments };
}

function createTextSegment(
  text: string,
  color: string,
  startLength: number,
  totalLength: number
): PdfTextColorSegment {
  return {
    text,
    color,
    startRatio: clamp(startLength / totalLength, 0, 1),
    endRatio: clamp((startLength + text.length) / totalLength, 0, 1)
  };
}

function createSplitTextItem(item: PdfReadingOrderLine, segment: PdfTextColorSegment): PdfReadingOrderLine {
  const x = item.x + item.width * segment.startRatio;
  const width = Math.max(1, item.width * Math.max(0.01, segment.endRatio - segment.startRatio));

  return {
    ...item,
    text: segment.text.trim(),
    x,
    width,
    color: segment.color
  };
}

function cmykToRgb(cValue: number, mValue: number, yValue: number, kValue: number): Rgb {
  const c = normalizeUnitColor(cValue);
  const m = normalizeUnitColor(mValue);
  const y = normalizeUnitColor(yValue);
  const k = normalizeUnitColor(kValue);

  return {
    r: Math.round(255 * (1 - c) * (1 - k)),
    g: Math.round(255 * (1 - m) * (1 - k)),
    b: Math.round(255 * (1 - y) * (1 - k))
  };
}

function readArg(args: any, index: number): number {
  if (Array.isArray(args)) return Number(args[index]) || 0;
  return Number(args?.[index]) || 0;
}

function normalizeColorComponent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value <= 1 ? value * 255 : value, 0, 255);
}

function normalizeUnitColor(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value > 1 ? value / 100 : value, 0, 1);
}

function toHexColor({ r, g, b }: Rgb): string {
  return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function toHex(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0").toUpperCase();
}

function normalizeText(text: string): string {
  return text.replace(/\u0000/g, "").replace(/\s+/g, " ");
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
