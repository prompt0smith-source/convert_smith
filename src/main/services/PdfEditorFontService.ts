import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { StandardFonts, rgb, type PDFDocument, type PDFFont } from "pdf-lib";

export interface PdfEditorFontChoice {
  font: PDFFont;
  embedded: boolean;
}

export class PdfEditorFontService {
  private readonly fontCache = new Map<string, PDFFont>();
  private standardFont?: PDFFont;

  reset(): void {
    this.fontCache.clear();
    this.standardFont = undefined;
  }

  async resolveFont(
    pdfDoc: PDFDocument,
    text: string,
    preferredFamily?: string,
    preferredWeight?: string,
    preferredStyle?: string
  ): Promise<PdfEditorFontChoice> {
    const customFontPath = await findLocalFontFile(preferredFamily, text, preferredWeight, preferredStyle);
    if (customFontPath) {
      const cached = this.fontCache.get(customFontPath);
      if (cached) return { font: cached, embedded: true };
      const font = await pdfDoc.embedFont(await readFile(customFontPath), { subset: true });
      this.fontCache.set(customFontPath, font);
      return { font, embedded: true };
    }

    if (!this.standardFont) {
      this.standardFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }
    return { font: this.standardFont, embedded: false };
  }
}

export function wrapPdfEditorText(font: PDFFont, text: string, maxWidth: number, fontSize: number): string[] {
  const explicitLines = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const explicitLine of explicitLines) {
    const words = explicitLine.split(/(\s+)/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const next = `${line}${word}`;
      if (line && font.widthOfTextAtSize(next, fontSize) > maxWidth) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line || " ");
  }
  return lines.slice(0, 20);
}

export function fitPdfEditorFontSize(font: PDFFont, text: string, maxWidth: number, requestedSize: number): number {
  let size = clamp(requestedSize, 5, 96);
  const longestLine = text.split(/\r?\n/).reduce((longest, line) => (line.length > longest.length ? line : longest), "");
  while (size > 5 && font.widthOfTextAtSize(longestLine, size) > maxWidth * 1.12) {
    size -= 0.5;
  }
  return size;
}

