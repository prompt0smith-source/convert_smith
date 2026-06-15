import path from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { access, copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";

type ProgressCallback = (progress: number, message: string) => void;

export class OfficeEngine {
  async convertToPdf(
    inputPath: string,
    outputPath: string,
    sofficePath: string,
    onProgress: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    await this.convertWithLibreOffice(
      inputPath,
      outputPath,
      sofficePath,
      "pdf",
      ".pdf",
      "LibreOffice에서 PDF로 변환하는 중입니다.",
      onProgress,
      signal
    );
  }

  async convertToCsv(
    inputPath: string,
    outputPath: string,
    sofficePath: string,
    onProgress: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    await this.convertWithLibreOffice(
      inputPath,
      outputPath,
      sofficePath,
      "csv",
      ".csv",
      "LibreOffice에서 CSV로 변환하는 중입니다.",
      onProgress,
      signal
    );
  }

  private async convertWithLibreOffice(
    inputPath: string,
    outputPath: string,
    sofficePath: string,
    convertTo: string,
    expectedExtension: string,
    runningMessage: string,
    onProgress: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "convert-smith-office-"));
    onProgress(15, "LibreOffice 변환을 준비하는 중입니다.");

    try {
      const executablePath = await this.resolveLibreOfficeExecutable(sofficePath);
      const profileDir = path.join(tempDir, "profile");
      await mkdir(profileDir, { recursive: true });
      await this.runLibreOffice(
        executablePath,
        [
          `-env:UserInstallation=${pathToFileURL(profileDir).toString()}`,
          "--headless",
          "--convert-to",
          convertTo,
          "--outdir",
          tempDir,
          inputPath
        ],
        runningMessage,
        onProgress,
        signal
      );
      const files = await readdir(tempDir);
      const convertedFile = files.find((file) => file.toLowerCase().endsWith(expectedExtension));
      if (!convertedFile) {
        throw new Error(`LibreOffice가 ${expectedExtension} 출력 파일을 만들지 못했습니다.`);
      }
      await copyFile(path.join(tempDir, convertedFile), outputPath);
      onProgress(92, "출력 파일을 저장했습니다.");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async resolveLibreOfficeExecutable(sofficePath: string): Promise<string> {
    if (process.platform !== "win32") return sofficePath;
    const normalized = sofficePath.trim().replace(/^["']|["']$/g, "");
    if (path.basename(normalized).toLowerCase() !== "soffice.exe") return normalized;

    const consoleLauncher = path.join(path.dirname(normalized), "soffice.com");
    try {
      await access(consoleLauncher);
      return consoleLauncher;
    } catch {
      return normalized;
    }
  }

  private runLibreOffice(
    sofficePath: string,
    args: string[],
    runningMessage: string,
    onProgress: ProgressCallback,
    signal?: AbortSignal
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(sofficePath, args, {
        shell: false,
        windowsHide: true
      });
      let stderr = "";
      let stdout = "";
      let settled = false;
      let timeout: NodeJS.Timeout;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };

      const abort = () => {
        child.kill("SIGTERM");
        finish(new Error("변환이 취소되었습니다."));
      };

      timeout = setTimeout(() => {
        child.kill("SIGTERM");
        finish(new Error("LibreOffice 변환 시간이 초과되었습니다. LibreOffice가 응답하지 않습니다."));
      }, 60000);

      signal?.addEventListener("abort", abort, { once: true });
      onProgress(35, runningMessage);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        finish(error);
      });
      child.on("close", (code) => {
        if (code === 0) {
          onProgress(80, "LibreOffice 변환이 완료되었습니다.");
          finish();
        } else {
          finish(new Error(`LibreOffice 변환 실패(code ${code}): ${(stderr || stdout).slice(-2000)}`));
        }
      });
    });
  }
}
