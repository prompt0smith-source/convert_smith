import type { PdfReadingOrderLine } from "./PdfReadingOrderService.js";
import { getPreparedCanvasLocalFontFamilies, preparePdfCanvasFonts } from "./PdfjsAssetService.js";

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

interface LocalFontFamily {
  family: string;
}

interface RuntimeGlobalFonts {
  loadSystemFonts?: () => number;
  getFamilies?: () => Buffer | Uint8Array | ArrayBuffer | string;
}

let localFontFamilies: string[] | undefined;
const FONT_STYLE_SUFFIXES = [
  "thin",
  "extralight",
  "ultralight",
  "light",
  "regular",
  "medium",
  "semibold",
  "demibold",
  "bold",
  "extrabold",
  "ultrabold",
  "black",
  "heavy",
  "italic",
  "oblique"
];

export async function applyLocalFontMatches(page: any, textItems: PdfReadingOrderLine[]): Promise<void> {
  const fonts = await getLocalFontFamilies();
  const fontCache = new Map<string, string | undefined>();

  for (const item of textItems) {
    const pdfFontName = getPdfFontName(page, item.pdfFontId) || item.pdfFontName || item.fontFamily;
    const pdfFontStyle = getPdfFontStyle(page, item.pdfFontId);
    item.pdfFontName = pdfFontName;
    item.fontWeight = pdfFontStyle.fontWeight || item.fontWeight;
    item.fontStyle = pdfFontStyle.fontStyle || item.fontStyle;

    const cacheKey = `${pdfFontName || ""}|${item.text}`;
    if (!fontCache.has(cacheKey)) {
      fontCache.set(cacheKey, matchLocalFont(pdfFontName, item.text, fonts));
    }
    item.fontFamily = fontCache.get(cacheKey);
  }
}

export async function warmPdfPageFonts(page: any): Promise<void> {
  try {
    const canvasModule = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
    preparePdfCanvasFonts(canvasModule);
    const viewport = page.getViewport({ scale: 0.05 });
    const canvas = canvasModule.createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
    await page.render({
      canvasContext: canvas.getContext("2d") as never,
      viewport
    }).promise;
  } catch {
    // Font-name extraction remains best effort. Conversion can continue with fallback fonts.
  }
}

export async function getLocalFontFamilies(): Promise<string[]> {
  if (localFontFamilies) return localFontFamilies;

  const preparedFamilies = getPreparedCanvasLocalFontFamilies();
  if (preparedFamilies) {
    localFontFamilies = preparedFamilies;
    return localFontFamilies;
  }

  try {
    const canvasModule = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
    const globalFonts = canvasModule.GlobalFonts as unknown as RuntimeGlobalFonts | undefined;
    globalFonts?.loadSystemFonts?.();
    const raw = globalFonts?.getFamilies?.();
    const parsed = parseFontFamilies(raw);
    const families = Array.from(
      new Set(
        parsed
          .map((item: LocalFontFamily) => item.family)
          .filter((family: unknown): family is string => typeof family === "string" && family.trim().length > 0)
      )
    );
    localFontFamilies = families.sort((a: string, b: string) => a.localeCompare(b, "en"));
  } catch {
    localFontFamilies = [];
  }

  return localFontFamilies || [];
}

function parseFontFamilies(raw: Buffer | Uint8Array | ArrayBuffer | string | undefined): LocalFontFamily[] {
  if (!raw) return [];
  try {
    const json =
      typeof raw === "string"
        ? raw
        : raw instanceof ArrayBuffer
          ? Buffer.from(new Uint8Array(raw)).toString("utf8")
          : Buffer.from(raw).toString("utf8");
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getPdfFontStyle(page: any, fontId?: string): { fontWeight?: string; fontStyle?: string } {
  if (!fontId) return {};
  try {
    const font = page.commonObjs?.get?.(fontId);
    const systemStyle = font?.systemFontInfo?.style;
    const fontWeight =
      typeof systemStyle?.weight === "string"
        ? systemStyle.weight
        : font?.bold
          ? "700"
          : undefined;
    const fontStyle =
      typeof systemStyle?.style === "string"
        ? systemStyle.style
        : font?.italic
          ? "italic"
          : undefined;
    return {
      fontWeight,
      fontStyle
    };
  } catch {
    return {};
  }
}

function getPdfFontName(page: any, fontId?: string): string | undefined {
  if (!fontId) return undefined;
  try {
    const font = page.commonObjs?.get?.(fontId);
    const name = font?.name || font?.cssFontInfo?.fontFamily || font?.fallbackName;
    return typeof name === "string" && name.trim() ? name : undefined;
  } catch {
    return undefined;
  }
}

function matchLocalFont(pdfFontName: string | undefined, text: string, fonts: string[]): string {
  const candidates = createFontCandidates(pdfFontName);
  for (const candidate of candidates) {
    const match = findLocalFont(candidate, fonts);
    if (match) return match;
  }

  return chooseFallbackFont(text, fonts);
}

function createFontCandidates(pdfFontName?: string): string[] {
  if (!pdfFontName) return [];
  const withoutSubset = pdfFontName.replace(/^[A-Z]{6}\+/, "");
  const normalized = withoutSubset
    .replace(/[,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const postScriptFamily = normalized
    .replace(/PSMT$/i, "")
    .replace(/PS[-\s]?(BoldItalic|Bold|Italic|Oblique)MT$/i, " $1")
    .replace(/PS[-\s]?(BoldItalic|Bold|Italic|Oblique)$/i, " $1")
    .trim();
  const postScriptWithoutStyle = postScriptFamily
    .replace(/[-\s]?(BoldItalic|Bold|Italic|Oblique)$/i, "")
    .trim();
  const withoutStyle = normalized
    .replace(/[-\s](Thin|ExtraLight|UltraLight|Light|Regular|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|Italic|Oblique|BoldMT|ItalicMT|BoldItalicMT)$/i, "")
    .trim();
  const dashFamily = normalized.includes("-") ? normalized.split("-")[0].trim() : "";

  return Array.from(new Set([normalized, postScriptFamily, postScriptWithoutStyle, withoutStyle, dashFamily].filter(Boolean)));
}

function findLocalFont(candidate: string, fonts: string[]): string | undefined {
  const normalizedCandidate = normalizeFontName(candidate);
  return (
    fonts.find((font) => normalizeFontName(font) === normalizedCandidate) ||
    fonts.find((font) => normalizeFontName(font).startsWith(normalizedCandidate)) ||
    fonts.find((font) => {
      const normalizedFont = normalizeFontName(font);
      if (!normalizedCandidate.startsWith(normalizedFont)) return false;
      return FONT_STYLE_SUFFIXES.includes(normalizedCandidate.slice(normalizedFont.length));
    })
  );
}

function chooseFallbackFont(text: string, fonts: string[]): string {
  const preferred = containsKorean(text)
    ? ["Pretendard", "Noto Sans CJK KR", "Noto Sans KR", "Malgun Gothic", "맑은 고딕", "Arial Unicode MS", "Arial"]
    : ["Pretendard", "Aptos", "Calibri", "Arial", "Helvetica", "Times New Roman"];

  for (const candidate of preferred) {
    const match = findLocalFont(candidate, fonts);
    if (match) return match;
  }

  return containsKorean(text) ? "Malgun Gothic" : "Arial";
}

function containsKorean(text: string): boolean {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(text);
}

function normalizeFontName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s_\-.,'"]/g, "")
    .replace(/psmt$/g, "")
    .replace(/mt$/g, "");
}
