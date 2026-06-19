import { ipcMain } from "electron";
import type { StartPdfEditorSavePayload } from "../types/conversion.js";
import { PathAccessRegistry } from "../services/PathAccessRegistry.js";
import { PdfEditorService } from "../services/PdfEditorService.js";
import { DebugLogService } from "../services/DebugLogService.js";

export function registerPdfEditorHandlers(service: PdfEditorService, pathAccess: PathAccessRegistry): void {
  const debugLog = new DebugLogService();

  ipcMain.handle("pdfEditor:getTextLayer", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("PDF 파일 경로가 올바르지 않습니다.");
    }
    const sourcePath = pathAccess.assertAllowed(filePath);
    try {
      return await service.getTextLayer(sourcePath);
    } catch (error) {
      const logPath = await debugLog.write({
        scope: "pdf-editor",
        message: "PDF editor text layer extraction failed.",
        filePath: sourcePath,
        error
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(logPath ? `${message}\nDebug log: ${logPath}` : message);
    }
  });

  ipcMain.handle("pdfEditor:saveTextEdits", async (_event, payload: StartPdfEditorSavePayload) => {
    if (!payload || typeof payload !== "object") {
      throw new Error("PDF 편집 저장 요청이 올바르지 않습니다.");
    }
    const normalizedPayload: StartPdfEditorSavePayload = {
      ...payload,
      sourcePath: pathAccess.assertAllowed(payload.sourcePath)
    };
    try {
      const result = await service.saveTextEdits(normalizedPayload);
      pathAccess.registerPaths([result.outputPath]);
      return result;
    } catch (error) {
      const logPath = await debugLog.write({
        scope: "pdf-editor",
        message: "PDF editor save failed.",
        filePath: normalizedPayload.sourcePath,
        data: {
          outputDir: normalizedPayload.outputDir,
          outputName: normalizedPayload.outputName,
          editCount: normalizedPayload.edits.length
        },
        error
      });
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(logPath ? `${message}\nDebug log: ${logPath}` : message);
    }
  });
}
