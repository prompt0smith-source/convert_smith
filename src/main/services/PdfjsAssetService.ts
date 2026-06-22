import path from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const nodeRequire = createRequire(__filename);

let pdfjsDistRoot: string | undefined;
let canvasFontsReady = false;
let canvasLocalFontFamilies: string[] | undefined;

interface CanvasFontRegistry {
  loadSystemFonts?: () => number;
  loadFontsFromDir?: (dir: string) => number;
  getFamilies?: () => Buffer | Uint8Array | ArrayBuffer | string;
  setAlias?: (family: string, alias: string) => boolean;
}

interface CanvasFontFamily {
  family: string;
}

export function createPdfjsDocumentOptions(data: Uint8Array): Record<string, unknown> {
  const root = getPdfjsDistRoot();
  return {
    data,
    disableWorker: true,
    isEvalSupported: false,
    verbosity: 0,
    useSystemFonts: true,
    disableFontFace: false,
    standardFontDataUrl: path.join(root, "standard_fonts") + path.sep,
    cMapUrl: path.join(root, "cmaps") + path.sep,
    cMapPacked: true
  };
}

export function preparePdfCanvasFonts(canvasModule: { GlobalFonts?: CanvasFontRegistry }): void {
  if (canvasFontsReady) return;
  canvasFontsReady = true;
  const fonts = canvasModule.GlobalFonts;
  if (!fonts) return;

  try {
    fonts.loadSystemFonts?.();
    if (process.platform === "win32") {
      const fontDir = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
      if (existsSync(fontDir)) fonts.loadFontsFromDir?.(fontDir);
    }

    captureCanvasLocalFonts(fonts);

    setAliases(fonts, "Times New Roman", [
      "Times",
      "Times-Roman",
      "TimesNewRoman",
      "Times New Roman PS",
      "TimesNewRomanPSMT",
      "TimesNewRomanPS-BoldMT",
      "TimesNewRomanPS-ItalicMT",
      "TimesNewRomanPS-BoldItalicMT",
      "Times New Roman Bold",
      "Times New Roman Italic",
      "Times New Roman Bold Italic"
    ]);
    setAliases(fonts, "Arial", ["Helvetica", "Helvetica Neue", "ArialMT"]);
    setAliases(fonts, "Courier New", ["Courier", "CourierNew", "CourierStd"]);
    setAliases(fonts, "Malgun Gothic", [
      "Gulim",
      "GulimChe",
      "Dotum",
      "DotumChe",
      "Batang",
      "BatangChe",
      "Gungsuh",
      "GungsuhChe",
      "AppleGothic",
      "Noto Sans CJK KR",
      "NotoSansCJKkr",
      "Korean"
    ]);
  } catch {
    // Font registration is a best-effort fallback. PDF rendering can still continue.
  }
}

export function getPreparedCanvasLocalFontFamilies(): string[] | undefined {
  return canvasLocalFontFamilies ? [...canvasLocalFontFamilies] : undefined;
}

function getPdfjsDistRoot(): string {
  if (!pdfjsDistRoot) {
    const unpackedRoot = path.join(
      process.resourcesPath || "",
      "app.asar.unpacked",
      "node_modules",
      "pdfjs-dist"
    );
    pdfjsDistRoot = existsSync(path.join(unpackedRoot, "package.json"))
      ? unpackedRoot
      : path.dirname(nodeRequire.resolve("pdfjs-dist/package.json"));
  }
  return pdfjsDistRoot;
}

function setAliases(fonts: CanvasFontRegistry, family: string, aliases: string[]): void {
  for (const alias of aliases) {
    try {
      fonts.setAlias?.(family, alias);
    } catch {
      // Ignore unsupported aliases.
    }
  }
}

function captureCanvasLocalFonts(fonts: CanvasFontRegistry): void {
  if (canvasLocalFontFamilies) return;

  try {
    const raw = fonts.getFamilies?.();
    const parsed = parseCanvasFontFamilies(raw);
    canvasLocalFontFamilies = Array.from(
      new Set(
        parsed
          .map((item: CanvasFontFamily) => item.family)
          .filter((family: unknown): family is string => typeof family === "string" && family.trim().length > 0)
      )
    ).sort((a: string, b: string) => a.localeCompare(b, "en"));
  } catch {
    canvasLocalFontFamilies = [];
  }
}

function parseCanvasFontFamilies(raw: Buffer | Uint8Array | ArrayBuffer | string | undefined): CanvasFontFamily[] {
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
