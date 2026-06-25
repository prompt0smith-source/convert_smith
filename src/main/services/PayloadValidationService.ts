import type {
  ConversionOptions,
  ConversionType,
  PdfImageFormat,
  PdfPageSize,
  PdfSplitGroup,
  PdfToolOptions,
  PdfToolType,
  PdfToDocxMode,
  GifResolution,
  SortMode,
  StartConversionPayload,
  StartPdfToolPayload
} from "../types/conversion.js";

const CONVERSION_TYPES: readonly ConversionType[] = [
  "pdf_to_docx",
  "pdf_to_xlsx",
  "docx_to_pdf",
  "images_to_pdf",
  "pdf_to_images",
  "heic_to_jpg",
  "heic_to_png",
  "png_to_jpg",
  "jpg_to_png",
  "image_to_webp",
  "jpg_optimize",
  "png_optimize",
  "webp_optimize",
  "webp_to_jpg",
  "webp_to_png",
  "avif_to_jpg",
  "avif_to_png",
  "tiff_to_jpg",
  "tiff_to_png",
  "bmp_to_jpg",
  "bmp_to_png",
  "mp4_to_mp3",
  "video_to_gif",
  "mov_to_mp4",
  "webm_to_mp4",
  "mkv_to_mp4",
  "wav_to_mp3",
  "flac_to_mp3",
  "m4a_to_mp3",
  "xlsx_to_pdf",
  "xlsx_to_csv",
  "pptx_to_pdf",
  "video_compatibility_repair"
];

const PDF_TOOL_TYPES: readonly PdfToolType[] = [
  "pdf_merge",
  "pdf_reorder",
  "pdf_split_all",
  "pdf_split_groups",
  "pdf_rotate_pages",
  "pdf_signature_stamp"
];

const PDF_IMAGE_FORMATS: readonly PdfImageFormat[] = ["jpg", "png"];
const PDF_PAGE_SIZES: readonly PdfPageSize[] = ["auto", "a4_portrait", "a4_landscape"];
const PDF_TO_DOCX_MODES: readonly PdfToDocxMode[] = ["editable_text", "visual_preservation"];
const GIF_RESOLUTIONS: readonly GifResolution[] = ["source", "720", "480", "360", "240"];
const SORT_MODES: readonly SortMode[] = ["basic", "custom", "name", "date", "type", "size"];
const ROTATIONS = new Set([0, 90, 180, 270]);
const MAX_SOURCE_PATHS = 200;
const MAX_PAGE_ITEMS = 5000;
const MAX_SPLIT_GROUPS = 200;
const MAX_GROUP_PAGES = 2000;
const MAX_OUTPUT_NAME_LENGTH = 120;
const DEFAULT_OPTIONS: ConversionOptions = {
  imageQuality: 90,
  pdfImageFormat: "jpg",
  pdfRenderScale: 2,
  pdfPageSize: "auto",
  pdfToDocxMode: "visual_preservation",
  gifResolution: "480",
  videoCompatibilityMode: true,
  overwritePolicy: "increment",
  sortMode: "basic",
  useDatedSubfolder: false
};

export class PayloadValidationService {
  normalizeConversionPayload(payload: unknown): StartConversionPayload {
    const raw = requirePlainObject(payload, "변환 요청 형식이 올바르지 않습니다.");
    const sourcePaths = normalizePathArray(raw.sourcePaths, "변환할 파일", MAX_SOURCE_PATHS);
    const outputDir = normalizePath(raw.outputDir, "저장 폴더 경로가 올바르지 않습니다.");
    const conversionType = normalizeEnum(
      raw.conversionType,
      CONVERSION_TYPES,
      "지원하지 않는 변환 형식입니다."
    );

    return {
      sourcePaths,
      outputDir,
      conversionType,
      options: normalizeConversionOptions(raw.options)
    };
  }

