import {
  FileArchive,
  FileAudio,
  FileCheck2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  GripVertical,
  ListRestart,
  Settings2,
  Trash2
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import type { FileItem, FileKind, SortMode } from "../../main/types/conversion";
import { formatBytes } from "../lib/formatLabels";

interface DropZoneProps {
  files: FileItem[];
  displayFiles: FileItem[];
  sortMode: SortMode;
  selectedFileId?: string;
  isDragging: boolean;
  clearFilesAfterSuccess: boolean;
  openFolderAfterSuccess: boolean;
  openFileAfterSuccess: boolean;
  outputName: string;
  onPickFiles: () => void;
  onSortModeChange: (mode: SortMode) => void;
  onClearFilesAfterSuccessChange: (value: boolean) => void;
  onOpenFolderAfterSuccessChange: (value: boolean) => void;
  onOpenFileAfterSuccessChange: (value: boolean) => void;
  onOutputNameChange: (value: string) => void;
  onSelectFile: (item: FileItem) => void;
  onRemoveFile: (id: string) => void;
  onReorderFiles: (orderedIds: string[]) => void;
}

const INTERNAL_FILE_DRAG_TYPE = "application/x-convert-smith-file-id";

const sortLabels: Record<SortMode, string> = {
  basic: "Basic",
  custom: "Custom",
  name: "이름순",
  date: "날짜순",
  type: "형식별",
  size: "크기순"
};

export function DropZone({
  files,
  displayFiles,
  sortMode,
  selectedFileId,
  isDragging,
  clearFilesAfterSuccess,
  openFolderAfterSuccess,
  openFileAfterSuccess,
  outputName,
  onPickFiles,
  onSortModeChange,
  onClearFilesAfterSuccessChange,
  onOpenFolderAfterSuccessChange,
  onOpenFileAfterSuccessChange,
  onOutputNameChange,
  onSelectFile,
  onRemoveFile,
  onReorderFiles
}: DropZoneProps): JSX.Element {
  const [draggedId, setDraggedId] = useState<string>();
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const [isCompletionOptionsOpen, setIsCompletionOptionsOpen] = useState(false);
  const [isCompletionOptionsRendered, setIsCompletionOptionsRendered] = useState(false);
  const [isCompletionOptionsClosing, setIsCompletionOptionsClosing] = useState(false);
  const completionOptionsRef = useRef<HTMLDivElement>(null);
  const completionOptionsTimerRef = useRef<number>();

  const draggedItem = draggedId ? displayFiles.find((item) => item.id === draggedId) : undefined;
  const visibleFiles = draggedItem ? displayFiles.filter((item) => item.id !== draggedItem.id) : displayFiles;
  const placeholderIndex =
    draggedItem !== undefined
      ? clampIndex(insertionIndex ?? displayFiles.findIndex((item) => item.id === draggedItem.id), visibleFiles.length)
      : -1;

  const startInternalDrag = (event: DragEvent, item: FileItem) => {
    event.stopPropagation();
    const originalIndex = displayFiles.findIndex((file) => file.id === item.id);
    setDraggedId(item.id);
    setInsertionIndex(originalIndex < 0 ? 0 : originalIndex);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_TYPE, item.id);
    setTransparentDragImage(event);
  };

  const overListDrag = (event: DragEvent<HTMLDivElement>) => {
    if (!hasInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    if (visibleFiles.length === 0) {
      setInsertionIndex(0);
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientY <= rect.top + 18) setInsertionIndex(0);
    if (event.clientY >= rect.bottom - 18) setInsertionIndex(visibleFiles.length);
  };

  const overFileDrag = (event: DragEvent<HTMLButtonElement>, index: number) => {
    if (!hasInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";

    const rect = event.currentTarget.getBoundingClientRect();
    const shouldInsertBefore = event.clientY < rect.top + rect.height / 2;
    setInsertionIndex(shouldInsertBefore ? index : index + 1);
  };

  const dropInternalDrag = (event: DragEvent) => {
    if (!hasInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const sourceId = event.dataTransfer.getData(INTERNAL_FILE_DRAG_TYPE) || draggedId;
    const nextBase = displayFiles.filter((item) => item.id !== sourceId);
    const nextIndex = clampIndex(insertionIndex ?? nextBase.length, nextBase.length);
    setDraggedId(undefined);
    setInsertionIndex(null);

    if (!sourceId || !displayFiles.some((item) => item.id === sourceId)) return;

    const nextIds = nextBase.map((item) => item.id);
    nextIds.splice(nextIndex, 0, sourceId);
    if (nextIds.join("\u0000") !== displayFiles.map((item) => item.id).join("\u0000")) {
      onReorderFiles(nextIds);
    }
  };

  const endInternalDrag = (event: DragEvent) => {
    event.stopPropagation();
    setDraggedId(undefined);
    setInsertionIndex(null);
  };

  const openCompletionOptions = () => {
    if (completionOptionsTimerRef.current) {
      window.clearTimeout(completionOptionsTimerRef.current);
    }
    setIsCompletionOptionsRendered(true);
    setIsCompletionOptionsClosing(false);
    setIsCompletionOptionsOpen(true);
  };

  const closeCompletionOptions = () => {
    if (!isCompletionOptionsRendered) return;
    if (completionOptionsTimerRef.current) {
      window.clearTimeout(completionOptionsTimerRef.current);
    }
    setIsCompletionOptionsOpen(false);
    setIsCompletionOptionsClosing(true);
    completionOptionsTimerRef.current = window.setTimeout(() => {
      setIsCompletionOptionsRendered(false);
      setIsCompletionOptionsClosing(false);
    }, 220);
  };

  const toggleCompletionOptions = () => {
    if (isCompletionOptionsOpen) closeCompletionOptions();
    else openCompletionOptions();
  };

  useEffect(() => {
    if (!isCompletionOptionsRendered || isCompletionOptionsClosing) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCompletionOptions();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && completionOptionsRef.current?.contains(target)) return;
      closeCompletionOptions();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [isCompletionOptionsClosing, isCompletionOptionsRendered]);

  useEffect(() => {
    return () => {
      if (completionOptionsTimerRef.current) {
        window.clearTimeout(completionOptionsTimerRef.current);
      }
    };
  }, []);

  return (
    <section className="flex min-h-0 flex-1 flex-col border-r border-stone-200 bg-stone-50">
      <div
        className={[
          "m-4 rounded-md border border-dashed p-4 transition",
          isDragging ? "border-emerald-500 bg-emerald-50" : "border-stone-300 bg-white"
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-stone-900">파일</h2>
            <p className="mt-1 text-sm leading-6 text-stone-600 [word-break:keep-all]">
              앱 어디에 드롭해도 목록에 추가됩니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onPickFiles}
            className="inline-flex h-9 min-w-[76px] shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            <FolderOpen size={16} />
            선택
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pb-3">
        <span className="shrink-0 text-sm font-medium text-stone-700">{files.length}개 파일</span>
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative" ref={completionOptionsRef}>
            <button
              type="button"
              onClick={toggleCompletionOptions}
              aria-label="완료 후 처리 옵션"
              aria-expanded={isCompletionOptionsOpen}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-stone-200 text-stone-800 shadow-sm transition hover:bg-stone-300"
            >
              <Settings2
                size={15}
                className={["transition-transform duration-300", isCompletionOptionsOpen ? "rotate-90" : "rotate-0"].join(" ")}
              />
            </button>

            {isCompletionOptionsRendered && (
              <div
                className={[
                  "completion-options-popover absolute right-0 top-10 z-30 w-[292px] max-w-[calc(100vw-24px)] rounded-md border border-stone-200 bg-white p-3 text-stone-900 shadow-xl",
                  isCompletionOptionsClosing
                    ? "completion-options-popover--closing"
                    : "completion-options-popover--open"
                ].join(" ")}
              >
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-stone-900">완료 후 처리</h3>
                  <p className="mt-1 text-xs leading-5 text-stone-500">
                    변환이 끝난 뒤 자동으로 실행할 동작을 선택합니다.
                  </p>
                </div>
                <div className="space-y-2">
                  <CompletionOption
                    icon={<ListRestart size={15} />}
                    label="완료 후 목록 초기화"
                    checked={clearFilesAfterSuccess}
                    onChange={onClearFilesAfterSuccessChange}
                  />
                  <CompletionOption
                    icon={<FolderOpen size={15} />}
                    label="완료 후 결과 위치 열기"
                    checked={openFolderAfterSuccess}
                    onChange={onOpenFolderAfterSuccessChange}
                  />
                  <CompletionOption
                    icon={<FileCheck2 size={15} />}
                    label="완료 후 첫 결과 파일 열기"
                    checked={openFileAfterSuccess}
                    onChange={onOpenFileAfterSuccessChange}
                  />
                </div>
              </div>
            )}
          </div>

          <select
            value={sortMode}
            onChange={(event) => onSortModeChange(event.target.value as SortMode)}
            className="h-8 min-w-[88px] rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-800"
          >
            {Object.entries(sortLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4 pt-1">
        {displayFiles.length === 0 ? (
          <div className="flex h-full min-h-64 items-center justify-center rounded-md border border-stone-200 bg-white px-4 text-center text-sm leading-6 text-stone-500 [word-break:keep-all]">
            변환할 파일을 드롭하세요.
          </div>
        ) : (
          <div className="space-y-2 pb-1" onDragOver={overListDrag} onDrop={dropInternalDrag}>
            {visibleFiles.map((item, index) => (
              <FileListFragment
                key={item.id}
                item={item}
                index={index}
                draggedItem={draggedItem}
                placeholderIndex={placeholderIndex}
                selectedFileId={selectedFileId}
                onDragStart={startInternalDrag}
                onDragOver={overFileDrag}
                onDrop={dropInternalDrag}
                onDragEnd={endInternalDrag}
                onSelectFile={onSelectFile}
                onRemoveFile={onRemoveFile}
              />
            ))}
            {draggedItem && placeholderIndex === visibleFiles.length && <FilePlaceholder item={draggedItem} />}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-stone-200 bg-white px-4 py-3">
        <label className="block min-w-0 text-sm font-semibold text-stone-900">
          결과 파일명
          <input
            value={outputName}
            onChange={(event) => onOutputNameChange(event.target.value)}
            placeholder="비워두면 자동 이름"
            className="mt-1 h-9 w-full rounded-md border border-stone-300 bg-stone-50 px-3 text-sm font-normal text-stone-800 outline-none transition placeholder:text-stone-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-100"
          />
        </label>
        <p className="mt-1 truncate text-xs text-stone-500">확장자는 변환 형식에 맞춰 자동으로 붙습니다.</p>
      </div>
    </section>
  );
}

function CompletionOption({
  icon,
  label,
  checked,
  onChange
}: {
  icon: JSX.Element;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex h-10 min-w-0 items-center justify-between gap-3 rounded-md bg-stone-50 px-3 text-sm text-stone-800 transition hover:bg-stone-100">
      <span className="inline-flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-stone-700">{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-emerald-700"
      />
    </label>
  );
}

function FileListFragment({
  item,
  index,
  draggedItem,
  placeholderIndex,
  selectedFileId,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSelectFile,
  onRemoveFile
}: {
  item: FileItem;
  index: number;
  draggedItem?: FileItem;
  placeholderIndex: number;
  selectedFileId?: string;
  onDragStart: (event: DragEvent, item: FileItem) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>, index: number) => void;
  onDrop: (event: DragEvent) => void;
  onDragEnd: (event: DragEvent) => void;
  onSelectFile: (item: FileItem) => void;
  onRemoveFile: (id: string) => void;
}): JSX.Element {
  return (
    <>
      {draggedItem && placeholderIndex === index && <FilePlaceholder item={draggedItem} />}
      <button
        type="button"
        draggable
        onDragStart={(event) => onDragStart(event, item)}
        onDragOver={(event) => onDragOver(event, index)}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        onClick={() => onSelectFile(item)}
        className={[
          "dropzone-file-row grid w-full grid-cols-[18px_28px_1fr_auto] items-center gap-2 rounded-md border p-3 text-left transition",
          selectedFileId === item.id
            ? "border-emerald-500 bg-emerald-50"
            : "border-stone-200 bg-white hover:border-stone-300"
        ].join(" ")}
      >
        <GripVertical size={15} className="cursor-grab text-stone-400" />
        <FileKindIcon kind={item.kind} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-stone-900">{item.name}</span>
          <span className="mt-1 block truncate text-xs text-stone-500">
            {item.extension || "unknown"} · {formatBytes(item.size)}
          </span>
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onRemoveFile(item.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onRemoveFile(item.id);
            }
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-stone-500 hover:bg-rose-50 hover:text-rose-700"
          aria-label="파일 제거"
        >
          <Trash2 size={16} />
        </span>
      </button>
    </>
  );
}

function FilePlaceholder({ item }: { item: FileItem }): JSX.Element {
  return (
    <div
      className="dropzone-file-placeholder grid w-full grid-cols-[18px_28px_1fr_auto] items-center gap-2 rounded-md border border-emerald-400 bg-emerald-50/60 p-3 text-left text-emerald-950"
      aria-hidden="true"
    >
      <GripVertical size={15} className="text-emerald-500/60" />
      <FileKindIcon kind={item.kind} muted />
      <span className="min-w-0 opacity-65">
        <span className="block truncate text-sm font-medium">{item.name}</span>
        <span className="mt-1 block truncate text-xs">
          {item.extension || "unknown"} · {formatBytes(item.size)}
        </span>
      </span>
      <span className="h-8 w-8" />
    </div>
  );
}

function FileKindIcon({ kind, muted = false }: { kind: FileKind; muted?: boolean }): JSX.Element {
  const className = muted ? "h-5 w-5 text-emerald-600/60" : "h-5 w-5 text-stone-600";
  if (kind === "image") return <FileImage className={className} />;
  if (kind === "video") return <FileVideo className={className} />;
  if (kind === "audio") return <FileAudio className={className} />;
  if (kind === "excel") return <FileSpreadsheet className={className} />;
  if (kind === "word" || kind === "pdf") return <FileText className={className} />;
  return <FileArchive className={className} />;
}

function hasInternalFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(INTERNAL_FILE_DRAG_TYPE);
}

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(Math.trunc(value), 0), max);
}

function setTransparentDragImage(event: DragEvent): void {
  const image = document.createElement("div");
  image.style.position = "fixed";
  image.style.left = "-1000px";
  image.style.top = "-1000px";
  image.style.width = "1px";
  image.style.height = "1px";
  image.style.opacity = "0";
  document.body.appendChild(image);
  event.dataTransfer.setDragImage(image, 0, 0);
  window.setTimeout(() => image.remove(), 0);
}
