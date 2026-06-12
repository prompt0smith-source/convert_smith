import { ipcMain } from "electron";
import type { PdfToolJob, StartPdfToolPayload } from "../types/conversion.js";
import { PdfToolService } from "../services/PdfToolService.js";

export function registerPdfToolHandlers(service: PdfToolService): void {
  ipcMain.handle("pdfTool:getInfo", async (_event, filePath: unknown) => {
    if (typeof filePath !== "string") {
      throw new Error("PDF 파일 경로가 올바르지 않습니다.");
    }
    return service.getInfo(filePath);
  });

  ipcMain.handle("pdfTool:start", async (event, payload: StartPdfToolPayload) => {
    return service.run(payload, (job: PdfToolJob) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("pdfTool:jobUpdated", job);
      }
    });
  });
}
