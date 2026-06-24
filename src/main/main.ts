import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { app, BrowserWindow, Notification, ipcMain, protocol, screen } from "electron";
import type { Rectangle } from "electron";
import { registerConversionHandlers } from "./ipc/conversionHandlers.js";
import { registerContextMenuHandlers } from "./ipc/contextMenuHandlers.js";
import { registerFloatingHandlers } from "./ipc/floatingHandlers.js";
import { registerPdfEditorHandlers } from "./ipc/pdfEditorHandlers.js";
import { registerPdfToolHandlers } from "./ipc/pdfToolHandlers.js";
import { ContextMenuService } from "./services/ContextMenuService.js";
import { ConversionService } from "./services/ConversionService.js";
import { FloatingWindowService } from "./services/FloatingWindowService.js";
import { PathAccessRegistry } from "./services/PathAccessRegistry.js";
import { PdfEditorService } from "./services/PdfEditorService.js";
import { PdfToolService } from "./services/PdfToolService.js";
import type { ContextMenuLaunchAction, ContextMenuLaunchRequest } from "./types/contextMenu.js";
import type { PdfEditorWindowContext, PdfEditorWindowOpenPayload } from "./types/conversion.js";

const conversionService = new ConversionService();
const pdfToolService = new PdfToolService();
const pdfEditorService = new PdfEditorService();
const contextMenuService = new ContextMenuService();
const pathAccessRegistry = new PathAccessRegistry();
let floatingService: FloatingWindowService | undefined;
let mainWindow: BrowserWindow | undefined;
const pdfEditorWindowContexts = new Map<string, PdfEditorWindowContext>();
const initialLaunchRequests = collectLaunchRequests(process.argv);
const initialQuickLaunchRequests = initialLaunchRequests.filter(isQuickLaunchRequest);
const pendingLaunchRequests: ContextMenuLaunchRequest[] = initialLaunchRequests.filter(isInteractiveLaunchRequest);
const pendingQuickPaths: Record<"merge" | "split", string[]> = { merge: [], split: [] };
let quickActionTimer: NodeJS.Timeout | undefined;
let quickActionRunning = false;
let lastExpandedWindowBounds: Rectangle | undefined;
let alwaysOnTopEnabled = false;
const QUICK_ACTION_DEBOUNCE_MS = 1200;
const APP_USER_MODEL_ID = "com.convertsmith.app";
const SETTINGS_FILE_NAME = "settings.json";
const EXPANDED_WINDOW_MIN_SIZE = { width: 760, height: 620 };
const EXPANDED_WINDOW_FALLBACK_SIZE = { width: 1280, height: 820 };
const COMPACT_WINDOW_SIZE = { width: 430, height: 560 };
const COMPACT_WINDOW_MIN_SIZE = { width: 360, height: 460 };
const PDF_EDITOR_WINDOW_MIN_SIZE = { width: 920, height: 680 };
const PDF_EDITOR_WINDOW_SIZE = { width: 1180, height: 840 };
const WINDOW_WORK_AREA_MARGIN = 12;
const LOCAL_FILE_PROTOCOL = "convert-smith-file";

protocol.registerSchemesAsPrivileged([
  {
    scheme: LOCAL_FILE_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

if (process.platform === "win32") {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

function getAppIconPath(): string {
  if (app.isPackaged) {
    const iconName = process.platform === "darwin" ? "icon.icns" : process.platform === "win32" ? "icon.ico" : "icon.png";
    return path.join(process.resourcesPath, "build", iconName);
  }
  return path.join(__dirname, "../../build", process.platform === "darwin" ? "icon.icns" : process.platform === "win32" ? "icon.ico" : "icon.png");
}

function registerLocalFileProtocol(): void {
  protocol.handle(LOCAL_FILE_PROTOCOL, async (request) => {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname !== "preview") {
        return createProtocolTextResponse("Not found", 404);
      }
      const token = requestUrl.pathname.split("/").filter(Boolean)[0];
      const filePath = pathAccessRegistry.resolvePreviewToken(token || "");
      const bytes = await readFile(filePath);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": getPreviewContentType(filePath),
          "Content-Length": String(bytes.byteLength),
          "Cache-Control": "no-store"
        }
      });
    } catch (error) {
      return createProtocolTextResponse(error instanceof Error ? error.message : "Preview failed", 403);
    }
  });
}

function createProtocolTextResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function getPreviewContentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  return "application/octet-stream";
}

function createWindow(): BrowserWindow {
  const iconPath = getAppIconPath();
  const preloadPath = path.join(__dirname, "../preload/preload.cjs");
  const window = new BrowserWindow({
    width: EXPANDED_WINDOW_FALLBACK_SIZE.width,
    height: EXPANDED_WINDOW_FALLBACK_SIZE.height,
    minWidth: EXPANDED_WINDOW_MIN_SIZE.width,
    minHeight: EXPANDED_WINDOW_MIN_SIZE.height,
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
  applyAlwaysOnTop(window);

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

function createPdfEditorWindow(context: PdfEditorWindowContext, parent?: BrowserWindow): BrowserWindow {
  const iconPath = getAppIconPath();
  const preloadPath = path.join(__dirname, "../preload/preload.cjs");
  const sourceBounds = parent && !parent.isDestroyed() ? getWindowReferenceBounds(parent) : undefined;
  const bounds = sourceBounds
    ? createBoundsOnSameDisplay(sourceBounds, PDF_EDITOR_WINDOW_SIZE)
    : undefined;
  const window = new BrowserWindow({
    width: bounds?.width || PDF_EDITOR_WINDOW_SIZE.width,
    height: bounds?.height || PDF_EDITOR_WINDOW_SIZE.height,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: PDF_EDITOR_WINDOW_MIN_SIZE.width,
    minHeight: PDF_EDITOR_WINDOW_MIN_SIZE.height,
    title: `Convert Smith PDF Viewer - ${context.sourceName}`,
    icon: iconPath,
    backgroundColor: "#f8faf7",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  applyAlwaysOnTop(window);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    const isDevUrl = url.startsWith("http://127.0.0.1:5173/");
    const isFileUrl = url.startsWith("file://");
    if (!isDevUrl && !isFileUrl) {
      event.preventDefault();
    }
  });
  window.on("closed", () => {
    pdfEditorWindowContexts.delete(context.token);
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    url.searchParams.set("convertSmithWindow", "pdfEditor");
    url.searchParams.set("token", context.token);
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(path.join(__dirname, "../../dist/index.html"), {
      query: {
        convertSmithWindow: "pdfEditor",
        token: context.token
      }
    });
  }

  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const launchRequests = collectLaunchRequests(argv);
    const quickRequests = launchRequests.filter(isQuickLaunchRequest);
    const interactiveRequests = launchRequests.filter(isInteractiveLaunchRequest);

    if (quickRequests.length > 0) {
      enqueueQuickLaunchRequests(quickRequests);
    }

    if (interactiveRequests.length > 0) {
      pendingLaunchRequests.push(...interactiveRequests);
      if (!mainWindow) {
        createWindow();
      } else {
        sendLaunchFiles(drainPendingLaunchRequests());
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }
  });

  app.whenReady().then(async () => {
    await loadAppSettings();
    registerLocalFileProtocol();
    registerConversionHandlers(conversionService, pathAccessRegistry);
    registerPdfToolHandlers(pdfToolService, pathAccessRegistry);
    registerPdfEditorHandlers(pdfEditorService, pathAccessRegistry);
    registerContextMenuHandlers(contextMenuService);
    ipcMain.handle("pdfEditor:openWindow", async (event, payload: PdfEditorWindowOpenPayload) => {
      if (!payload || typeof payload !== "object" || typeof payload.sourcePath !== "string") {
        throw new Error("PDF Viewer를 열 파일 정보가 올바르지 않습니다.");
      }
      const sourcePath = pathAccessRegistry.assertAllowed(payload.sourcePath);
      const token = randomUUID();
      const context: PdfEditorWindowContext = {
        token,
        sourcePath,
        sourceName: path.basename(sourcePath),
        outputDir: typeof payload.outputDir === "string" ? payload.outputDir : undefined,
        outputName: typeof payload.outputName === "string" ? payload.outputName : undefined,
        useDatedSubfolder: payload.useDatedSubfolder === true
      };
      pdfEditorWindowContexts.set(token, context);
      createPdfEditorWindow(context, BrowserWindow.fromWebContents(event.sender) || mainWindow);
      return true;
    });
    ipcMain.handle("pdfEditor:getWindowContext", (_event, token: unknown) => {
      if (typeof token !== "string" || !token.trim()) {
        throw new Error("PDF Viewer 창 정보를 찾지 못했습니다.");
      }
      const context = pdfEditorWindowContexts.get(token);
      if (!context) {
        throw new Error("PDF Viewer 창 정보가 만료되었습니다. 다시 열어주세요.");
      }
      return context;
    });
    ipcMain.handle("app:getLaunchFiles", () => drainPendingLaunchRequests());
    ipcMain.handle("app:setCompactMode", (event, enabled: unknown) => {
      const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      return setCompactWindowMode(window, Boolean(enabled));
    });
    ipcMain.handle("app:getAlwaysOnTop", () => alwaysOnTopEnabled);
    ipcMain.handle("app:setAlwaysOnTop", async (event, enabled: unknown) => {
      alwaysOnTopEnabled = Boolean(enabled);
      const window = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      const applied = applyAlwaysOnTop(window);
      if (mainWindow && mainWindow !== window) applyAlwaysOnTop(mainWindow);
      await saveAppSettings();
      return applied || alwaysOnTopEnabled;
    });

    if (initialQuickLaunchRequests.length > 0) {
      enqueueQuickLaunchRequests(initialQuickLaunchRequests);
    }

    if (pendingLaunchRequests.length > 0 || initialQuickLaunchRequests.length === 0) {
      createWindow();
    }

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

function setCompactWindowMode(window: BrowserWindow | undefined, enabled: boolean): boolean {
  if (!window || window.isDestroyed()) return false;

  if (enabled) {
    const sourceBounds = getWindowReferenceBounds(window);
    if (!window.isMaximized() && !window.isFullScreen()) {
      lastExpandedWindowBounds = sourceBounds;
    }
    if (window.isFullScreen()) window.setFullScreen(false);
    if (window.isMaximized()) window.unmaximize();
    window.setMinimumSize(COMPACT_WINDOW_MIN_SIZE.width, COMPACT_WINDOW_MIN_SIZE.height);
    window.setBounds(createBoundsOnSameDisplay(sourceBounds, COMPACT_WINDOW_SIZE), true);
    return true;
  }

  const compactBounds = getWindowReferenceBounds(window);
  if (window.isFullScreen()) window.setFullScreen(false);
  if (window.isMaximized()) window.unmaximize();
  window.setMinimumSize(EXPANDED_WINDOW_MIN_SIZE.width, EXPANDED_WINDOW_MIN_SIZE.height);
  window.setBounds(getExpandedBoundsForCurrentDisplay(compactBounds), true);
  return true;
}

function getWindowReferenceBounds(window: BrowserWindow): Rectangle {
  return window.isMaximized() || window.isFullScreen() ? window.getNormalBounds() : window.getBounds();
}

function getExpandedBoundsForCurrentDisplay(currentBounds: Rectangle): Rectangle {
  const currentDisplay = screen.getDisplayMatching(currentBounds);
  if (!lastExpandedWindowBounds) {
    return createBoundsOnSameDisplay(currentBounds, EXPANDED_WINDOW_FALLBACK_SIZE);
  }

  const lastExpandedDisplay = screen.getDisplayMatching(lastExpandedWindowBounds);
  if (lastExpandedDisplay.id === currentDisplay.id) {
    return clampBoundsToWorkArea(lastExpandedWindowBounds, currentDisplay.workArea);
  }

  return createBoundsOnSameDisplay(currentBounds, {
    width: lastExpandedWindowBounds.width || EXPANDED_WINDOW_FALLBACK_SIZE.width,
    height: lastExpandedWindowBounds.height || EXPANDED_WINDOW_FALLBACK_SIZE.height
  });
}

function createBoundsOnSameDisplay(referenceBounds: Rectangle, size: { width: number; height: number }): Rectangle {
  const display = screen.getDisplayMatching(referenceBounds);
  const x = referenceBounds.x + referenceBounds.width / 2 - size.width / 2;
  const y = referenceBounds.y + referenceBounds.height / 2 - size.height / 2;
  return clampBoundsToWorkArea(
    {
      x: Math.round(x),
      y: Math.round(y),
      width: size.width,
      height: size.height
    },
    display.workArea
  );
}

function clampBoundsToWorkArea(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.min(Math.max(Math.round(bounds.width), 1), Math.max(workArea.width - WINDOW_WORK_AREA_MARGIN * 2, 1));
  const height = Math.min(Math.max(Math.round(bounds.height), 1), Math.max(workArea.height - WINDOW_WORK_AREA_MARGIN * 2, 1));
  const minX = workArea.x + WINDOW_WORK_AREA_MARGIN;
  const minY = workArea.y + WINDOW_WORK_AREA_MARGIN;
  const maxX = workArea.x + workArea.width - width - WINDOW_WORK_AREA_MARGIN;
  const maxY = workArea.y + workArea.height - height - WINDOW_WORK_AREA_MARGIN;
  return {
    x: Math.round(clamp(bounds.x, minX, Math.max(minX, maxX))),
    y: Math.round(clamp(bounds.y, minY, Math.max(minY, maxY))),
    width,
    height
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function applyAlwaysOnTop(window: BrowserWindow | undefined): boolean {
  if (!window || window.isDestroyed()) return false;

  if (alwaysOnTopEnabled) {
    window.setAlwaysOnTop(true, "floating");
    window.moveTop();
  } else {
    window.setAlwaysOnTop(false);
  }

  return window.isAlwaysOnTop();
}

function getSettingsPath(): string {
  return path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
}

async function loadAppSettings(): Promise<void> {
  try {
    const raw = await readFile(getSettingsPath(), "utf8");
    const settings = JSON.parse(raw) as { alwaysOnTop?: unknown };
    alwaysOnTopEnabled = settings.alwaysOnTop === true;
  } catch {
    alwaysOnTopEnabled = false;
  }
}

async function saveAppSettings(): Promise<void> {
  const settingsPath = getSettingsPath();
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify({ alwaysOnTop: alwaysOnTopEnabled }, null, 2), "utf8");
}

function collectLaunchRequests(argv: string[]): ContextMenuLaunchRequest[] {
  const requests: ContextMenuLaunchRequest[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--open" || arg === "convert-smith-open") {
      const filePath = argv[index + 1];
      if (isUsableLaunchPath(filePath)) {
        requests.push({ action: "convert", paths: [filePath] });
        index += 1;
      }
      continue;
    }

    if (arg === "--context-action" || arg === "convert-smith-action") {
      const action = normalizeLaunchAction(argv[index + 1]);
      if (!action) {
        index += 1;
        continue;
      }

      const paths: string[] = [];
      index += 2;
      while (index < argv.length) {
        const candidate = argv[index];
        if (candidate.startsWith("--")) {
          index -= 1;
          break;
        }
        if (isUsableLaunchPath(candidate)) paths.push(candidate);
        index += 1;
      }

      const uniquePaths = dedupeLaunchPaths(paths);
      if (uniquePaths.length > 0) requests.push({ action, paths: uniquePaths });
    }
  }

  return requests;
}

function normalizeLaunchAction(value: string | undefined): ContextMenuLaunchAction | undefined {
  if (value === "convert" || value === "merge" || value === "split") return value;
  return undefined;
}

function isInteractiveLaunchRequest(request: ContextMenuLaunchRequest): boolean {
  return request.action === "convert";
}

function isQuickLaunchRequest(request: ContextMenuLaunchRequest): request is ContextMenuLaunchRequest & { action: "merge" | "split" } {
  return request.action === "merge" || request.action === "split";
}

function isUsableLaunchPath(value: string | undefined): value is string {
  return Boolean(value && value.trim() && !value.includes("\0"));
}

function dedupeLaunchPaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const filePath of paths) {
    const key = process.platform === "win32" ? filePath.toLowerCase() : filePath;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(filePath);
  }
  return deduped;
}

function sortLaunchPathsByFileName(paths: string[]): string[] {
  return [...paths].sort((left, right) => {
    const leftName = path.basename(left);
    const rightName = path.basename(right);
    const nameCompare = leftName.localeCompare(rightName, ["ko", "en"], {
      numeric: true,
      sensitivity: "base"
    });
    if (nameCompare !== 0) return nameCompare;
    return left.localeCompare(right, ["ko", "en"], {
      numeric: true,
      sensitivity: "base"
    });
  });
}

function drainPendingLaunchRequests(): ContextMenuLaunchRequest[] {
  return pendingLaunchRequests.splice(0, pendingLaunchRequests.length);
}

function sendLaunchFiles(requests: ContextMenuLaunchRequest[]): void {
  if (requests.length === 0 || !mainWindow || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send("app:launchFiles", requests);
}

function enqueueQuickLaunchRequests(requests: Array<ContextMenuLaunchRequest & { action: "merge" | "split" }>): void {
  for (const request of requests) {
    pendingQuickPaths[request.action].push(...request.paths);
  }
  if (quickActionTimer) clearTimeout(quickActionTimer);
  quickActionTimer = setTimeout(() => {
    quickActionTimer = undefined;
    void flushQuickActions();
  }, QUICK_ACTION_DEBOUNCE_MS);
}

async function flushQuickActions(): Promise<void> {
  if (quickActionRunning) return;
  quickActionRunning = true;

  const mergePaths = sortLaunchPathsByFileName(dedupeLaunchPaths(pendingQuickPaths.merge.splice(0)));
  const splitPaths = dedupeLaunchPaths(pendingQuickPaths.split.splice(0));

  try {
    if (mergePaths.length > 0) {
      await runQuickMerge(mergePaths);
    }
    for (const splitPath of splitPaths) {
      await runQuickSplit(splitPath);
    }
  } finally {
    quickActionRunning = false;
    if (pendingQuickPaths.merge.length > 0 || pendingQuickPaths.split.length > 0) {
      enqueueQuickLaunchRequests([]);
      return;
    }
    if (!mainWindow) app.quit();
  }
}

async function runQuickMerge(sourcePaths: string[]): Promise<void> {
  if (sourcePaths.length < 2) {
    showQuickNotification("PDF 병합을 진행하지 못했습니다.", "PDF 병합은 2개 이상의 PDF 파일을 선택해야 합니다.");
    return;
  }

  const outputDir = path.dirname(sourcePaths[0]);
  const outputName = await createQuickMergeBaseName(outputDir);
  try {
    const job = await pdfToolService.run(
      {
        sourcePaths,
        outputDir,
        toolType: "pdf_merge",
        options: { outputName, useDatedSubfolder: false }
      },
      () => undefined
    );

    if (job.status === "success") {
      showQuickNotification("PDF 병합 완료", `${path.basename(job.outputPaths[0] || `${outputName}.pdf`)} 파일을 같은 폴더에 저장했습니다.`);
      return;
    }

    showQuickNotification("PDF 병합 실패", job.error || "선택한 PDF 파일을 병합하지 못했습니다.");
  } catch (error) {
    showQuickNotification("PDF 병합 실패", getErrorMessage(error));
  }
}

async function runQuickSplit(sourcePath: string): Promise<void> {
  const outputDir = path.dirname(sourcePath);
  const outputName = path.basename(sourcePath, path.extname(sourcePath));
  try {
    const job = await pdfToolService.run(
      {
        sourcePaths: [sourcePath],
        outputDir,
        toolType: "pdf_split_all",
        options: { outputName, useDatedSubfolder: false }
      },
      () => undefined
    );

    if (job.status === "success") {
      showQuickNotification("PDF 분할 완료", `${job.outputPaths.length}개 파일을 같은 폴더에 저장했습니다.`);
      return;
    }

    showQuickNotification("PDF 분할 실패", job.error || "선택한 PDF 파일을 분할하지 못했습니다.");
  } catch (error) {
    showQuickNotification("PDF 분할 실패", getErrorMessage(error));
  }
}

async function createQuickMergeBaseName(outputDir: string): Promise<string> {
  for (let index = 1; index < 10000; index += 1) {
    const baseName = `merged(${index})`;
    if (!(await exists(path.join(outputDir, `${baseName}.pdf`)))) return baseName;
  }
  return `merged(${Date.now()})`;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function showQuickNotification(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title: `Convert Smith - ${title}`, body }).show();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
