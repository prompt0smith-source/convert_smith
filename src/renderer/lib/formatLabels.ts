import type { ConversionType, FileItem, PdfToolType } from "../../main/types/conversion";

export const conversionLabels: Record<ConversionType, string> = {
  pdf_to_docx: "PDF → Word / DOCX",
  pdf_to_xlsx: "PDF → Excel / XLSX",
  docx_to_pdf: "Word / DOCX → PDF",
  images_to_pdf: "이미지 → PDF",
  pdf_to_images: "PDF → JPG / PNG",
  heic_to_jpg: "HEIC → JPG",
  heic_to_png: "HEIC → PNG",
  png_to_jpg: "PNG → JPG",
  jpg_to_png: "JPG → PNG",
  image_to_webp: "JPG / PNG → WEBP",
  jpg_optimize: "이미지 용량 최적화 (JPG)",
  png_optimize: "이미지 용량 최적화 (PNG)",
  webp_optimize: "웹 업로드용 이미지 최적화",
  webp_to_jpg: "WEBP → JPG",
  webp_to_png: "WEBP → PNG",
  avif_to_jpg: "AVIF → JPG",
  avif_to_png: "AVIF → PNG",
  tiff_to_jpg: "TIFF → JPG",
  tiff_to_png: "TIFF → PNG",
  bmp_to_jpg: "BMP → JPG",
  bmp_to_png: "BMP → PNG",
  mp4_to_mp3: "MP4 → MP3",
  video_to_gif: "영상 → GIF",
  mov_to_mp4: "MOV → MP4",
  webm_to_mp4: "WEBM → MP4",
  mkv_to_mp4: "MKV → MP4",
  wav_to_mp3: "WAV → MP3",
  flac_to_mp3: "FLAC → MP3",
  m4a_to_mp3: "M4A → MP3",
  xlsx_to_pdf: "Excel / XLSX → PDF",
  xlsx_to_csv: "Excel / XLSX → CSV",
  pptx_to_pdf: "PowerPoint / PPTX → PDF",
  video_compatibility_repair: "동영상 호환성 복구 MP4"
};

