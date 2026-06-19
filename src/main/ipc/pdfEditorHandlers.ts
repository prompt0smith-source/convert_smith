import { ipcMain } from "electron";
import type { StartPdfEditorSavePayload } from "../types/conversion.js";
import { PathAccessRegistry } from "../services/PathAccessRegistry.js";
import { PdfEditorService } from "../services/PdfEditorService.js";

export function registerPdfEditorHandlers(service: PdfEditorService, pathAccess: PathAccessRegistry): void {
  ipcMain.handle("pdfEditor:getTextLayer", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("PDF 파일 경로가 올바르지 않습니다.");
    }
    return service.getTextLayer(pathAccess.assertAllowed(filePath));
  });

  ipcMain.handle("pdfEditor:saveTextEdits", async (_event, payload: StartPdfEditorSavePayload) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("PDF 편집 저장 요청이 올바르지 않습니다.");
    }
    const normalizedPayload: StartPdfEditorSavePayload = {
      ...payload,
      sourcePath: pathAccess.assertAllowed(payload.sourcePath)
    };
    const result = await service.saveTextEdits(normalizedPayload);
    pathAccess.registerPaths([result.outputPath]);
    return result;
  });
}
