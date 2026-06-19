export type ConversionType =
  | "pdf_to_docx"
  | "pdf_to_xlsx"
  | "docx_to_pdf"
  | "images_to_pdf"
  | "pdf_to_images"
  | "heic_to_jpg"
  | "heic_to_png"
  | "png_to_jpg"
  | "jpg_to_png"
  | "image_to_webp"
  | "jpg_optimize"
  | "png_optimize"
  | "webp_optimize"
  | "webp_to_jpg"
  | "webp_to_png"
  | "avif_to_jpg"
  | "avif_to_png"
  | "tiff_to_jpg"
  | "tiff_to_png"
  | "bmp_to_jpg"
  | "bmp_to_png"
  | "mp4_to_mp3"
  | "mov_to_mp4"
  | "webm_to_mp4"
  | "mkv_to_mp4"
  | "wav_to_mp3"
  | "flac_to_mp3"
  | "m4a_to_mp3"
  | "xlsx_to_pdf"
  | "xlsx_to_csv"
  | "pptx_to_pdf"
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
export type SortMode = "basic" | "custom" | "name" | "date" | "type" | "size";
export type ConvertMode = "batch" | "individual";
export type WorkMode = "convert" | "pdf_tools" | "pdf_editor";
export type FileKind = "pdf" | "word" | "excel" | "presentation" | "image" | "video" | "audio" | "other";

export type PdfToolType =
  | "pdf_merge"
  | "pdf_reorder"
  | "pdf_split_all"
  | "pdf_split_groups"
  | "pdf_rotate_pages"
  | "pdf_signature_stamp";

export type PdfRotation = 0 | 90 | 180 | 270;

export interface PdfSplitGroup {
  id: string;
  name: string;
  pages: number[];
}

export interface PdfSignatureStampPlacement {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent?: number;
  keepAspectRatio: boolean;
}

export interface PdfSignatureStampOptions {
  signatureImagePath: string;
  pages: number[];
  placement: PdfSignatureStampPlacement;
  opacity: number;
  flattenSignedPages: boolean;
  renderScale: 1 | 2 | 3;
}

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
  useDatedSubfolder?: boolean;
  outputName?: string;
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
  resultReport?: ConversionResultReport;
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

export interface PdfToolOptions {
  outputName?: string;
  pageOrder?: number[];
  pageRotations?: Record<number, PdfRotation>;
  splitGroups?: PdfSplitGroup[];
  signatureStamp?: PdfSignatureStampOptions;
  useDatedSubfolder?: boolean;
}

export interface StartPdfToolPayload {
  sourcePaths: string[];
  outputDir: string;
  toolType: PdfToolType;
  options: PdfToolOptions;
}

export interface PdfToolJob {
  id: string;
  sourcePaths: string[];
  outputDir: string;
  toolType: PdfToolType;
  status: ConversionStatus;
  progress: number;
  message: string;
  outputPaths: string[];
  error?: string;
  technicalDetails?: string;
  resultReport?: ConversionResultReport;
  createdAt: number;
  completedAt?: number;
  options: PdfToolOptions;
}

export type PdfEditorEditAction = "replace" | "delete" | "add";

export interface PdfEditorTextItem {
  id: string;
  pageNumber: number;
  sourceIndex?: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  color?: string;
}

export interface PdfEditorPageSize {
  pageNumber: number;
  width: number;
  height: number;
}

export interface PdfEditorTextLayer {
  path: string;
  name: string;
  pageCount: number;
  pageSizes: PdfEditorPageSize[];
  items: PdfEditorTextItem[];
}

export interface PdfEditorEdit {
  action: PdfEditorEditAction;
  pageNumber: number;
  originalText?: string;
  replacementText?: string;
  coverX?: number;
  coverY?: number;
  coverWidth?: number;
  coverHeight?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily?: string;
  color?: string;
}

export interface StartPdfEditorSavePayload {
  sourcePath: string;
  outputDir: string;
  outputName?: string;
  useDatedSubfolder?: boolean;
  edits: PdfEditorEdit[];
}

export type PdfEditorSaveMode = "native_text_edit" | "failed";

export interface PdfEditorSaveResult {
  outputPath: string;
  editedCount: number;
  deletedCount: number;
  addedCount: number;
  warnings: string[];
  mode: PdfEditorSaveMode;
}

export interface PdfEditorWindowOpenPayload {
  sourcePath: string;
  outputDir?: string;
  outputName?: string;
  useDatedSubfolder?: boolean;
}

export interface PdfEditorWindowContext extends PdfEditorWindowOpenPayload {
  token: string;
  sourceName: string;
}

export interface ConversionResultReport {
  sourceCount: number;
  outputCount: number;
  inputBytes: number;
  outputBytes: number;
  byteDelta: number;
  byteDeltaPercent: number;
  durationMs: number;
  validationPassed: boolean;
  validationMessages: string[];
}

export interface PdfDocumentInfo {
  path: string;
  name: string;
  pageCount: number;
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
