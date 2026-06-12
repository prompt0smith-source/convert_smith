import { ipcMain, dialog, shell, BrowserWindow } from "electron";
import type { ConversionJob, StartConversionPayload } from "../types/conversion.js";
import { ConversionService } from "../services/ConversionService.js";
import { DependencyService } from "../services/DependencyService.js";

const LIBRE_OFFICE_DOWNLOAD_URL = "https://www.libreoffice.org/download/";

const OPEN_FILE_FILTERS = [
  {
    name: "지원 파일",
    extensions: ["pdf", "doc", "docx", "xls", "xlsx", "jpg", "jpeg", "png", "heic", "heif", "mp4", "mov", "mkv", "webm", "m4v"]
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

  ipcMain.handle("file:getPreview", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("파일 경로가 올바르지 않습니다.");
    }
    return service.getFilePreview(filePath);
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
}
