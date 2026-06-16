import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerConversionHandlers } from "./ipc/conversionHandlers.js";
import { registerContextMenuHandlers } from "./ipc/contextMenuHandlers.js";
import { registerFloatingHandlers } from "./ipc/floatingHandlers.js";
import { registerPdfToolHandlers } from "./ipc/pdfToolHandlers.js";
import { ContextMenuService } from "./services/ContextMenuService.js";
import { ConversionService } from "./services/ConversionService.js";
import { FloatingWindowService } from "./services/FloatingWindowService.js";
import { PathAccessRegistry } from "./services/PathAccessRegistry.js";
import { PdfToolService } from "./services/PdfToolService.js";

const conversionService = new ConversionService();
const pdfToolService = new PdfToolService();
const contextMenuService = new ContextMenuService();
const pathAccessRegistry = new PathAccessRegistry();
let floatingService: FloatingWindowService | undefined;
let mainWindow: BrowserWindow | undefined;
const pendingLaunchPaths: string[] = collectOpenFileArgs(process.argv);

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
  const window = new BrowserWindow({
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
  floatingService.attachMainWindow(window);

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const isDevUrl = url.startsWith("http://127.0.0.1:5173/");
    const isFileUrl = url.startsWith("file://");
    if (!isDevUrl && !isFileUrl) {
      event.preventDefault();
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  mainWindow = window;
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const launchPaths = collectOpenFileArgs(argv);
    if (launchPaths.length > 0) {
      pendingLaunchPaths.push(...launchPaths);
      if (mainWindow) sendLaunchFiles(drainPendingLaunchPaths());
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    registerConversionHandlers(conversionService, pathAccessRegistry);
    registerPdfToolHandlers(pdfToolService, pathAccessRegistry);
    registerContextMenuHandlers(contextMenuService);
    ipcMain.handle("app:getLaunchFiles", () => drainPendingLaunchPaths());
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function collectOpenFileArgs(argv: string[]): string[] {
  const paths: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--open") continue;
    const filePath = argv[index + 1];
    if (filePath && !filePath.includes("\0")) {
      paths.push(filePath);
      index += 1;
    }
  }
  return paths;
}

function drainPendingLaunchPaths(): string[] {
  return pendingLaunchPaths.splice(0, pendingLaunchPaths.length);
}

function sendLaunchFiles(paths: string[]): void {
  if (paths.length === 0 || !mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("app:launchFiles", paths);
}
