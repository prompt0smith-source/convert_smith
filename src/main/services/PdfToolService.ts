import path from "node:path";
import { mkdir, stat, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type {
  PdfDocumentInfo,
  PdfRotation,
  ConversionResultReport,
  PdfSignatureStampOptions,
  PdfToolJob,
  PdfToolOptions,
  StartPdfToolPayload
} from "../types/conversion.js";
import { DependencyService } from "./DependencyService.js";
import { FileSignatureService } from "./FileSignatureService.js";
import { ValidationService } from "./ValidationService.js";
import { PdfToolEngine } from "../engines/PdfToolEngine.js";
import { PdfSignatureStampEngine } from "../engines/PdfSignatureStampEngine.js";

type JobUpdateCallback = (job: PdfToolJob) => void;

export class PdfToolService {
  private readonly dependencies = new DependencyService();
  private readonly signatures = new FileSignatureService();
  private readonly validation = new ValidationService(this.signatures, this.dependencies.getFfprobePath());
  private readonly engine = new PdfToolEngine();
  private readonly signatureStampEngine = new PdfSignatureStampEngine();

  async getInfo(filePath: string): Promise<PdfDocumentInfo> {
    const resolved = await this.validatePdfInput(filePath);
    return this.engine.getInfo(resolved);
  }

  async run(payload: StartPdfToolPayload, onUpdate: JobUpdateCallback): Promise<PdfToolJob> {
    const sourcePaths = await Promise.all(payload.sourcePaths.map((sourcePath) => this.validatePdfInput(sourcePath)));
    const outputDir = await this.validation.validateOutputDir(payload.outputDir);
    const options: PdfToolOptions = {
      ...payload.options,
      pageRotations: this.normalizeRotations(payload.options.pageRotations)
    };

    if (payload.toolType === "pdf_merge" && sourcePaths.length < 2) {
      throw new Error("PDF 병합에는 PDF 파일이 2개 이상 필요합니다.");
    }
    if (payload.toolType !== "pdf_merge" && sourcePaths.length !== 1) {
      throw new Error("이 PDF 작업은 PDF 파일 하나를 선택해야 합니다.");
    }
    if (payload.toolType === "pdf_signature_stamp") {
      options.signatureStamp = await this.validateSignatureStampOptions(options.signatureStamp, sourcePaths[0]);
    }

    const job: PdfToolJob = {
      id: randomUUID(),
      sourcePaths,
      outputDir,
      toolType: payload.toolType,
      status: "queued",
      progress: 0,
      message: "PDF 작업 대기 중입니다.",
      outputPaths: [],
      createdAt: Date.now(),
      options
    };

    const emit = (patch: Partial<PdfToolJob>) => {
      Object.assign(job, patch);
      onUpdate({ ...job, outputPaths: [...job.outputPaths] });
    };
    const createdOutputPaths = new Set<string>();

    try {
      const targetOutputDir = options.useDatedSubfolder ? await this.createDatedOutputDir(outputDir) : outputDir;
      emit({ status: "running", progress: 5, message: "PDF 작업 폴더를 준비했습니다." });

      const customOutputName = options.outputName?.trim();
      const trackOutputPath = (outputPath: string) => {
        createdOutputPaths.add(outputPath);
        return outputPath;
      };
      const createNamedOutputPath = async (baseName: string, extension: string) =>
        trackOutputPath(await this.createUniqueOutputPath(
          targetOutputDir,
          customOutputName ? this.applyCustomNameToGeneratedBase(customOutputName, baseName) : baseName,
          extension,
          false
        ));
      const createRawNamedOutputPath = async (baseName: string, extension: string) =>
        trackOutputPath(await this.createUniqueOutputPath(targetOutputDir, baseName, extension, false));
      const createNumberedOutputPath = async (baseName: string, extension: string) =>
        trackOutputPath(await this.createNumberedOutputPath(targetOutputDir, baseName, extension));
      const createOutputPath = async (sourcePath: string, suffix: string) =>
        trackOutputPath(await this.createUniqueOutputPath(
          targetOutputDir,
          customOutputName || `${path.basename(sourcePath, path.extname(sourcePath))}_${suffix}`,
          "pdf",
          false
        ));

      const rotations = options.pageRotations || {};
      let outputPaths: string[];
      const toolWarnings: string[] = [];

      if (payload.toolType === "pdf_merge") {
        const outputPath = customOutputName
          ? await createRawNamedOutputPath(customOutputName, "pdf")
          : await createNumberedOutputPath("merged", "pdf");
        outputPaths = await this.engine.mergePdfs(sourcePaths, outputPath, (progress, message) => emit({ progress, message }));
      } else if (payload.toolType === "pdf_reorder") {
        const outputPath = await createOutputPath(sourcePaths[0], "reordered");
        outputPaths = await this.engine.reorderPdf(
          sourcePaths[0],
          outputPath,
          options.pageOrder || [],
          rotations,
          (progress, message) => emit({ progress, message })
        );
      } else if (payload.toolType === "pdf_split_all") {
        outputPaths = await this.engine.splitAllPages(
          sourcePaths[0],
          createNamedOutputPath,
          rotations,
          (progress, message) => emit({ progress, message })
        );
      } else if (payload.toolType === "pdf_split_groups") {
        const groups =
          customOutputName && options.splitGroups
            ? options.splitGroups.map((group, index) => ({
                ...group,
                name: `${customOutputName}_group_${String(index + 1).padStart(3, "0")}`
              }))
            : options.splitGroups || [];
        outputPaths = await this.engine.splitGroups(
          sourcePaths[0],
          groups,
          createRawNamedOutputPath,
          rotations,
          (progress, message) => emit({ progress, message })
        );
      } else if (payload.toolType === "pdf_signature_stamp") {
        const outputPath = await createOutputPath(sourcePaths[0], "signed");
        const result = await this.signatureStampEngine.stamp(
          sourcePaths[0],
          outputPath,
          options.signatureStamp!,
          (progress, message) => emit({ progress, message })
        );
        outputPaths = result.outputPaths;
        toolWarnings.push(...result.warnings);
      } else {
        const outputPath = await createOutputPath(sourcePaths[0], "rotated");
        outputPaths = await this.engine.rotatePdf(
          sourcePaths[0],
          outputPath,
          rotations,
          (progress, message) => emit({ progress, message })
        );
      }

      const validationMessages: string[] = [];
      emit({ progress: 96, message: "PDF 출력 파일을 검증하는 중입니다.", outputPaths });
      for (const outputPath of outputPaths) {
        const validation = await this.validation.validateOutput("images_to_pdf", outputPath);
        validationMessages.push(validation.message);
        if (!validation.ok) {
          throw new Error(`${validation.message}\n${validation.technicalDetails || ""}`.trim());
        }
      }

      emit({
        status: "success",
        progress: 100,
        message:
          toolWarnings.length > 0
            ? `PDF 작업과 검증이 완료되었습니다. ${toolWarnings[0]}`
            : "PDF 작업과 검증이 완료되었습니다.",
        outputPaths,
        resultReport: await this.buildResultReport(
          sourcePaths,
          outputPaths,
          job.createdAt,
          true,
          [...validationMessages, ...toolWarnings]
        ),
        completedAt: Date.now()
      });
    } catch (error) {
      const cleanedCount = await this.cleanupCreatedOutputs(createdOutputPaths, sourcePaths);
      const userError = error instanceof Error ? error.message : String(error);
      emit({
        status: "failed",
        progress: Math.max(job.progress, 1),
        message: `PDF 작업을 완료하지 못했습니다.${cleanedCount > 0 ? " 불완전한 출력 파일은 자동 정리했습니다." : ""}`,
        outputPaths: [],
        error: userError,
        technicalDetails: error instanceof Error ? error.stack || error.message : String(error),
        resultReport: await this.buildResultReport(sourcePaths, [], job.createdAt, false, [userError]),
        completedAt: Date.now()
      });
    }

    return job;
  }

  private async validatePdfInput(filePath: string): Promise<string> {
    const resolved = await this.validation.validateInputPath(filePath);
    if (path.extname(resolved).toLowerCase() !== ".pdf") {
      throw new Error("PDF 도구에는 PDF 파일만 사용할 수 있습니다.");
    }
    if (!(await this.signatures.isPdf(resolved))) {
      throw new Error("PDF 파일 검증에 실패했습니다.");
    }
    return resolved;
  }

  private normalizeRotations(rotations?: Record<number, PdfRotation>): Record<number, PdfRotation> {
    const result: Record<number, PdfRotation> = {};
    for (const [rawPage, rawRotation] of Object.entries(rotations || {})) {
      const page = Math.trunc(Number(rawPage));
      const rotation = Number(rawRotation);
      if (page < 1) continue;
      if (rotation === 90 || rotation === 180 || rotation === 270) result[page] = rotation;
    }
    return result;
  }

  private async validateSignatureStampOptions(
    options: PdfSignatureStampOptions | undefined,
    sourcePath: string
  ): Promise<PdfSignatureStampOptions> {
    if (!options) {
      throw new Error("서명 이미지를 선택해주세요.");
    }

    const signatureImagePath = await this.validation.validateInputPath(options.signatureImagePath);
    const extension = path.extname(signatureImagePath).toLowerCase();
    if (![".png", ".jpg", ".jpeg"].includes(extension)) {
      throw new Error("PNG 또는 JPG 서명 이미지만 사용할 수 있습니다.");
    }
    const validSignature =
      extension === ".png"
        ? await this.signatures.isPng(signatureImagePath)
        : await this.signatures.isJpeg(signatureImagePath);
    if (!validSignature) {
      throw new Error("PNG 또는 JPG 서명 이미지만 사용할 수 있습니다.");
    }

    const info = await this.engine.getInfo(sourcePath);
    const pages = [...new Set(options.pages.map((page) => Math.trunc(Number(page))))];
    if (pages.length === 0) {
      throw new Error("서명을 넣을 페이지를 선택해주세요.");
    }
    if (pages.some((page) => page < 1 || page > info.pageCount)) {
      throw new Error("선택한 페이지 범위가 PDF 페이지 수를 벗어났습니다.");
    }
    if (
      !Number.isFinite(options.placement.xPercent) ||
      !Number.isFinite(options.placement.yPercent) ||
      !Number.isFinite(options.placement.widthPercent) ||
      (options.placement.heightPercent !== undefined && !Number.isFinite(options.placement.heightPercent))
    ) {
      throw new Error("서명 위치 값이 올바르지 않습니다.");
    }

    return {
      ...options,
      signatureImagePath,
      pages,
      opacity: Math.min(1, Math.max(0.1, options.opacity)),
      flattenSignedPages: typeof options.flattenSignedPages === "boolean" ? options.flattenSignedPages : false,
      renderScale: options.renderScale === 1 || options.renderScale === 3 ? options.renderScale : 2,
      placement: {
        ...options.placement,
        keepAspectRatio:
          typeof options.placement.keepAspectRatio === "boolean" ? options.placement.keepAspectRatio : true
      }
    };
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
    return sanitized || "pdf_output";
  }

  private applyCustomNameToGeneratedBase(customBaseName: string, generatedBaseName: string): string {
    const pageSuffix = generatedBaseName.match(/_page_\d+$/i)?.[0];
    if (pageSuffix) return `${customBaseName}${pageSuffix}`;
    const numberedSuffix = generatedBaseName.match(/\(\d+\)$/)?.[0];
    if (numberedSuffix) return `${customBaseName}${numberedSuffix}`;
    return customBaseName;
  }

  private async createNumberedOutputPath(outputDir: string, rawBaseName: string, extension: string): Promise<string> {
    const safeBaseName = this.sanitizeBaseName(rawBaseName);
    const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
    for (let index = 1; index < 10000; index += 1) {
      const candidate = path.join(outputDir, `${safeBaseName}(${index})${normalizedExtension}`);
      if (!(await this.exists(candidate))) return candidate;
    }
    return this.createUniqueOutputPath(outputDir, safeBaseName, extension, false);
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
        // Cleanup must not hide the original PDF tool error.
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
}