  normalizePdfToolPayload(payload: unknown): StartPdfToolPayload {
    const raw = requirePlainObject(payload, "PDF 작업 요청 형식이 올바르지 않습니다.");
    const sourcePaths = normalizePathArray(raw.sourcePaths, "PDF 파일", MAX_SOURCE_PATHS);
    const outputDir = normalizePath(raw.outputDir, "저장 폴더 경로가 올바르지 않습니다.");
    const toolType = normalizeEnum(raw.toolType, PDF_TOOL_TYPES, "지원하지 않는 PDF 작업입니다.");
    const options = normalizePdfToolOptions(raw.options);
    if (toolType === "pdf_signature_stamp" && !options.signatureStamp) {
      throw new Error("서명 이미지를 선택해주세요.");
    }

    return {
      sourcePaths,
      outputDir,
      toolType,
      options
    };
  }
}

function normalizeConversionOptions(value: unknown): ConversionOptions {
  const raw = isPlainObject(value) ? value : {};
  return {
    ...DEFAULT_OPTIONS,
    imageQuality: clampInteger(raw.imageQuality, 1, 100, 90),
    pdfImageFormat: normalizeEnum(raw.pdfImageFormat, PDF_IMAGE_FORMATS, "PDF 이미지 형식이 올바르지 않습니다.", "jpg"),
    pdfRenderScale: normalizeEnum(raw.pdfRenderScale, [1, 2, 3] as const, "PDF 렌더 배율이 올바르지 않습니다.", 2),
    pdfPageSize: normalizeEnum(raw.pdfPageSize, PDF_PAGE_SIZES, "PDF 페이지 크기 옵션이 올바르지 않습니다.", "auto"),
    pdfToDocxMode: normalizeEnum(
      raw.pdfToDocxMode,
      PDF_TO_DOCX_MODES,
      "PDF → Word 변환 모드가 올바르지 않습니다.",
      "visual_preservation"
    ),
    gifResolution: normalizeEnum(raw.gifResolution, GIF_RESOLUTIONS, "GIF 해상도 옵션이 올바르지 않습니다.", "480"),
    videoCompatibilityMode: typeof raw.videoCompatibilityMode === "boolean" ? raw.videoCompatibilityMode : true,
    overwritePolicy: "increment",
    sortMode: normalizeEnum(raw.sortMode, SORT_MODES, "정렬 옵션이 올바르지 않습니다.", "basic"),
    useDatedSubfolder: Boolean(raw.useDatedSubfolder),
    outputName: normalizeOptionalString(raw.outputName, MAX_OUTPUT_NAME_LENGTH),
    libreOfficePath: normalizeOptionalPath(raw.libreOfficePath)
  };
}

function normalizePdfToolOptions(value: unknown): PdfToolOptions {
  const raw = isPlainObject(value) ? value : {};
  return {
    outputName: normalizeOptionalString(raw.outputName, MAX_OUTPUT_NAME_LENGTH),
    pageOrder: normalizeIntegerArray(raw.pageOrder, "페이지 순서", MAX_PAGE_ITEMS),
    pageRotations: normalizePageRotations(raw.pageRotations),
    splitGroups: normalizeSplitGroups(raw.splitGroups),
    signatureStamp: normalizeSignatureStamp(raw.signatureStamp),
    useDatedSubfolder: Boolean(raw.useDatedSubfolder)
  };
}

function normalizeSignatureStamp(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const raw = requirePlainObject(value, "서명 스탬프 옵션이 올바르지 않습니다.");
  const signatureImagePath = normalizePath(raw.signatureImagePath, "서명 이미지를 선택해주세요.");
  const extension = signatureImagePath.split(".").pop()?.toLowerCase();
  if (!extension || !["png", "jpg", "jpeg"].includes(extension)) {
    throw new Error("PNG 또는 JPG 서명 이미지만 사용할 수 있습니다.");
  }
  const pages = normalizeIntegerArray(raw.pages, "서명 페이지", MAX_PAGE_ITEMS);
  if (!pages || pages.length === 0) {
    throw new Error("서명을 넣을 페이지를 선택해주세요.");
  }
  const placementRaw = requirePlainObject(raw.placement, "서명 위치 값이 올바르지 않습니다.");
  const keepAspectRatio =
    typeof placementRaw.keepAspectRatio === "boolean" ? placementRaw.keepAspectRatio : true;
  return {
    signatureImagePath,
    pages,
    placement: {
      xPercent: clampNumber(placementRaw.xPercent, 0, 100, "서명 위치 값이 올바르지 않습니다."),
      yPercent: clampNumber(placementRaw.yPercent, 0, 100, "서명 위치 값이 올바르지 않습니다."),
      widthPercent: clampNumber(placementRaw.widthPercent, 1, 100, "서명 위치 값이 올바르지 않습니다."),
      heightPercent:
        placementRaw.heightPercent === undefined || placementRaw.heightPercent === null
          ? undefined
          : clampNumber(placementRaw.heightPercent, 1, 100, "서명 위치 값이 올바르지 않습니다."),
      keepAspectRatio
    },
    opacity: clampNumber(raw.opacity, 0.1, 1, "서명 투명도 값이 올바르지 않습니다."),
    flattenSignedPages: typeof raw.flattenSignedPages === "boolean" ? raw.flattenSignedPages : false,
    renderScale: normalizeEnum(raw.renderScale, [1, 2, 3] as const, "서명 페이지 이미지화 배율이 올바르지 않습니다.", 2)
  };
}

