const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("convertSmith", {
  getDroppedFilePaths: (files) =>
    Array.from(files || [])
      .map((file) => webUtils.getPathForFile(file))
      .filter(Boolean),
  resolveDroppedFiles: (paths, dropIndexOffset) =>
    ipcRenderer.invoke("files:resolveDropped", paths, dropIndexOffset),
  selectFiles: () => ipcRenderer.invoke("dialog:selectFiles"),
  selectOutputDirectory: () => ipcRenderer.invoke("dialog:selectOutputDirectory"),
  selectLibreOfficePath: () => ipcRenderer.invoke("dialog:selectLibreOfficePath"),
  openLibreOfficeDownloadPage: () => ipcRenderer.invoke("external:openLibreOfficeDownload"),
  startConversion: (payload) => ipcRenderer.invoke("conversion:start", payload),
  cancelConversion: (jobId) => ipcRenderer.invoke("conversion:cancel", jobId),
  inspectVideo: (filePath) => ipcRenderer.invoke("video:inspect", filePath),
  getDependencyStatus: (libreOfficePath) =>
    ipcRenderer.invoke("dependencies:status", libreOfficePath),
  getFilePreview: (filePath) => ipcRenderer.invoke("file:getPreview", filePath),
  previewFile: (filePath) => ipcRenderer.invoke("file:preview", filePath),
  revealPath: (filePath) => ipcRenderer.invoke("file:reveal", filePath),
  onJobUpdate: (listener) => {
    const wrapped = (_event, job) => listener(job);
    ipcRenderer.on("conversion:jobUpdated", wrapped);
    return () => ipcRenderer.removeListener("conversion:jobUpdated", wrapped);
  }
});
