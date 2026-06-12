import { BrowserWindow, nativeImage, screen, type Event as ElectronEvent } from "electron";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class FloatingWindowService {
  private mainWindow?: BrowserWindow;
  private floatingWindow?: BrowserWindow;
  private lastMainBounds?: Bounds;
  private lastFloatingBounds?: Bounds;
  private offsetFromFloatingToMain = { dx: -360, dy: -120 };
  private enabled = true;

  constructor(
    private readonly preloadPath: string,
    private readonly iconPath: string
  ) {}

  attachMainWindow(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    mainWindow.on("minimize" as never, (event: ElectronEvent) => {
      if (!this.enabled) return;
      event.preventDefault();
      this.lastMainBounds = mainWindow.getNormalBounds();
      const nextFloating = this.positionNear(this.lastMainBounds, "top-right");
      this.offsetFromFloatingToMain = {
        dx: this.lastMainBounds.x - nextFloating.x,
        dy: this.lastMainBounds.y - nextFloating.y
      };
      mainWindow.hide();
      this.showFloating();
    });

    mainWindow.on("move", () => {
      if (!mainWindow.isMinimized() && !mainWindow.isDestroyed()) {
        this.lastMainBounds = mainWindow.getNormalBounds();
      }
    });

    mainWindow.on("closed", () => {
      this.destroy();
    });
  }

  setEnabled(value: boolean): boolean {
    this.enabled = value;
    if (!value) this.hideFloating();
    return this.enabled;
  }

  getEnabled(): boolean {
    return this.enabled;
  }

  showMainFromFloating(): boolean {
    this.hideFloating();
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return false;

    this.mainWindow.show();
    this.mainWindow.restore();
    const floatingBounds = this.floatingWindow && !this.floatingWindow.isDestroyed()
      ? this.floatingWindow.getBounds()
      : this.lastFloatingBounds;
    if (floatingBounds) {
      const mainBounds = this.mainWindow.getBounds();
      const display = screen.getDisplayMatching(floatingBounds);
      const workArea = display.workArea;
      const x = clamp(
        floatingBounds.x + this.offsetFromFloatingToMain.dx,
        workArea.x,
        workArea.x + workArea.width - mainBounds.width
      );
      const y = clamp(
        floatingBounds.y + this.offsetFromFloatingToMain.dy,
        workArea.y,
        workArea.y + workArea.height - mainBounds.height
      );
      this.mainWindow.setPosition(Math.round(x), Math.round(y));
      this.lastMainBounds = { x, y, width: mainBounds.width, height: mainBounds.height };
    }
    this.mainWindow.focus();
    return true;
  }

  moveFloating(rawX: number, rawY: number): boolean {
    if (!this.floatingWindow || this.floatingWindow.isDestroyed()) return false;
    const [width, height] = this.floatingWindow.getSize();
    const display = screen.getDisplayNearestPoint({ x: Math.round(rawX), y: Math.round(rawY) });
    const workArea = display.workArea;
    const x = clamp(rawX, workArea.x + 8, workArea.x + workArea.width - width - 8);
    const y = clamp(rawY, workArea.y + 8, workArea.y + workArea.height - height - 8);
    this.floatingWindow.setPosition(Math.round(x), Math.round(y));
    this.lastFloatingBounds = { x, y, width, height };
    return true;
  }

  getIconDataUrl(): string {
    return this.createTightIcon().toDataURL();
  }

  destroy(): void {
    if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      this.floatingWindow.destroy();
    }
    this.floatingWindow = undefined;
  }

  private showFloating(): void {
    if (!this.floatingWindow || this.floatingWindow.isDestroyed()) {
      this.createFloatingWindow();
    }
    if (!this.floatingWindow) return;
    if (this.lastMainBounds) {
      this.positionNear(this.lastMainBounds, "top-right");
    }
    this.floatingWindow.show();
    this.floatingWindow.focus();
  }

  private hideFloating(): void {
    if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      this.floatingWindow.hide();
    }
  }

  private createFloatingWindow(): void {
    this.floatingWindow = new BrowserWindow({
      width: 58,
      height: 58,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      backgroundColor: "#00000000",
      icon: this.iconPath,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });

    this.floatingWindow.setAlwaysOnTop(true, "floating");
    this.floatingWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    void this.floatingWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(this.getFloatingHtml())}`);
  }

  private positionNear(targetBounds: Bounds, anchor: "top-right" | "bottom-right"): Bounds {
    const display = screen.getDisplayMatching(targetBounds);
    const workArea = display.workArea;
    const width = 58;
    const height = 58;
    const x = clamp(targetBounds.x + targetBounds.width - width - 8, workArea.x + 8, workArea.x + workArea.width - width - 8);
    const rawY = anchor === "top-right" ? targetBounds.y + 8 : targetBounds.y + targetBounds.height - height - 8;
    const y = clamp(rawY, workArea.y + 8, workArea.y + workArea.height - height - 8);
    if (this.floatingWindow && !this.floatingWindow.isDestroyed()) {
      this.floatingWindow.setPosition(Math.round(x), Math.round(y));
    }
    this.lastFloatingBounds = { x, y, width, height };
    return this.lastFloatingBounds;
  }

  private createTightIcon(): Electron.NativeImage {
    const image = nativeImage.createFromPath(this.iconPath);
    const size = image.getSize();
    if (!size.width || !size.height) return image;

    const buffer = image.toBitmap();
    let minX = size.width;
    let minY = size.height;
    let maxX = 0;
    let maxY = 0;
    let found = false;

    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const alphaIndex = (y * size.width + x) * 4 + 3;
        if (buffer[alphaIndex] > 0) {
          found = true;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (!found) return image;
    return image
      .crop({ x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
      .resize({ width: 256, height: 256, quality: "best" });
  }

  private getFloatingHtml(): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
html,body{width:58px;height:58px;margin:0;background:transparent;overflow:hidden;border-radius:999px}
body{display:flex;align-items:center;justify-content:center}
#bubble{width:48px;height:48px;border-radius:999px;border:1px solid rgba(0,0,0,.1);background:rgba(255,255,255,.62);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:inset 0 10px 18px rgba(0,0,0,.12),inset 0 -10px 18px rgba(255,255,255,.35),0 6px 18px rgba(0,0,0,.1);opacity:.72;cursor:grab;transition:transform .12s ease,opacity .12s ease,box-shadow .12s ease;background-position:center;background-repeat:no-repeat;background-size:40px 40px}
#bubble:hover{opacity:1;transform:translateY(-2px);box-shadow:0 10px 22px rgba(0,0,0,.18),inset 0 1px 0 rgba(255,255,255,.55)}
#bubble.dragging{cursor:grabbing;transform:scale(.98)}
</style>
</head>
<body>
<div id="bubble" title="Convert Smith"></div>
<script>
const bubble = document.getElementById("bubble");
window.convertSmith.getAppIconDataUrl().then((url) => { bubble.style.backgroundImage = "url(" + JSON.stringify(url) + ")"; });
let dragging = false;
let moved = false;
let downX = 0;
let downY = 0;
let offsetX = 0;
let offsetY = 0;
bubble.addEventListener("mousedown", (event) => {
  dragging = true;
  moved = false;
  downX = event.screenX;
  downY = event.screenY;
  offsetX = event.screenX - window.screenX;
  offsetY = event.screenY - window.screenY;
  bubble.classList.add("dragging");
});
window.addEventListener("mousemove", (event) => {
  if (!dragging) return;
  if (Math.abs(event.screenX - downX) > 3 || Math.abs(event.screenY - downY) > 3) moved = true;
  window.convertSmith.moveFloating(event.screenX - offsetX, event.screenY - offsetY);
});
window.addEventListener("mouseup", () => {
  if (dragging && !moved) window.convertSmith.showMainFromFloating();
  dragging = false;
  bubble.classList.remove("dragging");
});
</script>
</body>
</html>`;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
