import { Copy, ExternalLink, FolderOpen, GripVertical, Layers, Scissors, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import type {
  FileItem,
  PdfDocumentInfo,
  PdfRotation,
  PdfSplitGroup,
  PdfToolJob,
  PdfToolType
} from "../../main/types/conversion";
import { formatBytes, pdfToolDescriptions, pdfToolLabels } from "../lib/formatLabels";

interface PdfToolsPanelProps {
  displayFiles: FileItem[];
  selectedFile?: FileItem;
  outputDir?: string;
  sourceOutputDir?: string;
  useSourceFolder: boolean;
  useDatedSubfolder: boolean;
  toolType: PdfToolType;
  outputName: string;
  selectedPage: number;
  pageOrder: number[];
  pageRotations: Record<number, PdfRotation>;
  splitGroups: PdfSplitGroup[];
  pdfToolJobs: PdfToolJob[];
  onSelectFile: (item: FileItem) => void;
  onToolTypeChange: (type: PdfToolType) => void;
  onOutputNameChange: (value: string) => void;
  onPagePreviewChange: (page: number) => void;
  onPageOrderChange: (pages: number[]) => void;
  onPageRotationsChange: (rotations: Record<number, PdfRotation>) => void;
  onSplitGroupsChange: (groups: PdfSplitGroup[]) => void;
  onPickOutputDir: () => void;
  onUseSourceFolderChange: (value: boolean) => void;
  onUseDatedSubfolderChange: (value: boolean) => void;
  onOpenPath: (path: string) => void;
  onReveal: (path: string) => void;
  onCopy: (path: string) => void;
  onNotice: (message?: string) => void;
}

const TOOL_TYPES: PdfToolType[] = [
  "pdf_merge",
  "pdf_reorder",
  "pdf_split_all",
  "pdf_split_groups"
];

const INTERNAL_PAGE_DRAG_TYPE = "application/x-convert-smith-page";

export function PdfToolsPanel({
  displayFiles,
  selectedFile,
  outputDir,
  sourceOutputDir,
  useSourceFolder,
  useDatedSubfolder,
  toolType,
  outputName,
  selectedPage,
  pageOrder,
  pageRotations,
  splitGroups,
  pdfToolJobs,
  onSelectFile,
  onToolTypeChange,
  onOutputNameChange,
  onPagePreviewChange,
  onPageOrderChange,
  onPageRotationsChange,
  onSplitGroupsChange,
  onPickOutputDir,
  onUseSourceFolderChange,
  onUseDatedSubfolderChange,
  onOpenPath,
  onReveal,
  onCopy,
  onNotice
}: PdfToolsPanelProps): JSX.Element {
  const pdfFiles = useMemo(() => displayFiles.filter((file) => file.extension === ".pdf"), [displayFiles]);
  const selectedPdf = selectedFile?.extension === ".pdf" ? selectedFile : pdfFiles[0];
  const [info, setInfo] = useState<PdfDocumentInfo>();
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");
  const [dragPage, setDragPage] = useState<number | null>(null);
  const [dropTargetPage, setDropTargetPage] = useState<number | null>(null);
  const effectiveOutputDir = useSourceFolder ? sourceOutputDir : outputDir;
  const latestJob = pdfToolJobs[0];

  useEffect(() => {
    let cancelled = false;
    setInfo(undefined);
    setSelectedPages([]);
    if (!selectedPdf) return undefined;

    window.convertSmith
      .getPdfInfo(selectedPdf.path)
      .then((nextInfo) => {
        if (cancelled) return;
        setInfo(nextInfo);
        const defaultOrder = Array.from({ length: nextInfo.pageCount }, (_, index) => index + 1);
        onPageOrderChange(defaultOrder);
        onPageRotationsChange({});
        onSplitGroupsChange([]);
        onPagePreviewChange(1);
      })
      .catch((error: unknown) => {
        if (!cancelled) onNotice(error instanceof Error ? error.message : "PDF 정보를 읽지 못했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPdf?.path]);

  const activeOrder = pageOrder.length ? pageOrder : Array.from({ length: info?.pageCount || 0 }, (_, index) => index + 1);

  const movePage = (page: number, targetPage: number) => {
    if (page === targetPage) return;
    const next = activeOrder.filter((item) => item !== page);
    const targetIndex = next.indexOf(targetPage);
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, page);
    onPageOrderChange(next);
  };

  const reversePages = () => onPageOrderChange([...activeOrder].reverse());

  const toggleSelectedPage = (page: number) => {
    setSelectedPages((current) =>
      current.includes(page) ? current.filter((item) => item !== page) : [...current, page].sort((a, b) => a - b)
    );
  };

  const addGroup = () => {
    if (selectedPages.length === 0) {
      onNotice("그룹에 넣을 페이지를 먼저 선택해주세요.");
      return;
    }
    const nextIndex = splitGroups.length + 1;
    onSplitGroupsChange([
      ...splitGroups,
      {
        id: `group-${Date.now()}-${nextIndex}`,
        name: groupName.trim() || `group_${nextIndex}`,
        pages: selectedPages
      }
    ]);
    setGroupName("");
    setSelectedPages([]);
  };

  const removeGroup = (id: string) => {
    onSplitGroupsChange(splitGroups.filter((group) => group.id !== id));
  };

  const startPageDrag = (event: DragEvent, page: number) => {
    if (toolType !== "pdf_reorder") return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(INTERNAL_PAGE_DRAG_TYPE, String(page));
    setDragPage(page);
  };

  const overPageDrag = (event: DragEvent, page: number) => {
    if (toolType !== "pdf_reorder" || !event.dataTransfer.types.includes(INTERNAL_PAGE_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setDropTargetPage(page);
  };

  const dropPageDrag = (event: DragEvent, page: number) => {
    if (toolType !== "pdf_reorder" || !event.dataTransfer.types.includes(INTERNAL_PAGE_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourcePage = Number(event.dataTransfer.getData(INTERNAL_PAGE_DRAG_TYPE)) || dragPage;
    if (sourcePage) movePage(sourcePage, page);
    setDragPage(null);
    setDropTargetPage(null);
  };

  return (
    <section className="h-full min-h-0 overflow-auto border-r border-stone-200 bg-white">
      <div className="border-b border-stone-200 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Layers size={18} className="text-emerald-700" />
          <h2 className="text-base font-semibold text-stone-900">PDF 도구</h2>
        </div>
        <p className="mb-4 text-sm leading-6 text-stone-600">
          이 영역은 PDF 병합, 분할, 페이지 정렬, 회전 전용입니다. 확장자/코덱 변환은 파일 변환 모드에서 실행합니다.
        </p>

        <div className="grid grid-cols-1 gap-2">
          {TOOL_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onToolTypeChange(type)}
              className={[
                "flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition",
                toolType === type
                  ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                  : "border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100"
              ].join(" ")}
            >
              <span className="font-medium">{pdfToolLabels[type]}</span>
              {type === "pdf_split_all" || type === "pdf_split_groups" ? <Scissors size={16} /> : <Shuffle size={16} />}
            </button>
          ))}
        </div>
        <p className="mt-3 rounded-md bg-stone-100 px-3 py-2 text-sm leading-6 text-stone-700">
          {pdfToolDescriptions[toolType]}
        </p>
      </div>

      <div className="border-b border-stone-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-stone-900">PDF 파일</h3>
        {pdfFiles.length === 0 ? (
          <p className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 py-5 text-center text-sm text-stone-500">
            PDF 파일을 드롭하면 작업할 수 있습니다.
          </p>
        ) : (
          <div className="max-h-44 space-y-2 overflow-auto pr-1">
            {pdfFiles.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => onSelectFile(file)}
                className={[
                  "flex w-full min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm",
                  selectedPdf?.id === file.id
                    ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                    : "border-stone-200 bg-stone-50 text-stone-700 hover:bg-stone-100"
                ].join(" ")}
              >
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <span className="shrink-0 text-xs text-stone-500">{formatBytes(file.size)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-b border-stone-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-stone-900">저장</h3>
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              checked={useSourceFolder}
              onChange={(event) => onUseSourceFolderChange(event.target.checked)}
              className="h-4 w-4 accent-emerald-700"
            />
            원본 PDF가 있던 폴더에 저장
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
          <label className="flex items-center gap-2 text-sm font-medium text-stone-700">
            <input
              type="checkbox"
              checked={useDatedSubfolder}
              onChange={(event) => onUseDatedSubfolderChange(event.target.checked)}
              className="h-4 w-4 accent-emerald-700"
            />
            날짜별 하위 폴더를 만들어 저장
          </label>
          {toolType === "pdf_merge" && (
            <label className="block text-sm font-medium text-stone-700">
              결과 파일명
              <input
                value={outputName}
                onChange={(event) => onOutputNameChange(event.target.value)}
                placeholder="merged_pdf"
                className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
              />
            </label>
          )}
        </div>
      </div>

      {selectedPdf && toolType === "pdf_merge" && (
        <div className="border-b border-stone-200 p-4">
          <h3 className="mb-2 text-sm font-semibold text-stone-900">병합 순서</h3>
          <p className="mb-3 text-xs text-stone-500">좌측 파일 목록의 현재 순서가 병합 결과에 반영됩니다.</p>
          <ol className="space-y-2">
            {pdfFiles.map((file, index) => (
              <li key={file.id} className="flex min-w-0 items-center gap-2 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-700">
                <span className="w-6 shrink-0 text-stone-400">{index + 1}</span>
                <span className="truncate">{file.name}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {selectedPdf && toolType !== "pdf_merge" && (
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">페이지</h3>
              <p className="mt-1 text-xs text-stone-500">{info ? `${info.pageCount}페이지` : "페이지 정보를 읽는 중입니다."}</p>
            </div>
            {toolType === "pdf_reorder" && (
              <button
                type="button"
                onClick={reversePages}
                className="inline-flex h-8 items-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700 hover:bg-stone-100"
              >
                <Shuffle size={14} />
                역순
              </button>
            )}
          </div>

          {toolType === "pdf_split_groups" && (
            <div className="mb-4 rounded-md border border-stone-200 bg-stone-50 p-3">
              <label className="block text-sm font-medium text-stone-700">
                그룹 이름
                <input
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  placeholder={`group_${splitGroups.length + 1}`}
                  className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={addGroup}
                className="mt-3 h-9 w-full rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                선택 페이지를 그룹으로 추가
              </button>
              {splitGroups.length > 0 && (
                <div className="mt-3 space-y-2">
                  {splitGroups.map((group) => (
                    <div key={group.id} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-white px-2 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        {group.name}: {group.pages.join(", ")}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeGroup(group.id)}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-stone-500 hover:bg-stone-100 hover:text-rose-700"
                        aria-label="그룹 제거"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="max-h-[420px] space-y-2 overflow-auto pr-1">
            {activeOrder.map((page) => (
              <div
                key={page}
                role="button"
                tabIndex={0}
                draggable={toolType === "pdf_reorder"}
                onClick={() => onPagePreviewChange(page)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onPagePreviewChange(page);
                  }
                }}
                onDragStart={(event) => startPageDrag(event, page)}
                onDragOver={(event) => overPageDrag(event, page)}
                onDrop={(event) => dropPageDrag(event, page)}
                onDragEnd={(event) => {
                  event.stopPropagation();
                  setDragPage(null);
                  setDropTargetPage(null);
                }}
                className={[
                  "grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2 py-2 text-sm",
                  selectedPage === page ? "border-emerald-400 bg-emerald-50" : "",
                  dropTargetPage === page && dragPage !== page ? "ring-2 ring-emerald-300 ring-offset-1" : "",
                  dragPage === page ? "opacity-55" : ""
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  {toolType === "pdf_reorder" && <GripVertical size={15} className="cursor-grab text-stone-400" />}
                  {toolType === "pdf_split_groups" && (
                    <input
                      type="checkbox"
                      checked={selectedPages.includes(page)}
                      onChange={() => toggleSelectedPage(page)}
                      className="h-4 w-4 accent-emerald-700"
                    />
                  )}
                </div>
                <span className="font-medium text-stone-800">
                  페이지 {page}
                  {pageRotations[page] ? <span className="ml-2 text-xs text-emerald-700">{pageRotations[page]}°</span> : null}
                </span>
                <span className="text-xs text-stone-400">{toolType === "pdf_reorder" ? "드래그" : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {latestJob && (
        <div className="border-t border-stone-200 p-4">
          <h3 className="mb-2 text-sm font-semibold text-stone-900">PDF 작업 결과</h3>
          <div
            key={`${latestJob.id}-${latestJob.status}-${latestJob.outputPaths.join("|")}`}
            className={[
              "result-dissolve rounded-md border px-3 py-2 text-sm",
              latestJob.status === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                : latestJob.status === "failed"
                  ? "border-rose-200 bg-rose-50 text-rose-950"
                  : "border-stone-200 bg-stone-50 text-stone-700"
            ].join(" ")}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{latestJob.message}</span>
              <span className="shrink-0 text-xs">{latestJob.progress}%</span>
            </div>
            {latestJob.error && <p className="mt-2 leading-6">{latestJob.error}</p>}
          </div>
          {latestJob.outputPaths.length > 0 && (
            <div className="mt-3 space-y-2">
              {latestJob.outputPaths.map((outputPath) => (
                <div key={outputPath} className="result-dissolve flex min-w-0 items-center gap-2 rounded-md bg-stone-50 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{outputPath}</span>
                  <button
                    type="button"
                    onClick={() => onOpenPath(outputPath)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700 hover:bg-stone-100"
                  >
                    <ExternalLink size={13} />
                    열기
                  </button>
                  <button
                    type="button"
                    onClick={() => onReveal(outputPath)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700 hover:bg-stone-100"
                  >
                    <FolderOpen size={13} />
                    폴더
                  </button>
                  <button
                    type="button"
                    onClick={() => onCopy(outputPath)}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700 hover:bg-stone-100"
                  >
                    <Copy size={13} />
                    복사
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
