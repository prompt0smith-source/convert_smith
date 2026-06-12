export const helperMessages = {
  appSubtitle: "확장자만 바꾸지 않고, 실제로 열리는 파일로 변환합니다.",
  kakao:
    "카카오톡에서 받은 동영상이 확장자는 MP4인데 재생이 안 되는 경우, 내부 코덱 문제일 수 있습니다. 이 경우 '동영상 호환성 복구 MP4'를 사용하세요.",
  pdfToWord:
    "PDF → Word 변환은 원본 레이아웃이 100% 유지되지 않을 수 있습니다. 편집이 필요하면 '편집형', 모양 보존이 중요하면 '외형 보존형'을 선택하세요.",
  jpgToPng:
    "JPG에는 투명 배경 정보가 없으므로 PNG로 바꿔도 배경이 자동 제거되지는 않습니다.",
  libreOfficeMissing:
    "DOCX/XLSX → PDF 변환을 위해 LibreOffice가 필요합니다. 설정에서 LibreOffice 경로를 지정해주세요."
};

export function practicalError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "파일을 변환하지 못했습니다. 원본 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.";
}
