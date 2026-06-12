import {
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  FolderOpen,
  Trash2
} from "lucide-react";
import type { FileItem, FileKind, SortMode } from "../../main/types/conversion";
import { formatBytes } from "../lib/formatLabels";

interface DropZoneProps {
  files: FileItem[];
  displayFiles: FileItem[];
  sortMode: SortMode;
  selectedFileId?: string;
  isDragging: boolean;
  clearFilesAfterSuccess: boolean;
  onPickFiles: () => void;
  onSortModeChange: (mode: SortMode) => void;
  onClearFilesAfterSuccessChange: (value: boolean) => void;
  onSelectFile: (item: FileItem) => void;
  onRemoveFile: (id: string) => void;
}

const sortLabels: Record<SortMode, string> = {
  basic: "Basic",
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
  onPickFiles,
  onSortModeChange,
  onClearFilesAfterSuccessChange,
  onSelectFile,
  onRemoveFile
}: DropZoneProps): JSX.Element {
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
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            <FolderOpen size={16} />
            선택
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-4 pb-3">
        <span className="text-sm font-medium text-stone-700">{files.length}개 파일</span>
        <div className="flex items-center gap-2">
          <label className="flex h-8 items-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-xs text-stone-700">
            <input
              type="checkbox"
              checked={clearFilesAfterSuccess}
              onChange={(event) => onClearFilesAfterSuccessChange(event.target.checked)}
              className="h-4 w-4 accent-emerald-700"
            />
            완료 후 목록 초기화
          </label>
          <select
            value={sortMode}
            onChange={(event) => onSortModeChange(event.target.value as SortMode)}
            className="h-8 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-800"
          >
            {Object.entries(sortLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {displayFiles.length === 0 ? (
          <div className="flex h-full min-h-64 items-center justify-center rounded-md border border-stone-200 bg-white text-sm text-stone-500">
            변환할 파일을 드롭하세요.
          </div>
        ) : (
          <div className="space-y-2">
            {displayFiles.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectFile(item)}
                className={[
                  "grid w-full grid-cols-[28px_1fr_auto] items-center gap-3 rounded-md border p-3 text-left transition",
                  selectedFileId === item.id
                    ? "border-emerald-500 bg-emerald-50"
                    : "border-stone-200 bg-white hover:border-stone-300"
                ].join(" ")}
              >
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
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FileKindIcon({ kind }: { kind: FileKind }): JSX.Element {
  const className = "h-5 w-5 text-stone-600";
  if (kind === "image") return <FileImage className={className} />;
  if (kind === "video") return <FileVideo className={className} />;
  if (kind === "audio") return <FileAudio className={className} />;
  if (kind === "excel") return <FileSpreadsheet className={className} />;
  if (kind === "word" || kind === "pdf") return <FileText className={className} />;
  return <FileArchive className={className} />;
}
