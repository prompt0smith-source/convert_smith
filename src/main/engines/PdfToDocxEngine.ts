import { readFile, writeFile } from "node:fs/promises";
import {
  Document,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  TextRun
} from "docx";

type ProgressCallback = (progress: number, message: string) => void;
const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

export class PdfToDocxEngine {
  async convertEditableText(
    inputPath: string,
    outputPath: string,
    onProgress: ProgressCallback
  ): Promise<void> {
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const data = new Uint8Array(await readFile(inputPath));
    const document = await pdfjs.getDocument({ data }).promise;
    const children: Paragraph[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(
        Math.round(((pageNumber - 1) / Math.max(1, document.numPages)) * 80) + 5,
        `PDF ${pageNumber}/${document.numPages}페이지의 텍스트를 추출하는 중입니다.`
      );
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = textContent.items
        .map((item: unknown) => {
          if (typeof item === "object" && item && "str" in item) {
            return String((item as { str: string }).str);
          }
          return "";
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      children.push(
        new Paragraph({
          children: [new TextRun(text || `페이지 ${pageNumber}`)]
        })
      );
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
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const { createCanvas } = await importRuntime<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
    const data = new Uint8Array(await readFile(inputPath));
    const document = await pdfjs.getDocument({ data }).promise;
    const children: Paragraph[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(
        Math.round(((pageNumber - 1) / Math.max(1, document.numPages)) * 80) + 5,
        `PDF ${pageNumber}/${document.numPages}페이지를 DOCX 이미지로 넣는 중입니다.`
      );
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext("2d");
      await page.render({
        canvasContext: context as never,
        viewport
      }).promise;
      const image = canvas.toBuffer("image/png");
      const width = 595;
      const height = Math.round((viewport.height / viewport.width) * width);

      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              type: "png",
              data: image,
              transformation: { width, height }
            })
          ]
        })
      );
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
}
