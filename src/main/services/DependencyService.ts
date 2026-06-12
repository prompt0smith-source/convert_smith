import path from "node:path";
import { access, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type { DependencyStatus } from "../types/conversion.js";
import type { ExecutableCheck, LibreOfficeDetection } from "../types/dependency.js";

const WINDOWS_LIBRE_OFFICE_CANDIDATES = [
  "C:\\Program Files\\LibreOffice\\program\\soffice.com",
  "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.com",
  "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
];

const MAC_LIBRE_OFFICE_CANDIDATES = [
  "/Applications/LibreOffice.app/Contents/MacOS/soffice"
];

const LINUX_LIBRE_OFFICE_CANDIDATES = ["libreoffice", "soffice"];

function normalizePackagedBinaryPath(binaryPath: string | null | undefined): string | undefined {
  if (!binaryPath) return undefined;
  return binaryPath.replace("app.asar", "app.asar.unpacked");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

export class DependencyService {
  getFfmpegPath(): string {
    const candidate = normalizePackagedBinaryPath(ffmpegStatic);
    if (!candidate) {
      throw new Error("ffmpeg-static 실행 파일을 찾지 못했습니다.");
    }
    return candidate;
  }

  getFfprobePath(): string {
    const candidate = normalizePackagedBinaryPath(ffprobeStatic.path);
    if (!candidate) {
      throw new Error("ffprobe-static 실행 파일을 찾지 못했습니다.");
    }
    return candidate;
  }

  async getStatus(libreOfficePath?: string): Promise<DependencyStatus> {
    const ffmpegPath = this.getFfmpegPath();
    const ffprobePath = this.getFfprobePath();
    const libreOffice = await this.detectLibreOffice(libreOfficePath);

    return {
      ffmpeg: {
        available: await pathExists(ffmpegPath),
        path: ffmpegPath
      },
      ffprobe: {
        available: await pathExists(ffprobePath),
        path: ffprobePath
      },
      libreOffice
    };
  }

  async detectLibreOffice(manualPath?: string): Promise<LibreOfficeDetection> {
    const candidates = await this.getLibreOfficeCandidates(manualPath);
    let firstFailure: ExecutableCheck | undefined;

    for (const candidate of candidates) {
      const check = await this.checkExecutable(candidate, ["--version"], 10000);
      if (check.available) {
        return {
          available: true,
          path: check.path || candidate,
          message: check.version ? `LibreOffice를 사용할 수 있습니다. ${check.version}` : "LibreOffice를 사용할 수 있습니다."
        };
      }
      firstFailure ||= check;
    }

    if (manualPath) {
      return {
        available: false,
        message: [
          "지정한 LibreOffice 경로를 확인하지 못했습니다.",
          "설정에서 LibreOffice 설치 폴더의 program\\soffice.com 또는 program\\soffice.exe를 선택해주세요.",
          firstFailure?.error ? `상세: ${firstFailure.error}` : undefined
        ]
          .filter(Boolean)
          .join(" ")
      };
    }

    return {
      available: false,
      message: "DOCX/XLSX → PDF 변환을 위해 LibreOffice가 필요합니다. 설정에서 LibreOffice 경로를 지정해주세요."
    };
  }

  private async getLibreOfficeCandidates(manualPath?: string): Promise<string[]> {
    const platformCandidates =
      process.platform === "win32"
        ? WINDOWS_LIBRE_OFFICE_CANDIDATES
        : process.platform === "darwin"
          ? MAC_LIBRE_OFFICE_CANDIDATES
          : LINUX_LIBRE_OFFICE_CANDIDATES;

    const manualCandidates = manualPath ? await this.expandManualLibreOfficePath(manualPath) : [];
    return [...new Set([...manualCandidates, ...platformCandidates].filter(Boolean))];
  }

  private async expandManualLibreOfficePath(rawPath: string): Promise<string[]> {
    const normalized = rawPath.trim().replace(/^["']|["']$/g, "");
    if (!normalized) return [];

    if (await isDirectory(normalized)) {
      if (process.platform === "win32") {
        return [
          path.join(normalized, "soffice.com"),
          path.join(normalized, "soffice.exe"),
          path.join(normalized, "program", "soffice.com"),
          path.join(normalized, "program", "soffice.exe")
        ];
      }
      return [
        path.join(normalized, "soffice"),
        path.join(normalized, "Contents", "MacOS", "soffice")
      ];
    }

    const dirname = path.dirname(normalized);
    if (process.platform === "win32") {
      const baseName = path.basename(normalized).toLowerCase();
      const siblingCom = path.join(dirname, "soffice.com");
      const siblingExe = path.join(dirname, "soffice.exe");
      const candidates =
        baseName === "soffice.exe"
          ? [siblingCom, normalized, siblingExe]
          : baseName === "soffice.com"
            ? [normalized, siblingExe]
            : [normalized, siblingCom, siblingExe];
      return [...new Set(candidates)];
    }

    const siblingSoffice = path.join(dirname, "soffice");
    return [normalized, siblingSoffice];
  }

  private checkExecutable(command: string, args: string[], timeoutMs: number): Promise<ExecutableCheck> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        shell: false,
        windowsHide: true
      });

      let output = "";
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          child.kill();
          resolve({ available: false, path: command, error: "LibreOffice 실행 시간이 초과되었습니다." });
        }
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({ available: false, path: command, error: error.message });
      });
      child.on("close", (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve({
          available: code === 0,
          path: command,
          version: output.trim(),
          error: code === 0 ? undefined : `종료 코드 ${code}${output.trim() ? `: ${output.trim()}` : ""}`
        });
      });
    });
  }
}
