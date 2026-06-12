import path from "node:path";
import { mkdir, stat, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type {
  ConversionJob,
  ConversionOptions,
  ConversionType,
  FilePreview,
  FileItem,
  FileKind,
  SortMode,
  StartConversionPayload,
  VideoInspection
} from "../types/conversion.js";
import { DependencyService } from "./DependencyService.js";
import { FileSignatureService } from "./FileSignatureService.js";
import { ValidationService } from "./ValidationService.js";
import { EngineRouter } from "./EngineRouter.js";
import { FfmpegEngine } from "../engines/FfmpegEngine.js";
import { ImageEngine } from "../engines/ImageEngine.js";
import { PdfEngine } from "../engines/PdfEngine.js";
import { OfficeEngine } from "../engines/OfficeEngine.js";
import { PdfToDocxEngine } from "../engines/PdfToDocxEngine.js";

type JobUpdateCallback = (job: ConversionJob) => void;
const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

const DEFAULT_OPTIONS: ConversionOptions = {
  imageQuality: 90,
  pdfImageFormat: "jpg",
  pdfRenderScale: 2,
  pdfPageSize: "auto",
  pdfToDocxMode: "editable_text",
  videoCompatibilityMode: true,
  overwritePolicy: "increment",
  sortMode: "basic"
};

export class ConversionService {
  private readonly dependencies = new DependencyService();
  private readonly signatures = new FileSignatureService();
  private readonly validation = new ValidationService(this.signatures, this.dependencies.getFfprobePath());
  private readonly ffmpeg = new FfmpegEngine(
    this.dependencies.getFfmpegPath(),
    this.dependencies.getFfprobePath()
  );
  private readonly router = new EngineRouter(
    this.ffmpeg,
    new ImageEngine(),
    new PdfEngine(),
    new OfficeEngine(),
    new PdfToDocxEngine()
  );
  private readonly controllers = new Map<string, AbortController>();

  async resolveDroppedFiles(paths: string[], dropIndexOffset = 0): Promise<FileItem[]> {
    if (!Array.isArray(paths)) {
      throw new Error("파일 목록이 올바르지 않습니다.");
    }

    const items: FileItem[] = [];
    for (const [index, rawPath] of paths.entries()) {
      const resolved = await this.validation.validateInputPath(rawPath);
      const info = await stat(resolved);
      const extension = path.extname(resolved).toLowerCase();
      items.push({
        id: randomUUID(),
        path: resolved,
        name: path.basename(resolved),
        extension,
        size: info.size,
        modifiedAt: info.mtimeMs,
        dropIndex: dropIndexOffset + index,
        kind: this.detectKind(extension),
        supportedConversions: this.validation.getSupportedConversions(resolved)
      });
    }
    return items;
  }

  async inspectVideo(filePath: string): Promise<VideoInspection> {
    const resolved = await this.validation.validateInputPath(filePath);
    return this.ffmpeg.inspect(resolved);
  }

  async getFilePreview(filePath: string): Promise<FilePreview> {
    const resolved = await this.validation.validateInputPath(filePath);
    const info = await stat(resolved);
    const extension = path.extname(resolved).toLowerCase();
    const kind = this.detectKind(extension);
    const basePreview = {
      path: resolved,
      name: path.basename(resolved),
      extension,
      kind,
      size: info.size,
      modifiedAt: info.mtimeMs
    };

    if (kind === "image") {
      try {
        const buffer = await sharp(resolved).rotate().png().toBuffer();
        return {
          ...basePreview,
          previewType: "image",
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
          message: "이미지 미리보기"
        };
      } catch (error) {
        return {
          ...basePreview,
          previewType: "metadata",
          message: "이미지 미리보기를 만들지 못했습니다.",
          details: {
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }

    if (extension === ".pdf") {
      try {
        const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
        const { createCanvas } = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
        const data = new Uint8Array(await readFile(resolved));
        const document = await pdfjs.getDocument({ data }).promise;
        const page = await document.getPage(1);
        const viewport = page.getViewport({ scale: 3 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        await page.render({
          canvasContext: context as never,
          viewport
        }).promise;
        const buffer = canvas.toBuffer("image/png");
        return {
          ...basePreview,
          previewType: "pdf_page",
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
          message: "PDF 1페이지 미리보기",
          details: {
            pages: document.numPages
          }
        };
      } catch (error) {
        return {
          ...basePreview,
          previewType: "metadata",
          message: "PDF 미리보기를 만들지 못했습니다.",
          details: {
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }

    if (kind === "video") {
      try {
        const inspection = await this.inspectVideo(resolved);
        return {
          ...basePreview,
          previewType: "media_info",
          message: "동영상 정보 미리보기",
          details: {
            container: inspection.container,
            videoCodec: inspection.videoCodec,
            audioCodec: inspection.audioCodec,
            pixelFormat: inspection.pixelFormat,
            durationSeconds: inspection.durationSeconds,
            resolution:
              inspection.width && inspection.height ? `${inspection.width} x ${inspection.height}` : undefined
          }
        };
      } catch (error) {
        return {
          ...basePreview,
          previewType: "metadata",
          message: "동영상 정보를 읽지 못했습니다.",
          details: {
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }

    return {
      ...basePreview,
      previewType: "metadata",
      message: "이 파일은 내부 미리보기를 지원하지 않습니다.",
      details: {
        fileName: path.basename(resolved),
        extension,
        size: info.size
      }
    };
  }

  cancelJob(jobId: string): boolean {
    const controller = this.controllers.get(jobId);
    if (!controller) return false;
    controller.abort();
    this.controllers.delete(jobId);
    return true;
  }

  async convert(payload: StartConversionPayload, onUpdate: JobUpdateCallback): Promise<ConversionJob> {
    const options: ConversionOptions = { ...DEFAULT_OPTIONS, ...payload.options };
    const sourcePaths = await Promise.all(
      payload.sourcePaths.map((sourcePath) => this.validation.validateInputPath(sourcePath))
    );
    const outputDir = await this.validation.validateOutputDir(payload.outputDir);
    this.validation.ensureConversionAllowed(payload.conversionType, sourcePaths);
    if (payload.conversionType === "images_to_pdf" && sourcePaths.length < 1) {
      throw new Error("PDF로 묶을 이미지 파일이 필요합니다.");
    }

    const job: ConversionJob = {
      id: randomUUID(),
      sourcePaths,
      outputDir,
      conversionType: payload.conversionType,
      status: "queued",
      progress: 0,
      message: "변환 대기 중입니다.",
      outputPaths: [],
      createdAt: Date.now(),
      options
    };

    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const emit = (patch: Partial<ConversionJob>) => {
      Object.assign(job, patch);
      onUpdate({ ...job, outputPaths: [...job.outputPaths] });
    };

    try {
      const datedOutputDir = await this.createDatedOutputDir(outputDir);
      emit({ status: "running", progress: 2, message: "출력 폴더를 준비했습니다." });

      const createOutputPath = async (sourcePath: string, extension: string) =>
        this.createUniqueOutputPath(datedOutputDir, path.basename(sourcePath, path.extname(sourcePath)), extension);
      const createNamedOutputPath = async (baseName: string, extension: string) =>
        this.createUniqueOutputPath(datedOutputDir, path.basename(baseName, path.extname(baseName)), extension, false);

      const outputPaths = await this.router.convert(
        job,
        createOutputPath,
        createNamedOutputPath,
        (progress, message) => emit({ progress, message }),
        controller.signal
      );

      emit({ progress: 98, message: "출력 파일을 검증하는 중입니다.", outputPaths });
      for (const outputPath of outputPaths) {
        const validation = await this.validation.validateOutput(payload.conversionType, outputPath);
        if (!validation.ok) {
          throw new Error(`${validation.message}\n${validation.technicalDetails || ""}`.trim());
        }
      }

      emit({
        status: "success",
        progress: 100,
        message: "변환과 검증이 완료되었습니다.",
        outputPaths,
        completedAt: Date.now()
      });
    } catch (error) {
      const isCancelled = controller.signal.aborted;
      emit({
        status: isCancelled ? "cancelled" : "failed",
        progress: isCancelled ? job.progress : Math.max(job.progress, 1),
        message: isCancelled
          ? "변환이 취소되었습니다."
          : "파일을 변환하지 못했습니다. 원본 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.",
        error: this.toUserError(error),
        technicalDetails: error instanceof Error ? error.stack || error.message : String(error),
        completedAt: Date.now()
      });
    } finally {
      this.controllers.delete(job.id);
    }

    return job;
  }

  private async createDatedOutputDir(outputDir: string): Promise<string> {
    const date = new Date();
    const folderName = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    const datedOutputDir = path.join(outputDir, folderName);
    await mkdir(datedOutputDir, { recursive: true });
    return datedOutputDir;
  }

  private async createUniqueOutputPath(
    outputDir: string,
    rawBaseName: string,
    extension: string,
    addConvertedSuffix = true
  ): Promise<string> {
    const safeBaseName = this.sanitizeBaseName(rawBaseName);
    const suffix = addConvertedSuffix ? "_converted" : "";
    const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
    let candidate = path.join(outputDir, `${safeBaseName}${suffix}${normalizedExtension}`);
    let index = 1;
    while (await this.exists(candidate)) {
      candidate = path.join(
        outputDir,
        `${safeBaseName}${suffix}_${String(index).padStart(3, "0")}${normalizedExtension}`
      );
      index += 1;
    }
    return candidate;
  }

  private sanitizeBaseName(baseName: string): string {
    const sanitized = baseName
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
    return sanitized || "converted_file";
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private detectKind(extension: string): FileKind {
    if (extension === ".pdf") return "pdf";
    if ([".doc", ".docx"].includes(extension)) return "word";
    if ([".xls", ".xlsx"].includes(extension)) return "excel";
    if ([".jpg", ".jpeg", ".png", ".heic", ".heif"].includes(extension)) return "image";
    if ([".mp4", ".mov", ".mkv", ".webm", ".m4v"].includes(extension)) return "video";
    if ([".mp3", ".wav", ".aac"].includes(extension)) return "audio";
    return "other";
  }

  private toUserError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("LibreOffice")) return "LibreOffice를 찾을 수 없어 PDF 변환을 진행할 수 없습니다.";
    if (message.includes("오디오 트랙") || message.toLowerCase().includes("audio")) {
      return "동영상에 오디오 트랙이 없어 MP3를 만들 수 없습니다.";
    }
    if (message.includes("HEIC")) return "HEIC 파일을 읽지 못했습니다. 다른 HEIC 변환 엔진으로 다시 시도해주세요.";
    if (message.includes("검증") || message.toLowerCase().includes("validation")) {
      return "출력 파일 검증에 실패했습니다. 파일이 정상적으로 열리지 않을 수 있습니다.";
    }
    if (message.includes("취소")) return "변환이 취소되었습니다.";
    return message || "파일을 변환하지 못했습니다.";
  }
}

export function sortSourcePaths(items: FileItem[], sortMode: SortMode): string[] {
  const sorted = [...items].sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name, "ko");
    if (sortMode === "date") return a.modifiedAt - b.modifiedAt;
    if (sortMode === "type") return a.extension.localeCompare(b.extension, "ko");
    if (sortMode === "size") return a.size - b.size;
    return a.dropIndex - b.dropIndex;
  });
  return sorted.map((item) => item.path);
}