export function parsePdfEditorRgb(hexColor?: string): ReturnType<typeof rgb> {
  const normalized = (hexColor || "000000").replace(/^#/, "").trim();
  const value = /^[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "000000";
  return rgb(
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255
  );
}

export function containsNonWinAnsi(text: string): boolean {
  return /[^\u0009\u000a\u000d\u0020-\u007e\u00a0-\u00ff]/.test(text);
}

async function findLocalFontFile(
  preferredFamily: string | undefined,
  text: string,
  preferredWeight?: string,
  preferredStyle?: string
): Promise<string | undefined> {
  const families = createFontCandidates(preferredFamily, text);
  const candidates = createFontPathCandidates(families, preferredWeight, preferredStyle);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

function createFontCandidates(preferredFamily: string | undefined, text: string): string[] {
  const preferred = preferredFamily ? [preferredFamily] : [];
  const korean = containsKorean(text)
    ? ["Malgun Gothic", "맑은 고딕", "Noto Sans CJK KR", "Noto Sans KR", "Pretendard", "Arial Unicode MS"]
    : [];
  const latin = ["Times New Roman", "Arial Narrow", "Arial", "Calibri", "Aptos", "Helvetica"];
  return Array.from(new Set([...preferred, ...korean, ...latin].filter(Boolean)));
}

function createFontPathCandidates(families: string[], preferredWeight?: string, preferredStyle?: string): string[] {
  const windowsFontDir = process.env.WINDIR ? path.join(process.env.WINDIR, "Fonts") : "C:\\Windows\\Fonts";
  const map: Record<string, Partial<Record<FontVariant, string[]>>> = {
    malgungothic: { regular: ["malgun.ttf"], bold: ["malgunbd.ttf", "malgun.ttf"] },
    맑은고딕: { regular: ["malgun.ttf"], bold: ["malgunbd.ttf", "malgun.ttf"] },
    notosanscjkkr: {
      regular: ["NotoSansCJKkr-Regular.otf", "NotoSansKR-Regular.otf"],
      bold: ["NotoSansCJKkr-Bold.otf", "NotoSansKR-Bold.otf", "NotoSansCJKkr-Regular.otf", "NotoSansKR-Regular.otf"]
    },
    notosanskr: { regular: ["NotoSansKR-Regular.otf"], bold: ["NotoSansKR-Bold.otf", "NotoSansKR-Regular.otf"] },
    pretendard: { regular: ["Pretendard-Regular.otf", "PretendardVariable.ttf"], bold: ["Pretendard-Bold.otf", "PretendardVariable.ttf", "Pretendard-Regular.otf"] },
    arialunicodems: { regular: ["arialuni.ttf"] },
    timesnewroman: {
      regular: ["times.ttf"],
      bold: ["timesbd.ttf", "times.ttf"],
      italic: ["timesi.ttf", "times.ttf"],
      boldItalic: ["timesbi.ttf", "timesbd.ttf", "timesi.ttf", "times.ttf"]
    },
    arial: {
      regular: ["arial.ttf"],
      bold: ["arialbd.ttf", "arial.ttf"],
      italic: ["ariali.ttf", "arial.ttf"],
      boldItalic: ["arialbi.ttf", "arialbd.ttf", "ariali.ttf", "arial.ttf"]
    },
    arialnarrow: {
      regular: ["arialn.ttf", "ARIALN.TTF"],
      bold: ["arialnb.ttf", "ARIALNB.TTF", "arialn.ttf", "ARIALN.TTF"],
      italic: ["arialni.ttf", "ARIALNI.TTF", "arialn.ttf", "ARIALN.TTF"],
      boldItalic: ["arialnbi.ttf", "ARIALNBI.TTF", "arialnb.ttf", "ARIALNB.TTF", "arialn.ttf", "ARIALN.TTF"]
    },
    calibri: {
      regular: ["calibri.ttf"],
      bold: ["calibrib.ttf", "calibri.ttf"],
      italic: ["calibrii.ttf", "calibri.ttf"],
      boldItalic: ["calibriz.ttf", "calibrib.ttf", "calibrii.ttf", "calibri.ttf"]
    },
    aptos: {
      regular: ["aptos.ttf", "Aptos.ttf"],
      bold: ["aptos-bold.ttf", "Aptos-Bold.ttf", "aptos.ttf", "Aptos.ttf"],
      italic: ["aptos-italic.ttf", "Aptos-Italic.ttf", "aptos.ttf", "Aptos.ttf"],
      boldItalic: ["aptos-bolditalic.ttf", "Aptos-BoldItalic.ttf", "aptos-bold.ttf", "Aptos-Bold.ttf", "aptos.ttf", "Aptos.ttf"]
    },
    helvetica: { regular: ["arial.ttf"], bold: ["arialbd.ttf", "arial.ttf"], italic: ["ariali.ttf", "arial.ttf"], boldItalic: ["arialbi.ttf", "arialbd.ttf", "arial.ttf"] }
  };
  const variants = createVariantOrder(preferredWeight, preferredStyle);
  return families.flatMap((family) => {
    const filesByVariant = map[normalizeFontName(family)] || {};
    const files = variants.flatMap((variant) => filesByVariant[variant] || []);
    return files.map((file) => path.join(windowsFontDir, file));
  });
}

type FontVariant = "regular" | "bold" | "italic" | "boldItalic";

function createVariantOrder(preferredWeight?: string, preferredStyle?: string): FontVariant[] {
  const bold = isBoldWeight(preferredWeight);
  const italic = /italic|oblique/i.test(preferredStyle || "");
  const preferred: FontVariant = bold && italic ? "boldItalic" : bold ? "bold" : italic ? "italic" : "regular";
  return Array.from(new Set([preferred, "regular", "bold", "italic", "boldItalic"]));
}

function isBoldWeight(weight?: string): boolean {
  if (!weight) return false;
  if (/bold|black|heavy/i.test(weight)) return true;
  const numeric = Number.parseInt(weight, 10);
  return Number.isFinite(numeric) && numeric >= 600;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function containsKorean(text: string): boolean {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(text);
}

function normalizeFontName(value: string): string {
  return value.toLowerCase().replace(/[\s_\-.,'"]/g, "");
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
