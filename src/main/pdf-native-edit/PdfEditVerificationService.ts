import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import type { PdfEditorEdit } from "../types/conversion.js";
import { readPdfDocumentContentStreams } from "./PdfContentStreamParser.js";
import { PdfEditVisualDiffService } from "./PdfEditVisualDiffService.js";

export interface PdfEditVerificationResult {
  ok: boolean;
  warnings: string[];
  message?: string;
}

export class PdfEditVerificationService {
  private readonly visualDiff = new PdfEditVisualDiffService();

  async verifyNativeTextEdit(sourcePath: string, outputPath: string, edits: PdfEditorEdit[]): Promise<PdfEditVerificationResult> {
    const warnings: string[] = [];
    const outputBytes = await readFile(outputPath);
    if (!outputBytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      return { ok: false, warnings, message: "PDF 편집 결과 검증에 실패했습니다. 결과 파일이 정상 PDF가 아닙니다." };
    }

    const pdfDoc = await PDFDocument.load(outputBytes, { ignoreEncryption: false });
    const contentStreams = readPdfDocumentContentStreams(pdfDoc).map((state) => state.content);
    if (contentStreams.some(hasSuspiciousWhiteRectangleCoverUp)) {
      return {
        ok: false,
        warnings,
        message: "PDF 편집 결과에서 시각적으로 덮어쓰기 의심 명령이 발견되어 저장을 중단했습니다."
      };
    }

    const visual = await this.visualDiff.compareEditedPages(sourcePath, outputPath, edits);
    warnings.push(`시각 검증: ${visual.message}`);
    if (!visual.ok) {
      return { ok: false, warnings, message: visual.message };
    }

    return { ok: true, warnings };
  }
}

function hasSuspiciousWhiteRectangleCoverUp(content: string): boolean {
  return /(?:^|\s)(?:1(?:\.0+)?\s+){3}rg[\s\S]{0,180}\bre\b[\s\S]{0,80}\bf\b/.test(content);
}