export const conversionDescriptions: Record<ConversionType, string> = {
  pdf_to_docx:
    "PDF 내용을 Word에서 열 수 있도록 DOCX로 변환합니다. 원본 레이아웃은 완벽히 유지되지 않을 수 있습니다.",
  pdf_to_xlsx:
    "PDF에 보이는 표와 텍스트 위치를 분석해 엑셀에서 편집 가능한 XLSX로 재구성합니다. 수식, 필터, 숨김 시트는 복원되지 않을 수 있습니다.",
  docx_to_pdf: "문서 제출, 견적서, 계약서 공유용 PDF로 변환합니다.",
  images_to_pdf: "이미지 여러 장을 하나의 PDF 문서로 묶습니다. JPG, PNG, WEBP, AVIF, TIFF, BMP를 지원합니다.",
  pdf_to_images: "PDF 각 페이지를 이미지 파일로 추출합니다.",
  heic_to_jpg: "아이폰 사진을 윈도우와 웹에서 열기 쉬운 JPG로 변환합니다.",
  heic_to_png: "HEIC 사진을 PNG 형식으로 변환합니다. HEVC 저장 인코더는 필요하지 않습니다.",
  png_to_jpg: "투명 배경은 흰색으로 합쳐지고, 일반 JPG 이미지로 변환됩니다.",
  jpg_to_png: "JPG 이미지를 PNG 형식으로 변환합니다. 단, 배경이 자동으로 투명해지지는 않습니다.",
  image_to_webp: "JPG 또는 PNG 이미지를 웹에 올리기 좋은 WEBP 파일로 다시 인코딩합니다.",
  jpg_optimize: "JPG 형식은 유지하면서 웹 업로드와 공유에 맞게 용량을 줄인 새 JPG 파일을 만듭니다.",
  png_optimize: "PNG 형식은 유지하면서 압축 설정을 높여 새 PNG 파일을 만듭니다. 투명 정보는 유지합니다.",
  webp_optimize: "WEBP 형식은 유지하면서 웹 업로드용으로 다시 압축한 새 WEBP 파일을 만듭니다.",
  webp_to_jpg: "WEBP 이미지를 일반 프로그램에서 열기 쉬운 JPG로 변환합니다. 투명 영역은 흰색으로 합성합니다.",
  webp_to_png: "WEBP 이미지를 PNG로 변환합니다. 투명 정보가 있으면 유지합니다.",
  avif_to_jpg: "AVIF 이미지를 호환성이 높은 JPG로 변환합니다.",
  avif_to_png: "AVIF 이미지를 PNG로 변환합니다.",
  tiff_to_jpg: "스캔 이미지나 인쇄용 TIFF를 일반 JPG로 변환합니다.",
  tiff_to_png: "TIFF 이미지를 PNG로 변환합니다.",
  bmp_to_jpg: "BMP 이미지를 용량이 작은 JPG로 변환합니다.",
  bmp_to_png: "BMP 이미지를 PNG로 변환합니다.",
  mp4_to_mp3: "영상에서 소리만 추출해 MP3 파일로 저장합니다.",
  video_to_gif: "영상 파일을 움직이는 GIF로 변환합니다. GIF 전용 해상도를 선택할 수 있습니다.",
  mov_to_mp4: "아이폰/카메라 MOV 영상을 호환성 높은 MP4로 변환합니다.",
  webm_to_mp4: "WEBM 영상을 H.264 + AAC 방식의 호환 MP4로 변환합니다.",
  mkv_to_mp4: "MKV 영상을 일반 플레이어에서 열기 쉬운 MP4로 변환합니다.",
  wav_to_mp3: "WAV 오디오를 MP3로 압축 변환합니다.",
  flac_to_mp3: "FLAC 오디오를 MP3로 변환합니다.",
  m4a_to_mp3: "M4A 오디오를 MP3로 변환합니다.",
  xlsx_to_pdf: "엑셀 견적서, 리스트, 정산표를 고정된 PDF 문서로 변환합니다.",
  xlsx_to_csv: "엑셀 표 데이터를 CSV 파일로 내보냅니다. 서식은 유지되지 않고 데이터 중심으로 변환됩니다.",
  pptx_to_pdf: "PowerPoint 발표 자료를 공유하기 쉬운 PDF로 변환합니다.",
  video_compatibility_repair:
    "확장자는 MP4인데 재생이 안 되는 영상을 H.264 + AAC 방식의 호환 MP4로 다시 변환합니다."
};

export const pdfToolLabels: Record<PdfToolType, string> = {
  pdf_merge: "PDF 병합",
  pdf_reorder: "PDF 페이지 정렬",
  pdf_split_all: "PDF 전체 분할",
  pdf_split_groups: "PDF 선택 그룹 분할",
  pdf_rotate_pages: "PDF 페이지 회전",
  pdf_signature_stamp: "서명 스탬프 추가"
};

export const pdfToolDescriptions: Record<PdfToolType, string> = {
  pdf_merge: "여러 PDF를 현재 정렬 순서대로 하나의 PDF로 합칩니다.",
  pdf_reorder: "선택한 PDF의 페이지 순서를 바꿔 새 PDF로 저장합니다.",
  pdf_split_all: "선택한 PDF를 페이지마다 개별 PDF로 나눕니다.",
  pdf_split_groups: "원하는 페이지 묶음별로 PDF를 나눠 저장합니다.",
  pdf_rotate_pages: "선택한 PDF 페이지의 회전 상태를 적용한 새 PDF로 저장합니다.",
  pdf_signature_stamp:
    "서명 이미지를 PDF에 시각적으로 삽입합니다. 인증서 기반의 법적 디지털 서명은 아닙니다."
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
