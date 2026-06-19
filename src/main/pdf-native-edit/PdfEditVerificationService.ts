import { readFile, stat } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { createPdfjsDocumentOptions } from "../services/PdfjsAssetService.js";
import type { PdfEditVerificationRequest, PdfEditVerificationResult } from "./types.js";

const importRuntime = new Function("specifier", "return import(specifier)") as <T = any>(
  specifier: string
) => Promise<T>;

export class PdfEditVerificationService {
  async verify(request: PdfEditVerificationRequest): Promise<PdfEditVerificationResult> {
    try {
      const info = await stat(request.outputPath);
      if (!info.isFile() || info.size <= 0) {
        return { ok: false, message: "PDF 편집 결과 파일이 없거나 비어 있습니다." };
      }

      const data = await readFile(request.outputPath);
      if (Buffer.from(data.subarray(0, 5)).toString("latin1") !== "%PDF-") {
        return { ok: false, message: "PDF 편집 결과의 헤더가 올바르지 않습니다." };
      }

      await PDFDocument.load(data, { ignoreEncryption: false });

      const expected = (request.expectedReplacementTexts || [])
        .map((text) => text.normalize("NFC").trim())
        .filter(Boolean);
      if (expected.length > 0) {
        const extractedText = await this.extractText(data);
        const normalizedExtracted = extractedText.normalize("NFC");
        const missing = expected.find((text) => !normalizedExtracted.includes(text));
        if (missing) {
          return {
            ok: false,
            message: "PDF 직접 편집 검증에 실패했습니다. 저장된 PDF에서 새 텍스트를 확인하지 못했습니다.",
            details: `Missing replacement text: ${missing}`
          };
        }
      }

      return { ok: true, message: "PDF 편집 결과를 검증했습니다." };
    } catch (error) {
      return {
        ok: false,
        message: "PDF 편집 결과 검증 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async extractText(data: Uint8Array): Promise<string> {
    const pdfjs = await importRuntime("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument(createPdfjsDocumentOptions(new Uint8Array(data))).promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      pageTexts.push(
        textContent.items
          .map((item: { str?: string }) => item.str || "")
          .join(" ")
      );
    }

    return pageTexts.join("\n");
  }
}
