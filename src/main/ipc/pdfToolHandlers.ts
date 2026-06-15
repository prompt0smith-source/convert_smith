import { ipcMain } from "electron";
import type { PdfToolJob, StartPdfToolPayload } from "../types/conversion.js";
import { PdfToolService } from "../services/PdfToolService.js";
import { PathAccessRegistry } from "../services/PathAccessRegistry.js";
import { PayloadValidationService } from "../services/PayloadValidationService.js";

export function registerPdfToolHandlers(service: PdfToolService, pathAccess: PathAccessRegistry): void {
  const payloadValidation = new PayloadValidationService();

  ipcMain.handle("pdfTool:getInfo", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("PDF 파일 경로가 올바르지 않습니다.");
    }
    return service.getInfo(pathAccess.assertAllowed(filePath));
  });

  ipcMain.handle("pdfTool:start", async (event, payload: StartPdfToolPayload) => {
    const normalizedPayload = payloadValidation.normalizePdfToolPayload(payload);
    const job = await service.run(normalizedPayload, (job: PdfToolJob) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("pdfTool:jobUpdated", job);
      }
    });
    if (job.status === "success") {
      pathAccess.registerPaths(job.outputPaths);
    }
    return job;
  });
}
