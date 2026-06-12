import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ShieldCheck, X, XCircle } from "lucide-react";
import type {
  ConversionJob,
  ConversionOptions,
  ConversionType,
  ConvertMode,
  DependencyStatus,
  FileItem,
  SortMode,
  StartConversionPayload
} from "../main/types/conversion";
import { DropZone } from "./components/DropZone";
import { ConversionTypeSelector } from "./components/ConversionTypeSelector";
import { OutputSettings } from "./components/OutputSettings";
import { VideoCodecInspector } from "./components/VideoCodecInspector";
import { PreviewPanel } from "./components/PreviewPanel";
import { UtilityDrawer } from "./components/UtilityDrawer";
import { getCommonConversions } from "./lib/formatLabels";
import { helperMessages, practicalError } from "./lib/koreanMessages";

const DEFAULT_OPTIONS: ConversionOptions = {
  imageQuality: 90,
  pdfImageFormat: "jpg",
  pdfRenderScale: 2,
  pdfPageSize: "auto",
  pdfToDocxMode: "editable_text",
  videoCompatibilityMode: true,
  overwritePolicy: "increment",
  sortMode: "basic"
};

const OUTPUT_DIR_STORAGE_KEY = "convertSmith.outputDir";
const USE_SOURCE_FOLDER_STORAGE_KEY = "convertSmith.useSourceFolder";

interface ConversionToast {
  id: string;
  variant: "success" | "failure";
  title: string;
  message: string;
}

