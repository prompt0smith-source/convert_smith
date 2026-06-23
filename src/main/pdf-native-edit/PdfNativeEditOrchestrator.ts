import type { PDFDocument } from "pdf-lib";
import type { PdfEditorEdit } from "../types/conversion.js";
import { PdfDirectTextEditService } from "../services/PdfDirectTextEditService.js";

export interface PdfReplacementFontInsertion {
  edit: PdfEditorEdit;
  reason: string;
}

export interface PdfNativeEditResult {
  replacedCount: number;
  deletedCount: number;
  replacementFontInsertions: PdfReplacementFontInsertion[];
  warnings: string[];
}

export class PdfNativeEditOrchestrator {
  private readonly directTextEditor = new PdfDirectTextEditService();

  applyTextEdits(pdfDoc: PDFDocument, edits: PdfEditorEdit[]): PdfNativeEditResult {
    const result: PdfNativeEditResult = {
      replacedCount: 0,
      deletedCount: 0,
      replacementFontInsertions: [],
      warnings: []
    };

    for (const edit of edits) {
      if (edit.action === "delete") {
        this.directTextEditor.apply(pdfDoc, [edit]);
        result.deletedCount += 1;
        continue;
      }

      if (edit.action !== "replace") continue;
      const replacement = (edit.replacementText || "").normalize("NFC");
      if (!replacement) {
        this.directTextEditor.apply(pdfDoc, [{ ...edit, action: "delete", replacementText: "" }]);
        result.deletedCount += 1;
        continue;
      }

      try {
        this.directTextEditor.apply(pdfDoc, [edit]);
        result.replacedCount += 1;
      } catch (directError) {
        this.directTextEditor.apply(pdfDoc, [{ ...edit, action: "delete", replacementText: "" }]);
        result.deletedCount += 1;
        result.replacementFontInsertions.push({
          edit,
          reason: directError instanceof Error ? directError.message : String(directError)
        });
        result.warnings.push(
          "원본 PDF 글꼴로 새 문자를 직접 표현할 수 없어, 원본 텍스트 명령을 비우고 로컬 글꼴을 임베드한 실제 PDF 텍스트 객체로 저장합니다."
        );
      }
    }

    return {
      ...result,
      warnings: Array.from(new Set(result.warnings))
    };
  }
}
