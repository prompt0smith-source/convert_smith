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

  async resolveFont(pdfDoc: PDFDocument, text: string, preferredFamily?: string): Promise<PdfEditorFontChoice> {
    const customFontPath = await findLocalFontFile(preferredFamily, text);
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

async function findLocalFontFile(preferredFamily: string | undefined, text: string): Promise<string | undefined> {
  const families = createFontCandidates(preferredFamily, text);
  const candidates = createFontPathCandidates(families);
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
  const latin = ["Arial", "Calibri", "Aptos", "Helvetica"];
  return Array.from(new Set([...preferred, ...korean, ...latin].filter(Boolean)));
}

function createFontPathCandidates(families: string[]): string[] {
  const windowsFontDir = process.env.WINDIR ? path.join(process.env.WINDIR, "Fonts") : "C:\\Windows\\Fonts";
  const map: Record<string, string[]> = {
    "malgun gothic": ["malgun.ttf", "malgunbd.ttf"],
    "맑은 고딕": ["malgun.ttf", "malgunbd.ttf"],
    "noto sans cjk kr": ["NotoSansCJKkr-Regular.otf", "NotoSansKR-Regular.otf"],
    "noto sans kr": ["NotoSansKR-Regular.otf"],
    pretendard: ["Pretendard-Regular.otf", "PretendardVariable.ttf"],
    "arial unicode ms": ["arialuni.ttf"],
    arial: ["arial.ttf"],
    calibri: ["calibri.ttf"],
    aptos: ["aptos.ttf"],
    helvetica: ["arial.ttf"]
  };
  return families.flatMap((family) => {
    const files = map[normalizeFontName(family)] || [];
    return files.map((file) => path.join(windowsFontDir, file));
  });
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
