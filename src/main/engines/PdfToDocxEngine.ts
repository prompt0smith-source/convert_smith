import { readFile, writeFile } from "node:fs/promises";
import {
  Document,
  FrameAnchorType,
  FrameWrap,
  HeightRule,
  HorizontalPositionRelativeFrom,
  ImageRun,
  LineRuleType,
  Packer,
  PageBreak,
  Paragraph,
  TextWrappingType,
  TextRun,
  VerticalPositionRelativeFrom
} from "docx";
import { createPdfjsDocumentOptions } from "../services/PdfjsAssetService.js";
import { applyLocalFontMatches, warmPdfPageFonts } from "../services/LocalFontMatchService.js";
import {
  extractPdfPlacedImages,
  type PdfPlacedImage
} from "../services/PdfImageExtractionService.js";
import { applyPdfRenderedTextColors, renderPdfGraphicsBackdrop } from "../services/PdfGraphicsBackdropService.js";
import {
  extractPdfReadingOrderFragments,
  extractPdfReadingOrderLines,
  type PdfReadingOrderLine
} from "../services/PdfReadingOrderService.js";
import { applyPdfTextColors } from "../services/PdfTextColorService.js";

type ProgressCallback = (progress: number, message: string) => void;
const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

interface PdfPageSnapshot {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  scale: number;
  backdrop?: Buffer;
  images: PdfPlacedImage[];
  textItems: PdfReadingOrderLine[];
}

const POINTS_PER_INCH = 72;
const PIXELS_PER_INCH = 96;
const TWIPS_PER_POINT = 20;
const WORD_MAX_PAGE_POINTS = 1584; // Word's practical page-size ceiling is about 22 inches.

