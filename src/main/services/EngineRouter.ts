import type { ConversionJob } from "../types/conversion.js";
import { FfmpegEngine } from "../engines/FfmpegEngine.js";
import { ImageEngine } from "../engines/ImageEngine.js";
import { PdfEngine } from "../engines/PdfEngine.js";
import { OfficeEngine } from "../engines/OfficeEngine.js";
import { PdfToDocxEngine } from "../engines/PdfToDocxEngine.js";

type ProgressCallback = (progress: number, message: string) => void;
type CreateOutputPath = (sourcePath: string, extension: string) => Promise<string>;
type CreateNamedOutputPath = (baseName: string, extension: string) => Promise<string>;

export class EngineRouter {
  constructor(
    private readonly ffmpeg: FfmpegEngine,
    private readonly image: ImageEngine,
    private readonly pdf: PdfEngine,
    private readonly office: OfficeEngine,
    private readonly pdfToDocx: PdfToDocxEngine
  ) {}

  async convert(
    job: ConversionJob,
    createOutputPath: CreateOutputPath,
    createNamedOutputPath: CreateNamedOutputPath,
    onProgress: ProgressCallback,
    signal?: AbortSignal
  ): Promise<string[]> {
    switch (job.conversionType) {
      case "mp4_to_mp3":
        return this.convertEach(job, "mp3", createOutputPath, (input, output) =>
          this.ffmpeg.convertMp4ToMp3(input, output, onProgress, signal)
        );
      case "mov_to_mp4":
      case "video_compatibility_repair":
        return this.convertEach(job, "mp4", createOutputPath, (input, output) =>
          this.ffmpeg.convertToCompatibleMp4(input, output, onProgress, signal)
        );
      case "heic_to_jpg":
        return this.convertEach(job, "jpg", createOutputPath, (input, output) =>
          this.image.heicToJpg(input, output, job.options.imageQuality, onProgress)
        );
      case "png_to_jpg":
        return this.convertEach(job, "jpg", createOutputPath, (input, output) =>
          this.image.pngToJpg(input, output, job.options.imageQuality, onProgress)
        );
      case "jpg_to_png":
        return this.convertEach(job, "png", createOutputPath, (input, output) =>
          this.image.jpgToPng(input, output, onProgress)
        );
      case "images_to_pdf": {
        const outputPath = await createNamedOutputPath(this.makeCombinedPdfBase(job.sourcePaths), "pdf");
        await this.pdf.imagesToPdf(job.sourcePaths, outputPath, job.options.pdfPageSize, onProgress);
        return [outputPath];
      }
      case "pdf_to_images":
        return this.pdf.pdfToImages(
          job.sourcePaths[0],
          job.options.pdfImageFormat,
          job.options.pdfRenderScale,
          job.options.imageQuality,
          createNamedOutputPath,
          onProgress
        );
      case "docx_to_pdf":
      case "xlsx_to_pdf": {
        if (!job.options.libreOfficePath) {
          throw new Error("LibreOffice를 찾을 수 없어 PDF 변환을 진행할 수 없습니다.");
        }
        return this.convertEach(job, "pdf", createOutputPath, (input, output) =>
          this.office.convertToPdf(input, output, job.options.libreOfficePath!, onProgress, signal)
        );
      }
      case "pdf_to_docx": {
        const outputPath = await createOutputPath(job.sourcePaths[0], "docx");
        if (job.options.pdfToDocxMode === "visual_preservation") {
          await this.pdfToDocx.convertVisualPreservation(job.sourcePaths[0], outputPath, onProgress);
        } else {
          await this.pdfToDocx.convertEditableText(job.sourcePaths[0], outputPath, onProgress);
        }
        return [outputPath];
      }
      default:
        throw new Error("지원하지 않는 변환 형식입니다.");
    }
  }

  private async convertEach(
    job: ConversionJob,
    extension: string,
    createOutputPath: CreateOutputPath,
    run: (inputPath: string, outputPath: string) => Promise<void>
  ): Promise<string[]> {
    const outputPaths: string[] = [];
    for (const [index, sourcePath] of job.sourcePaths.entries()) {
      const outputPath = await createOutputPath(sourcePath, extension);
      await run(sourcePath, outputPath);
      outputPaths.push(outputPath);
      if (job.sourcePaths.length > 1) {
        const progress = Math.round(((index + 1) / job.sourcePaths.length) * 95);
        void progress;
      }
    }
    return outputPaths;
  }

  private makeCombinedPdfBase(sourcePaths: string[]): string {
    if (sourcePaths.length === 1) {
      return sourcePaths[0];
    }
    return "images_converted";
  }
}
