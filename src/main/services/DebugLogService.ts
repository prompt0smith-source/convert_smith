import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { inspect } from "node:util";

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

export interface DebugLogPayload {
  scope: string;
  message: string;
  filePath?: string;
  pageNumber?: number;
  data?: Record<string, unknown>;
  error?: unknown;
}

export class DebugLogService {
  private cachedLogPath?: string;

  async getLogPath(): Promise<string> {
    if (this.cachedLogPath) return this.cachedLogPath;

    let rootDir = process.cwd();
    if (process.versions.electron) {
      try {
        const electron = await importRuntime<typeof import("electron")>("electron");
        rootDir = electron.app.getPath("userData");
      } catch {
        rootDir = process.cwd();
      }
    }

    const logDir = path.join(rootDir, "logs");
    await mkdir(logDir, { recursive: true });
    this.cachedLogPath = path.join(logDir, "convert-smith-debug.log");
    return this.cachedLogPath;
  }

  async write(payload: DebugLogPayload): Promise<string | undefined> {
    try {
      const logPath = await this.getLogPath();
      const line = JSON.stringify({
        at: new Date().toISOString(),
        scope: payload.scope,
        message: payload.message,
        filePath: payload.filePath,
        pageNumber: payload.pageNumber,
        data: payload.data,
        error: this.serializeError(payload.error)
      });
      await appendFile(logPath, `${line}\n`, "utf8");
      return logPath;
    } catch {
      return undefined;
    }
  }

  private serializeError(error: unknown): unknown {
    if (!error) return undefined;
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack
      };
    }
    if (typeof error === "string") return error;
    return inspect(error, { depth: 4, breakLength: 160 });
  }
}
