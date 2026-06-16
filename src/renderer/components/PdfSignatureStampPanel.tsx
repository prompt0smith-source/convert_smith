import { ImagePlus } from "lucide-react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { FileItem, PdfDocumentInfo, PdfSignatureStampOptions } from "../../main/types/conversion";

type PageMode = "current" | "all" | "custom";

interface PdfSignatureStampPanelProps {
  selectedPdf: FileItem;
  info?: PdfDocumentInfo;
  selectedPage: number;
  options?: PdfSignatureStampOptions;
  onOptionsChange: (options?: PdfSignatureStampOptions) => void;
  onPagePreviewChange: (page: number) => void;
  onNotice: (message?: string) => void;
}

const DEFAULT_PLACEMENT = {
  xPercent: 60,
  yPercent: 70,
  widthPercent: 25,
  keepAspectRatio: true
};

export function PdfSignatureStampPanel({
  selectedPdf,
  info,
  selectedPage,
  options,
  onOptionsChange,
  onPagePreviewChange,
  onNotice
}: PdfSignatureStampPanelProps): JSX.Element {
  const [pageMode, setPageMode] = useState<PageMode>("current");
  const [customPages, setCustomPages] = useState("");
  const pageCount = Math.max(1, info?.pageCount || 1);
  const disabled = !options;

  useEffect(() => {
    if (!options || pageMode !== "current") return;
    onOptionsChange({ ...options, pages: [selectedPage] });
  }, [selectedPage]);

  const selectSignatureImage = async () => {
    try {
      const image = await window.convertSmith.selectSignatureImage();
      if (!image) return;
      onOptionsChange({
        signatureImagePath: image.path,
        pages: [selectedPage],
        placement: DEFAULT_PLACEMENT,
        opacity: 0.9,
        flattenSignedPages: true,
        renderScale: 2
      });
      setPageMode("current");
      onNotice(undefined);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "서명 이미지를 선택하지 못했습니다.");
    }
  };

  const update = (patch: Partial<PdfSignatureStampOptions>) => {
    if (!options) return;
    onOptionsChange({ ...options, ...patch });
  };

  const updatePlacement = (patch: Partial<PdfSignatureStampOptions["placement"]>) => {
    if (!options) return;
    onOptionsChange({
      ...options,
      placement: {
        ...options.placement,
        ...patch
      }
    });
  };

  const applyPageMode = (nextMode: PageMode, nextCustomPages = customPages) => {
    setPageMode(nextMode);
    if (!options) return;
    if (nextMode === "current") {
      update({ pages: [selectedPage] });
      return;
    }
    if (nextMode === "all") {
      update({ pages: Array.from({ length: pageCount }, (_, index) => index + 1) });
      return;
    }
    const parsed = parsePageRanges(nextCustomPages, pageCount);
    if (!parsed) {
      onNotice("선택한 페이지 범위가 PDF 페이지 수를 벗어났습니다.");
      return;
    }
    update({ pages: parsed });
    if (parsed[0]) onPagePreviewChange(parsed[0]);
  };

  const previewHeight = options?.placement.keepAspectRatio
    ? Math.max(8, options.placement.widthPercent * 0.35)
    : options?.placement.heightPercent || 12;

  return (
    <section className="border-b border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-stone-900">서명 스탬프 추가</h3>
          <p className="mt-1 text-xs leading-5 text-stone-500">
            이 기능은 서명 이미지를 PDF에 시각적으로 삽입하는 기능입니다. 인증서 기반의 법적 디지털 서명은 아닙니다.
          </p>
        </div>
        <button
          type="button"
          onClick={selectSignatureImage}
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
        >
          <ImagePlus size={15} />
          이미지 선택
        </button>
      </div>

      <div className="mb-3 rounded-md bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600">
        <p className="truncate">PDF: {selectedPdf.name}</p>
        <p className="truncate">서명 이미지: {options ? fileNameFromPath(options.signatureImagePath) : "선택 필요"}</p>
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold text-stone-700">페이지</p>
          <div className="grid grid-cols-3 gap-2">
            <PageModeButton active={pageMode === "current"} onClick={() => applyPageMode("current")} disabled={disabled}>
              현재
            </PageModeButton>
            <PageModeButton active={pageMode === "all"} onClick={() => applyPageMode("all")} disabled={disabled}>
              전체
            </PageModeButton>
            <PageModeButton active={pageMode === "custom"} onClick={() => applyPageMode("custom")} disabled={disabled}>
              직접
            </PageModeButton>
          </div>
          {pageMode === "custom" && (
            <input
              type="text"
              value={customPages}
              disabled={disabled}
              placeholder="1,3,5-7"
              onChange={(event) => {
                setCustomPages(event.target.value);
                applyPageMode("custom", event.target.value);
              }}
              className="mt-2 h-9 w-full rounded-md border border-stone-300 px-2 text-sm disabled:bg-stone-100"
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberControl label="X %" value={options?.placement.xPercent ?? 60} disabled={disabled} onChange={(value) => updatePlacement({ xPercent: value })} />
          <NumberControl label="Y %" value={options?.placement.yPercent ?? 70} disabled={disabled} onChange={(value) => updatePlacement({ yPercent: value })} />
          <RangeControl label="너비 %" min={1} max={80} value={options?.placement.widthPercent ?? 25} disabled={disabled} onChange={(value) => updatePlacement({ widthPercent: value })} />
          <RangeControl label="투명도" min={10} max={100} value={Math.round((options?.opacity ?? 0.9) * 100)} disabled={disabled} onChange={(value) => update({ opacity: value / 100 })} />
        </div>

        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={options?.placement.keepAspectRatio ?? true}
            disabled={disabled}
            onChange={(event) => updatePlacement({ keepAspectRatio: event.target.checked })}
            className="h-4 w-4 accent-emerald-700"
          />
          서명 이미지 비율 유지
        </label>

        {!options?.placement.keepAspectRatio && (
          <RangeControl
            label="높이 %"
            min={1}
            max={80}
            value={options?.placement.heightPercent ?? 12}
            disabled={disabled}
            onChange={(value) => updatePlacement({ heightPercent: value })}
          />
        )}

        <label className="flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={options?.flattenSignedPages ?? true}
            disabled={disabled}
            onChange={(event) => update({ flattenSignedPages: event.target.checked })}
            className="mt-0.5 h-4 w-4 accent-emerald-700"
          />
          <span>
            <span className="block font-medium">서명된 페이지를 이미지형 페이지로 저장</span>
            <span className="block text-xs leading-5 text-stone-500">
              서명된 페이지를 이미지형 페이지로 저장하여 일반적인 PDF 편집이 어렵게 만듭니다.
            </span>
          </span>
        </label>

        {options?.flattenSignedPages && (
          <label className="block text-sm font-medium text-stone-700">
            이미지화 배율
            <select
              value={options.renderScale}
              disabled={disabled}
              onChange={(event) => update({ renderScale: Number(event.target.value) as 1 | 2 | 3 })}
              className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-2 text-sm disabled:bg-stone-100"
            >
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={3}>3x</option>
            </select>
          </label>
        )}

        <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 p-3">
          <p className="mb-2 text-xs font-semibold text-stone-600">위치 미리보기</p>
          <div className="relative mx-auto aspect-[3/4] w-full max-w-[180px] overflow-hidden rounded-sm border border-stone-300 bg-white">
            {options && (
              <div
                className="absolute rounded border-2 border-emerald-500 bg-emerald-200/30"
                style={{
                  left: `${options.placement.xPercent}%`,
                  top: `${options.placement.yPercent}%`,
                  width: `${options.placement.widthPercent}%`,
                  height: `${previewHeight}%`,
                  opacity: Math.max(0.25, options.opacity)
                }}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function PageModeButton({
  active,
  disabled,
  onClick,
  children
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "h-8 rounded-md border px-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50",
        active ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white text-stone-600"
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function NumberControl({
  label,
  value,
  disabled,
  onChange
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="block text-xs font-semibold text-stone-700">
      {label}
      <input
        type="number"
        min={0}
        max={100}
        value={Math.round(value)}
        disabled={disabled}
        onChange={(event) => onChange(clampPercent(Number(event.target.value)))}
        className="mt-1 h-9 w-full rounded-md border border-stone-300 px-2 text-sm disabled:bg-stone-100"
      />
    </label>
  );
}

function RangeControl({
  label,
  min,
  max,
  value,
  disabled,
  onChange
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}): JSX.Element {
  return (
    <label className="block text-xs font-semibold text-stone-700">
      {label} {Math.round(value)}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-emerald-700 disabled:opacity-50"
      />
    </label>
  );
}

function parsePageRanges(value: string, pageCount: number): number[] | null {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const token = part.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pageCount) return null;
      for (let page = start; page <= end; page += 1) pages.add(page);
      continue;
    }
    const page = Number(token);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) return null;
    pages.add(page);
  }
  return pages.size > 0 ? [...pages] : null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}
