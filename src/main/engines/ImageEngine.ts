import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import heicConvert from "heic-convert";
import { decodeBmpToPngBuffer } from "../services/BmpImageService.js";

type ProgressCallback = (progress: number, message: string) => void;

export class ImageEngine {
  async pngToJpg(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toJpg(inputPath, outputPath, quality, onProgress, "PNG");
  }

  async jpgToPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toPng(inputPath, outputPath, onProgress, "JPG");
  }

  async imageToWebp(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(20, "이미지를 WEBP로 다시 인코딩하는 중입니다.");
    await sharp(inputPath).rotate().webp({ quality }).toFile(outputPath);
    onProgress(90, "WEBP 파일을 저장했습니다.");
  }

  async optimizeJpg(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(20, "JPG 이미지를 최적화하는 중입니다.");
    await sharp(inputPath)
      .rotate()
      .jpeg({ quality, mozjpeg: true })
      .toFile(outputPath);
    onProgress(90, "최적화된 JPG 파일을 저장했습니다.");
  }

  async optimizePng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(20, "PNG 이미지를 최적화하는 중입니다.");
    await sharp(inputPath)
      .rotate()
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(outputPath);
    onProgress(90, "최적화된 PNG 파일을 저장했습니다.");
  }

  async optimizeWebp(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(20, "WEBP 이미지를 최적화하는 중입니다.");
    await sharp(inputPath)
      .rotate()
      .webp({ quality, effort: 6 })
      .toFile(outputPath);
    onProgress(90, "최적화된 WEBP 파일을 저장했습니다.");
  }

  async webpToJpg(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toJpg(inputPath, outputPath, quality, onProgress, "WEBP");
  }

  async webpToPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toPng(inputPath, outputPath, onProgress, "WEBP");
  }

  async avifToJpg(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toJpg(inputPath, outputPath, quality, onProgress, "AVIF");
  }

  async avifToPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toPng(inputPath, outputPath, onProgress, "AVIF");
  }

  async tiffToJpg(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toJpg(inputPath, outputPath, quality, onProgress, "TIFF");
  }

  async tiffToPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toPng(inputPath, outputPath, onProgress, "TIFF");
  }

  async bmpToJpg(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(20, "BMP 이미지를 JPG로 변환하는 중입니다.");
    const pngBuffer = await decodeBmpToPngBuffer(await readFile(inputPath));
    await sharp(pngBuffer).flatten({ background: "#ffffff" }).jpeg({ quality }).toFile(outputPath);
    onProgress(90, "JPG 파일을 저장했습니다.");
  }

  async bmpToPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(20, "BMP 이미지를 PNG로 변환하는 중입니다.");
    await writeFile(outputPath, await decodeBmpToPngBuffer(await readFile(inputPath)));
    onProgress(90, "PNG 파일을 저장했습니다.");
  }

  async heicToJpg(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(15, "HEIC 이미지를 읽는 중입니다.");
    try {
      await sharp(inputPath).rotate().jpeg({ quality }).toFile(outputPath);
      onProgress(90, "JPG 파일을 저장했습니다.");
      return;
    } catch {
      onProgress(40, "다른 HEIC 변환 엔진으로 다시 시도하는 중입니다.");
    }

    const input = await readFile(inputPath);
    const output = await heicConvert({
      buffer: input,
      format: "JPEG",
      quality: Math.max(0.1, Math.min(1, quality / 100))
    });
    await writeFile(outputPath, Buffer.from(output));
    onProgress(90, "JPG 파일을 저장했습니다.");
  }

  async heicToPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(15, "HEIC 이미지를 읽는 중입니다.");
    try {
      await sharp(inputPath).rotate().png().toFile(outputPath);
      onProgress(90, "PNG 파일을 저장했습니다.");
      return;
    } catch {
      onProgress(40, "다른 HEIC 변환 엔진으로 다시 시도하는 중입니다.");
    }

    const input = await readFile(inputPath);
    const output = await heicConvert({
      buffer: input,
      format: "PNG"
    });
    await writeFile(outputPath, Buffer.from(output));
    onProgress(90, "PNG 파일을 저장했습니다.");
  }

  private async toJpg(
    inputPath: string,
    outputPath: string,
    quality: number,
    onProgress: ProgressCallback,
    sourceLabel: string
  ): Promise<void> {
    onProgress(20, `${sourceLabel} 이미지를 JPG로 변환하는 중입니다.`);
    await sharp(inputPath)
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality })
      .toFile(outputPath);
    onProgress(90, "JPG 파일을 저장했습니다.");
  }

  private async toPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback,
    sourceLabel: string
  ): Promise<void> {
    onProgress(20, `${sourceLabel} 이미지를 PNG로 변환하는 중입니다.`);
    await sharp(inputPath).rotate().png().toFile(outputPath);
    onProgress(90, "PNG 파일을 저장했습니다.");
  }
}
