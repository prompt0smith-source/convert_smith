import path from "node:path";
import { mkdir, stat, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type {
  ConversionJob,
  ConversionOptions,
  ConversionResultReport,
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
import { PdfToXlsxEngine } from "../engines/PdfToXlsxEngine.js";
import { createPdfjsDocumentOptions, preparePdfCanvasFonts } from "./PdfjsAssetService.js";
import { decodeBmpToPngBuffer } from "./BmpImageService.js";
import { DebugLogService } from "./DebugLogService.js";

type JobUpdateCallback = (job: ConversionJob) => void;
const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

const DEFAULT_OPTIONS: ConversionOptions = {
  imageQuality: 90,
  pdfImageFormat: "jpg",
  pdfRenderScale: 2,
  pdfPageSize: "auto",
  pdfToDocxMode: "visual_preservation",
  videoCompatibilityMode: true,
  overwritePolicy: "increment",
  sortMode: "basic",
  useDatedSubfolder: false
};

export class ConversionService {
  private readonly dependencies = new DependencyService();
  private readonly signatures = new FileSignatureService();
  private readonly validation = new ValidationService(this.signatures, this.dependencies.getFfprobePath());
  private readonly debugLog = new DebugLogService();
  private readonly ffmpeg = new FfmpegEngine(
    this.dependencies.getFfmpegPath(),
    this.dependencies.getFfprobePath()
  );
  private readonly router = new EngineRouter(
    this.ffmpeg,
    new ImageEngine(),
    new PdfEngine(),
    new OfficeEngine(),
    new PdfToDocxEngine(),
    new PdfToXlsxEngine()
  );
  private readonly controllers = new Map<string, AbortController>();

  async resolveDroppedFiles(paths: string[], dropIndexOffset = 0): Promise<FileItem[]> {
    if (!Array.isArray(paths)) {
      throw new Error("???뵬 筌뤴뫖以????而?몴?? ??녿뮸??덈뼄.");
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

  async getFilePreview(filePath: string, pageNumber = 1): Promise<FilePreview> {
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
        const buffer =
          extension === ".bmp"
            ? await decodeBmpToPngBuffer(await readFile(resolved))
            : await sharp(resolved).rotate().png().toBuffer();
        return {
          ...basePreview,
          previewType: "image",
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
          message: "???筌왖 沃섎챶?곮퉪?용┛"
        };
      } catch (error) {
        return {
          ...basePreview,
          previewType: "metadata",
          message: "???筌왖 沃섎챶?곮퉪?용┛??筌띾슢諭억쭪? 筌륁궢六??щ빍??",
          details: {
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }

    if (extension === ".pdf") {
      let pdfjsError: unknown;

      try {
        const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
        const canvasModule = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
        preparePdfCanvasFonts(canvasModule);
        const { createCanvas } = canvasModule;
        const data = new Uint8Array(await readFile(resolved));
        const document = await pdfjs.getDocument(createPdfjsDocumentOptions(data)).promise;
        const safePageNumber = Math.max(1, Math.min(document.numPages, Math.trunc(pageNumber) || 1));
        const page = await document.getPage(safePageNumber);
        const viewport = page.getViewport({ scale: 3 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext("2d");
        context.save();
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
        await page.render({
          canvasContext: context as never,
          viewport
        }).promise;
        const buffer = canvas.toBuffer("image/png");
        return {
          ...basePreview,
          previewType: "pdf_page",
          dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
          message: `PDF ${safePageNumber}페이지 미리보기`,
          details: {
            pages: document.numPages,
            page: safePageNumber,
            renderer: "pdfjs",
            pdfiumPreviewDisabled: true
          }
        };
      } catch (error) {
        pdfjsError = error;
      }

      const logPath = await this.debugLog.write({
        scope: "pdf-preview",
        message: "PDF preview render failed in all renderers.",
        filePath: resolved,
        pageNumber,
        data: {
          fileSize: info.size,
          pdfiumPreviewDisabled: true
        },
        error: pdfjsError
      });
      return {
        ...basePreview,
        previewType: "metadata",
        message: "PDF 미리보기를 만들지 못했습니다.",
        details: {
          error: pdfjsError instanceof Error ? pdfjsError.message : pdfjsError ? String(pdfjsError) : undefined,
          logPath
        }
      };
    }

    if (kind === "video") {
      try {
        const inspection = await this.inspectVideo(resolved);
        return {
          ...basePreview,
          previewType: "media_info",
          message: "??덉겫???類ｋ궖 沃섎챶?곮퉪?용┛",
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
          message: "??덉겫???類ｋ궖????? 筌륁궢六??щ빍??",
          details: {
            error: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }

    return {
      ...basePreview,
      previewType: "metadata",
      message: "?????뵬?? ??? 沃섎챶?곮퉪?용┛??筌왖?癒곕릭筌왖 ??녿뮸??덈뼄.",
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
      throw new Error("PDF嚥??얜씈?????筌왖 ???뵬???袁⑹뒄??몃빍??");
    }

    const job: ConversionJob = {
      id: randomUUID(),
      sourcePaths,
      outputDir,
      conversionType: payload.conversionType,
      status: "queued",
      progress: 0,
      message: "癰궰????疫?餓λ쵐???덈뼄.",
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
    const createdOutputPaths = new Set<string>();

    try {
      const targetOutputDir = options.useDatedSubfolder ? await this.createDatedOutputDir(outputDir) : outputDir;
      emit({ status: "running", progress: 2, message: "?곗뮆?????묊몴?餓Β??쑵六??щ빍??" });

      const customOutputName = options.outputName?.trim();
      let customOutputCounter = 0;
      const trackOutputPath = (outputPath: string) => {
        createdOutputPaths.add(outputPath);
        return outputPath;
      };
      const createOutputPath = async (sourcePath: string, extension: string) =>
        trackOutputPath(await this.createUniqueOutputPath(
          targetOutputDir,
          customOutputName
            ? this.makeCustomOutputBaseName(customOutputName, sourcePaths.length > 1 ? ++customOutputCounter : undefined)
            : path.basename(sourcePath, path.extname(sourcePath)),
          extension,
          !customOutputName
        ));
      const createNamedOutputPath = async (baseName: string, extension: string) =>
        trackOutputPath(await this.createUniqueOutputPath(
          targetOutputDir,
          customOutputName
            ? this.applyCustomNameToGeneratedBase(customOutputName, path.basename(baseName, path.extname(baseName)))
            : path.basename(baseName, path.extname(baseName)),
          extension,
          false
        ));

      const outputPaths = await this.router.convert(
        job,
        createOutputPath,
        createNamedOutputPath,
        (progress, message) => emit({ progress, message }),
        controller.signal
      );

      const validationMessages: string[] = [];
      emit({ progress: 98, message: "?곗뮆?????뵬??野꺜筌앹빜釉??餓λ쵐???덈뼄.", outputPaths });
      for (const outputPath of outputPaths) {
        const validation = await this.validation.validateOutput(payload.conversionType, outputPath);
        validationMessages.push(validation.message);
        if (!validation.ok) {
          throw new Error(`${validation.message}\n${validation.technicalDetails || ""}`.trim());
        }
      }

      emit({
        status: "success",
        progress: 100,
        message: "癰궰??띾궢 野꺜筌앹빘???袁⑥┷??뤿???щ빍??",
        outputPaths,
        resultReport: await this.buildResultReport(sourcePaths, outputPaths, job.createdAt, true, validationMessages),
        completedAt: Date.now()
      });
    } catch (error) {
      const isCancelled = controller.signal.aborted;
      const cleanedCount = await this.cleanupCreatedOutputs(createdOutputPaths, sourcePaths);
      const userError = this.toUserError(error);
      const logPath = await this.debugLog.write({
        scope: "conversion",
        message: "Conversion job failed.",
        data: {
          jobId: job.id,
          conversionType: payload.conversionType,
          sourcePaths,
          outputDir,
          cleanedCount,
          cancelled: isCancelled
        },
        error
      });
      emit({
        status: isCancelled ? "cancelled" : "failed",
        progress: isCancelled ? job.progress : Math.max(job.progress, 1),
        message: isCancelled
          ? "癰궰??륁뵠 ?띯뫁???뤿???щ빍??"
          : `???뵬??癰궰??묐릭筌왖 筌륁궢六??щ빍?? ?癒?궚 ???뵬???癒?맒??뤿?椰꾧퀡援?筌왖?癒곕릭筌왖 ??낅뮉 ?類ㅻ뻼??????됰뮸??덈뼄.${cleanedCount > 0 ? " ?븍뜆??袁る립 ?곗뮆?????뵬?? ?癒?짗 ?類ｂ봺??됰뮸??덈뼄." : ""}`,
        outputPaths: [],
        error: userError,
        technicalDetails: [
          error instanceof Error ? error.stack || error.message : String(error),
          logPath ? `Debug log: ${logPath}` : undefined
        ].filter(Boolean).join("\n\n"),
        resultReport: await this.buildResultReport(sourcePaths, [], job.createdAt, false, [userError]),
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

  private makeCustomOutputBaseName(baseName: string, index?: number): string {
    if (!index) return baseName;
    return `${baseName}_${String(index).padStart(3, "0")}`;
  }

  private applyCustomNameToGeneratedBase(customBaseName: string, generatedBaseName: string): string {
    const pageSuffix = generatedBaseName.match(/_page_\d+$/i)?.[0];
    if (pageSuffix) return `${customBaseName}${pageSuffix}`;
    return customBaseName;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async cleanupCreatedOutputs(outputPaths: Iterable<string>, sourcePaths: string[]): Promise<number> {
    const sourceSet = new Set(sourcePaths.map((sourcePath) => path.resolve(sourcePath)));
    let cleanedCount = 0;
    for (const outputPath of outputPaths) {
      const resolved = path.resolve(outputPath);
      if (sourceSet.has(resolved)) continue;
      try {
        await stat(resolved);
        await rm(resolved, { force: true });
        cleanedCount += 1;
      } catch {
        // Cleanup must not hide the original conversion error.
      }
    }
    return cleanedCount;
  }

  private async buildResultReport(
    sourcePaths: string[],
    outputPaths: string[],
    startedAt: number,
    validationPassed: boolean,
    validationMessages: string[]
  ): Promise<ConversionResultReport> {
    const inputBytes = await this.sumFileSizes(sourcePaths);
    const outputBytes = await this.sumFileSizes(outputPaths);
    const byteDelta = inputBytes - outputBytes;
    return {
      sourceCount: sourcePaths.length,
      outputCount: outputPaths.length,
      inputBytes,
      outputBytes,
      byteDelta,
      byteDeltaPercent: inputBytes > 0 ? (byteDelta / inputBytes) * 100 : 0,
      durationMs: Math.max(0, Date.now() - startedAt),
      validationPassed,
      validationMessages
    };
  }

  private async sumFileSizes(filePaths: string[]): Promise<number> {
    let total = 0;
    for (const filePath of filePaths) {
      try {
        total += (await stat(filePath)).size;
      } catch {
        // Missing files should not prevent reporting the original result.
      }
    }
    return total;
  }

  private detectKind(extension: string): FileKind {
    if (extension === ".pdf") return "pdf";
    if ([".doc", ".docx"].includes(extension)) return "word";
    if ([".xls", ".xlsx"].includes(extension)) return "excel";
    if ([".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".avif", ".tif", ".tiff", ".bmp"].includes(extension)) return "image";
    if ([".mp4", ".mov", ".mkv", ".webm", ".m4v"].includes(extension)) return "video";
    if ([".mp3", ".wav", ".aac", ".flac", ".m4a"].includes(extension)) return "audio";
    if ([".ppt", ".pptx"].includes(extension)) return "presentation";
    return "other";
  }

  private toUserError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    if (message.includes("LibreOffice") || lower.includes("soffice")) {
      return "LibreOffice를 찾지 못해 변환을 진행할 수 없습니다. 설정에서 soffice 경로를 지정해주세요.";
    }
    if (lower.includes("eacces") || lower.includes("eperm") || message.includes("권한")) {
      return "파일을 읽거나 저장할 권한이 없습니다. 파일이 열려 있는지, 저장 폴더 권한이 있는지 확인해주세요.";
    }
    if (lower.includes("enoent") || message.includes("찾을 수")) {
      return "파일 경로를 찾지 못했습니다. 원본 파일이 이동되었거나 삭제되었는지 확인해주세요.";
    }
    if (message.includes("빈 파일") || lower.includes("empty")) {
      return "빈 파일은 변환할 수 없습니다.";
    }
    if (lower.includes("password") || lower.includes("encrypted") || message.includes("암호")) {
      return "암호로 보호되었거나 제한된 PDF는 변환할 수 없습니다. 암호 해제 후 다시 시도해주세요.";
    }
    if (
      lower.includes("invalid pdf") ||
      lower.includes("bad xref") ||
      lower.includes("xref") ||
      lower.includes("pdf header") ||
      lower.includes("parse") ||
      message.includes("PDF 파일 검증")
    ) {
      return "PDF 구조를 읽지 못했습니다. 원본 파일이 손상되었거나 지원하지 않는 PDF일 수 있습니다.";
    }
    if (message.includes("오디오 트랙") || lower.includes("audio track") || lower.includes("no audio")) {
      return "동영상에 오디오 트랙이 없어 MP3를 만들 수 없습니다.";
    }
    if (lower.includes("unsupported codec") || lower.includes("ffprobe") || lower.includes("ffmpeg") || lower.includes("invalid data")) {
      return "미디어 파일을 읽지 못했습니다. 원본 파일이 손상되었거나 지원하지 않는 코덱일 수 있습니다.";
    }
    if (message.includes("HEIC")) {
      return "HEIC 파일을 읽지 못했습니다. 다른 HEIC 파일로 다시 시도해주세요.";
    }
    if (message.includes("검증") || lower.includes("validation")) {
      return "출력 파일 검증에 실패했습니다. 파일이 정상적으로 열리지 않을 수 있습니다.";
    }
    if (message.includes("취소")) return "변환 작업이 취소되었습니다.";
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
