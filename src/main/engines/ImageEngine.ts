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
    onProgress(20, "PNG 이미지를 읽는 중입니다.");
    await sharp(inputPath)
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality })
      .toFile(outputPath);
    onProgress(90, "JPG 파일을 저장했습니다.");
  }

  async jpgToPng(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    onProgress(20, "JPG 이미지를 읽는 중입니다.");
    await sharp(inputPath).rotate().png().toFile(outputPath);
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
}
