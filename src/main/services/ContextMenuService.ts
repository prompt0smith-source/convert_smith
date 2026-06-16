import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { ContextMenuLaunchAction, ContextMenuStatus } from "../types/contextMenu.js";

interface ContextMenuEntry {
  shellKey: string;
  commandKey: string;
  label: string;
  action: ContextMenuLaunchAction;
  multiSelectModel: "Document" | "Single";
}

const OLD_SHELL_KEY = "HKCU\\Software\\Classes\\*\\shell\\ConvertSmith";

const CONTEXT_MENU_ENTRIES: ContextMenuEntry[] = [
  {
    shellKey: "HKCU\\Software\\Classes\\*\\shell\\ConvertSmithConvert",
    commandKey: "HKCU\\Software\\Classes\\*\\shell\\ConvertSmithConvert\\command",
    label: "Convert with Convert Smith",
    action: "convert",
    multiSelectModel: "Document"
  },
  {
    shellKey: "HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\ConvertSmithMerge",
    commandKey: "HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\ConvertSmithMerge\\command",
    label: "Merge with Convert Smith",
    action: "merge",
    multiSelectModel: "Document"
  },
  {
    shellKey: "HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\ConvertSmithSplit",
    commandKey: "HKCU\\Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\ConvertSmithSplit\\command",
    label: "Split with Convert Smith",
    action: "split",
    multiSelectModel: "Single"
  }
];

export class ContextMenuService {
  async getStatus(): Promise<ContextMenuStatus> {
    if (process.platform !== "win32") {
      return {
        supported: false,
        registered: false,
        message: "탐색기 우클릭 메뉴 등록은 현재 Windows에서만 지원됩니다."
      };
    }

    const results = await Promise.all(
      CONTEXT_MENU_ENTRIES.map((entry) => this.runReg(["query", entry.commandKey, "/ve"], false))
    );
    const registered = results.every((result) => result.ok);

    return {
      supported: true,
      registered,
      message: registered
        ? "탐색기 우클릭 메뉴가 등록되어 있습니다."
        : "탐색기 우클릭 메뉴가 등록되어 있지 않습니다."
    };
  }

  async install(): Promise<ContextMenuStatus> {
    if (process.platform !== "win32") return this.getStatus();

    const commandPrefix = this.getAppLaunchPrefix();
    const iconPath = this.getIconPath();

    try {
      await this.deleteKnownKeys();

      for (const entry of CONTEXT_MENU_ENTRIES) {
        const command = `${commandPrefix} -- convert-smith-action ${entry.action} "%1"`;
        await this.runReg(["add", entry.shellKey, "/ve", "/d", entry.label, "/f"]);
        await this.runReg(["add", entry.shellKey, "/v", "Icon", "/d", iconPath, "/f"]);
        await this.runReg(["add", entry.shellKey, "/v", "MultiSelectModel", "/d", entry.multiSelectModel, "/f"]);
        await this.runReg(["add", entry.commandKey, "/ve", "/d", command, "/f"]);
      }

      return {
        supported: true,
        registered: true,
        message: "탐색기 우클릭 메뉴를 등록했습니다."
      };
    } catch (error) {
      throw new Error(
        [
          "우클릭 메뉴 등록에 실패했습니다. Windows 권한 또는 보안 설정을 확인해주세요.",
          error instanceof Error ? error.message : String(error)
        ].join("\n")
      );
    }
  }

  async uninstall(): Promise<ContextMenuStatus> {
    if (process.platform !== "win32") return this.getStatus();

    try {
      await this.deleteKnownKeys();
      return {
        supported: true,
        registered: false,
        message: "탐색기 우클릭 메뉴를 제거했습니다."
      };
    } catch (error) {
      throw new Error(
        [
          "우클릭 메뉴 제거에 실패했습니다. Windows 권한 또는 보안 설정을 확인해주세요.",
          error instanceof Error ? error.message : String(error)
        ].join("\n")
      );
    }
  }

  private async deleteKnownKeys(): Promise<void> {
    await this.runReg(["delete", OLD_SHELL_KEY, "/f"], false);
    for (const entry of CONTEXT_MENU_ENTRIES) {
      await this.runReg(["delete", entry.shellKey, "/f"], false);
    }
  }

  private getAppLaunchPrefix(): string {
    if (app.isPackaged) return `"${process.execPath}"`;
    return `"${process.execPath}" "${app.getAppPath()}"`;
  }

  private getIconPath(): string {
    const candidates = app.isPackaged
      ? [path.join(process.resourcesPath, "build", "icon.ico"), process.execPath]
      : [path.join(app.getAppPath(), "build", "icon.ico"), process.execPath];
    return candidates.find((candidate) => existsSync(candidate)) ?? process.execPath;
  }

  private runReg(args: string[], rejectOnError = true): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile("reg.exe", args, { windowsHide: true, shell: false }, (error, stdout, stderr) => {
        if (error) {
          if (rejectOnError) {
            reject(new Error((stderr || error.message).trim()));
            return;
          }
          resolve({ ok: false, stdout, stderr });
          return;
        }
        resolve({ ok: true, stdout, stderr });
      });
    });
  }
}