export function App(): JSX.Element {
  const rememberedOutputDir = localStorage.getItem(OUTPUT_DIR_STORAGE_KEY) || undefined;
  const notifiedJobIds = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<number>();

  const [files, setFiles] = useState<FileItem[]>([]);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>("basic");
  const [convertMode, setConvertMode] = useState<ConvertMode>("batch");
  const [batchConversionType, setBatchConversionType] = useState<ConversionType>();
  const [individualTargets, setIndividualTargets] = useState<Record<string, ConversionType>>({});
  const [outputDir, setOutputDir] = useState<string | undefined>(rememberedOutputDir);
  const [useSourceFolder, setUseSourceFolder] = useState(() => {
    const stored = localStorage.getItem(USE_SOURCE_FOLDER_STORAGE_KEY);
    if (stored) return stored === "true";
    return !rememberedOutputDir;
  });
  const [clearFilesAfterSuccess, setClearFilesAfterSuccess] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string>();
  const [options, setOptions] = useState<ConversionOptions>(() => {
    const libreOfficePath = localStorage.getItem("convertSmith.libreOfficePath") || undefined;
    return { ...DEFAULT_OPTIONS, libreOfficePath };
  });
  const [dependencyStatus, setDependencyStatus] = useState<DependencyStatus>();
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [darkMode, setDarkMode] = useState(localStorage.getItem("convertSmith.darkMode") === "true");
  const [isUtilityOpen, setIsUtilityOpen] = useState(false);
  const [arrowBurst, setArrowBurst] = useState(false);
  const [toast, setToast] = useState<ConversionToast>();

  const displayFiles = useMemo(() => sortFiles(files, sortMode), [files, sortMode]);
  const selectedFile = files.find((item) => item.id === selectedFileId) || files[0];
  const sourceOutputDir = selectedFile ? getParentDir(selectedFile.path) : files[0] ? getParentDir(files[0].path) : undefined;
  const commonConversions = useMemo(() => getCommonConversions(files), [files]);
  const selectedConversion =
    convertMode === "batch"
      ? batchConversionType
      : selectedFile
        ? individualTargets[selectedFile.id] || selectedFile.supportedConversions[0]
        : undefined;

  const showJobToast = useCallback((job: ConversionJob) => {
    if (job.status !== "success" && job.status !== "failed") return;
    if (notifiedJobIds.current.has(job.id)) return;
    notifiedJobIds.current.add(job.id);

    const nextToast: ConversionToast =
      job.status === "success"
        ? {
            id: `${job.id}-success-${Date.now()}`,
            variant: "success",
            title: "성공",
            message: "변환 완료되었습니다. 출력 파일 검증도 통과했습니다."
          }
        : {
            id: `${job.id}-failed-${Date.now()}`,
            variant: "failure",
            title: "실패",
            message: job.error || "변환에 실패했습니다. 설정 패널의 작업 큐에서 오류 상세를 확인하세요."
          };

    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast(nextToast);
    toastTimeoutRef.current = window.setTimeout(() => setToast(undefined), 3400);
  }, []);

  const upsertJob = useCallback(
    (job: ConversionJob) => {
      showJobToast(job);
      setJobs((current) => {
        const index = current.findIndex((item) => item.id === job.id);
        if (index === -1) return [job, ...current];
        const next = [...current];
        next[index] = job;
        return next;
      });
    },
    [showJobToast]
  );

  const refreshDependencies = useCallback(() => {
    window.convertSmith
      .getDependencyStatus(options.libreOfficePath)
      .then(setDependencyStatus)
      .catch((error: unknown) => setNotice(practicalError(error)));
  }, [options.libreOfficePath]);

  useEffect(() => {
    const unsubscribe = window.convertSmith.onJobUpdate(upsertJob);
    return unsubscribe;
  }, [upsertJob]);

  useEffect(() => {
    refreshDependencies();
  }, [refreshDependencies]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("convertSmith.darkMode", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    if (!batchConversionType || !commonConversions.includes(batchConversionType)) {
      setBatchConversionType(commonConversions[0]);
    }
  }, [batchConversionType, commonConversions]);

  useEffect(() => {
    if (!selectedFileId && files[0]) {
      setSelectedFileId(files[0].id);
    }
  }, [files, selectedFileId]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const addFileItems = useCallback(
    (newItems: FileItem[]) => {
      setFiles((current) => {
        const existingPaths = new Set(current.map((item) => item.path));
        const offset = current.length;
        const deduped = newItems
          .filter((item) => !existingPaths.has(item.path))
          .map((item, index) => ({ ...item, dropIndex: offset + index }));

        setIndividualTargets((targets) => {
          const next = { ...targets };
          for (const item of deduped) {
            if (item.supportedConversions[0]) next[item.id] = item.supportedConversions[0];
          }
          return next;
        });

        if (!selectedFileId && deduped[0]) {
          setSelectedFileId(deduped[0].id);
        }

        return [...current, ...deduped];
      });
    },
    [selectedFileId]
  );

  const resolvePaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        setNotice("드롭한 파일의 실제 경로를 읽지 못했습니다. 파일 선택 버튼으로 다시 추가해주세요.");
        return;
      }
      try {
        const items = await window.convertSmith.resolveDroppedFiles(paths, files.length);
        addFileItems(items);
        setNotice(undefined);
      } catch (error) {
        setNotice(practicalError(error));
      }
    },
    [addFileItems, files.length]
  );

  useEffect(() => {
    let dragDepth = 0;

    const prevent = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onDragEnter = (event: DragEvent) => {
      prevent(event);
      dragDepth += 1;
      setIsDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      prevent(event);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      prevent(event);
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setIsDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      prevent(event);
      dragDepth = 0;
      setIsDragging(false);
      void extractDroppedPaths(event.dataTransfer).then(resolvePaths);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [resolvePaths]);

  const pickFiles = async () => {
    try {
      const items = await window.convertSmith.selectFiles();
      addFileItems(items);
    } catch (error) {
      setNotice(practicalError(error));
    }
  };

  const pickOutputDir = async () => {
    const picked = await window.convertSmith.selectOutputDirectory();
    if (!picked) return;
    setOutputDir(picked);
    setUseSourceFolder(false);
    localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, picked);
    localStorage.setItem(USE_SOURCE_FOLDER_STORAGE_KEY, "false");
  };

  const changeUseSourceFolder = (value: boolean) => {
    setUseSourceFolder(value);
    localStorage.setItem(USE_SOURCE_FOLDER_STORAGE_KEY, String(value));
  };

  const pickLibreOfficePath = async () => {
    try {
      const picked = await window.convertSmith.selectLibreOfficePath();
      if (!picked) return;

      localStorage.setItem("convertSmith.libreOfficePath", picked);
      setOptions((current) => ({ ...current, libreOfficePath: picked }));

      const status = await window.convertSmith.getDependencyStatus(picked);
      const resolvedPath = status.libreOffice.available && status.libreOffice.path ? status.libreOffice.path : picked;
      localStorage.setItem("convertSmith.libreOfficePath", resolvedPath);
      setOptions((current) => ({ ...current, libreOfficePath: resolvedPath }));
      setDependencyStatus(status);
      setNotice(
        status.libreOffice.available
          ? "LibreOffice 경로가 확인되었습니다."
          : status.libreOffice.message
      );
    } catch (error) {
      setNotice(practicalError(error));
    }
  };

  const openLibreOfficeDownload = async () => {
    const result = await window.convertSmith.openLibreOfficeDownloadPage();
    if (!result.ok) setNotice(result.message);
  };

  const startConversion = async () => {
    if (files.length === 0) {
      setNotice("변환할 파일을 먼저 추가해주세요.");
      return;
    }

    setIsConverting(true);
    setNotice(undefined);

    const submittedJobs: ConversionJob[] = [];
    try {
      const sorted = sortFiles(files, sortMode);
      if (convertMode === "batch") {
        if (!batchConversionType) {
          setNotice("변환 형식을 선택해주세요.");
          return;
        }
        if (["pdf_to_docx", "pdf_to_images"].includes(batchConversionType)) {
          for (const item of sorted) {
            submittedJobs.push(await submitJob([item.path], batchConversionType));
          }
        } else {
          submittedJobs.push(await submitJob(sorted.map((item) => item.path), batchConversionType));
        }
      } else {
        for (const item of sorted) {
          const target = individualTargets[item.id] || item.supportedConversions[0];
          if (!target) {
            setNotice(`${item.name} 파일은 지원 가능한 변환 형식이 없습니다.`);
            return;
          }
          submittedJobs.push(await submitJob([item.path], target));
        }
      }

      if (clearFilesAfterSuccess && submittedJobs.length > 0 && submittedJobs.every((job) => job.status === "success")) {
        setFiles([]);
        setIndividualTargets({});
        setSelectedFileId(undefined);
      }
    } finally {
      setIsConverting(false);
    }
  };

  const submitJob = async (sourcePaths: string[], conversionType: ConversionType): Promise<ConversionJob> => {
    const targetOutputDir = getOutputDirForSources(sourcePaths, useSourceFolder, outputDir);
    if (!targetOutputDir) {
      const message = useSourceFolder ? "원본 파일 폴더를 감지할 파일이 필요합니다." : "저장할 폴더를 지정해주세요.";
      setNotice(message);
      throw new Error(message);
    }

    const payload: StartConversionPayload = {
      sourcePaths,
      outputDir: targetOutputDir,
      conversionType,
      options: { ...options, sortMode }
    };
    const job = await window.convertSmith.startConversion(payload);
    upsertJob(job);
    return job;
  };

  const triggerConversion = () => {
    if (isConverting) return;
    setArrowBurst(false);
    window.requestAnimationFrame(() => setArrowBurst(true));
    window.setTimeout(() => setArrowBurst(false), 620);
    void startConversion().catch((error: unknown) => setNotice(practicalError(error)));
  };

  const openExternalPreview = async (item?: FileItem) => {
    if (!item) return;
    const result = await window.convertSmith.previewFile(item.path);
    if (!result.ok) setNotice(result.message);
  };

  const revealPath = async (filePath: string) => {
    const result = await window.convertSmith.revealPath(filePath);
    if (!result.ok) setNotice(result.message);
  };

  const copyPath = async (filePath: string) => {
    await navigator.clipboard.writeText(filePath);
    setNotice("경로를 복사했습니다.");
  };

  const removeFile = (id: string) => {
    setFiles((current) => current.filter((item) => item.id !== id));
    setIndividualTargets((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (selectedFileId === id) {
      setSelectedFileId(undefined);
    }
  };

  return (
    <div
      className={[
        "flex h-screen flex-col overflow-hidden",
        darkMode ? "bg-zinc-950 text-zinc-100" : "bg-[#f5f7f3] text-stone-900"
      ].join(" ")}
    >
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-emerald-500 bg-emerald-500/10">
          <div className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-emerald-800 shadow-lg">
            파일을 놓으면 Convert Smith가 감지합니다.
          </div>
        </div>
      )}

      {toast && <ConversionToastView key={toast.id} toast={toast} onClose={() => setToast(undefined)} />}

      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-normal text-stone-950">Convert Smith</h1>
            <p className="mt-1 text-sm text-stone-600">{helperMessages.appSubtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
              <ShieldCheck size={16} />
              로컬 변환 · 업로드 없음
            </div>
            <UtilityDrawer
              isOpen={isUtilityOpen}
              dependencyStatus={dependencyStatus}
              jobs={jobs}
              libreOfficePath={options.libreOfficePath}
              darkMode={darkMode}
              onToggle={() => setIsUtilityOpen((value) => !value)}
              onClose={() => setIsUtilityOpen(false)}
              onRefreshDependencies={refreshDependencies}
              onPickLibreOfficePath={pickLibreOfficePath}
              onOpenLibreOfficeDownload={openLibreOfficeDownload}
              onDarkModeChange={setDarkMode}
              onCancelJob={(jobId) => void window.convertSmith.cancelConversion(jobId)}
              onReveal={revealPath}
              onCopy={copyPath}
            />
          </div>
        </div>
      </header>

      {notice && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          {notice}
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[minmax(320px,31%)_64px_minmax(340px,30%)_minmax(420px,1fr)]">
        <DropZone
          files={files}
          displayFiles={displayFiles}
          sortMode={sortMode}
          selectedFileId={selectedFile?.id}
          isDragging={isDragging}
          clearFilesAfterSuccess={clearFilesAfterSuccess}
          onPickFiles={pickFiles}
          onSortModeChange={setSortMode}
          onClearFilesAfterSuccessChange={setClearFilesAfterSuccess}
          onSelectFile={(item) => setSelectedFileId(item.id)}
          onRemoveFile={removeFile}
        />

        <div className="flex items-center justify-center border-r border-stone-200 bg-stone-100">
          <button
            type="button"
            onClick={triggerConversion}
            disabled={isConverting}
            aria-label="변환 시작"
            className={[
              "convert-arrow-button flex h-12 w-12 items-center justify-center rounded-full border border-emerald-300 bg-white text-emerald-700 shadow-sm transition hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-60",
              arrowBurst ? "convert-arrow-button--burst" : ""
            ].join(" ")}
          >
            <ArrowRight className="convert-arrow-icon" size={30} strokeWidth={5} />
          </button>
        </div>

        <section className="min-h-0 overflow-auto border-r border-stone-200 bg-white">
          <ConversionTypeSelector
            files={files}
            displayFiles={displayFiles}
            convertMode={convertMode}
            batchConversionType={batchConversionType}
            individualTargets={individualTargets}
            onConvertModeChange={setConvertMode}
            onBatchConversionTypeChange={setBatchConversionType}
            onIndividualTargetChange={(id, type) =>
              setIndividualTargets((current) => ({ ...current, [id]: type }))
            }
          />

          <VideoCodecInspector selectedFile={selectedFile} />

          <OutputSettings
            outputDir={outputDir}
            sourceOutputDir={sourceOutputDir}
            useSourceFolder={useSourceFolder}
            selectedConversion={selectedConversion}
            options={options}
            onPickOutputDir={pickOutputDir}
            onUseSourceFolderChange={changeUseSourceFolder}
            onOptionsChange={setOptions}
          />
        </section>

        <PreviewPanel selectedFile={selectedFile} onOpenExternal={openExternalPreview} />
      </main>
    </div>
  );
}

function ConversionToastView({
  toast,
  onClose
}: {
  toast: ConversionToast;
  onClose: () => void;
}): JSX.Element {
  const isSuccess = toast.variant === "success";
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div
        role="status"
        className={[
          "conversion-toast pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-md border px-4 py-3 shadow-xl",
          isSuccess
            ? "border-lime-300 bg-lime-50 text-lime-950"
            : "border-red-200 bg-red-50 text-red-950"
        ].join(" ")}
      >
        {isSuccess ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-lime-700" />
        ) : (
          <XCircle className="mt-0.5 h-5 w-5 flex-none text-red-700" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{toast.title}</p>
          <p className="mt-1 line-clamp-2 text-sm leading-5 opacity-90">{toast.message}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={[
            "inline-flex h-7 w-7 flex-none items-center justify-center rounded-md transition",
            isSuccess ? "text-lime-800 hover:bg-lime-100" : "text-red-800 hover:bg-red-100"
          ].join(" ")}
          aria-label="알림 닫기"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function sortFiles(files: FileItem[], sortMode: SortMode): FileItem[] {
  return [...files].sort((a, b) => {
    if (sortMode === "name") return a.name.localeCompare(b.name, "ko");
    if (sortMode === "date") return a.modifiedAt - b.modifiedAt;
    if (sortMode === "type") return a.extension.localeCompare(b.extension, "ko");
    if (sortMode === "size") return a.size - b.size;
    return a.dropIndex - b.dropIndex;
  });
}

async function extractDroppedPaths(dataTransfer: DataTransfer | null): Promise<string[]> {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files || []);
  const preloadPaths = window.convertSmith.getDroppedFilePaths(files);
  if (preloadPaths.length > 0) return preloadPaths;
  return files.map((file) => file.path).filter((filePath): filePath is string => Boolean(filePath));
}

function getParentDir(filePath: string): string {
  const normalized = filePath.replace(/\//g, "\\");
  const index = normalized.lastIndexOf("\\");
  return index > 0 ? normalized.slice(0, index) : "";
}

function getOutputDirForSources(sourcePaths: string[], useSourceFolder: boolean, outputDir?: string): string | undefined {
  if (!useSourceFolder) return outputDir;
  const firstSource = sourcePaths[0];
  return firstSource ? getParentDir(firstSource) : undefined;
}
