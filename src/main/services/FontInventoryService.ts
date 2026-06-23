import path from "node:path";
import { homedir, platform } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";

export interface FontInventoryItem {
  path: string;
  postscriptName?: string;
  familyName?: string;
  fullName?: string;
  subfamilyName?: string;
  format: "ttf" | "otf" | "ttc" | "otc";
  weightGuess?: number;
  italicGuess?: boolean;
}

export interface FontSearchRequest {
  text: string;
  preferredFamily?: string;
  preferredWeight?: string;
  preferredStyle?: string;
}

export class FontInventoryService {
  private inventory?: Promise<FontInventoryItem[]>;

  async findFontFileForText(request: FontSearchRequest): Promise<string | undefined> {
    const fonts = await this.getInventory();
    const wantedNames = createWantedFontNames(request.preferredFamily, request.text);
    const bold = isBoldWeight(request.preferredWeight);
    const italic = /italic|oblique/i.test(request.preferredStyle || "");

    const ranked = fonts
      .filter((font) => font.format === "ttf" || font.format === "otf")
      .map((font) => ({
        font,
        score: scoreFont(font, wantedNames, bold, italic)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);

    for (const entry of ranked) {
      if (await this.fontCoversText(entry.font.path, request.text)) return entry.font.path;
    }
    return undefined;
  }

  async getInventory(): Promise<FontInventoryItem[]> {
    if (!this.inventory) this.inventory = this.scanFonts();
    return this.inventory;
  }

  refresh(): void {
    this.inventory = undefined;
  }

  private async scanFonts(): Promise<FontInventoryItem[]> {
    const files = await collectFontFiles(getFontDirectories());
    const items: FontInventoryItem[] = [];
    for (const filePath of files) {
      const item = await parseFontFile(filePath);
      if (item) items.push(item);
    }
    return items;
  }

  private async fontCoversText(filePath: string, text: string): Promise<boolean> {
    try {
      const font = fontkit.create(new Uint8Array(await readFile(filePath))) as any;
      return Array.from(text).every((char) => {
        if (!char.trim()) return true;
        const codePoint = char.codePointAt(0);
        if (codePoint === undefined) return false;
        if (typeof font.hasGlyphForCodePoint === "function") return Boolean(font.hasGlyphForCodePoint(codePoint));
        const glyph = typeof font.glyphForCodePoint === "function" ? font.glyphForCodePoint(codePoint) : undefined;
        return Boolean(glyph && glyph.id !== 0);
      });
    } catch {
      return false;
    }
  }
}

async function collectFontFiles(directories: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const directory of directories) {
    try {
      await stat(directory);
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          files.push(...await collectFontFiles([entryPath]));
          continue;
        }
        if (/\.(ttf|otf|ttc|otc)$/i.test(entry.name)) files.push(entryPath);
      }
    } catch {
      // Missing or protected font directories are ignored.
    }
  }
  return Array.from(new Set(files));
}

async function parseFontFile(filePath: string): Promise<FontInventoryItem | undefined> {
  try {
    const extension = path.extname(filePath).slice(1).toLowerCase() as FontInventoryItem["format"];
    const font = fontkit.create(new Uint8Array(await readFile(filePath))) as any;
    const fullName = String(font.fullName || font.postscriptName || path.basename(filePath, path.extname(filePath)));
    const familyName = String(font.familyName || fullName);
    const subfamilyName = String(font.subfamilyName || "");
    return {
      path: filePath,
      postscriptName: typeof font.postscriptName === "string" ? font.postscriptName : undefined,
      familyName,
      fullName,
      subfamilyName,
      format: extension,
      weightGuess: guessWeight(`${fullName} ${subfamilyName}`),
      italicGuess: /italic|oblique/i.test(`${fullName} ${subfamilyName}`)
    };
  } catch {
    return undefined;
  }
}

function getFontDirectories(): string[] {
  const home = homedir();
  if (platform() === "win32") {
    const windowsDir = process.env.WINDIR || "C:\\Windows";
    return [
      path.join(windowsDir, "Fonts"),
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Microsoft", "Windows", "Fonts") : ""
    ].filter(Boolean);
  }
  if (platform() === "darwin") {
    return ["/System/Library/Fonts", "/Library/Fonts", path.join(home, "Library", "Fonts")];
  }
  return ["/usr/share/fonts", "/usr/local/share/fonts", path.join(home, ".local", "share", "fonts"), path.join(home, ".fonts")];
}

function createWantedFontNames(preferredFamily: string | undefined, text: string): string[] {
  const preferred = preferredFamily ? [preferredFamily] : [];
  const korean = /[\u3131-\u318e\uac00-\ud7a3]/.test(text)
    ? ["Malgun Gothic", "맑은 고딕", "Noto Sans KR", "Noto Sans CJK KR", "Pretendard", "Source Han Sans"]
    : [];
  return Array.from(new Set([...preferred, ...korean, "Arial", "Times New Roman", "Calibri", "Aptos"].map(normalizeFontName)));
}

function scoreFont(font: FontInventoryItem, wantedNames: string[], bold: boolean, italic: boolean): number {
  const names = [font.postscriptName, font.familyName, font.fullName, font.subfamilyName].filter(Boolean).map((name) => normalizeFontName(String(name)));
  let score = 0;
  for (const wanted of wantedNames) {
    if (names.some((name) => name === wanted)) score = Math.max(score, 100);
    if (names.some((name) => name.includes(wanted) || wanted.includes(name))) score = Math.max(score, 70);
  }
  if (bold === Boolean((font.weightGuess || 400) >= 600)) score += 8;
  if (italic === Boolean(font.italicGuess)) score += 6;
  return score;
}

function guessWeight(value: string): number {
  if (/black|heavy/i.test(value)) return 900;
  if (/extra.?bold|ultra.?bold/i.test(value)) return 800;
  if (/bold/i.test(value)) return 700;
  if (/semi.?bold|demi.?bold/i.test(value)) return 600;
  if (/medium/i.test(value)) return 500;
  if (/light/i.test(value)) return 300;
  return 400;
}

function isBoldWeight(weight?: string): boolean {
  if (!weight) return false;
  if (/bold|black|heavy/i.test(weight)) return true;
  const numeric = Number.parseInt(weight, 10);
  return Number.isFinite(numeric) && numeric >= 600;
}

function normalizeFontName(value: string): string {
  return value.toLowerCase().replace(/[\s_\-.,'"]/g, "");
}
