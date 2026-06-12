export type ConversionType =
  | "pdf_to_docx"
  | "docx_to_pdf"
  | "images_to_pdf"
  | "pdf_to_images"
  | "heic_to_jpg"
  | "png_to_jpg"
  | "jpg_to_png"
  | "mp4_to_mp3"
  | "mov_to_mp4"
  | "xlsx_to_pdf"
  | "video_compatibility_repair";

export type ConversionStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled";

export type PdfPageSize = "auto" | "a4_portrait" | "a4_landscape";
export type PdfImageFormat = "jpg" | "png";
export type PdfToDocxMode = "editable_text" | "visual_preservation";
export type OverwritePolicy = "increment";
export type SortMode = "basic" | "name" | "date" | "type" | "size";
export type ConvertMode = "batch" | "individual";
export type FileKind = "pdf" | "word" | "excel" | "image" | "video" | "audio" | "other";

export interface ConversionOptions {
  imageQuality: number;
  pdfImageFormat: PdfImageFormat;
  pdfRenderScale: 1 | 2 | 3;
  pdfPageSize: PdfPageSize;
  pdfToDocxMode: PdfToDocxMode;
  videoCompatibilityMode: boolean;
  overwritePolicy: OverwritePolicy;
  libreOfficePath?: string;
  sortMode?: SortMode;
}

export interface ConversionJob {
  id: string;
  sourcePaths: string[];
  outputDir: string;
  conversionType: ConversionType;
  status: ConversionStatus;
  progress: number;
  message: string;
  outputPaths: string[];
  error?: string;
  technicalDetails?: string;
  createdAt: number;
  completedAt?: number;
  options: ConversionOptions;
}

export interface StartConversionPayload {
  sourcePaths: string[];
  outputDir: string;
  conversionType: ConversionType;
  options: ConversionOptions;
}

export interface FileItem {
  id: string;
  path: string;
  name: string;
  extension: string;
  size: number;
  modifiedAt: number;
  dropIndex: number;
  kind: FileKind;
  supportedConversions: ConversionType[];
}

export interface VideoInspection {
  path: string;
  extension: string;
  container?: string;
  videoCodec?: string;
  audioCodec?: string;
  pixelFormat?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  compatibilityMessage: string;
  warning?: string;
}

export interface FilePreview {
  path: string;
  name: string;
  extension: string;
  kind: FileKind;
  size: number;
  modifiedAt: number;
  previewType: "image" | "pdf_page" | "media_info" | "metadata";
  dataUrl?: string;
  message: string;
  details?: Record<string, string | number | boolean | undefined>;
}

export interface ConversionValidationResult {
  ok: boolean;
  message: string;
  technicalDetails?: string;
}

export interface DependencyStatus {
  ffmpeg: {
    available: boolean;
    path?: string;
  };
  ffprobe: {
    available: boolean;
    path?: string;
  };
  libreOffice: {
    available: boolean;
    path?: string;
    message: string;
  };
}
