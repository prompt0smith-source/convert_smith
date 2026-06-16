import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { degrees, PDFDocument } from "pdf-lib";
import type { PdfDocumentInfo, PdfRotation, PdfSplitGroup } from "../types/conversion.js";

type ProgressCallback = (progress: number, message: string) => void;
type CreateNamedOutputPath = (baseName: string, extension: string) => Promise<string>;

export class PdfToolEngine {
  async getInfo(inputPath: string): Promise<PdfDocumentInfo> {
    const pdf = await this.loadPdf(inputPath);
    return {
      path: inputPath,
      name: path.basename(inputPath),
      pageCount: pdf.getPageCount()
    };
  }

  async mergePdfs(
    sourcePaths: string[],
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<string[]> {
    const target = await PDFDocument.create();
    for (const [index, sourcePath] of sourcePaths.entries()) {
      onProgress(10 + Math.round((index / Math.max(1, sourcePaths.length)) * 70), "PDF를 병합하는 중입니다.");
      const source = await this.loadPdf(sourcePath);
      const pageNumbers = Array.from({ length: source.getPageCount() }, (_, pageIndex) => pageIndex + 1);
      await this.appendPages(target, source, pageNumbers);
    }
    await writeFile(outputPath, await target.save());
    onProgress(92, "병합 PDF를 저장했습니다.");
    return [outputPath];
  }

  async reorderPdf(
    sourcePath: string,
    outputPath: string,
    pageOrder: number[],
    pageRotations: Record<number, PdfRotation>,
    onProgress: ProgressCallback
  ): Promise<string[]> {
    const source = await this.loadPdf(sourcePath);
    const order = this.normalizePageOrder(pageOrder, source.getPageCount());
    const target = await PDFDocument.create();
    onProgress(35, "페이지 순서를 적용하는 중입니다.");
    await this.appendPages(target, source, order, pageRotations);
    await writeFile(outputPath, await target.save());
    onProgress(92, "정렬된 PDF를 저장했습니다.");
    return [outputPath];
  }

  async rotatePdf(
    sourcePath: string,
    outputPath: string,
    pageRotations: Record<number, PdfRotation>,
    onProgress: ProgressCallback
  ): Promise<string[]> {
    const source = await this.loadPdf(sourcePath);
    const pageNumbers = Array.from({ length: source.getPageCount() }, (_, pageIndex) => pageIndex + 1);
    const target = await PDFDocument.create();
    onProgress(35, "페이지 회전을 적용하는 중입니다.");
    await this.appendPages(target, source, pageNumbers, pageRotations);
    await writeFile(outputPath, await target.save());
    onProgress(92, "회전된 PDF를 저장했습니다.");
    return [outputPath];
  }

  async splitAllPages(
    sourcePath: string,
    createOutputPath: CreateNamedOutputPath,
    pageRotations: Record<number, PdfRotation>,
    onProgress: ProgressCallback
  ): Promise<string[]> {
    const source = await this.loadPdf(sourcePath);
    const total = source.getPageCount();
    const outputs: string[] = [];
    const baseName = path.basename(sourcePath, path.extname(sourcePath));

    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      onProgress(10 + Math.round((pageNumber / total) * 80), `페이지 ${pageNumber}/${total} 분할 중입니다.`);
      const target = await PDFDocument.create();
      await this.appendPages(target, source, [pageNumber], pageRotations);
      const outputPath = await createOutputPath(`${baseName}(${pageNumber})`, "pdf");
      await writeFile(outputPath, await target.save());
      outputs.push(outputPath);
    }
    onProgress(92, "PDF 분할 파일을 저장했습니다.");
    return outputs;
  }

  async splitGroups(
    sourcePath: string,
    groups: PdfSplitGroup[],
    createOutputPath: CreateNamedOutputPath,
    pageRotations: Record<number, PdfRotation>,
    onProgress: ProgressCallback
  ): Promise<string[]> {
    const source = await this.loadPdf(sourcePath);
    const pageCount = source.getPageCount();
    const validGroups = groups
      .map((group, index) => ({
        ...group,
        name: group.name?.trim() || `group_${index + 1}`,
        pages: this.uniqueValidPages(group.pages, pageCount)
      }))
      .filter((group) => group.pages.length > 0);

    if (validGroups.length === 0) {
      throw new Error("분할할 페이지 그룹이 없습니다.");
    }

    const outputs: string[] = [];
    for (const [index, group] of validGroups.entries()) {
      onProgress(10 + Math.round(((index + 1) / validGroups.length) * 80), `그룹 ${index + 1}/${validGroups.length} 저장 중입니다.`);
      const target = await PDFDocument.create();
      await this.appendPages(target, source, group.pages, pageRotations);
      const outputPath = await createOutputPath(group.name, "pdf");
      await writeFile(outputPath, await target.save());
      outputs.push(outputPath);
    }

    onProgress(92, "선택 그룹 PDF를 저장했습니다.");
    return outputs;
  }

  private async appendPages(
    target: PDFDocument,
    source: PDFDocument,
    pageNumbers: number[],
    pageRotations: Record<number, PdfRotation> = {}
  ): Promise<void> {
    if (!pageNumbers.length) return;
    const copiedPages = await target.copyPages(
      source,
      pageNumbers.map((pageNumber) => pageNumber - 1)
    );

    copiedPages.forEach((page, index) => {
      const pageNumber = pageNumbers[index];
      const rotation = pageRotations[pageNumber] || 0;
      if (rotation) {
        const base = page.getRotation().angle || 0;
        page.setRotation(degrees(this.normalizeRotation(base + rotation)));
      }
      target.addPage(page);
    });
  }

  private async loadPdf(inputPath: string): Promise<PDFDocument> {
    return PDFDocument.load(await readFile(inputPath), { ignoreEncryption: false });
  }

  private normalizePageOrder(pageOrder: number[], pageCount: number): number[] {
    const normalized = this.uniqueValidPages(pageOrder, pageCount);
    if (normalized.length === pageCount) return normalized;
    const included = new Set(normalized);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (!included.has(pageNumber)) normalized.push(pageNumber);
    }
    return normalized;
  }

  private uniqueValidPages(pages: number[], pageCount: number): number[] {
    const seen = new Set<number>();
    const result: number[] = [];
    for (const page of pages) {
      const pageNumber = Math.trunc(Number(page));
      if (pageNumber < 1 || pageNumber > pageCount || seen.has(pageNumber)) continue;
      seen.add(pageNumber);
      result.push(pageNumber);
    }
    return result;
  }

  private normalizeRotation(value: number): PdfRotation {
    const normalized = ((value % 360) + 360) % 360;
    return (normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0) as PdfRotation;
  }
}
