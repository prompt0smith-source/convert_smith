import { ipcMain } from "electron";
import type { StartPdfEditorSavePayload } from "../types/conversion.js";
import { PathAccessRegistry } from "../services/PathAccessRegistry.js";
import { PdfEditorService } from "../services/PdfEditorService.js";
import { DebugLogService } from "../services/DebugLogService.js";

const PDF_EDITOR_IPC_TIMEOUT_MS = 60000;

export function registerPdfEditorHandlers(service: PdfEditorService, pathAccess: PathAccessRegistry): void {
  const debugLog = new DebugLogService();

  ipcMain.handle("pdfEditor:getTextLayer", async (_event, filePath: unknown) => {
    let sourcePath = "";
    try {
      if (typeof filePath !== "string") {
        throw new Error("PDF 파일 경로가 올바르지 않습니다.");
      }
      sourcePath = pathAccess.assertAllowed(filePath);
      return await withIpcTimeout(
        service.getTextLayer(sourcePath),
        PDF_EDITOR_IPC_TIMEOUT_MS,
        "PDF 분석 시간이 오래 걸려 Viewer를 열지 못했습니다. 파일이 매우 복잡하거나 손상되었을 수 있습니다."
      );
    } catch (error) {
      const logPath = await debugLog.write({
        scope: "pdf-editor",
        message: "PDF editor text layer extraction failed.",
        filePath: sourcePath || (typeof filePath === "string" ? filePath : undefined),
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

function withIpcTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}
