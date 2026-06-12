import path from "node:path";
import os from "node:os";
import { access, mkdtemp, readdir, copyFile, rm } from "node:fs/promises";
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
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "convert-smith-office-"));
    onProgress(15, "LibreOffice 변환을 준비하는 중입니다.");

    try {
      const executablePath = await this.resolveLibreOfficeExecutable(sofficePath);
      await this.runLibreOffice(
        executablePath,
        ["--headless", "--convert-to", "pdf", "--outdir", tempDir, inputPath],
        onProgress,
        signal
      );
      const files = await readdir(tempDir);
      const pdfFile = files.find((file) => file.toLowerCase().endsWith(".pdf"));
      if (!pdfFile) {
        throw new Error("LibreOffice가 PDF 출력 파일을 만들지 못했습니다.");
      }
      await copyFile(path.join(tempDir, pdfFile), outputPath);
      onProgress(92, "PDF 파일을 저장했습니다.");
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
      const abort = () => {
        child.kill("SIGTERM");
        reject(new Error("변환이 취소되었습니다."));
      };

      signal?.addEventListener("abort", abort, { once: true });
      onProgress(35, "LibreOffice에서 문서를 PDF로 변환하는 중입니다.");

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      });
      child.on("close", (code) => {
        signal?.removeEventListener("abort", abort);
        if (code === 0) {
          onProgress(80, "LibreOffice 변환이 완료되었습니다.");
          resolve();
        } else {
          reject(new Error(`LibreOffice 변환 실패(code ${code}): ${(stderr || stdout).slice(-2000)}`));
        }
      });
    });
  }
}
