import { ArrowRight, SplitSquareHorizontal } from "lucide-react";
import type { ConversionType, ConvertMode, FileItem } from "../../main/types/conversion";
import { conversionDescriptions, conversionLabels, getCommonConversions } from "../lib/formatLabels";

interface ConversionTypeSelectorProps {
  files: FileItem[];
  displayFiles: FileItem[];
  convertMode: ConvertMode;
  batchConversionType?: ConversionType;
  individualTargets: Record<string, ConversionType>;
  onConvertModeChange: (mode: ConvertMode) => void;
  onBatchConversionTypeChange: (type: ConversionType) => void;
  onIndividualTargetChange: (id: string, type: ConversionType) => void;
}

export function ConversionTypeSelector({
  files,
  displayFiles,
  convertMode,
  batchConversionType,
  individualTargets,
  onConvertModeChange,
  onBatchConversionTypeChange,
  onIndividualTargetChange
}: ConversionTypeSelectorProps): JSX.Element {
  const commonConversions = getCommonConversions(files);
  const selectedDescription = batchConversionType
    ? conversionDescriptions[batchConversionType]
    : "선택한 파일에서 가능한 변환만 표시합니다.";

  return (
    <section className="border-b border-stone-200 bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-stone-900">변환 형식</h2>
        <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-stone-100 p-1 text-sm">
          <button
            type="button"
            onClick={() => onConvertModeChange("batch")}
            className={[
              "rounded px-3 py-1.5",
              convertMode === "batch" ? "bg-white font-semibold text-emerald-800 shadow-sm" : "text-stone-600"
            ].join(" ")}
          >
            전체
          </button>
          <button
            type="button"
            onClick={() => onConvertModeChange("individual")}
            className={[
              "rounded px-3 py-1.5",
              convertMode === "individual" ? "bg-white font-semibold text-emerald-800 shadow-sm" : "text-stone-600"
            ].join(" ")}
          >
            개별
          </button>
        </div>
      </div>

      {convertMode === "batch" ? (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-stone-700" htmlFor="batch-conversion">
            전체 파일 변환
          </label>
          <select
            id="batch-conversion"
            value={batchConversionType || ""}
            disabled={commonConversions.length === 0}
            onChange={(event) => onBatchConversionTypeChange(event.target.value as ConversionType)}
            className="h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-900 disabled:bg-stone-100 disabled:text-stone-400"
          >
            <option value="">변환 형식 선택</option>
            {commonConversions.map((type) => (
              <option key={type} value={type}>
                {conversionLabels[type]}
              </option>
            ))}
          </select>
          <p className="text-sm leading-6 text-stone-600">{selectedDescription}</p>
        </div>
      ) : (
        <div className="max-h-60 space-y-2 overflow-auto pr-1">
          {displayFiles.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[1fr_auto_220px] items-center gap-2 rounded-md border border-stone-200 bg-stone-50 p-2"
            >
              <span className="truncate text-sm text-stone-800">{item.name}</span>
              <ArrowRight size={16} className="text-emerald-700" />
              <select
                value={individualTargets[item.id] || item.supportedConversions[0] || ""}
                disabled={item.supportedConversions.length === 0}
                onChange={(event) => onIndividualTargetChange(item.id, event.target.value as ConversionType)}
                className="h-8 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900"
              >
                {item.supportedConversions.length === 0 ? (
                  <option value="">지원 불가</option>
                ) : (
                  item.supportedConversions.map((type) => (
                    <option key={type} value={type}>
                      {conversionLabels[type]}
                    </option>
                  ))
                )}
              </select>
            </div>
          ))}
        </div>
      )}

      {files.length > 1 && (
        <div className="mt-4 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <SplitSquareHorizontal size={16} />
          선택한 정렬 방식은 변환 순서와 결과 표시 순서에 반영됩니다.
        </div>
      )}
    </section>
  );
}
