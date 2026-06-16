import { ipcMain } from "electron";
import { ContextMenuService } from "../services/ContextMenuService.js";

export function registerContextMenuHandlers(service: ContextMenuService): void {
  ipcMain.handle("contextMenu:getStatus", () => service.getStatus());
  ipcMain.handle("contextMenu:install", () => service.install());
  ipcMain.handle("contextMenu:uninstall", () => service.uninstall());
}
