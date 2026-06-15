import { FolderOpen } from "lucide-react";
import type {
  ConversionOptions,
  ConversionType,
  PdfImageFormat,
  PdfPageSize,
  PdfToDocxMode
} from "../../main/types/conversion";
import { helperMessages } from "../lib/koreanMessages";

interface OutputSettingsProps {
  outputDir?: string;
  sourceOutputDir?: string;
  useSourceFolder: boolean;
  selectedConversion?: ConversionType;
  options: ConversionOptions;
  onPickOutputDir: () => void;
  onUseSourceFolderChange: (value: boolean) => void;
  onOptionsChange: (options: ConversionOptions) => void;
}

const QUALITY_CONVERSIONS: ConversionType[] = [
  "heic_to_jpg",
  "png_to_jpg",
  "pdf_to_images",
  "image_to_webp",
  "jpg_optimize",
  "webp_optimize",
  "webp_to_jpg",
  "avif_to_jpg",
  "tiff_to_jpg",
  "bmp_to_jpg"
];

export function OutputSettings({
  outputDir,
  sourceOutputDir,
  useSourceFolder,
  selectedConversion,
  options,
  onPickOutputDir,
  onUseSourceFolderChange,
  onOptionsChange
}: OutputSettingsProps): JSX.Element {
  const update = (patch: Partial<ConversionOptions>) => onOptionsChange({ ...options, ...patch });
  const effectiveOutputDir = useSourceFolder ? sourceOutputDir : outputDir;

  return (
    <section className="border-b border-stone-200 bg-white p-4">
      <h2 className="mb-3 text-base font-semibold text-stone-900">저장 및 옵션</h2>
      <div className="space-y-4">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              checked={useSourceFolder}
              onChange={(event) => onUseSourceFolderChange(event.target.checked)}
              className="h-4 w-4 accent-emerald-700"
            />
            원본 파일이 있던 폴더에 저장
          </label>
          <button
            type="button"
            onClick={onPickOutputDir}
            className="flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-md border border-stone-300 bg-stone-50 px-3 text-left text-sm text-stone-800 hover:bg-stone-100"
          >
            <span className="truncate">
              {effectiveOutputDir || (useSourceFolder ? "원본 파일 폴더 감지 대기" : "저장할 폴더 선택")}
            </span>
            <FolderOpen size={16} />
          </button>
          {!useSourceFolder && outputDir && (
            <p className="text-xs text-stone-500">직접 지정한 폴더는 다음 실행에서도 기억합니다.</p>
          )}
          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              checked={Boolean(options.useDatedSubfolder)}
              onChange={(event) => update({ useDatedSubfolder: event.target.checked })}
              className="h-4 w-4 accent-emerald-700"
            />
            날짜별 하위 폴더를 만들어 저장
          </label>
          <p className="text-xs leading-5 text-stone-500">
            끄면 선택한 폴더에 바로 저장합니다. 켜면 YYYY-MM-DD 폴더 안에 저장합니다.
          </p>
        </div>

        {selectedConversion && QUALITY_CONVERSIONS.includes(selectedConversion) && (
          <label className="block text-sm font-medium text-stone-700">
            품질 {options.imageQuality}
            <input
              type="range"
              min={50}
              max={100}
              value={options.imageQuality}
              onChange={(event) => update({ imageQuality: Number(event.target.value) })}
              className="mt-2 w-full accent-emerald-700"
            />
          </label>
        )}

        {selectedConversion === "images_to_pdf" && (
          <label className="block text-sm font-medium text-stone-700">
            PDF 페이지 크기
            <select
              value={options.pdfPageSize}
              onChange={(event) => update({ pdfPageSize: event.target.value as PdfPageSize })}
              className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-sm"
            >
              <option value="auto">이미지에 맞춤</option>
              <option value="a4_portrait">A4 세로</option>
              <option value="a4_landscape">A4 가로</option>
            </select>
          </label>
        )}

        {selectedConversion === "pdf_to_images" && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm font-medium text-stone-700">
              이미지 형식
              <select
                value={options.pdfImageFormat}
                onChange={(event) => update({ pdfImageFormat: event.target.value as PdfImageFormat })}
                className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-sm"
              >
                <option value="jpg">JPG</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-stone-700">
              렌더 배율
              <select
                value={options.pdfRenderScale}
                onChange={(event) => update({ pdfRenderScale: Number(event.target.value) as 1 | 2 | 3 })}
                className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-sm"
              >
                <option value={1}>1x</option>
                <option value={2}>2x</option>
                <option value={3}>3x</option>
              </select>
            </label>
          </div>
        )}

        {selectedConversion === "pdf_to_docx" && (
          <div className="space-y-2">
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
              {helperMessages.pdfToWord}
            </p>
            <select
              value={options.pdfToDocxMode}
              onChange={(event) => update({ pdfToDocxMode: event.target.value as PdfToDocxMode })}
              className="h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-sm"
            >
              <option value="visual_preservation">외형 보존형</option>
              <option value="editable_text">편집형</option>
            </select>
            {options.pdfToDocxMode === "visual_preservation" && (
              <p className="rounded-md bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-700">
                {helperMessages.pdfToWordVisual}
              </p>
            )}
          </div>
        )}

        {selectedConversion === "jpg_to_png" && (
          <p className="rounded-md bg-stone-100 px-3 py-2 text-sm leading-6 text-stone-700">
            {helperMessages.jpgToPng}
          </p>
        )}

        {selectedConversion === "xlsx_to_csv" && (
          <p className="rounded-md bg-stone-100 px-3 py-2 text-sm leading-6 text-stone-700">
            CSV는 데이터 중심 형식입니다. 글꼴, 색상, 셀 병합 같은 엑셀 서식은 유지되지 않습니다.
          </p>
        )}
      </div>
    </section>
  );
}
