import { ipcMain } from "electron";
import { FloatingWindowService } from "../services/FloatingWindowService.js";

export function registerFloatingHandlers(service: FloatingWindowService): void {
  ipcMain.handle("floating:showMain", async () => service.showMainFromFloating());
  ipcMain.handle("floating:move", async (_event, x: unknown, y: unknown) => {
    if (typeof x !== "number" || typeof y !== "number") return false;
    return service.moveFloating(x, y);
  });
  ipcMain.handle("floating:setEnabled", async (_event, enabled: unknown) => service.setEnabled(Boolean(enabled)));
  ipcMain.handle("floating:getEnabled", async () => service.getEnabled());
  ipcMain.handle("app:getIconDataUrl", async () => service.getIconDataUrl());
}
