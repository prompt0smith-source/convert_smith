import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, FileCog, FileStack, ShieldCheck, X, XCircle } from "lucide-react";
import type {
  ConversionJob,
  ConversionOptions,
  ConversionType,
  ConvertMode,
  DependencyStatus,
  FileItem,
  PdfRotation,
  PdfSplitGroup,
  PdfToolJob,
  PdfToolType,
  SortMode,
  StartConversionPayload,
  StartPdfToolPayload,
  WorkMode
} from "../main/types/conversion";
import { DropZone } from "./components/DropZone";
import { ConversionTypeSelector } from "./components/ConversionTypeSelector";
import { OutputSettings } from "./components/OutputSettings";
import { PreviewPanel } from "./components/PreviewPanel";
import { UtilityDrawer } from "./components/UtilityDrawer";
import { PdfToolsPanel } from "./components/PdfToolsPanel";
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
  sortMode: "basic",
  useDatedSubfolder: false
};

const OUTPUT_DIR_STORAGE_KEY = "convertSmith.outputDir";
const USE_SOURCE_FOLDER_STORAGE_KEY = "convertSmith.useSourceFolder";
const USE_DATED_SUBFOLDER_STORAGE_KEY = "convertSmith.useDatedSubfolder";
const CLEAR_AFTER_SUCCESS_STORAGE_KEY = "convertSmith.clearFilesAfterSuccess";
const OPEN_FOLDER_AFTER_SUCCESS_STORAGE_KEY = "convertSmith.openFolderAfterSuccess";
const OPEN_FILE_AFTER_SUCCESS_STORAGE_KEY = "convertSmith.openFileAfterSuccess";
const STORAGE_GUIDE_KEY = "convertSmith.storageGuideSeen";
const INTERNAL_FILE_DRAG_TYPE = "application/x-convert-smith-file-id";
const INTERNAL_PAGE_DRAG_TYPE = "application/x-convert-smith-page";

interface ConversionToast {
  id: string;
  variant: "success" | "failure";
  title: string;
  message: string;
}

interface LoadingOverlayState {
  total: number;
  expectedJobs: number;
  completed: number;
  progress: number;
  message: string;
}

interface ActiveRunJobState {
  status: ConversionJob["status"];
  progress: number;
  message: string;
}

