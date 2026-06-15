export const helperMessages = {
  appSubtitle: "확장자만 바꾸지 않고, 실제로 열리는 파일로 변환합니다.",
  pdfToWord:
    "PDF → Word 변환은 원본 문서 구조와 편집 흐름이 100% 복원되지 않을 수 있습니다. '편집형'은 텍스트 편집을 우선하고, '외형 보존형'은 선택 가능한 텍스트와 PDF 이미지 객체를 최대한 분리해 배치합니다.",
  pdfToWordVisual:
    "외형 보존형은 PDF에서 드래그 선택 가능한 글자는 Word 텍스트로, PDF 내부 이미지 객체는 이미지로 분리합니다. 글 순서와 줄 순서는 최대한 보존하지만, 벡터 도형이나 복잡한 표 구조가 Word 객체로 100% 재구성되지는 않을 수 있습니다.",
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
