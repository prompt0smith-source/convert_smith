import path from "node:path";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";

const nodeRequire = createRequire(__filename);

let pdfjsDistRoot: string | undefined;
let canvasFontsReady = false;

interface CanvasFontRegistry {
  loadSystemFonts?: () => number;
  loadFontsFromDir?: (dir: string) => number;
  setAlias?: (family: string, alias: string) => boolean;
}

export function createPdfjsDocumentOptions(data: Uint8Array): Record<string, unknown> {
  const root = getPdfjsDistRoot();
  return {
    data,
    disableWorker: true,
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

    setAliases(fonts, "Times New Roman", ["Times", "Times-Roman", "TimesNewRoman", "Times New Roman PS"]);
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