export function App(): JSX.Element {
  const rememberedOutputDir = localStorage.getItem(OUTPUT_DIR_STORAGE_KEY) || undefined;
  const notifiedJobIds = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<number>();
  const loadingHideTimerRef = useRef<number>();
  const modeTimerRefs = useRef<number[]>([]);
  const activeRunJobsRef = useRef<Map<string, ActiveRunJobState>>(new Map());

  const [files, setFiles] = useState<FileItem[]>([]);
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [pdfToolJobs, setPdfToolJobs] = useState<PdfToolJob[]>([]);
  const [workMode, setWorkMode] = useState<WorkMode>("convert");
  const [displayedWorkMode, setDisplayedWorkMode] = useState<WorkMode>("convert");
  const [modeAnimation, setModeAnimation] = useState<"idle" | "exiting" | "entering">("idle");
  const [sortMode, setSortMode] = useState<SortMode>("basic");
  const [convertMode, setConvertMode] = useState<ConvertMode>("batch");
  const [batchConversionType, setBatchConversionType] = useState<ConversionType>();
  const [individualTargets, setIndividualTargets] = useState<Record<string, ConversionType>>({});
  const [pdfToolType, setPdfToolType] = useState<PdfToolType>("pdf_merge");
  const [pdfOutputName, setPdfOutputName] = useState("merged_pdf");
  const [pdfPreviewPage, setPdfPreviewPage] = useState(1);
  const [pdfPageOrder, setPdfPageOrder] = useState<number[]>([]);
  const [pdfPageRotations, setPdfPageRotations] = useState<Record<number, PdfRotation>>({});
  const [pdfSplitGroups, setPdfSplitGroups] = useState<PdfSplitGroup[]>([]);
  const [outputDir, setOutputDir] = useState<string | undefined>(rememberedOutputDir);
  const [useSourceFolder, setUseSourceFolder] = useState(() => {
    const stored = localStorage.getItem(USE_SOURCE_FOLDER_STORAGE_KEY);
    if (stored) return stored === "true";
    return !rememberedOutputDir;
  });
  const [clearFilesAfterSuccess, setClearFilesAfterSuccess] = useState(
    () => localStorage.getItem(CLEAR_AFTER_SUCCESS_STORAGE_KEY) === "true"
  );
  const [openFolderAfterSuccess, setOpenFolderAfterSuccess] = useState(
    () => localStorage.getItem(OPEN_FOLDER_AFTER_SUCCESS_STORAGE_KEY) === "true"
  );
  const [openFileAfterSuccess, setOpenFileAfterSuccess] = useState(
    () => localStorage.getItem(OPEN_FILE_AFTER_SUCCESS_STORAGE_KEY) === "true"
  );
  const [selectedFileId, setSelectedFileId] = useState<string>();
  const [options, setOptions] = useState<ConversionOptions>(() => {
    const libreOfficePath = localStorage.getItem("convertSmith.libreOfficePath") || undefined;
    const useDatedSubfolder = localStorage.getItem(USE_DATED_SUBFOLDER_STORAGE_KEY) === "true";
    return { ...DEFAULT_OPTIONS, libreOfficePath, useDatedSubfolder };
  });
  const [dependencyStatus, setDependencyStatus] = useState<DependencyStatus>();
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [darkMode, setDarkMode] = useState(localStorage.getItem("convertSmith.darkMode") === "true");
  const [floatingEnabled, setFloatingEnabled] = useState(true);
  const [isUtilityOpen, setIsUtilityOpen] = useState(false);
  const [arrowBurst, setArrowBurst] = useState(false);
  const [toast, setToast] = useState<ConversionToast>();
  const [loadingOverlay, setLoadingOverlay] = useState<LoadingOverlayState>();

  const displayFiles = useMemo(() => sortFiles(files, sortMode), [files, sortMode]);
  const selectedFile = files.find((item) => item.id === selectedFileId) || files[0];
  const pdfDisplayFiles = useMemo(() => displayFiles.filter((item) => item.extension === ".pdf"), [displayFiles]);
  const selectedPdfFile = selectedFile?.extension === ".pdf" ? selectedFile : pdfDisplayFiles[0];
  const activePreviewFile = displayedWorkMode === "pdf_tools" ? selectedPdfFile : selectedFile;
  const sourceAnchorFile = displayedWorkMode === "pdf_tools" ? selectedPdfFile : selectedFile;
  const sourceOutputDir = sourceAnchorFile ? getParentDir(sourceAnchorFile.path) : files[0] ? getParentDir(files[0].path) : undefined;
  const commonConversions = useMemo(() => getCommonConversions(files), [files]);
  const selectedConversion =
    convertMode === "batch"
      ? batchConversionType
      : selectedFile
        ? individualTargets[selectedFile.id] || selectedFile.supportedConversions[0]
        : undefined;

  const getPlannedRunInfo = useCallback((): Pick<LoadingOverlayState, "total" | "expectedJobs"> => {
    const sorted = sortFiles(files, sortMode);
    if (sorted.length === 0) return { total: 0, expectedJobs: 0 };

    if (displayedWorkMode === "pdf_tools") {
      const pdfFiles = sorted.filter((item) => item.extension === ".pdf");
      if (pdfFiles.length === 0) return { total: 0, expectedJobs: 0 };
      return { total: Math.max(1, pdfToolType === "pdf_merge" ? pdfFiles.length : 1), expectedJobs: 1 };
    }

    if (convertMode === "batch") {
      if (!batchConversionType) return { total: 0, expectedJobs: 0 };
      const createsOneJobPerFile = batchConversionType === "pdf_to_docx" || batchConversionType === "pdf_to_images";
      return { total: sorted.length, expectedJobs: createsOneJobPerFile ? sorted.length : 1 };
    }

    return { total: sorted.length, expectedJobs: sorted.length };
  }, [batchConversionType, convertMode, displayedWorkMode, files, pdfToolType, sortMode]);

  const beginLoadingOverlay = useCallback(
    (message: string) => {
      const planned = getPlannedRunInfo();
      if (planned.total <= 0 || planned.expectedJobs <= 0) return;
      if (loadingHideTimerRef.current) {
        window.clearTimeout(loadingHideTimerRef.current);
      }
      activeRunJobsRef.current.clear();
      setLoadingOverlay({
        ...planned,
        completed: 0,
        progress: 0,
        message
      });
    },
    [getPlannedRunInfo]
  );

  const updateLoadingOverlayFromJob = useCallback((job: ConversionJob | PdfToolJob) => {
    setLoadingOverlay((current) => {
      if (!current) return current;

      const runJobs = activeRunJobsRef.current;
      if (!runJobs.has(job.id) && runJobs.size >= current.expectedJobs) return current;

      runJobs.set(job.id, {
        status: job.status,
        progress: isTerminalStatus(job.status) ? 100 : clampProgress(job.progress),
        message: job.message
      });

      const trackedJobs = Array.from(runJobs.values());
      const terminalCount = trackedJobs.filter((item) => isTerminalStatus(item.status)).length;
      const expectedJobs = Math.max(1, current.expectedJobs);
      const progressSum = trackedJobs.reduce(
        (sum, item) => sum + (isTerminalStatus(item.status) ? 100 : clampProgress(item.progress)),
        0
      );
      const aggregateProgress = clampProgress(progressSum / expectedJobs);
      const completed =
        expectedJobs === 1
          ? terminalCount > 0
            ? current.total
            : Math.min(Math.max(current.total - 1, 0), Math.floor((aggregateProgress / 100) * current.total))
          : Math.min(current.total, terminalCount);

      return {
        ...current,
        completed,
        progress: aggregateProgress,
        message: job.message || current.message
      };
    });
  }, []);

  const showCompletionToast = useCallback(
    (completedJobs: Array<ConversionJob | PdfToolJob>) => {
      const freshJobs = completedJobs.filter((job) => !notifiedJobIds.current.has(job.id));
      if (freshJobs.length === 0) return;
      freshJobs.forEach((job) => notifiedJobIds.current.add(job.id));

      const successCount = freshJobs.filter((job) => job.status === "success").length;
      const failedJobs = freshJobs.filter((job) => job.status === "failed");
      if (successCount === 0 && failedJobs.length === 0) return;

      const failedNames = failedJobs.map((job) => shortenName(getPrimarySourceName(job), 8));
      const failedText =
        failedNames.length === 0
          ? ""
          : failedNames.length === 1
            ? `${failedNames[0]} 파일은 변환하지 못했습니다.`
            : `${failedNames.slice(0, 2).join(", ")}${failedNames.length > 2 ? " 외" : ""} ${failedJobs.length}건은 변환하지 못했습니다.`;

      const nextToast: ConversionToast =
        successCount > 0
          ? {
              id: `success-summary-${Date.now()}`,
              variant: "success",
              title: failedJobs.length > 0 ? "일부 작업 완료" : "변환 완료",
              message:
                failedJobs.length > 0
                  ? `${successCount}건이 완료되었습니다. ${failedText}`
                  : `${successCount}건의 변환이 정상 완료되었습니다.`
            }
          : {
              id: `failure-summary-${Date.now()}`,
              variant: "failure",
              title: "변환 실패",
              message:
                failedJobs.length === 1
                  ? `${failedNames[0]} 변환을 완료하지 못했습니다.`
                  : `${failedText || `${failedJobs.length}건을 완료하지 못했습니다.`}`
            };

      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
      setToast(nextToast);
      toastTimeoutRef.current = window.setTimeout(() => setToast(undefined), 4200);
    },
    []
  );

  const upsertJob = useCallback(
    (job: ConversionJob) => {
      updateLoadingOverlayFromJob(job);
      setJobs((current) => {
        const index = current.findIndex((item) => item.id === job.id);
        if (index === -1) return [job, ...current];
        const next = [...current];
        next[index] = job;
        return next;
      });
    },
    [updateLoadingOverlayFromJob]
  );

  const upsertPdfToolJob = useCallback(
    (job: PdfToolJob) => {
      updateLoadingOverlayFromJob(job);
      setPdfToolJobs((current) => {
        const index = current.findIndex((item) => item.id === job.id);
        if (index === -1) return [job, ...current];
        const next = [...current];
        next[index] = job;
        return next;
      });
    },
    [updateLoadingOverlayFromJob]
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
    const unsubscribe = window.convertSmith.onPdfToolUpdate(upsertPdfToolJob);
    return unsubscribe;
  }, [upsertPdfToolJob]);

  useEffect(() => {
    refreshDependencies();
  }, [refreshDependencies]);

  useEffect(() => {
    window.convertSmith
      .getFloatingEnabled()
      .then(setFloatingEnabled)
      .catch(() => setFloatingEnabled(true));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("convertSmith.darkMode", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem(USE_DATED_SUBFOLDER_STORAGE_KEY, String(Boolean(options.useDatedSubfolder)));
  }, [options.useDatedSubfolder]);

  useEffect(() => {
    localStorage.setItem(CLEAR_AFTER_SUCCESS_STORAGE_KEY, String(clearFilesAfterSuccess));
  }, [clearFilesAfterSuccess]);

  useEffect(() => {
    localStorage.setItem(OPEN_FOLDER_AFTER_SUCCESS_STORAGE_KEY, String(openFolderAfterSuccess));
  }, [openFolderAfterSuccess]);

  useEffect(() => {
    localStorage.setItem(OPEN_FILE_AFTER_SUCCESS_STORAGE_KEY, String(openFileAfterSuccess));
  }, [openFileAfterSuccess]);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_GUIDE_KEY)) return;
    setNotice("기본 저장은 선택한 폴더에 바로 저장됩니다. 날짜별 하위 폴더 저장은 옵션에서 켤 수 있습니다.");
    localStorage.setItem(STORAGE_GUIDE_KEY, "true");
  }, []);

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
    setPdfPreviewPage(1);
  }, [selectedPdfFile?.path]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        window.clearTimeout(toastTimeoutRef.current);
      }
      if (loadingHideTimerRef.current) {
        window.clearTimeout(loadingHideTimerRef.current);
      }
      modeTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
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

  const changeWorkMode = useCallback(
    (nextMode: WorkMode) => {
      if (nextMode === workMode || modeAnimation !== "idle") return;
      modeTimerRefs.current.forEach((timer) => window.clearTimeout(timer));
      modeTimerRefs.current = [];
      setWorkMode(nextMode);
      setModeAnimation("exiting");
      const swapTimer = window.setTimeout(() => {
        setDisplayedWorkMode(nextMode);
        setModeAnimation("entering");
        const idleTimer = window.setTimeout(() => setModeAnimation("idle"), 280);
        modeTimerRefs.current.push(idleTimer);
      }, 240);
      modeTimerRefs.current.push(swapTimer);
    },
    [modeAnimation, workMode]
  );

  const reorderFiles = useCallback((orderedIds: string[]) => {
    setSortMode("custom");
    setFiles((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      const ordered = orderedIds.map((id) => byId.get(id)).filter((item): item is FileItem => Boolean(item));
      const orderedSet = new Set(orderedIds);
      const remaining = current.filter((item) => !orderedSet.has(item.id));
      return [...ordered, ...remaining].map((item, index) => ({ ...item, dropIndex: index }));
    });
  }, []);

  const resolvePaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) {
        setNotice("파일을 추가하지 못했습니다. 파일 선택 버튼으로 다시 추가해주세요.");
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
      if (!isExternalFileDrag(event)) return;
      dragDepth += 1;
      setIsDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      prevent(event);
      if (!isExternalFileDrag(event)) return;
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      prevent(event);
      if (!isExternalFileDrag(event)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setIsDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      prevent(event);
      dragDepth = 0;
      setIsDragging(false);
      if (!isExternalFileDrag(event)) return;
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

  const changeFloatingEnabled = async (value: boolean) => {
    setFloatingEnabled(value);
    try {
      const confirmed = await window.convertSmith.setFloatingEnabled(value);
      setFloatingEnabled(confirmed);
    } catch (error) {
      setNotice(practicalError(error));
      setFloatingEnabled((current) => !current);
    }
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

      if (submittedJobs.length > 0) {
        showCompletionToast(submittedJobs);
        void runCompletionActions(submittedJobs);
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

  const startPdfTool = async (): Promise<PdfToolJob> => {
    const sortedPdfFiles = sortFiles(files, sortMode).filter((item) => item.extension === ".pdf");
    if (sortedPdfFiles.length === 0) {
      const message = "PDF 도구를 사용하려면 PDF 파일을 먼저 추가해주세요.";
      setNotice(message);
      throw new Error(message);
    }

    const sourcePaths =
      pdfToolType === "pdf_merge"
        ? sortedPdfFiles.map((item) => item.path)
        : [(selectedPdfFile || sortedPdfFiles[0]).path];

    if (pdfToolType === "pdf_merge" && sourcePaths.length < 2) {
      const message = "PDF 병합에는 PDF 파일이 2개 이상 필요합니다.";
      setNotice(message);
      throw new Error(message);
    }

    const targetOutputDir = getOutputDirForSources(sourcePaths, useSourceFolder, outputDir);
    if (!targetOutputDir) {
      const message = useSourceFolder ? "원본 PDF 폴더를 감지할 파일이 필요합니다." : "저장할 폴더를 지정해주세요.";
      setNotice(message);
      throw new Error(message);
    }

    const payload: StartPdfToolPayload = {
      sourcePaths,
      outputDir: targetOutputDir,
      toolType: pdfToolType,
      options: {
        outputName: pdfOutputName,
        pageOrder: pdfPageOrder,
        pageRotations: pdfPageRotations,
        splitGroups: pdfSplitGroups,
        useDatedSubfolder: options.useDatedSubfolder
      }
    };
    const job = await window.convertSmith.startPdfTool(payload);
    upsertPdfToolJob(job);
    showCompletionToast([job]);
    void runCompletionActions([job]);
    return job;
  };

  const triggerConversion = () => {
    if (isConverting) return;
    setArrowBurst(false);
    window.requestAnimationFrame(() => setArrowBurst(true));
    window.setTimeout(() => setArrowBurst(false), 620);
    const run = displayedWorkMode === "pdf_tools" ? startPdfTool : startConversion;
    beginLoadingOverlay(displayedWorkMode === "pdf_tools" ? "PDF 작업을 준비하고 있습니다." : "파일 변환을 준비하고 있습니다.");
    setIsConverting(true);
    void run()
      .catch((error: unknown) => setNotice(practicalError(error)))
      .finally(() => {
        setIsConverting(false);
        if (loadingHideTimerRef.current) {
          window.clearTimeout(loadingHideTimerRef.current);
        }
        loadingHideTimerRef.current = window.setTimeout(() => {
          setLoadingOverlay(undefined);
          activeRunJobsRef.current.clear();
        }, 520);
      });
  };

  const openExternalPreview = async (item?: FileItem) => {
    if (!item) return;
    const result = await window.convertSmith.previewFile(item.path);
    if (!result.ok) setNotice(result.message);
  };

  const openPath = async (filePath: string) => {
    const result = await window.convertSmith.previewFile(filePath);
    if (!result.ok) setNotice(result.message);
  };

  const rotateCurrentPdfPreview = () => {
    if (!selectedPdfFile) return;
    if (pdfToolType === "pdf_merge") {
      setPdfToolType("pdf_reorder");
    }
    const page = Math.max(1, Math.trunc(pdfPreviewPage) || 1);
    setPdfPageRotations((current) => {
      const nextRotation = ((((current[page] || 0) + 90) % 360) || 0) as PdfRotation;
      const next = { ...current };
      if (nextRotation === 0) delete next[page];
      else next[page] = nextRotation;
      return next;
    });
  };

  const revealPath = async (filePath: string) => {
    const result = await window.convertSmith.revealPath(filePath);
    if (!result.ok) setNotice(result.message);
  };

  const copyPath = async (filePath: string) => {
    await navigator.clipboard.writeText(filePath);
    setNotice("경로를 복사했습니다.");
  };

  const runCompletionActions = async (completedJobs: Array<ConversionJob | PdfToolJob>) => {
    const outputPaths = completedJobs
      .filter((job) => job.status === "success")
      .flatMap((job) => job.outputPaths);
    if (outputPaths.length === 0) return;

    const firstOutput = outputPaths[0];
    if (openFolderAfterSuccess) {
      await revealPath(firstOutput);
    }
    if (openFileAfterSuccess) {
      await openPath(firstOutput);
    }
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
      {loadingOverlay && <ConversionLoadingOverlay state={loadingOverlay} />}

      <header className="border-b border-stone-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-normal text-stone-950">Convert Smith</h1>
            <p className="mt-1 text-sm text-stone-600">{helperMessages.appSubtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="inline-grid grid-cols-2 rounded-md border border-stone-200 bg-stone-100 p-1 text-sm">
              <button
                type="button"
                onClick={() => changeWorkMode("convert")}
                className={[
                  "inline-flex h-9 items-center justify-center gap-2 rounded px-3",
                  workMode === "convert" ? "bg-white font-semibold text-emerald-800 shadow-sm" : "text-stone-600"
                ].join(" ")}
              >
                <FileCog size={15} />
                파일 변환
              </button>
              <button
                type="button"
                onClick={() => changeWorkMode("pdf_tools")}
                className={[
                  "inline-flex h-9 items-center justify-center gap-2 rounded px-3",
                  workMode === "pdf_tools" ? "bg-white font-semibold text-emerald-800 shadow-sm" : "text-stone-600"
                ].join(" ")}
              >
                <FileStack size={15} />
                PDF 도구
              </button>
            </div>
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
              floatingEnabled={floatingEnabled}
              clearFilesAfterSuccess={clearFilesAfterSuccess}
              openFolderAfterSuccess={openFolderAfterSuccess}
              openFileAfterSuccess={openFileAfterSuccess}
              onToggle={() => setIsUtilityOpen((value) => !value)}
              onClose={() => setIsUtilityOpen(false)}
              onRefreshDependencies={refreshDependencies}
              onPickLibreOfficePath={pickLibreOfficePath}
              onOpenLibreOfficeDownload={openLibreOfficeDownload}
              onDarkModeChange={setDarkMode}
              onFloatingEnabledChange={changeFloatingEnabled}
              onClearFilesAfterSuccessChange={setClearFilesAfterSuccess}
              onOpenFolderAfterSuccessChange={setOpenFolderAfterSuccess}
              onOpenFileAfterSuccessChange={setOpenFileAfterSuccess}
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
          onPickFiles={pickFiles}
          onSortModeChange={setSortMode}
          onSelectFile={(item) => setSelectedFileId(item.id)}
          onRemoveFile={removeFile}
          onReorderFiles={reorderFiles}
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

        <div
          className={[
            "mode-panel min-h-0 overflow-hidden",
            modeAnimation === "exiting" ? "mode-panel--exiting" : "",
            modeAnimation === "entering" ? "mode-panel--entering" : ""
          ].join(" ")}
        >
          {displayedWorkMode === "convert" ? (
            <section className="h-full min-h-0 overflow-auto border-r border-stone-200 bg-white">
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
          ) : (
            <PdfToolsPanel
              displayFiles={displayFiles}
              selectedFile={selectedPdfFile}
              outputDir={outputDir}
              sourceOutputDir={sourceOutputDir}
              useSourceFolder={useSourceFolder}
              useDatedSubfolder={Boolean(options.useDatedSubfolder)}
              toolType={pdfToolType}
              outputName={pdfOutputName}
              selectedPage={pdfPreviewPage}
              pageOrder={pdfPageOrder}
              pageRotations={pdfPageRotations}
              splitGroups={pdfSplitGroups}
              pdfToolJobs={pdfToolJobs}
              onSelectFile={(item) => setSelectedFileId(item.id)}
              onToolTypeChange={setPdfToolType}
              onOutputNameChange={setPdfOutputName}
              onPagePreviewChange={setPdfPreviewPage}
              onPageOrderChange={setPdfPageOrder}
              onPageRotationsChange={setPdfPageRotations}
              onSplitGroupsChange={setPdfSplitGroups}
              onPickOutputDir={pickOutputDir}
              onUseSourceFolderChange={changeUseSourceFolder}
              onUseDatedSubfolderChange={(value) => setOptions((current) => ({ ...current, useDatedSubfolder: value }))}
              onOpenPath={openPath}
              onReveal={revealPath}
              onCopy={copyPath}
              onNotice={setNotice}
            />
          )}
        </div>

        <PreviewPanel
          selectedFile={activePreviewFile}
          onOpenExternal={openExternalPreview}
          pdfPageNumber={displayedWorkMode === "pdf_tools" ? pdfPreviewPage : 1}
          pdfRotation={displayedWorkMode === "pdf_tools" ? pdfPageRotations[pdfPreviewPage] || 0 : 0}
          onRotatePdfPreview={
            displayedWorkMode === "pdf_tools" && activePreviewFile?.extension === ".pdf"
              ? rotateCurrentPdfPreview
              : undefined
          }
        />
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

function ConversionLoadingOverlay({ state }: { state: LoadingOverlayState }): JSX.Element {
  const progress = Math.round(clampProgress(state.progress));
  const completed = Math.min(state.total, Math.max(0, state.completed));
  const title = "변환 중입니다";

  return (
    <div className="smith-loader-overlay smith-loader-overlay--show" role="status" aria-live="polite">
      <div className="smith-loader-card">
        <WaterDropLoader />
        <div className="smith-page-loader-text" aria-hidden="true">
          <span className="smith-page-loader-label is-animating">
            {Array.from(title).map((char, index) => (
              <span
                className="smith-page-loader-char"
                style={{ animationDelay: `${index * 36}ms` }}
                key={`${char}-${index}`}
              >
                {char === " " ? "\u00a0" : char}
              </span>
            ))}
          </span>
        </div>
        <p className="max-w-[320px] text-center text-sm leading-5 text-stone-700">{state.message}</p>
        <div className="w-full">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-stone-600">
            <span>진행률 {progress}%</span>
            <span>
              {completed}/{state.total}
            </span>
          </div>
          <div className="smith-loader-progress" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function WaterDropLoader(): JSX.Element {
  return (
    <div className="smith-water-drop-loader" aria-hidden="true">
      <svg className="smith-water-drop-loader-svg" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="smith-water-drop-gooey">
          <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7"
            result="gooey"
          />
          <feBlend in="SourceGraphic" in2="gooey" />
        </filter>
      </svg>
      <div className="smith-water-drop-loader-gooey">
        <span className="smith-water-drop-loader-main" />
        <span className="smith-water-drop-loader-orb" />
        <span className="smith-water-drop-loader-orb-small" />
        <span className="smith-water-drop-loader-splash smith-water-drop-loader-splash-1" />
        <span className="smith-water-drop-loader-splash smith-water-drop-loader-splash-2" />
        <span className="smith-water-drop-loader-splash smith-water-drop-loader-splash-3" />
        <span className="smith-water-drop-loader-merge smith-water-drop-loader-merge-1" />
        <span className="smith-water-drop-loader-merge smith-water-drop-loader-merge-2" />
        <span className="smith-water-drop-loader-merge smith-water-drop-loader-merge-3" />
      </div>
      <span className="smith-sr-only">Loading</span>
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

function isExternalFileDrag(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types || []);
  if (types.includes(INTERNAL_FILE_DRAG_TYPE) || types.includes(INTERNAL_PAGE_DRAG_TYPE)) return false;
  return types.includes("Files");
}

function getParentDir(filePath: string): string {
  const normalized = filePath.replace(/\//g, "\\");
  const index = normalized.lastIndexOf("\\");
  return index > 0 ? normalized.slice(0, index) : "";
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function isTerminalStatus(status: ConversionJob["status"]): boolean {
  return status === "success" || status === "failed" || status === "cancelled";
}

function getOutputDirForSources(sourcePaths: string[], useSourceFolder: boolean, outputDir?: string): string | undefined {
  if (!useSourceFolder) return outputDir;
  const firstSource = sourcePaths[0];
  return firstSource ? getParentDir(firstSource) : undefined;
}

function getPrimarySourceName(job: ConversionJob | PdfToolJob): string {
  const firstSource = job.sourcePaths[0];
  if (!firstSource) return "작업";
  const normalized = firstSource.replace(/\//g, "\\");
  const fileName = normalized.slice(normalized.lastIndexOf("\\") + 1);
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function shortenName(value: string, maxLength: number): string {
  const chars = Array.from(value.trim() || "작업");
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}...` : chars.join("");
}
