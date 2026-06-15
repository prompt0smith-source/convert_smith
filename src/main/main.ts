import path from "node:path";
import { app, BrowserWindow } from "electron";
import { registerConversionHandlers } from "./ipc/conversionHandlers.js";
import { registerFloatingHandlers } from "./ipc/floatingHandlers.js";
import { registerPdfToolHandlers } from "./ipc/pdfToolHandlers.js";
import { ConversionService } from "./services/ConversionService.js";
import { FloatingWindowService } from "./services/FloatingWindowService.js";
import { PathAccessRegistry } from "./services/PathAccessRegistry.js";
import { PdfToolService } from "./services/PdfToolService.js";

const conversionService = new ConversionService();
const pdfToolService = new PdfToolService();
const pathAccessRegistry = new PathAccessRegistry();
let floatingService: FloatingWindowService | undefined;

function getAppIconPath(): string {
  if (app.isPackaged) {
    const iconName = process.platform === "darwin" ? "icon.icns" : process.platform === "win32" ? "icon.ico" : "icon.png";
    return path.join(process.resourcesPath, "build", iconName);
  }
  return path.join(__dirname, "../../build", process.platform === "darwin" ? "icon.icns" : process.platform === "win32" ? "icon.ico" : "icon.png");
}

function createWindow(): BrowserWindow {
  const iconPath = getAppIconPath();
  const preloadPath = path.join(__dirname, "../preload/preload.cjs");
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 620,
    title: "Convert Smith",
    icon: iconPath,
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (!floatingService) {
    floatingService = new FloatingWindowService(preloadPath, iconPath);
    registerFloatingHandlers(floatingService);
  }
  floatingService.attachMainWindow(mainWindow);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const isDevUrl = url.startsWith("http://127.0.0.1:5173/");
    const isFileUrl = url.startsWith("file://");
    if (!isDevUrl && !isFileUrl) {
      event.preventDefault();
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  registerConversionHandlers(conversionService, pathAccessRegistry);
  registerPdfToolHandlers(pdfToolService, pathAccessRegistry);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
