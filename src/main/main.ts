import path from "node:path";
import { app, BrowserWindow } from "electron";
import { registerConversionHandlers } from "./ipc/conversionHandlers.js";
import { ConversionService } from "./services/ConversionService.js";

const conversionService = new ConversionService();

function getAppIconPath(): string {
  if (app.isPackaged) {
    const iconName = process.platform === "darwin" ? "icon.icns" : process.platform === "win32" ? "icon.ico" : "icon.png";
    return path.join(process.resourcesPath, "build", iconName);
  }
  return path.join(__dirname, "../../build", process.platform === "darwin" ? "icon.icns" : process.platform === "win32" ? "icon.ico" : "icon.png");
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 700,
    title: "Convert Smith",
    icon: getAppIconPath(),
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

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
  registerConversionHandlers(conversionService);
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
