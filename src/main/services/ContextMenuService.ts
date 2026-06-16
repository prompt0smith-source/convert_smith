import { execFile } from "node:child_process";
import { app } from "electron";
import type { ContextMenuStatus } from "../types/contextMenu.js";

const SHELL_KEY = "HKCU\\Software\\Classes\\*\\shell\\ConvertSmith";
const COMMAND_KEY = `${SHELL_KEY}\\command`;
const MENU_LABEL = "Convert with Convert Smith";

export class ContextMenuService {
  async getStatus(): Promise<ContextMenuStatus> {
    if (process.platform !== "win32") {
      return {
        supported: false,
        registered: false,
        message: "우클릭 메뉴 등록은 현재 Windows에서만 지원됩니다."
      };
    }

    const query = await this.runReg(["query", COMMAND_KEY, "/ve"], false);
    return {
      supported: true,
      registered: query.ok,
      message: query.ok ? "탐색기 우클릭 메뉴가 등록되어 있습니다." : "탐색기 우클릭 메뉴가 등록되어 있지 않습니다."
    };
  }

  async install(): Promise<ContextMenuStatus> {
    if (process.platform !== "win32") return this.getStatus();
    const exePath = this.getExecutablePath();
    const command = `"${exePath}" --open "%1"`;

    try {
      await this.runReg(["add", SHELL_KEY, "/ve", "/d", MENU_LABEL, "/f"]);
      await this.runReg(["add", SHELL_KEY, "/v", "Icon", "/d", exePath, "/f"]);
      await this.runReg(["add", COMMAND_KEY, "/ve", "/d", command, "/f"]);
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
    const status = await this.getStatus();
    if (!status.registered) return status;

    try {
      await this.runReg(["delete", SHELL_KEY, "/f"]);
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

  private getExecutablePath(): string {
    return app.isPackaged ? process.execPath : process.execPath;
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
