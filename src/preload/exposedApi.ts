import type {
  ConversionJob,
  DependencyStatus,
  FilePreview,
  FileItem,
  StartConversionPayload,
  VideoInspection
} from "../main/types/conversion.js";

export interface ConvertSmithApi {
  getDroppedFilePaths(files: File[]): string[];
  resolveDroppedFiles(paths: string[], dropIndexOffset?: number): Promise<FileItem[]>;
  selectFiles(): Promise<FileItem[]>;
  selectOutputDirectory(): Promise<string | null>;
  selectLibreOfficePath(): Promise<string | null>;
  openLibreOfficeDownloadPage(): Promise<{ ok: boolean; message: string }>;
  startConversion(payload: StartConversionPayload): Promise<ConversionJob>;
  cancelConversion(jobId: string): Promise<boolean>;
  inspectVideo(path: string): Promise<VideoInspection>;
  getDependencyStatus(libreOfficePath?: string): Promise<DependencyStatus>;
  getFilePreview(path: string): Promise<FilePreview>;
  previewFile(path: string): Promise<{ ok: boolean; message: string }>;
  revealPath(path: string): Promise<{ ok: boolean; message: string }>;
  onJobUpdate(listener: (job: ConversionJob) => void): () => void;
}
