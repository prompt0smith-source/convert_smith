import { Edit3, ExternalLink, FileText, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";
import type { FileItem } from "../../main/types/conversion";
import { formatBytes } from "../lib/formatLabels";

interface PdfEditorPanelProps {
  displayFiles: FileItem[];
  selectedFile?: FileItem;
  outputDir?: string;
  sourceOutputDir?: string;
  useSourceFolder: boolean;
  useDatedSubfolder: boolean;
  outputName: string;
  onSelectFile: (item: FileItem) => void;
  onPickOutputDir: () => void;
  onUseSourceFolderChange: (value: boolean) => void;
  onUseDatedSubfolderChange: (value: boolean) => void;
  onOutputNameChange: (value: string) => void;
  onNotice: (message?: string) => void;
}

export function PdfEditorPanel({
  displayFiles,
  selectedFile,
  outputDir,
  sourceOutputDir,
  useSourceFolder,
  useDatedSubfolder,
  outputName,
  onSelectFile,
  onPickOutputDir,
  onUseSourceFolderChange,
  onUseDatedSubfolderChange,
  onOutputNameChange,
  onNotice
}: PdfEditorPanelProps): JSX.Element {
  const pdfFiles = useMemo(() => displayFiles.filter((file) => file.extension === ".pdf"), [displayFiles]);
  const selectedPdf = selectedFile?.extension === ".pdf" ? selectedFile : pdfFiles[0];
  const effectiveOutputDir = useSourceFolder ? sourceOutputDir : outputDir;
  const [isOpening, setIsOpening] = useState(false);

  const openViewer = async () => {
    if (!selectedPdf) {
      onNotice("PDF Viewer로 열 PDF 파일을 먼저 선택해주세요.");
      return;
    }
    if (!effectiveOutputDir) {
      onNotice("PDF 수정본을 저장할 폴더를 먼저 지정해주세요.");
      return;
    }

    setIsOpening(true);
    try {
      await window.convertSmith.openPdfEditorWindow({
        sourcePath: selectedPdf.path,
        outputDir: effectiveOutputDir,
        outputName: outputName.trim() || undefined,
        useDatedSubfolder
      });
      onNotice("PDF Viewer 창을 열었습니다. 수정과 저장은 Viewer 창에서 진행해주세요.");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "PDF Viewer 창을 열지 못했습니다.");
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col border-r border-stone-200 bg-white">
      <div className="border-b border-stone-200 p-5">
        <div className="mb-3 flex items-center gap-2">
          <Edit3 size={18} className="text-emerald-700" />
          <h2 className="text-base font-semibold text-stone-950">PDF 편집기</h2>
        </div>
        <p className="text-sm leading-6 text-stone-600">
          PDF Viewer를 별도 창으로 열고, 그 안에서 PDF를 보며 수정본을 저장합니다.
        </p>
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          원본 형태가 틀어질 위험이 있으면 저장하지 않습니다. 원본 PDF는 직접 수정하지 않습니다.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mb-5 rounded-md border border-stone-200 bg-stone-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-stone-950">PDF 파일</h3>
          {pdfFiles.length === 0 ? (
            <p className="rounded-md border border-dashed border-stone-300 bg-white px-3 py-8 text-center text-sm text-stone-500">
              PDF 파일을 드롭하면 Viewer로 열 수 있습니다.
            </p>
          ) : (
            <div className="max-h-48 space-y-2 overflow-auto pr-1">
              {pdfFiles.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => onSelectFile(file)}
                  className={[
                    "flex h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md border px-3 text-left text-sm",
                    selectedPdf?.id === file.id
                      ? "border-emerald-500 bg-emerald-50 text-emerald-950"
                      : "border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
                  ].join(" ")}
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <FileText size={15} />
                    <span className="truncate">{file.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-stone-500">{formatBytes(file.size)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="mb-5 rounded-md border border-stone-200 bg-stone-50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-stone-950">저장 위치</h3>
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
              className="flex h-10 w-full min-w-0 items-center justify-between gap-3 rounded-md border border-stone-300 bg-white px-3 text-left text-sm text-stone-800 hover:bg-stone-100"
            >
              <span className="truncate">{effectiveOutputDir || "저장할 폴더 선택"}</span>
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
            <input
              value={outputName}
              onChange={(event) => onOutputNameChange(event.target.value)}
              placeholder="비워두면 원본파일명_edited"
              className="h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={openViewer}
          disabled={!selectedPdf || !effectiveOutputDir || isOpening}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          <ExternalLink size={16} />
          {isOpening ? "Viewer 여는 중" : "PDF Viewer 열기"}
        </button>
      </div>
    </section>
  );
}