export class PdfToDocxEngine {
  async convertEditableText(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await readFile(inputPath));
    const document = await pdfjs.getDocument(createPdfjsDocumentOptions(data)).promise;
    const children: Paragraph[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(
        Math.round(((pageNumber - 1) / Math.max(1, document.numPages)) * 80) + 5,
        `PDF ${pageNumber}/${document.numPages}페이지의 텍스트를 좌→우, 상→하 순서로 정리하는 중입니다.`
      );
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const lines = this.extractOrderedTextLines(pdfjs, page, textContent);
      await applyPdfTextColors(pdfjs, page, textContent, lines);
      await applyPdfRenderedTextColors(page, lines, 1);
      await warmPdfPageFonts(page);
      await applyLocalFontMatches(page, lines);

      for (const line of lines) {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line.text,
                font: createRunFontOptions(line.fontFamily || "Arial"),
                color: line.color || "000000"
              })
            ]
          })
        );
      }
      if (pageNumber < document.numPages) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    const doc = new Document({
      sections: [{ children }]
    });
    await writeFile(outputPath, await Packer.toBuffer(doc));
    onProgress(95, "DOCX 파일을 저장했습니다.");
  }

  async convertVisualPreservation(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    await this.convertHybridPreservation(inputPath, outputPath, onProgress);
  }

  private async convertHybridPreservation(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await readFile(inputPath));
    const document = await pdfjs.getDocument(createPdfjsDocumentOptions(data)).promise;
    const sections: Array<{
      properties: {
        page: {
          size: { width: number; height: number };
          margin: { top: number; right: number; bottom: number; left: number; header: number; footer: number };
        };
      };
      children: Paragraph[];
    }> = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(
        Math.round(((pageNumber - 1) / Math.max(1, document.numPages)) * 20) + 70,
        `PDF ${pageNumber}/${document.numPages}페이지의 텍스트와 이미지를 분리하는 중입니다.`
      );
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const layoutScale = this.getWordLayoutScale(viewport.width, viewport.height);
      const textContent = await page.getTextContent();
      const textItems = this.extractTextLayerItems(pdfjs, page, textContent, layoutScale);
      await applyPdfTextColors(pdfjs, page, textContent, textItems, { splitMixedColorText: true });
      const images = await extractPdfPlacedImages(pdfjs, page, layoutScale);
      const backdrop = await renderPdfGraphicsBackdrop(page, textItems, images, layoutScale);
      await applyLocalFontMatches(page, textItems);
      const snapshot: PdfPageSnapshot = {
        pageNumber,
        widthPt: viewport.width * layoutScale,
        heightPt: viewport.height * layoutScale,
        scale: layoutScale,
        backdrop,
        images,
        textItems
      };

      sections.push(this.createHybridSection(snapshot));
    }

    const doc = new Document({ sections });
    await writeFile(outputPath, await Packer.toBuffer(doc));
    onProgress(95, "PDF 텍스트와 이미지를 분리해 DOCX로 저장했습니다.");
  }

  private createHybridSection(snapshot: PdfPageSnapshot): {
    properties: {
      page: {
        size: { width: number; height: number };
        margin: { top: number; right: number; bottom: number; left: number; header: number; footer: number };
      };
    };
    children: Paragraph[];
  } {
    const children: Paragraph[] = [];

    if (snapshot.backdrop) {
      children.push(this.createBackdropParagraph(snapshot));
    }

    for (const image of snapshot.images) {
      children.push(this.createPlacedImageParagraph(image));
    }

    for (const item of snapshot.textItems) {
      children.push(this.createVisibleTextFrame(item, snapshot));
    }

    return {
      properties: {
        page: {
          size: {
            width: this.pointsToTwips(snapshot.widthPt),
            height: this.pointsToTwips(snapshot.heightPt)
          },
          margin: {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            header: 0,
            footer: 0
          }
        }
      },
      children
    };
  }

  private createBackdropParagraph(snapshot: PdfPageSnapshot): Paragraph {
    return new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [
        new ImageRun({
          type: "png",
          data: snapshot.backdrop!,
          transformation: {
            width: this.pointsToPixels(snapshot.widthPt),
            height: this.pointsToPixels(snapshot.heightPt)
          },
          floating: {
            horizontalPosition: {
              relative: HorizontalPositionRelativeFrom.PAGE,
              offset: 0
            },
            verticalPosition: {
              relative: VerticalPositionRelativeFrom.PAGE,
              offset: 0
            },
            allowOverlap: true,
            behindDocument: true,
            lockAnchor: true,
            wrap: { type: TextWrappingType.NONE },
            zIndex: 0
          }
        })
      ]
    });
  }

  private createPlacedImageParagraph(image: PdfPlacedImage): Paragraph {
    return new Paragraph({
      spacing: { before: 0, after: 0 },
      children: [
        new ImageRun({
          type: "png",
          data: image.data,
          transformation: {
            width: this.pointsToPixels(image.width),
            height: this.pointsToPixels(image.height)
          },
          floating: {
            horizontalPosition: {
              relative: HorizontalPositionRelativeFrom.PAGE,
              offset: this.pointsToEmus(image.x)
            },
            verticalPosition: {
              relative: VerticalPositionRelativeFrom.PAGE,
              offset: this.pointsToEmus(image.y)
            },
            allowOverlap: true,
            behindDocument: true,
            lockAnchor: true,
            wrap: { type: TextWrappingType.NONE },
            zIndex: 1
          }
        })
      ]
    });
  }

  private createVisibleTextFrame(item: PdfReadingOrderLine, snapshot: PdfPageSnapshot): Paragraph {
    const fontSizePt = this.clamp(item.fontSize, 4, 48);
    const lineHeightPt = Math.max(fontSizePt * 1.2, item.height * 1.08, 6);
    const estimatedTextWidthPt = this.estimateTextWidth(item.text, fontSizePt);
    const naturalWidthPt = Math.max(item.width * 1.08, estimatedTextWidthPt + fontSizePt * 0.65, fontSizePt * 1.5, 8);
    const availableWidthPt = Math.max(8, snapshot.widthPt - item.x - 1);
    const frameWidthPt = Math.min(naturalWidthPt, availableWidthPt);
    const lineCount = Math.max(1, Math.ceil(naturalWidthPt / Math.max(1, frameWidthPt)));
    const desiredHeightPt = lineHeightPt * lineCount + fontSizePt * 0.2;
    const availableHeightPt = Math.max(lineHeightPt, snapshot.heightPt - item.y - 1);
    const frameHeightPt = Math.min(Math.max(lineHeightPt, desiredHeightPt), availableHeightPt);

    return new Paragraph({
      frame: {
        type: "absolute",
        position: {
          x: this.pointsToTwips(item.x),
          y: this.pointsToTwips(item.y)
        },
        width: this.pointsToTwips(frameWidthPt),
        height: this.pointsToTwips(frameHeightPt),
        anchor: {
          horizontal: FrameAnchorType.PAGE,
          vertical: FrameAnchorType.PAGE
        },
        wrap: FrameWrap.NONE,
        rule: HeightRule.EXACT,
        anchorLock: true
      },
      spacing: {
        before: 0,
        after: 0,
        line: this.pointsToTwips(lineHeightPt),
        lineRule: LineRuleType.EXACT
      },
      children: [
        new TextRun({
          text: item.text,
          size: Math.max(2, Math.round(fontSizePt * 2)),
          font: createRunFontOptions(item.fontFamily || "Arial"),
          color: item.color || "000000",
          noProof: true
        })
      ]
    });
  }

  private extractOrderedTextLines(pdfjs: any, page: any, textContent: any): PdfReadingOrderLine[] {
    return extractPdfReadingOrderLines(pdfjs, page, textContent, 1);
  }

  private extractTextLayerItems(
    pdfjs: any,
    page: any,
    textContent: any,
    layoutScale: number
  ): PdfReadingOrderLine[] {
    return extractPdfReadingOrderFragments(pdfjs, page, textContent, layoutScale);
  }

  private getWordLayoutScale(widthPt: number, heightPt: number): number {
    const maxSide = Math.max(widthPt, heightPt);
    if (!Number.isFinite(maxSide) || maxSide <= 0) return 1;
    return Math.min(1, WORD_MAX_PAGE_POINTS / maxSide);
  }

  private pointsToTwips(points: number): number {
    return Math.max(1, Math.round(points * TWIPS_PER_POINT));
  }

  private pointsToPixels(points: number): number {
    return Math.max(1, Math.round((points / POINTS_PER_INCH) * PIXELS_PER_INCH));
  }

  private pointsToEmus(points: number): number {
    return Math.round(points * 12700);
  }

  private estimateTextWidth(text: string, fontSizePt: number): number {
    let units = 0;
    for (const char of text) {
      if (/\s/.test(char)) units += 0.32;
      else if (/[\u3131-\u318e\uac00-\ud7a3\u3040-\u30ff\u3400-\u9fff]/.test(char)) units += 0.96;
      else if (/[A-Z]/.test(char)) units += 0.64;
      else if (/[a-z]/.test(char)) units += 0.53;
      else if (/[0-9]/.test(char)) units += 0.56;
      else if (/[,.;:!|'"]/u.test(char)) units += 0.32;
      else units += 0.58;
    }

    return units * fontSizePt;
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
}

function createRunFontOptions(family: string): { ascii: string; hAnsi: string; eastAsia: string; cs: string } {
  return {
    ascii: family,
    hAnsi: family,
    eastAsia: family,
    cs: family
  };
}
