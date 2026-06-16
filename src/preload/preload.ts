import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ConvertSmithApi } from "./exposedApi.js";
import type { StartConversionPayload, StartPdfToolPayload } from "../main/types/conversion.js";

const api: ConvertSmithApi = {
  getDroppedFilePaths: (files: File[]) =>
    Array.from(files)
      .map((file) => webUtils.getPathForFile(file))
      .filter((filePath): filePath is string => Boolean(filePath)),
  resolveDroppedFiles: (paths: string[], dropIndexOffset?: number) =>
    ipcRenderer.invoke("files:resolveDropped", paths, dropIndexOffset),
  resolveClipboardFiles: (dropIndexOffset?: number, includeTextPaths?: boolean) =>
    ipcRenderer.invoke("files:resolveClipboard", dropIndexOffset, includeTextPaths),
  selectFiles: () => ipcRenderer.invoke("dialog:selectFiles"),
  selectSignatureImage: () => ipcRenderer.invoke("dialog:selectSignatureImage"),
  selectOutputDirectory: () => ipcRenderer.invoke("dialog:selectOutputDirectory"),
  selectLibreOfficePath: () => ipcRenderer.invoke("dialog:selectLibreOfficePath"),
  openLibreOfficeDownloadPage: () => ipcRenderer.invoke("external:openLibreOfficeDownload"),
  startConversion: (payload: StartConversionPayload) =>
    ipcRenderer.invoke("conversion:start", payload),
  cancelConversion: (jobId: string) => ipcRenderer.invoke("conversion:cancel", jobId),
  getPdfInfo: (path: string) => ipcRenderer.invoke("pdfTool:getInfo", path),
  startPdfTool: (payload: StartPdfToolPayload) => ipcRenderer.invoke("pdfTool:start", payload),
  inspectVideo: (path: string) => ipcRenderer.invoke("video:inspect", path),
  getDependencyStatus: (libreOfficePath?: string) =>
    ipcRenderer.invoke("dependencies:status", libreOfficePath),
  getFilePreview: (path: string, pageNumber?: number) => ipcRenderer.invoke("file:getPreview", path, pageNumber),
  getNativePreviewUrl: (path: string) => ipcRenderer.invoke("file:getNativePreviewUrl", path),
  previewFile: (path: string) => ipcRenderer.invoke("file:preview", path),
  revealPath: (path: string) => ipcRenderer.invoke("file:reveal", path),
  setFloatingEnabled: (enabled: boolean) => ipcRenderer.invoke("floating:setEnabled", enabled),
  getFloatingEnabled: () => ipcRenderer.invoke("floating:getEnabled"),
  showMainFromFloating: () => ipcRenderer.invoke("floating:showMain"),
  moveFloating: (x: number, y: number) => ipcRenderer.invoke("floating:move", x, y),
  getAppIconDataUrl: () => ipcRenderer.invoke("app:getIconDataUrl"),
  getContextMenuStatus: () => ipcRenderer.invoke("contextMenu:getStatus"),
  installContextMenu: () => ipcRenderer.invoke("contextMenu:install"),
  uninstallContextMenu: () => ipcRenderer.invoke("contextMenu:uninstall"),
  getLaunchFiles: () => ipcRenderer.invoke("app:getLaunchFiles"),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  onJobUpdate: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, job: unknown) => {
      listener(job as never);
    };
    ipcRenderer.on("conversion:jobUpdated", wrapped);
    return () => ipcRenderer.removeListener("conversion:jobUpdated", wrapped);
  },
  onPdfToolUpdate: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, job: unknown) => {
      listener(job as never);
    };
    ipcRenderer.on("pdfTool:jobUpdated", wrapped);
    return () => ipcRenderer.removeListener("pdfTool:jobUpdated", wrapped);
  },
  onLaunchFiles: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, paths: unknown) => {
      listener(Array.isArray(paths) ? paths.filter((item): item is string => typeof item === "string") : []);
    };
    ipcRenderer.on("app:launchFiles", wrapped);
    return () => ipcRenderer.removeListener("app:launchFiles", wrapped);
  }
};

contextBridge.exposeInMainWorld("convertSmith", api);
