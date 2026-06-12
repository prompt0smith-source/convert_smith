import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import heicConvert from "heic-convert";

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
    await this.toJpg(inputPath, outputPath, quality, onProgress, "BMP");
  }

  async bmpToPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.toPng(inputPath, outputPath, onProgress, "BMP");
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
