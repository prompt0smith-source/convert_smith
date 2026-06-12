import path from "node:path";
import { stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { ConversionType, ConversionValidationResult } from "../types/conversion.js";
import { FileSignatureService } from "./FileSignatureService.js";

const SUPPORTED_INPUTS: Record<ConversionType, string[]> = {
  pdf_to_docx: [".pdf"],
  docx_to_pdf: [".docx", ".doc"],
  images_to_pdf: [".jpg", ".jpeg", ".png", ".webp", ".avif", ".tif", ".tiff", ".bmp"],
  pdf_to_images: [".pdf"],
  heic_to_jpg: [".heic", ".heif"],
  png_to_jpg: [".png"],
  jpg_to_png: [".jpg", ".jpeg"],
  image_to_webp: [".jpg", ".jpeg", ".png"],
  webp_to_jpg: [".webp"],
  webp_to_png: [".webp"],
  avif_to_jpg: [".avif"],
  avif_to_png: [".avif"],
  tiff_to_jpg: [".tif", ".tiff"],
  tiff_to_png: [".tif", ".tiff"],
  bmp_to_jpg: [".bmp"],
  bmp_to_png: [".bmp"],
  mp4_to_mp3: [".mp4"],
  mov_to_mp4: [".mov"],
  webm_to_mp4: [".webm"],
  mkv_to_mp4: [".mkv"],
  wav_to_mp3: [".wav"],
  flac_to_mp3: [".flac"],
  m4a_to_mp3: [".m4a"],
  xlsx_to_pdf: [".xlsx", ".xls"],
  xlsx_to_csv: [".xlsx", ".xls"],
  pptx_to_pdf: [".pptx", ".ppt"],
  video_compatibility_repair: [".mp4", ".mov", ".mkv", ".webm", ".m4v"]
};

export class ValidationService {
  constructor(
    private readonly signatures: FileSignatureService,
    private readonly ffprobePath: string
  ) {}

  async validateInputPath(filePath: string): Promise<string> {
    if (typeof filePath !== "string" || !filePath.trim() || filePath.includes("\0")) {
      throw new Error("파일 경로가 올바르지 않습니다.");
    }
    const resolved = path.resolve(filePath);
    const info = await stat(resolved);
    if (!info.isFile()) {
      throw new Error("파일만 변환할 수 있습니다.");
    }
    if (info.size <= 0) {
      throw new Error("비어 있는 파일은 변환할 수 없습니다.");
    }
    return resolved;
  }

  async validateOutputDir(outputDir: string): Promise<string> {
    if (typeof outputDir !== "string" || !outputDir.trim() || outputDir.includes("\0")) {
      throw new Error("저장 폴더 경로가 올바르지 않습니다.");
    }
    const resolved = path.resolve(outputDir);
    const info = await stat(resolved);
    if (!info.isDirectory()) {
      throw new Error("저장 위치는 폴더여야 합니다.");
    }
    return resolved;
  }

  ensureConversionAllowed(conversionType: ConversionType, sourcePaths: string[]): void {
    const allowedExtensions = SUPPORTED_INPUTS[conversionType];
    const invalid = sourcePaths.find((sourcePath) => {
      const extension = path.extname(sourcePath).toLowerCase();
      return !allowedExtensions.includes(extension);
    });

    if (invalid) {
      throw new Error(`이 변환은 ${path.basename(invalid)} 파일 형식을 지원하지 않습니다.`);
    }
  }

  getSupportedConversions(filePath: string): ConversionType[] {
    const extension = path.extname(filePath).toLowerCase();
    return Object.entries(SUPPORTED_INPUTS)
      .filter(([, extensions]) => extensions.includes(extension))
      .map(([conversionType]) => conversionType as ConversionType);
  }

  async validateOutput(conversionType: ConversionType, outputPath: string): Promise<ConversionValidationResult> {
    try {
      const info = await stat(outputPath);
      if (!info.isFile() || info.size <= 0) {
        return {
          ok: false,
          message: "출력 파일 검증에 실패했습니다. 파일이 정상적으로 열리지 않을 수 있습니다.",
          technicalDetails: "Output file is missing or empty."
        };
      }

      const extension = path.extname(outputPath).toLowerCase();
      if (extension === ".pdf") {
        return this.booleanResult(await this.signatures.isPdf(outputPath), "PDF 파일 검증에 실패했습니다.");
      }
      if (extension === ".jpg" || extension === ".jpeg") {
        return this.booleanResult(await this.signatures.isJpeg(outputPath), "JPG 파일 검증에 실패했습니다.");
      }
      if (extension === ".png") {
        return this.booleanResult(await this.signatures.isPng(outputPath), "PNG 파일 검증에 실패했습니다.");
      }
      if (extension === ".webp") {
        return this.booleanResult(await this.signatures.isWebp(outputPath), "WEBP 파일 검증에 실패했습니다.");
      }
      if (extension === ".docx" || extension === ".xlsx") {
        return this.booleanResult(await this.signatures.isZip(outputPath), "Office 문서 검증에 실패했습니다.");
      }
      if (extension === ".csv") {
        return { ok: true, message: "CSV 파일을 검증했습니다." };
      }
      if (extension === ".mp4" || extension === ".mp3") {
        const media = await this.validateMediaReadable(outputPath);
        if (!media.ok) return media;
        if (["video_compatibility_repair", "mov_to_mp4", "webm_to_mp4", "mkv_to_mp4"].includes(conversionType)) {
          return this.validateCompatibleMp4(outputPath);
        }
        return media;
      }

      return { ok: true, message: "출력 파일을 검증했습니다." };
    } catch (error) {
      return {
        ok: false,
        message: "출력 파일 검증에 실패했습니다. 파일이 정상적으로 열리지 않을 수 있습니다.",
        technicalDetails: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private booleanResult(ok: boolean, failureMessage: string): ConversionValidationResult {
    return ok
      ? { ok: true, message: "출력 파일을 검증했습니다." }
      : {
          ok: false,
          message: "출력 파일 검증에 실패했습니다. 파일이 정상적으로 열리지 않을 수 있습니다.",
          technicalDetails: failureMessage
        };
  }

  private async validateMediaReadable(outputPath: string): Promise<ConversionValidationResult> {
    const result = await this.runFfprobe(outputPath);
    return result.ok
      ? { ok: true, message: "미디어 파일을 검증했습니다." }
      : {
          ok: false,
          message: "출력 미디어 파일을 읽지 못했습니다.",
          technicalDetails: result.technicalDetails
        };
  }

  private async validateCompatibleMp4(outputPath: string): Promise<ConversionValidationResult> {
    const result = await this.runFfprobe(outputPath);
    if (!result.ok || !result.json) {
      return {
        ok: false,
        message: "출력 MP4 파일을 검증하지 못했습니다.",
        technicalDetails: result.technicalDetails
      };
    }

    const streams: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string }> = Array.isArray(result.json.streams)
      ? result.json.streams
      : [];
    const video = streams.find((stream) => stream.codec_type === "video");
    const audio = streams.find((stream) => stream.codec_type === "audio");
    if (!video || video.codec_name !== "h264" || video.pix_fmt !== "yuv420p") {
      return {
        ok: false,
        message: "출력 MP4가 H.264/yuv420p 호환 형식이 아닙니다.",
        technicalDetails: JSON.stringify({ video }, null, 2)
      };
    }
    if (audio && audio.codec_name !== "aac") {
      return {
        ok: false,
        message: "출력 MP4의 오디오가 AAC 형식이 아닙니다.",
        technicalDetails: JSON.stringify({ audio }, null, 2)
      };
    }
    return { ok: true, message: "호환 MP4 파일을 검증했습니다." };
  }

  private runFfprobe(outputPath: string): Promise<{ ok: boolean; json?: any; technicalDetails?: string }> {
    return new Promise((resolve) => {
      const child = spawn(
        this.ffprobePath,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", outputPath],
        { shell: false, windowsHide: true }
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        resolve({ ok: false, technicalDetails: error.message });
      });
      child.on("close", (code) => {
        if (code !== 0) {
          resolve({ ok: false, technicalDetails: stderr.slice(-2000) });
          return;
        }
        try {
          resolve({ ok: true, json: JSON.parse(stdout) });
        } catch (error) {
          resolve({
            ok: false,
            technicalDetails: error instanceof Error ? error.message : String(error)
          });
        }
      });
    });
  }
}
