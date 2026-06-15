import { ipcMain, dialog, shell, BrowserWindow, clipboard, app } from "electron";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { ConversionJob, StartConversionPayload } from "../types/conversion.js";
import { ConversionService } from "../services/ConversionService.js";
import { DependencyService } from "../services/DependencyService.js";

const LIBRE_OFFICE_DOWNLOAD_URL = "https://www.libreoffice.org/download/";

const OPEN_FILE_FILTERS = [
  {
    name: "지원 파일",
    extensions: [
      "pdf",
      "doc",
      "docx",
      "xls",
      "xlsx",
      "ppt",
      "pptx",
      "jpg",
      "jpeg",
      "png",
      "heic",
      "heif",
      "webp",
      "avif",
      "tif",
      "tiff",
      "bmp",
      "mp4",
      "mov",
      "mkv",
      "webm",
      "m4v",
      "wav",
      "flac",
      "m4a"
    ]
  },
  { name: "모든 파일", extensions: ["*"] }
];

export function registerConversionHandlers(service: ConversionService): void {
  const dependencies = new DependencyService();

  ipcMain.handle("files:resolveDropped", async (_event, paths: unknown, dropIndexOffset: unknown) => {
    if (!Array.isArray(paths) || !paths.every((item) => typeof item === "string")) {
      throw new Error("파일 목록이 올바르지 않습니다.");
    }
    const offset = typeof dropIndexOffset === "number" && Number.isFinite(dropIndexOffset) ? dropIndexOffset : 0;
    return service.resolveDroppedFiles(paths, offset);
  });

  ipcMain.handle("files:resolveClipboard", async (_event, dropIndexOffset: unknown, includeTextPaths: unknown) => {
    const offset = typeof dropIndexOffset === "number" && Number.isFinite(dropIndexOffset) ? dropIndexOffset : 0;
    const paths = readClipboardFilePaths(includeTextPaths !== false);
    if (paths.length === 0) {
      const imagePath = await writeClipboardImageIfAvailable();
      if (imagePath) paths.push(imagePath);
    }
    if (paths.length === 0) return [];
    return service.resolveDroppedFiles(paths, offset);
  });

  ipcMain.handle("dialog:selectFiles", async () => {
    const result = await dialog.showOpenDialog({
      title: "변환할 파일 선택",
      properties: ["openFile", "multiSelections"],
      filters: OPEN_FILE_FILTERS
    });
    if (result.canceled) return [];
    return service.resolveDroppedFiles(result.filePaths, 0);
  });

  ipcMain.handle("dialog:selectOutputDirectory", async () => {
    const result = await dialog.showOpenDialog({
      title: "저장할 폴더 선택",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:selectLibreOfficePath", async () => {
    const result = await dialog.showOpenDialog({
      title: "LibreOffice soffice 실행 파일 선택",
      properties: ["openFile"],
      filters: [
        { name: "LibreOffice soffice", extensions: process.platform === "win32" ? ["exe"] : ["*"] },
        { name: "모든 파일", extensions: ["*"] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("external:openLibreOfficeDownload", async () => {
    try {
      await shell.openExternal(LIBRE_OFFICE_DOWNLOAD_URL);
      return { ok: true, message: "LibreOffice 공식 다운로드 페이지를 열었습니다." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "LibreOffice 다운로드 페이지를 열지 못했습니다."
      };
    }
  });

  ipcMain.handle("conversion:start", async (event, payload: StartConversionPayload) => {
    return service.convert(payload, (job: ConversionJob) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("conversion:jobUpdated", job);
      }
    });
  });

  ipcMain.handle("conversion:cancel", async (_event, jobId: unknown) => {
    if (typeof jobId !== "string") return false;
    return service.cancelJob(jobId);
  });

  ipcMain.handle("video:inspect", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("파일 경로가 올바르지 않습니다.");
    }
    return service.inspectVideo(filePath);
  });

  ipcMain.handle("dependencies:status", async (_event, libreOfficePath: unknown) => {
    return dependencies.getStatus(typeof libreOfficePath === "string" ? libreOfficePath : undefined);
  });

  ipcMain.handle("file:getPreview", async (_event, filePath: unknown, pageNumber: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("파일 경로가 올바르지 않습니다.");
    }
    return service.getFilePreview(filePath, typeof pageNumber === "number" ? pageNumber : 1);
  });

  ipcMain.handle("file:getNativePreviewUrl", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("파일 경로가 올바르지 않습니다.");
    }
    return service.getNativePreviewUrl(filePath);
  });

  ipcMain.handle("file:preview", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      return { ok: false, message: "파일 경로가 올바르지 않습니다." };
    }
    try {
      const [item] = await service.resolveDroppedFiles([filePath], 0);
      const message = await shell.openPath(item.path);
      return message ? { ok: false, message } : { ok: true, message: "파일을 열었습니다." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "파일을 열지 못했습니다."
      };
    }
  });

  ipcMain.handle("file:reveal", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      return { ok: false, message: "파일 경로가 올바르지 않습니다." };
    }
    try {
      const [item] = await service.resolveDroppedFiles([filePath], 0);
      shell.showItemInFolder(item.path);
      return { ok: true, message: "폴더에서 파일을 표시했습니다." };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : "파일 위치를 열지 못했습니다."
      };
    }
  });

  ipcMain.handle("window:focus", async (event) => {
    BrowserWindow.fromWebContents(event.sender)?.focus();
  });

  ipcMain.handle("app:quit", async () => {
    setImmediate(() => app.quit());
    return true;
  });
}

function readClipboardFilePaths(includeTextPaths = true): string[] {
  const candidates = new Set<string>();

  for (const filePath of readNullSeparatedUtf16Clipboard("FileNameW")) {
    candidates.add(filePath);
  }
  for (const filePath of readNullSeparatedAnsiClipboard("FileName")) {
    candidates.add(filePath);
  }
  if (includeTextPaths) {
    for (const filePath of readPathsFromTextClipboard()) {
      candidates.add(filePath);
    }
  }

  return [...candidates].filter((filePath) => typeof filePath === "string" && filePath.trim() && !filePath.includes("\0"));
}

function readNullSeparatedUtf16Clipboard(format: string): string[] {
  try {
    const buffer = clipboard.readBuffer(format);
    if (!buffer || buffer.length === 0) return [];
    return buffer
      .toString("utf16le")
      .split("\0")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readNullSeparatedAnsiClipboard(format: string): string[] {
  try {
    const buffer = clipboard.readBuffer(format);
    if (!buffer || buffer.length === 0) return [];
    return buffer
      .toString("latin1")
      .split("\0")
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readPathsFromTextClipboard(): string[] {
  const text = clipboard.readText().trim();
  if (!text) return [];

  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^["']|["']$/g, ""))
    .map((line) => {
      if (/^file:\/\//i.test(line)) {
        try {
          return path.normalize(decodeURIComponent(new URL(line).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
        } catch {
          return "";
        }
      }
      return line;
    })
    .filter((line) => path.isAbsolute(line));
}

async function writeClipboardImageIfAvailable(): Promise<string | null> {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;

  const png = image.toPNG();
  if (png.length === 0) return null;

  const outputDir = path.join(app.getPath("userData"), "clipboard-images");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `clipboard_screenshot_${formatTimestamp(new Date())}_${randomUUID().slice(0, 8)}.png`);
  await writeFile(outputPath, png);
  return outputPath;
}

function formatTimestamp(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "_",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    "_",
    pad(date.getMilliseconds(), 3)
  ].join("");
}
