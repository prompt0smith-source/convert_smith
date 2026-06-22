import type {
  ConversionJob,
  DependencyStatus,
  FilePreview,
  FileItem,
  PdfDocumentInfo,
  PdfEditorSaveResult,
  PdfEditorTextLayer,
  PdfEditorWindowContext,
  PdfEditorWindowOpenPayload,
  PdfToolJob,
  StartConversionPayload,
  StartPdfEditorSavePayload,
  StartPdfToolPayload,
  VideoInspection
} from "../main/types/conversion.js";
import type { ContextMenuLaunchRequest, ContextMenuStatus } from "../main/types/contextMenu.js";

export interface ConvertSmithApi {
  getDroppedFilePaths(files: File[]): string[];
  resolveDroppedFiles(paths: string[], dropIndexOffset?: number): Promise<FileItem[]>;
  resolveClipboardFiles(dropIndexOffset?: number, includeTextPaths?: boolean): Promise<FileItem[]>;
  selectFiles(): Promise<FileItem[]>;
  selectSignatureImage(): Promise<FileItem | null>;
  selectOutputDirectory(): Promise<string | null>;
  selectLibreOfficePath(): Promise<string | null>;
  openLibreOfficeDownloadPage(): Promise<{ ok: boolean; message: string }>;
  startConversion(payload: StartConversionPayload): Promise<ConversionJob>;
  cancelConversion(jobId: string): Promise<boolean>;
  getPdfInfo(path: string): Promise<PdfDocumentInfo>;
  startPdfTool(payload: StartPdfToolPayload): Promise<PdfToolJob>;
  getPdfEditorTextLayer(path: string): Promise<PdfEditorTextLayer>;
  savePdfEditorTextEdits(payload: StartPdfEditorSavePayload): Promise<PdfEditorSaveResult>;
  openPdfEditorWindow(payload: PdfEditorWindowOpenPayload): Promise<boolean>;
  getPdfEditorWindowContext(token: string): Promise<PdfEditorWindowContext>;
  inspectVideo(path: string): Promise<VideoInspection>;
  getDependencyStatus(libreOfficePath?: string): Promise<DependencyStatus>;
  getFilePreview(path: string, pageNumber?: number): Promise<FilePreview>;
  getNativePreviewUrl(path: string): Promise<string>;
  previewFile(path: string): Promise<{ ok: boolean; message: string }>;
  revealPath(path: string): Promise<{ ok: boolean; message: string }>;
  setFloatingEnabled(enabled: boolean): Promise<boolean>;
  getFloatingEnabled(): Promise<boolean>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  getAlwaysOnTop(): Promise<boolean>;
  showMainFromFloating(): Promise<boolean>;
  moveFloating(x: number, y: number): Promise<boolean>;
  getAppIconDataUrl(): Promise<string>;
  getContextMenuStatus(): Promise<ContextMenuStatus>;
  installContextMenu(): Promise<ContextMenuStatus>;
  uninstallContextMenu(): Promise<ContextMenuStatus>;
  getLaunchFiles(): Promise<ContextMenuLaunchRequest[]>;
  setCompactMode(enabled: boolean): Promise<boolean>;
  quitApp(): Promise<boolean>;
  onJobUpdate(listener: (job: ConversionJob) => void): () => void;
  onPdfToolUpdate(listener: (job: PdfToolJob) => void): () => void;
  onLaunchFiles(listener: (requests: ContextMenuLaunchRequest[]) => void): () => void;
}
