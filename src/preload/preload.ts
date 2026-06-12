import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ConvertSmithApi } from "./exposedApi.js";
import type { StartConversionPayload } from "../main/types/conversion.js";

const api: ConvertSmithApi = {
  getDroppedFilePaths: (files: File[]) =>
    Array.from(files)
      .map((file) => webUtils.getPathForFile(file))
      .filter((filePath): filePath is string => Boolean(filePath)),
  resolveDroppedFiles: (paths: string[], dropIndexOffset?: number) =>
    ipcRenderer.invoke("files:resolveDropped", paths, dropIndexOffset),
  selectFiles: () => ipcRenderer.invoke("dialog:selectFiles"),
  selectOutputDirectory: () => ipcRenderer.invoke("dialog:selectOutputDirectory"),
  selectLibreOfficePath: () => ipcRenderer.invoke("dialog:selectLibreOfficePath"),
  openLibreOfficeDownloadPage: () => ipcRenderer.invoke("external:openLibreOfficeDownload"),
  startConversion: (payload: StartConversionPayload) =>
    ipcRenderer.invoke("conversion:start", payload),
  cancelConversion: (jobId: string) => ipcRenderer.invoke("conversion:cancel", jobId),
  inspectVideo: (path: string) => ipcRenderer.invoke("video:inspect", path),
  getDependencyStatus: (libreOfficePath?: string) =>
    ipcRenderer.invoke("dependencies:status", libreOfficePath),
  getFilePreview: (path: string) => ipcRenderer.invoke("file:getPreview", path),
  previewFile: (path: string) => ipcRenderer.invoke("file:preview", path),
  revealPath: (path: string) => ipcRenderer.invoke("file:reveal", path),
  onJobUpdate: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, job: unknown) => {
      listener(job as never);
    };
    ipcRenderer.on("conversion:jobUpdated", wrapped);
    return () => ipcRenderer.removeListener("conversion:jobUpdated", wrapped);
  }
};

contextBridge.exposeInMainWorld("convertSmith", api);