function normalizePathArray(value: unknown, label: string, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} 목록이 비어 있습니다.`);
  }
  if (value.length > maxLength) {
    throw new Error(`${label}은 한 번에 최대 ${maxLength}개까지 처리할 수 있습니다.`);
  }
  return value.map((item) => normalizePath(item, `${label} 경로가 올바르지 않습니다.`));
}

function normalizePath(value: unknown, message: string): string {
  if (typeof value !== "string") throw new Error(message);
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0")) throw new Error(message);
  return trimmed;
}

function normalizeOptionalPath(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizePath(value, "LibreOffice 경로가 올바르지 않습니다.");
}

function normalizeOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error("출력 파일명이 올바르지 않습니다.");
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes("\0")) throw new Error("출력 파일명에 사용할 수 없는 문자가 포함되어 있습니다.");
  return trimmed.slice(0, maxLength);
}

function normalizeIntegerArray(value: unknown, label: string, maxLength: number): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} 값이 올바르지 않습니다.`);
  if (value.length > maxLength) throw new Error(`${label}은 최대 ${maxLength}개까지 처리할 수 있습니다.`);
  return value.map((item) => {
    const numberValue = Number(item);
    if (!Number.isInteger(numberValue) || !Number.isFinite(numberValue)) {
      throw new Error(`${label}에 올바르지 않은 페이지 번호가 있습니다.`);
    }
    return numberValue;
  });
}

function normalizePageRotations(value: unknown): Record<number, 0 | 90 | 180 | 270> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) throw new Error("페이지 회전 값이 올바르지 않습니다.");
  const result: Record<number, 0 | 90 | 180 | 270> = {};
  for (const [rawPage, rawRotation] of Object.entries(value)) {
    const page = Number(rawPage);
    const rotation = Number(rawRotation);
    if (!Number.isInteger(page) || page < 1 || !ROTATIONS.has(rotation)) {
      throw new Error("페이지 회전 값은 0, 90, 180, 270도만 사용할 수 있습니다.");
    }
    result[page] = rotation as 0 | 90 | 180 | 270;
  }
  return result;
}

function normalizeSplitGroups(value: unknown): PdfSplitGroup[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error("PDF 분할 그룹 값이 올바르지 않습니다.");
  if (value.length > MAX_SPLIT_GROUPS) {
    throw new Error(`PDF 분할 그룹은 최대 ${MAX_SPLIT_GROUPS}개까지 사용할 수 있습니다.`);
  }

  return value.map((item, index) => {
    const group = requirePlainObject(item, "PDF 분할 그룹 형식이 올바르지 않습니다.");
    return {
      id: normalizeOptionalString(group.id, 80) || `group_${index + 1}`,
      name: normalizeOptionalString(group.name, MAX_OUTPUT_NAME_LENGTH) || `group_${index + 1}`,
      pages: normalizeIntegerArray(group.pages, "그룹 페이지", MAX_GROUP_PAGES) || []
    };
  });
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || !Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function clampNumber(value: unknown, min: number, max: number, message: string): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < min || numberValue > max) {
    throw new Error(message);
  }
  return numberValue;
}

function normalizeEnum<T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  message: string,
  fallback?: T
): T {
  if (allowed.includes(value as T)) return value as T;
  if (fallback !== undefined) return fallback;
  throw new Error(message);
}

function requirePlainObject(value: unknown, message: string): Record<string, unknown> {
  if (!isPlainObject(value)) throw new Error(message);
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
