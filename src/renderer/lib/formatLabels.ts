import type { ConversionType, FileItem } from "../../main/types/conversion";

export const conversionLabels: Record<ConversionType, string> = {
  pdf_to_docx: "PDF → Word / DOCX",
  docx_to_pdf: "Word / DOCX → PDF",
  images_to_pdf: "JPG / PNG → PDF",
  pdf_to_images: "PDF → JPG / PNG",
  heic_to_jpg: "HEIC → JPG",
  png_to_jpg: "PNG → JPG",
  jpg_to_png: "JPG → PNG",
  mp4_to_mp3: "MP4 → MP3",
  mov_to_mp4: "MOV → MP4",
  xlsx_to_pdf: "Excel / XLSX → PDF",
  video_compatibility_repair: "동영상 호환성 복구 MP4"
};

export const conversionDescriptions: Record<ConversionType, string> = {
  pdf_to_docx:
    "PDF 내용을 Word에서 열 수 있도록 DOCX로 변환합니다. 원본 레이아웃은 완벽히 유지되지 않을 수 있습니다.",
  docx_to_pdf: "문서 제출, 견적서, 계약서 공유용 PDF로 변환합니다.",
  images_to_pdf: "이미지 여러 장을 하나의 PDF 문서로 묶습니다.",
  pdf_to_images: "PDF 각 페이지를 이미지 파일로 추출합니다.",
  heic_to_jpg: "아이폰 사진을 윈도우와 웹에서 열기 쉬운 JPG로 변환합니다.",
  png_to_jpg: "투명 배경은 흰색으로 합쳐지고, 일반 JPG 이미지로 변환됩니다.",
  jpg_to_png:
    "JPG 이미지를 PNG 형식으로 변환합니다. 단, 배경이 자동으로 투명해지지는 않습니다.",
  mp4_to_mp3: "영상에서 소리만 추출해 MP3 파일로 저장합니다.",
  mov_to_mp4: "아이폰/카메라 MOV 영상을 호환성 높은 MP4로 변환합니다.",
  xlsx_to_pdf: "엑셀 견적서, 리스트, 정산표를 고정된 PDF 문서로 변환합니다.",
  video_compatibility_repair:
    "확장자는 MP4인데 재생이 안 되는 영상을 H.264 + AAC 방식의 호환 MP4로 다시 변환합니다."
};

export function getCommonConversions(items: FileItem[]): ConversionType[] {
  if (items.length === 0) return [];
  return items
    .map((item) => item.supportedConversions)
    .reduce((common, current) => common.filter((type) => current.includes(type)));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatDuration(seconds?: number): string {
  if (!seconds) return "-";
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
