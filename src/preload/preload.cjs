const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("convertSmith", {
  getDroppedFilePaths: (files) =>
    Array.from(files || [])
      .map((file) => webUtils.getPathForFile(file))
      .filter(Boolean),
  resolveDroppedFiles: (paths, dropIndexOffset) =>
    ipcRenderer.invoke("files:resolveDropped", paths, dropIndexOffset),
  resolveClipboardFiles: (dropIndexOffset, includeTextPaths) =>
    ipcRenderer.invoke("files:resolveClipboard", dropIndexOffset, includeTextPaths),
  selectFiles: () => ipcRenderer.invoke("dialog:selectFiles"),
  selectSignatureImage: () => ipcRenderer.invoke("dialog:selectSignatureImage"),
  selectOutputDirectory: () => ipcRenderer.invoke("dialog:selectOutputDirectory"),
  selectLibreOfficePath: () => ipcRenderer.invoke("dialog:selectLibreOfficePath"),
  openLibreOfficeDownloadPage: () => ipcRenderer.invoke("external:openLibreOfficeDownload"),
  startConversion: (payload) => ipcRenderer.invoke("conversion:start", payload),
  cancelConversion: (jobId) => ipcRenderer.invoke("conversion:cancel", jobId),
  getPdfInfo: (filePath) => ipcRenderer.invoke("pdfTool:getInfo", filePath),
  startPdfTool: (payload) => ipcRenderer.invoke("pdfTool:start", payload),
  getPdfEditorTextLayer: (filePath) => ipcRenderer.invoke("pdfEditor:getTextLayer", filePath),
  previewPdfEditorTextEdits: (payload) => ipcRenderer.invoke("pdfEditor:previewTextEdits", payload),
  savePdfEditorTextEdits: (payload) => ipcRenderer.invoke("pdfEditor:saveTextEdits", payload),
  openPdfEditorWindow: (payload) => ipcRenderer.invoke("pdfEditor:openWindow", payload),
  getPdfEditorWindowContext: (token) => ipcRenderer.invoke("pdfEditor:getWindowContext", token),
  inspectVideo: (filePath) => ipcRenderer.invoke("video:inspect", filePath),
  getDependencyStatus: (libreOfficePath) =>
    ipcRenderer.invoke("dependencies:status", libreOfficePath),
  getFilePreview: (filePath, pageNumber) => ipcRenderer.invoke("file:getPreview", filePath, pageNumber),
  getNativePreviewUrl: (filePath) => ipcRenderer.invoke("file:getNativePreviewUrl", filePath),
  previewFile: (filePath) => ipcRenderer.invoke("file:preview", filePath),
  revealPath: (filePath) => ipcRenderer.invoke("file:reveal", filePath),
  setFloatingEnabled: (enabled) => ipcRenderer.invoke("floating:setEnabled", enabled),
  getFloatingEnabled: () => ipcRenderer.invoke("floating:getEnabled"),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke("app:setAlwaysOnTop", enabled),
  getAlwaysOnTop: () => ipcRenderer.invoke("app:getAlwaysOnTop"),
  showMainFromFloating: () => ipcRenderer.invoke("floating:showMain"),
  moveFloating: (x, y) => ipcRenderer.invoke("floating:move", x, y),
  getAppIconDataUrl: () => ipcRenderer.invoke("app:getIconDataUrl"),
  getContextMenuStatus: () => ipcRenderer.invoke("contextMenu:getStatus"),
  installContextMenu: () => ipcRenderer.invoke("contextMenu:install"),
  uninstallContextMenu: () => ipcRenderer.invoke("contextMenu:uninstall"),
  getLaunchFiles: () => ipcRenderer.invoke("app:getLaunchFiles").then(normalizeLaunchRequests),
  setCompactMode: (enabled) => ipcRenderer.invoke("app:setCompactMode", enabled),
  quitApp: () => ipcRenderer.invoke("app:quit"),
  onJobUpdate: (listener) => {
    const wrapped = (_event, job) => listener(job);
    ipcRenderer.on("conversion:jobUpdated", wrapped);
    return () => ipcRenderer.removeListener("conversion:jobUpdated", wrapped);
  },
  onPdfToolUpdate: (listener) => {
    const wrapped = (_event, job) => listener(job);
    ipcRenderer.on("pdfTool:jobUpdated", wrapped);
    return () => ipcRenderer.removeListener("pdfTool:jobUpdated", wrapped);
  },
  onLaunchFiles: (listener) => {
    const wrapped = (_event, requests) => listener(normalizeLaunchRequests(requests));
    ipcRenderer.on("app:launchFiles", wrapped);
    return () => ipcRenderer.removeListener("app:launchFiles", wrapped);
  }
});

function normalizeLaunchRequests(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const action = normalizeLaunchAction(item.action);
    const paths = Array.isArray(item.paths)
      ? item.paths.filter((pathValue) => typeof pathValue === "string" && Boolean(pathValue.trim()))
      : [];
    return action && paths.length > 0 ? [{ action, paths }] : [];
  });
}

function normalizeLaunchAction(value) {
  return value === "convert" || value === "merge" || value === "split" ? value : undefined;
}
