import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Edit3,
  FileCog,
  FileStack,
  FolderOpen,
  GripVertical,
  Maximize2,
  Minimize2,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import type {
  ConversionJob,
  ConversionOptions,
  ConversionType,
  ConvertMode,
  DependencyStatus,
  FileItem,
  PdfRotation,
  PdfSignatureStampOptions,
  PdfSplitGroup,
  PdfToolJob,
  PdfToolType,
  SortMode,
  StartConversionPayload,
  StartPdfToolPayload,
  WorkMode
} from "../main/types/conversion";
import type { ContextMenuLaunchRequest, ContextMenuStatus } from "../main/types/contextMenu";
import { DropZone, type FileSelectionModifiers } from "./components/DropZone";
import { ConversionTypeSelector } from "./components/ConversionTypeSelector";
import { OutputSettings } from "./components/OutputSettings";
import { PreviewPanel } from "./components/PreviewPanel";
import { UtilityDrawer } from "./components/UtilityDrawer";
import { PdfEditorPanel } from "./components/PdfEditorPanel";
import { PdfToolsPanel } from "./components/PdfToolsPanel";
import { formatBytes, getCommonConversions } from "./lib/formatLabels";
import { helperMessages, practicalError } from "./lib/koreanMessages";

const DEFAULT_OPTIONS: ConversionOptions = {
  imageQuality: 90,
  pdfImageFormat: "jpg",
  pdfRenderScale: 2,
  pdfPageSize: "auto",
  pdfToDocxMode: "visual_preservation",
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
const TERMS_ACCEPTED_STORAGE_KEY = "convertSmith.termsAcceptedVersion";
const TERMS_VERSION = "2026-06-15";
const INTERNAL_FILE_DRAG_TYPE = "application/x-convert-smith-file-id";
const INTERNAL_PAGE_DRAG_TYPE = "application/x-convert-smith-page";
const POINTER_DRAG_THRESHOLD = 5;

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

interface PlannedConversionEntry {
  file: FileItem;
  conversionType?: ConversionType;
}

interface PreflightNoticeItem {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  message: string;
}

interface FileListSnapshot {
  files: FileItem[];
  selectedFileId?: string;
  selectedFileIds: string[];
  selectionAnchorId?: string;
  individualTargets: Record<string, ConversionType>;
  sortMode: SortMode;
}

interface InternalFileClipboard {
  files: FileItem[];
  targets: Record<string, ConversionType>;
  cut: boolean;
}

interface FilePointerDragSession {
  pointerId: number;
  startX: number;
  startY: number;
  ids: string[];
  dragging: boolean;
}

interface FileDragGhostPosition {
  x: number;
  y: number;
}

interface QuickConversionPreset {
  label: string;
  preferredTypes: ConversionType[];
}

type CompactTask =
  | "pdf_merge"
  | "pdf_split_all"
  | "images_to_pdf"
  | "pdf_to_images"
  | "video_compatibility_repair"
  | "image_optimize"
  | "doc_to_pdf";

interface CompactTaskOption {
  value: CompactTask;
  label: string;
}

const COMPACT_TASK_OPTIONS: CompactTaskOption[] = [
  { value: "pdf_merge", label: "PDF 병합" },
  { value: "pdf_split_all", label: "PDF 분할" },
  { value: "images_to_pdf", label: "이미지 PDF" },
  { value: "pdf_to_images", label: "PDF 이미지" },
  { value: "video_compatibility_repair", label: "호환 MP4" },
  { value: "image_optimize", label: "이미지 최적화" },
  { value: "doc_to_pdf", label: "문서 PDF" }
];

const QUICK_CONVERSION_PRESETS: QuickConversionPreset[] = [
  { label: "문서를 PDF로", preferredTypes: ["docx_to_pdf", "xlsx_to_pdf", "pptx_to_pdf"] },
  { label: "이미지를 PDF로", preferredTypes: ["images_to_pdf"] },
  { label: "PDF를 이미지로", preferredTypes: ["pdf_to_images"] },
  { label: "동영상을 호환 MP4로", preferredTypes: ["video_compatibility_repair", "mov_to_mp4", "webm_to_mp4", "mkv_to_mp4"] },
  { label: "이미지를 가볍게", preferredTypes: ["jpg_optimize", "png_optimize", "webp_optimize", "image_to_webp"] }
];

const LIBRE_OFFICE_CONVERSIONS = new Set<ConversionType>([
  "docx_to_pdf",
  "xlsx_to_pdf",
  "xlsx_to_csv",
  "pptx_to_pdf"
]);

const VIDEO_ESTIMATE_CONVERSIONS = new Set<ConversionType>([
  "mp4_to_mp3",
  "mov_to_mp4",
  "webm_to_mp4",
  "mkv_to_mp4",
  "video_compatibility_repair"
]);

export function App(): JSX.Element {
  const rememberedOutputDir = localStorage.getItem(OUTPUT_DIR_STORAGE_KEY) || undefined;
  const notifiedJobIds = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<number>();
  const loadingHideTimerRef = useRef<number>();
  const modeTimerRefs = useRef<number[]>([]);
  const activeRunJobsRef = useRef<Map<string, ActiveRunJobState>>(new Map());
  const fileStateRef = useRef<FileListSnapshot>({
    files: [],
    selectedFileId: undefined,
    selectedFileIds: [],
    selectionAnchorId: undefined,
    individualTargets: {},
    sortMode: "basic"
  });
  const undoFileStackRef = useRef<FileListSnapshot[]>([]);
  const redoFileStackRef = useRef<FileListSnapshot[]>([]);
  const internalFileClipboardRef = useRef<InternalFileClipboard>();

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
  const [outputName, setOutputName] = useState("");
  const [pdfPreviewPage, setPdfPreviewPage] = useState(1);
  const [pdfPageOrder, setPdfPageOrder] = useState<number[]>([]);
  const [pdfPageRotations, setPdfPageRotations] = useState<Record<number, PdfRotation>>({});
  const [pdfSplitGroups, setPdfSplitGroups] = useState<PdfSplitGroup[]>([]);
  const [pdfSignatureStamp, setPdfSignatureStamp] = useState<PdfSignatureStampOptions>();
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
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string>();
  const [options, setOptions] = useState<ConversionOptions>(() => {
    const libreOfficePath = localStorage.getItem("convertSmith.libreOfficePath") || undefined;
    const useDatedSubfolder = localStorage.getItem(USE_DATED_SUBFOLDER_STORAGE_KEY) === "true";
    return { ...DEFAULT_OPTIONS, libreOfficePath, useDatedSubfolder };
  });
  const [dependencyStatus, setDependencyStatus] = useState<DependencyStatus>();
  const [contextMenuStatus, setContextMenuStatus] = useState<ContextMenuStatus>();
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [darkMode, setDarkMode] = useState(localStorage.getItem("convertSmith.darkMode") === "true");
  const [floatingEnabled, setFloatingEnabled] = useState(true);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [isUtilityOpen, setIsUtilityOpen] = useState(false);
  const [isCompactMode, setIsCompactMode] = useState(false);
  const [compactTask, setCompactTask] = useState<CompactTask>("pdf_merge");
  const [isCompactOptionsOpen, setIsCompactOptionsOpen] = useState(true);
  const [isCompactCompletionOpen, setIsCompactCompletionOpen] = useState(false);
  const [arrowBurst, setArrowBurst] = useState(false);
  const [toast, setToast] = useState<ConversionToast>();
  const [loadingOverlay, setLoadingOverlay] = useState<LoadingOverlayState>();
  const [termsAccepted, setTermsAccepted] = useState(
    () => localStorage.getItem(TERMS_ACCEPTED_STORAGE_KEY) === TERMS_VERSION
  );

  const plannedConversionEntries = useMemo(
    () => getPlannedConversionEntries(files, sortMode, convertMode, batchConversionType, individualTargets),
    [batchConversionType, convertMode, files, individualTargets, sortMode]
  );
  const conversionPreflightItems = useMemo(
    () => buildConversionPreflightItems(plannedConversionEntries, dependencyStatus),
    [dependencyStatus, plannedConversionEntries]
  );

  const displayFiles = useMemo(() => sortFiles(files, sortMode), [files, sortMode]);
  const selectedFile = files.find((item) => item.id === selectedFileId) || files[0];
  const pdfDisplayFiles = useMemo(() => displayFiles.filter((item) => item.extension === ".pdf"), [displayFiles]);
  const selectedPdfFile = selectedFile?.extension === ".pdf" ? selectedFile : pdfDisplayFiles[0];
  const isPdfWorkMode = displayedWorkMode === "pdf_tools" || displayedWorkMode === "pdf_editor";
  const activePreviewFile = isPdfWorkMode ? selectedPdfFile : selectedFile;
  const sourceAnchorFile = isPdfWorkMode ? selectedPdfFile : selectedFile;
  const sourceOutputDir = sourceAnchorFile ? getParentDir(sourceAnchorFile.path) : files[0] ? getParentDir(files[0].path) : undefined;
  const commonConversions = useMemo(() => getCommonConversions(files), [files]);
  const selectedConversion =
    convertMode === "batch"
      ? batchConversionType
      : selectedFile
        ? individualTargets[selectedFile.id] || selectedFile.supportedConversions[0]
        : undefined;

  useEffect(() => {
    fileStateRef.current = {
      files,
      selectedFileId,
      selectedFileIds,
      selectionAnchorId,
      individualTargets,
      sortMode
    };
  }, [files, individualTargets, selectedFileId, selectedFileIds, selectionAnchorId, sortMode]);

  const captureFileSnapshot = useCallback((): FileListSnapshot => {
    const current = fileStateRef.current;
    return {
      files: cloneFileItems(current.files),
      selectedFileId: current.selectedFileId,
      selectedFileIds: [...current.selectedFileIds],
      selectionAnchorId: current.selectionAnchorId,
      individualTargets: { ...current.individualTargets },
      sortMode: current.sortMode
    };
  }, []);

  const applyFileSnapshot = useCallback((snapshot: FileListSnapshot) => {
    setFiles(cloneFileItems(snapshot.files));
    setSelectedFileId(snapshot.selectedFileId);
    setSelectedFileIds([...snapshot.selectedFileIds]);
    setSelectionAnchorId(snapshot.selectionAnchorId);
    setIndividualTargets({ ...snapshot.individualTargets });
    setSortMode(snapshot.sortMode);
  }, []);

  const pushFileHistory = useCallback(() => {
    undoFileStackRef.current.push(captureFileSnapshot());
    if (undoFileStackRef.current.length > 80) {
      undoFileStackRef.current.shift();
    }
    redoFileStackRef.current = [];
  }, [captureFileSnapshot]);

  const undoFileAction = useCallback(() => {
    const previous = undoFileStackRef.current.pop();
    if (!previous) return;
    redoFileStackRef.current.push(captureFileSnapshot());
    applyFileSnapshot(previous);
    setNotice("파일 목록 작업을 되돌렸습니다.");
  }, [applyFileSnapshot, captureFileSnapshot]);

  const redoFileAction = useCallback(() => {
    const next = redoFileStackRef.current.pop();
    if (!next) return;
    undoFileStackRef.current.push(captureFileSnapshot());
    applyFileSnapshot(next);
    setNotice("파일 목록 작업을 다시 적용했습니다.");
  }, [applyFileSnapshot, captureFileSnapshot]);

  const getPlannedRunInfo = useCallback((): Pick<LoadingOverlayState, "total" | "expectedJobs"> => {
    const sorted = sortFiles(files, sortMode);
    if (sorted.length === 0) return { total: 0, expectedJobs: 0 };

    if (displayedWorkMode === "pdf_editor") {
      return { total: 0, expectedJobs: 0 };
    }

    if (displayedWorkMode === "pdf_tools") {
      const pdfFiles = sorted.filter((item) => item.extension === ".pdf");
      if (pdfFiles.length === 0) return { total: 0, expectedJobs: 0 };
      return { total: Math.max(1, pdfToolType === "pdf_merge" ? pdfFiles.length : 1), expectedJobs: 1 };
    }

    if (convertMode === "batch") {
      if (!batchConversionType) return { total: 0, expectedJobs: 0 };
      const createsOneJobPerFile =
        batchConversionType === "pdf_to_docx" ||
        batchConversionType === "pdf_to_xlsx" ||
        batchConversionType === "pdf_to_images";
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

  const refreshContextMenuStatus = useCallback(() => {
    window.convertSmith
      .getContextMenuStatus()
      .then(setContextMenuStatus)
      .catch((error: unknown) => setNotice(practicalError(error)));
  }, []);

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
    refreshContextMenuStatus();
  }, [refreshContextMenuStatus]);

  useEffect(() => {
    window.convertSmith
      .getFloatingEnabled()
      .then(setFloatingEnabled)
      .catch(() => setFloatingEnabled(true));
  }, []);

  useEffect(() => {
    window.convertSmith
      .getAlwaysOnTop()
      .then(setAlwaysOnTop)
      .catch(() => setAlwaysOnTop(false));
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
    if (files.length === 0) {
      if (selectedFileId) setSelectedFileId(undefined);
      setSelectedFileIds([]);
      if (selectionAnchorId) setSelectionAnchorId(undefined);
      return;
    }

    const existingIds = new Set(files.map((item) => item.id));
    const nextSelectedFileId = selectedFileId && existingIds.has(selectedFileId) ? selectedFileId : undefined;
    if (selectedFileId && !nextSelectedFileId) {
      setSelectedFileId(undefined);
    }

    setSelectedFileIds((current) => {
      const filtered = current.filter((id) => existingIds.has(id));
      return sameStringArray(current, filtered) ? current : filtered;
    });

    if (selectionAnchorId && !existingIds.has(selectionAnchorId)) {
      setSelectionAnchorId(nextSelectedFileId);
    }
  }, [files, selectedFileId, selectionAnchorId]);

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
          setSelectedFileIds([deduped[0].id]);
          setSelectionAnchorId(deduped[0].id);
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

  const applyQuickPreset = useCallback(
    (preset: QuickConversionPreset) => {
      const sorted = sortFiles(files, sortMode);
      if (sorted.length === 0) {
        setNotice("프리셋을 적용하려면 파일을 먼저 추가해주세요.");
        return;
      }

      const commonPresetType = preset.preferredTypes.find((type) => getCommonConversions(sorted).includes(type));
      changeWorkMode("convert");

      if (commonPresetType) {
        setConvertMode("batch");
        setBatchConversionType(commonPresetType);
        setNotice(`${preset.label} 프리셋을 적용했습니다.`);
        return;
      }

      const nextTargets: Record<string, ConversionType> = {};
      for (const item of sorted) {
        const target = preset.preferredTypes.find((type) => item.supportedConversions.includes(type));
        if (!target) {
          setNotice(`${preset.label} 프리셋을 현재 파일 전체에 적용할 수 없습니다.`);
          return;
        }
        nextTargets[item.id] = target;
      }

      setConvertMode("individual");
      setIndividualTargets((current) => ({ ...current, ...nextTargets }));
      setNotice(`${preset.label} 프리셋을 파일별로 적용했습니다.`);
    },
    [changeWorkMode, files, sortMode]
  );

  const syncCompactTask = useCallback((task: CompactTask, sourceFiles: FileItem[]) => {
    setCompactTask(task);
    setModeAnimation("idle");

    if (task === "pdf_merge" || task === "pdf_split_all") {
      setWorkMode("pdf_tools");
      setDisplayedWorkMode("pdf_tools");
      setPdfToolType(task);
      return;
    }

    setWorkMode("convert");
    setDisplayedWorkMode("convert");

    if (task === "image_optimize" || task === "doc_to_pdf") {
      setConvertMode("individual");
      setIndividualTargets((current) => {
        const next = { ...current };
        for (const item of sourceFiles) {
          const conversionType = getCompactTaskConversionForFile(task, item);
          if (conversionType) next[item.id] = conversionType;
        }
        return next;
      });
      return;
    }

    setConvertMode("batch");
    setBatchConversionType(task);
  }, []);

  const changeCompactMode = useCallback(
    async (enabled: boolean) => {
      try {
        if (enabled) {
          syncCompactTask("pdf_merge", files);
          setIsCompactOptionsOpen(true);
          setIsCompactCompletionOpen(false);
        }
        const applied = await window.convertSmith.setCompactMode(enabled);
        if (applied) setIsCompactMode(enabled);
      } catch (error) {
        setNotice(practicalError(error));
      }
    },
    [files, syncCompactTask]
  );

  const changeCompactTask = useCallback(
    (task: CompactTask) => {
      syncCompactTask(task, files);
    },
    [files, syncCompactTask]
  );

  useEffect(() => {
    if (!isCompactMode) return;
    syncCompactTask(compactTask, files);
  }, [compactTask, files, isCompactMode, syncCompactTask]);

  const reorderFiles = useCallback((orderedIds: string[]) => {
    pushFileHistory();
    setSortMode("custom");
    setFiles((current) => {
      const byId = new Map(current.map((item) => [item.id, item]));
      const ordered = orderedIds.map((id) => byId.get(id)).filter((item): item is FileItem => Boolean(item));
      const orderedSet = new Set(orderedIds);
      const remaining = current.filter((item) => !orderedSet.has(item.id));
      return [...ordered, ...remaining].map((item, index) => ({ ...item, dropIndex: index }));
    });
  }, [pushFileHistory]);

  const moveSelectedFilesByKeyboard = useCallback(
    (direction: -1 | 1) => {
      const orderedIds = displayFiles.map((item) => item.id);
      const nextIds = moveSelectedIdsByStep(orderedIds, selectedFileIds, direction);
      if (!nextIds) return false;
      reorderFiles(nextIds);
      return true;
    },
    [displayFiles, reorderFiles, selectedFileIds]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (isEditablePasteTarget(event.target)) return;

      const moved = moveSelectedFilesByKeyboard(event.key === "ArrowUp" ? -1 : 1);
      if (!moved) return;
      event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSelectedFilesByKeyboard]);

  const clearFileSelection = useCallback(() => {
    if (!selectedFileId && selectedFileIds.length === 0 && !selectionAnchorId) return false;
    setSelectedFileId(undefined);
    setSelectedFileIds([]);
    setSelectionAnchorId(undefined);
    return true;
  }, [selectedFileId, selectedFileIds.length, selectionAnchorId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape") return;
      if (isEditablePasteTarget(event.target)) return;
      if (document.body.classList.contains("convert-smith-grabbing")) return;
      if (!clearFileSelection()) return;

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [clearFileSelection]);

  const selectFileItem = useCallback(
    (item: FileItem, modifiers: FileSelectionModifiers = {}) => {
      const isToggle = Boolean(modifiers.ctrlKey || modifiers.metaKey);
      const anchorId = selectionAnchorId || selectedFileId || item.id;

      if (modifiers.preserveSelection && selectedFileIds.includes(item.id)) {
        setSelectedFileId(item.id);
        setSelectionAnchorId(item.id);
        return;
      }

      if (modifiers.shiftKey) {
        const anchorIndex = displayFiles.findIndex((file) => file.id === anchorId);
        const targetIndex = displayFiles.findIndex((file) => file.id === item.id);
        if (anchorIndex >= 0 && targetIndex >= 0) {
          const start = Math.min(anchorIndex, targetIndex);
          const end = Math.max(anchorIndex, targetIndex);
          const rangeIds = displayFiles.slice(start, end + 1).map((file) => file.id);
          const nextIds = isToggle ? mergeUniqueIds(selectedFileIds, rangeIds) : rangeIds;
          setSelectedFileId(item.id);
          setSelectedFileIds(nextIds);
          setSelectionAnchorId(anchorId);
          return;
        }
      }

      if (isToggle) {
        setSelectedFileId(item.id);
        setSelectionAnchorId(item.id);
        setSelectedFileIds((current) => {
          const next = current.includes(item.id)
            ? current.filter((id) => id !== item.id)
            : [...current, item.id];
          return next.length > 0 ? next : [item.id];
        });
        return;
      }

      setSelectedFileId(item.id);
      setSelectedFileIds([item.id]);
      setSelectionAnchorId(item.id);
    },
    [displayFiles, selectedFileId, selectedFileIds, selectionAnchorId]
  );

  const copySelectedFile = useCallback((cut: boolean) => {
    const current = fileStateRef.current;
    const selected = current.files.find((item) => item.id === current.selectedFileId);
    if (!selected) {
      setNotice("복사할 파일을 먼저 선택해주세요.");
      return;
    }

    const target = current.individualTargets[selected.id];
    internalFileClipboardRef.current = {
      files: [{ ...selected }],
      targets: target ? { [selected.id]: target } : {},
      cut
    };

    if (!cut) {
      setNotice(`${shortenName(selected.name, 16)} 항목을 복사했습니다.`);
      return;
    }

    pushFileHistory();
    const ordered = sortFiles(current.files, current.sortMode);
    const selectedIndex = ordered.findIndex((item) => item.id === selected.id);
    const fallbackSelection =
      ordered[selectedIndex + 1]?.id || ordered[selectedIndex - 1]?.id || current.files.find((item) => item.id !== selected.id)?.id;
    const nextTargets = { ...current.individualTargets };
    delete nextTargets[selected.id];
    setFiles(current.files.filter((item) => item.id !== selected.id).map((item, index) => ({ ...item, dropIndex: index })));
    setIndividualTargets(nextTargets);
    setSelectedFileId(fallbackSelection);
    setNotice(`${shortenName(selected.name, 16)} 항목을 잘라냈습니다.`);
  }, [pushFileHistory]);

  const copySelectedFiles = useCallback((cut: boolean) => {
    const current = fileStateRef.current;
    const selectedIds = getActiveSelectionIds(current);
    const selectedIdSet = new Set(selectedIds);
    const selectedFiles = sortFiles(current.files, current.sortMode).filter((item) => selectedIdSet.has(item.id));
    if (selectedFiles.length === 0) {
      setNotice("먼저 복사할 파일을 선택해주세요.");
      return;
    }

    internalFileClipboardRef.current = {
      files: selectedFiles.map((item) => ({ ...item })),
      targets: Object.fromEntries(
        selectedFiles
          .map((item) => [item.id, current.individualTargets[item.id]] as const)
          .filter((entry): entry is readonly [string, ConversionType] => Boolean(entry[1]))
      ),
      cut
    };

    if (!cut) {
      setNotice(`${selectedFiles.length}개 항목을 복사했습니다.`);
      return;
    }

    pushFileHistory();
    const ordered = sortFiles(current.files, current.sortMode);
    const selectedIndex = ordered.findIndex((item) => selectedIdSet.has(item.id));
    const remainingOrdered = ordered.filter((item) => !selectedIdSet.has(item.id));
    const fallbackSelection =
      remainingOrdered[Math.min(selectedIndex, Math.max(remainingOrdered.length - 1, 0))]?.id;
    const nextTargets = { ...current.individualTargets };
    selectedFiles.forEach((item) => delete nextTargets[item.id]);

    setFiles(current.files.filter((item) => !selectedIdSet.has(item.id)).map((item, index) => ({ ...item, dropIndex: index })));
    setIndividualTargets(nextTargets);
    setSelectedFileId(fallbackSelection);
    setSelectedFileIds(fallbackSelection ? [fallbackSelection] : []);
    setSelectionAnchorId(fallbackSelection);
    setNotice(`${selectedFiles.length}개 항목을 잘라냈습니다.`);
  }, [pushFileHistory]);

  const pasteInternalFile = useCallback((): boolean => {
    const clipboard = internalFileClipboardRef.current;
    if (!clipboard || clipboard.files.length === 0) return false;

    const current = fileStateRef.current;
    const ordered = sortFiles(current.files, current.sortMode);
    const selectedIndex = ordered.findIndex((item) => item.id === current.selectedFileId);
    const insertIndex = selectedIndex >= 0 ? selectedIndex + 1 : ordered.length;
    const existingIds = new Set(ordered.map((item) => item.id));
    const pastedItems = clipboard.files.map((item) => {
      const shouldKeepId = clipboard.cut && !existingIds.has(item.id);
      return {
        ...item,
        id: shouldKeepId ? item.id : createRendererFileId(),
        dropIndex: 0
      };
    });
    const nextFiles = [
      ...ordered.slice(0, insertIndex),
      ...pastedItems,
      ...ordered.slice(insertIndex)
    ].map((item, index) => ({ ...item, dropIndex: index }));
    const nextTargets = { ...current.individualTargets };
    pastedItems.forEach((item, index) => {
      const source = clipboard.files[index];
      const sourceTarget = clipboard.targets[source.id];
      if (sourceTarget) nextTargets[item.id] = sourceTarget;
    });

    pushFileHistory();
    setFiles(nextFiles);
    setIndividualTargets(nextTargets);
    setSortMode("custom");
    setSelectedFileId(pastedItems[0]?.id);
    setNotice(`${pastedItems.length}개 항목을 선택한 위치 아래에 붙여넣었습니다.`);
    if (clipboard.cut) {
      internalFileClipboardRef.current = undefined;
    }
    return true;
  }, [pushFileHistory]);

  const pasteInternalFiles = useCallback((): boolean => {
    const clipboard = internalFileClipboardRef.current;
    if (!clipboard || clipboard.files.length === 0) return false;

    const current = fileStateRef.current;
    const ordered = sortFiles(current.files, current.sortMode);
    const selectedIds = getActiveSelectionIds(current);
    const lastSelectedIndex = ordered.reduce(
      (index, item, itemIndex) => (selectedIds.includes(item.id) ? itemIndex : index),
      -1
    );
    const insertIndex = lastSelectedIndex >= 0 ? lastSelectedIndex + 1 : ordered.length;
    const existingIds = new Set(ordered.map((item) => item.id));
    const pastedItems = clipboard.files.map((item) => {
      const shouldKeepId = clipboard.cut && !existingIds.has(item.id);
      return {
        ...item,
        id: shouldKeepId ? item.id : createRendererFileId(),
        dropIndex: 0
      };
    });
    const nextFiles = [
      ...ordered.slice(0, insertIndex),
      ...pastedItems,
      ...ordered.slice(insertIndex)
    ].map((item, index) => ({ ...item, dropIndex: index }));
    const nextTargets = { ...current.individualTargets };
    pastedItems.forEach((item, index) => {
      const source = clipboard.files[index];
      const sourceTarget = clipboard.targets[source.id];
      if (sourceTarget) nextTargets[item.id] = sourceTarget;
    });

    pushFileHistory();
    setFiles(nextFiles);
    setIndividualTargets(nextTargets);
    setSortMode("custom");
    setSelectedFileId(pastedItems[0]?.id);
    setSelectedFileIds(pastedItems.map((item) => item.id));
    setSelectionAnchorId(pastedItems[0]?.id);
    setNotice(`${pastedItems.length}개 항목을 선택 위치 아래에 붙여넣었습니다.`);
    if (clipboard.cut) {
      internalFileClipboardRef.current = undefined;
    }
    return true;
  }, [pushFileHistory]);

  const selectAllFiles = useCallback(() => {
    const ids = displayFiles.map((item) => item.id);
    if (ids.length === 0) return;
    setSelectedFileId(ids[0]);
    setSelectedFileIds(ids);
    setSelectionAnchorId(ids[0]);
    setNotice(`${ids.length}개 파일을 모두 선택했습니다.`);
  }, [displayFiles]);

  const deleteSelectedFiles = useCallback(() => {
    const current = fileStateRef.current;
    const selectedIds = getActiveSelectionIds(current);
    if (selectedIds.length === 0) return;

    pushFileHistory();
    const selectedIdSet = new Set(selectedIds);
    const ordered = sortFiles(current.files, current.sortMode);
    const firstSelectedIndex = ordered.findIndex((item) => selectedIdSet.has(item.id));
    const remainingOrdered = ordered.filter((item) => !selectedIdSet.has(item.id));
    const fallbackSelection =
      remainingOrdered[Math.min(firstSelectedIndex, Math.max(remainingOrdered.length - 1, 0))]?.id;
    const nextTargets = { ...current.individualTargets };
    selectedIds.forEach((id) => delete nextTargets[id]);

    setFiles(current.files.filter((item) => !selectedIdSet.has(item.id)).map((item, index) => ({ ...item, dropIndex: index })));
    setIndividualTargets(nextTargets);
    setSelectedFileId(fallbackSelection);
    setSelectedFileIds(fallbackSelection ? [fallbackSelection] : []);
    setSelectionAnchorId(fallbackSelection);
    setNotice(`${selectedIds.length}개 항목을 목록에서 제거했습니다.`);
  }, [pushFileHistory]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey || event.metaKey || isEditablePasteTarget(event.target)) return;

      if (event.key === "Delete") {
        event.preventDefault();
        deleteSelectedFiles();
        return;
      }

      if (!event.ctrlKey) return;
      const key = event.key.toLowerCase();

      if (key === "a") {
        event.preventDefault();
        selectAllFiles();
        return;
      }

      if (key === "c") {
        event.preventDefault();
        copySelectedFiles(false);
        return;
      }

      if (key === "x") {
        event.preventDefault();
        copySelectedFiles(true);
        return;
      }

      if (key === "v") {
        if (!internalFileClipboardRef.current) return;
        event.preventDefault();
        pasteInternalFiles();
        return;
      }

      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoFileAction();
        else undoFileAction();
        return;
      }

      if (key === "y") {
        event.preventDefault();
        redoFileAction();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelectedFiles, deleteSelectedFiles, pasteInternalFiles, redoFileAction, selectAllFiles, undoFileAction]);

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

  const handleLaunchPaths = useCallback(
    async (paths: string[]) => {
      const launchPaths = paths.filter((item) => typeof item === "string" && item.trim());
      if (launchPaths.length === 0) return;
      changeWorkMode("convert");
      setConvertMode("batch");
      await resolvePaths(launchPaths);
      setNotice("탐색기에서 선택한 파일을 불러왔습니다. 변환 형식을 확인한 뒤 시작해주세요.");
    },
    [changeWorkMode, resolvePaths]
  );

  const handleLaunchRequests = useCallback(
    async (requests: ContextMenuLaunchRequest[]) => {
      const normalized = normalizeLaunchRequests(requests);
      if (normalized.length === 0) return;

      const action = normalized[normalized.length - 1].action;
      const launchPaths = dedupePaths(normalized.flatMap((request) => request.paths));
      if (launchPaths.length === 0) return;

      if (action === "merge") {
        changeWorkMode("pdf_tools");
        setPdfToolType("pdf_merge");
        await resolvePaths(launchPaths);
        setNotice("탐색기에서 선택한 PDF를 병합 작업으로 불러왔습니다. 순서를 확인한 뒤 시작해주세요.");
        return;
      }

      if (action === "split") {
        changeWorkMode("pdf_tools");
        setPdfToolType("pdf_split_all");
        await resolvePaths(launchPaths);
        setNotice("탐색기에서 선택한 PDF를 분할 작업으로 불러왔습니다. 페이지를 확인한 뒤 시작해주세요.");
        return;
      }

      await handleLaunchPaths(launchPaths);
      setNotice("탐색기에서 선택한 파일을 불러왔습니다. 변환 형식을 확인한 뒤 시작해주세요.");
    },
    [changeWorkMode, handleLaunchPaths, resolvePaths]
  );

  useEffect(() => {
    let cancelled = false;
    window.convertSmith
      .getLaunchFiles()
      .then((requests) => {
        if (!cancelled) void handleLaunchRequests(requests);
      })
      .catch((error: unknown) => setNotice(practicalError(error)));

    const unsubscribe = window.convertSmith.onLaunchFiles((requests) => {
      void handleLaunchRequests(requests).catch((error: unknown) => setNotice(practicalError(error)));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [handleLaunchRequests]);

  useEffect(() => {
    let dragDepth = 0;

    const prevent = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };
    const onDragEnter = (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      prevent(event);
      dragDepth += 1;
      setIsDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      prevent(event);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
      prevent(event);
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setIsDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!isExternalFileDrag(event)) return;
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

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      void (async () => {
        const includeTextPaths = !isEditablePasteTarget(event.target);
        const pastedPaths = await extractDroppedPaths(event.clipboardData);
        if (pastedPaths.length > 0) {
          event.preventDefault();
          await resolvePaths(pastedPaths);
          return;
        }

        const items = await window.convertSmith.resolveClipboardFiles(files.length, includeTextPaths);
        if (items.length === 0) return;
        event.preventDefault();
        addFileItems(items);
        setNotice("클립보드의 파일을 목록에 추가했습니다.");
      })().catch((error: unknown) => setNotice(practicalError(error)));
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFileItems, files.length, resolvePaths]);

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

  const installContextMenu = async () => {
    try {
      const status = await window.convertSmith.installContextMenu();
      setContextMenuStatus(status);
      setNotice(status.message);
    } catch (error) {
      setNotice(practicalError(error));
    }
  };

  const uninstallContextMenu = async () => {
    try {
      const status = await window.convertSmith.uninstallContextMenu();
      setContextMenuStatus(status);
      setNotice(status.message);
    } catch (error) {
      setNotice(practicalError(error));
    }
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

  const changeAlwaysOnTop = async (value: boolean) => {
    setAlwaysOnTop(value);
    try {
      const confirmed = await window.convertSmith.setAlwaysOnTop(value);
      setAlwaysOnTop(confirmed);
    } catch (error) {
      setNotice(practicalError(error));
      setAlwaysOnTop((current) => !current);
    }
  };

  const ensureConversionPreflightReady = useCallback(async (): Promise<boolean> => {
    if (displayedWorkMode !== "convert") return true;
    const needsLibreOffice = plannedConversionEntries.some(
      (entry) => entry.conversionType && LIBRE_OFFICE_CONVERSIONS.has(entry.conversionType)
    );
    if (!needsLibreOffice) return true;

    try {
      const status = await window.convertSmith.getDependencyStatus(options.libreOfficePath);
      setDependencyStatus(status);
      if (status.libreOffice.available) return true;
      setNotice(
        "이 변환은 LibreOffice가 필요합니다. 우측 상단 옵션에서 LibreOffice 경로를 지정한 뒤 다시 시작해주세요."
      );
      return false;
    } catch (error) {
      setNotice(practicalError(error));
      return false;
    }
  }, [displayedWorkMode, options.libreOfficePath, plannedConversionEntries]);

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
        if (["pdf_to_docx", "pdf_to_xlsx", "pdf_to_images"].includes(batchConversionType)) {
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
        setSelectedFileIds([]);
        setSelectionAnchorId(undefined);
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
      options: { ...options, sortMode, outputName: outputName.trim() || undefined }
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
        outputName: outputName.trim() || undefined,
        pageOrder: pdfPageOrder,
        pageRotations: pdfPageRotations,
        splitGroups: pdfSplitGroups,
        signatureStamp: pdfToolType === "pdf_signature_stamp" ? pdfSignatureStamp : undefined,
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
    if (displayedWorkMode === "pdf_editor") {
      setNotice("PDF 편집은 'PDF Viewer 열기' 버튼으로 별도 창에서 진행해주세요.");
      return;
    }
    setArrowBurst(false);
    window.requestAnimationFrame(() => setArrowBurst(true));
    window.setTimeout(() => setArrowBurst(false), 620);
    const run = displayedWorkMode === "pdf_tools" ? startPdfTool : startConversion;
    setIsConverting(true);
    void (async () => {
      const ready = await ensureConversionPreflightReady();
      if (!ready) return;
      beginLoadingOverlay(displayedWorkMode === "pdf_tools" ? "PDF 작업을 준비하고 있습니다." : "파일 변환을 준비하고 있습니다.");
      await run();
    })()
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
    pushFileHistory();
    setFiles((current) => current.filter((item) => item.id !== id));
    setIndividualTargets((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (selectedFileId === id) {
      setSelectedFileId(undefined);
    }
    setSelectedFileIds((current) => current.filter((itemId) => itemId !== id));
    if (selectionAnchorId === id) {
      setSelectionAnchorId(undefined);
    }
  };

  const acceptTerms = () => {
    localStorage.setItem(TERMS_ACCEPTED_STORAGE_KEY, TERMS_VERSION);
    setTermsAccepted(true);
  };

  const declineTerms = () => {
    void window.convertSmith.quitApp().catch(() => window.close());
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
      {!termsAccepted && <TermsAgreementModal onAgree={acceptTerms} onDecline={declineTerms} />}

      {isCompactMode ? (
        <CompactWorkspace
          files={files}
          displayFiles={displayFiles}
          selectedFileId={selectedFileId}
          selectedFileIds={selectedFileIds}
          sortMode={sortMode}
          task={compactTask}
          taskOptions={COMPACT_TASK_OPTIONS}
          notice={notice}
          isDragging={isDragging}
          isConverting={isConverting}
          arrowBurst={arrowBurst}
          outputDir={outputDir}
          sourceOutputDir={sourceOutputDir}
          useSourceFolder={useSourceFolder}
          useDatedSubfolder={Boolean(options.useDatedSubfolder)}
          outputName={outputName}
          selectedConversion={selectedConversion}
          options={options}
          isOptionsOpen={isCompactOptionsOpen}
          isCompletionOpen={isCompactCompletionOpen}
          clearFilesAfterSuccess={clearFilesAfterSuccess}
          openFolderAfterSuccess={openFolderAfterSuccess}
          openFileAfterSuccess={openFileAfterSuccess}
          onTaskChange={changeCompactTask}
          onPickFiles={pickFiles}
          onPickOutputDir={pickOutputDir}
          onUseSourceFolderChange={changeUseSourceFolder}
          onUseDatedSubfolderChange={(value) => setOptions((current) => ({ ...current, useDatedSubfolder: value }))}
          onOutputNameChange={setOutputName}
          onOptionsChange={setOptions}
          onOptionsToggle={() => setIsCompactOptionsOpen((value) => !value)}
          onCompletionToggle={() => setIsCompactCompletionOpen((value) => !value)}
          onClearFilesAfterSuccessChange={setClearFilesAfterSuccess}
          onOpenFolderAfterSuccessChange={setOpenFolderAfterSuccess}
          onOpenFileAfterSuccessChange={setOpenFileAfterSuccess}
          onSelectFile={selectFileItem}
          onRemoveFile={removeFile}
          onReorderFiles={reorderFiles}
          onRun={triggerConversion}
          onExpand={() => void changeCompactMode(false)}
        />
      ) : (
        <>
      <header className="app-header border-b border-stone-200 bg-white px-6 py-4">
        <div className="app-header-inner flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-normal text-stone-950">Convert Smith</h1>
            <p className="mt-1 text-sm text-stone-600">{helperMessages.appSubtitle}</p>
          </div>
          <div className="app-header-actions flex items-center gap-3">
            <div className="inline-grid grid-cols-3 rounded-md border border-stone-200 bg-stone-100 p-1 text-sm">
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
              <button
                type="button"
                onClick={() => changeWorkMode("pdf_editor")}
                className={[
                  "inline-flex h-9 items-center justify-center gap-2 rounded px-3",
                  workMode === "pdf_editor" ? "bg-white font-semibold text-emerald-800 shadow-sm" : "text-stone-600"
                ].join(" ")}
              >
                <Edit3 size={15} />
                PDF 편집기
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900">
              <ShieldCheck size={16} />
              로컬 변환 · 업로드 없음
            </div>
            <button
              type="button"
              onClick={() => void changeCompactMode(true)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-stone-700 shadow-sm hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
              title="약식 실행창으로 줄이기"
            >
              <Minimize2 size={15} />
              약식
            </button>
            <UtilityDrawer
              isOpen={isUtilityOpen}
              dependencyStatus={dependencyStatus}
              jobs={jobs}
              libreOfficePath={options.libreOfficePath}
              contextMenuStatus={contextMenuStatus}
              darkMode={darkMode}
              floatingEnabled={floatingEnabled}
              alwaysOnTop={alwaysOnTop}
              onToggle={() => setIsUtilityOpen((value) => !value)}
              onClose={() => setIsUtilityOpen(false)}
              onRefreshDependencies={refreshDependencies}
              onPickLibreOfficePath={pickLibreOfficePath}
              onOpenLibreOfficeDownload={openLibreOfficeDownload}
              onInstallContextMenu={installContextMenu}
              onUninstallContextMenu={uninstallContextMenu}
              onDarkModeChange={setDarkMode}
              onFloatingEnabledChange={changeFloatingEnabled}
              onAlwaysOnTopChange={changeAlwaysOnTop}
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

      <main className="app-main-grid grid min-h-0 flex-1">
        <DropZone
          files={files}
          displayFiles={displayFiles}
          sortMode={sortMode}
          selectedFileId={selectedFileId}
          selectedFileIds={selectedFileIds}
          isDragging={isDragging}
          clearFilesAfterSuccess={clearFilesAfterSuccess}
          openFolderAfterSuccess={openFolderAfterSuccess}
          openFileAfterSuccess={openFileAfterSuccess}
          outputName={outputName}
          onPickFiles={pickFiles}
          onSortModeChange={setSortMode}
          onClearFilesAfterSuccessChange={setClearFilesAfterSuccess}
          onOpenFolderAfterSuccessChange={setOpenFolderAfterSuccess}
          onOpenFileAfterSuccessChange={setOpenFileAfterSuccess}
          onOutputNameChange={setOutputName}
          onSelectFile={selectFileItem}
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
            displayedWorkMode === "pdf_editor" ? "pdf-editor-mode-panel" : "",
            modeAnimation === "exiting" ? "mode-panel--exiting" : "",
            modeAnimation === "entering" ? "mode-panel--entering" : ""
          ].join(" ")}
        >
          {displayedWorkMode === "convert" ? (
            <section className="h-full min-h-0 overflow-auto border-r border-stone-200 bg-white">
              <QuickPresetPanel presets={QUICK_CONVERSION_PRESETS} onApplyPreset={applyQuickPreset} />

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
              <PreflightNoticePanel items={conversionPreflightItems} />
            </section>
          ) : displayedWorkMode === "pdf_tools" ? (
            <PdfToolsPanel
              displayFiles={displayFiles}
              selectedFile={selectedPdfFile}
              outputDir={outputDir}
              sourceOutputDir={sourceOutputDir}
              useSourceFolder={useSourceFolder}
              useDatedSubfolder={Boolean(options.useDatedSubfolder)}
              toolType={pdfToolType}
              selectedPage={pdfPreviewPage}
              pageOrder={pdfPageOrder}
              pageRotations={pdfPageRotations}
              splitGroups={pdfSplitGroups}
              signatureStamp={pdfSignatureStamp}
              pdfToolJobs={pdfToolJobs}
              onSelectFile={(item) => setSelectedFileId(item.id)}
              onToolTypeChange={setPdfToolType}
              onPagePreviewChange={setPdfPreviewPage}
              onPageOrderChange={setPdfPageOrder}
              onPageRotationsChange={setPdfPageRotations}
              onSplitGroupsChange={setPdfSplitGroups}
              onSignatureStampChange={setPdfSignatureStamp}
              onPickOutputDir={pickOutputDir}
              onUseSourceFolderChange={changeUseSourceFolder}
              onUseDatedSubfolderChange={(value) => setOptions((current) => ({ ...current, useDatedSubfolder: value }))}
              onOpenPath={openPath}
              onReveal={revealPath}
              onCopy={copyPath}
              onNotice={setNotice}
            />
          ) : (
            <PdfEditorPanel
              displayFiles={displayFiles}
              selectedFile={selectedPdfFile}
              outputDir={outputDir}
              sourceOutputDir={sourceOutputDir}
              useSourceFolder={useSourceFolder}
              useDatedSubfolder={Boolean(options.useDatedSubfolder)}
              outputName={outputName}
              onSelectFile={(item) => setSelectedFileId(item.id)}
              onPickOutputDir={pickOutputDir}
              onUseSourceFolderChange={changeUseSourceFolder}
              onUseDatedSubfolderChange={(value) => setOptions((current) => ({ ...current, useDatedSubfolder: value }))}
              onOutputNameChange={setOutputName}
              onNotice={setNotice}
            />
          )}
        </div>

        {displayedWorkMode !== "pdf_editor" && (
          <PreviewPanel
            selectedFile={activePreviewFile}
            onOpenExternal={openExternalPreview}
            pdfPageNumber={isPdfWorkMode ? pdfPreviewPage : 1}
            pdfRotation={displayedWorkMode === "pdf_tools" ? pdfPageRotations[pdfPreviewPage] || 0 : 0}
            onRotatePdfPreview={
              displayedWorkMode === "pdf_tools" && activePreviewFile?.extension === ".pdf"
                ? rotateCurrentPdfPreview
                : undefined
            }
          />
        )}
      </main>

      <footer className="app-footer flex h-7 shrink-0 items-center justify-center border-t border-stone-200 bg-white px-4 text-[11px] font-semibold tracking-[0.08em] text-stone-500">
        COPYRIGHT © JINKYU YOO
      </footer>
        </>
      )}
    </div>
  );
}

function CompactWorkspace({
  files,
  displayFiles,
  selectedFileId,
  selectedFileIds,
  sortMode,
  task,
  taskOptions,
  notice,
  isDragging,
  isConverting,
  arrowBurst,
  outputDir,
  sourceOutputDir,
  useSourceFolder,
  useDatedSubfolder,
  outputName,
  selectedConversion,
  options,
  isOptionsOpen,
  isCompletionOpen,
  clearFilesAfterSuccess,
  openFolderAfterSuccess,
  openFileAfterSuccess,
  onTaskChange,
  onPickFiles,
  onPickOutputDir,
  onUseSourceFolderChange,
  onUseDatedSubfolderChange,
  onOutputNameChange,
  onOptionsChange,
  onOptionsToggle,
  onCompletionToggle,
  onClearFilesAfterSuccessChange,
  onOpenFolderAfterSuccessChange,
  onOpenFileAfterSuccessChange,
  onSelectFile,
  onRemoveFile,
  onReorderFiles,
  onRun,
  onExpand
}: {
  files: FileItem[];
  displayFiles: FileItem[];
  selectedFileId?: string;
  selectedFileIds: string[];
  sortMode: SortMode;
  task: CompactTask;
  taskOptions: CompactTaskOption[];
  notice?: string;
  isDragging: boolean;
  isConverting: boolean;
  arrowBurst: boolean;
  outputDir?: string;
  sourceOutputDir?: string;
  useSourceFolder: boolean;
  useDatedSubfolder: boolean;
  outputName: string;
  selectedConversion?: ConversionType;
  options: ConversionOptions;
  isOptionsOpen: boolean;
  isCompletionOpen: boolean;
  clearFilesAfterSuccess: boolean;
  openFolderAfterSuccess: boolean;
  openFileAfterSuccess: boolean;
  onTaskChange: (task: CompactTask) => void;
  onPickFiles: () => void;
  onPickOutputDir: () => void;
  onUseSourceFolderChange: (value: boolean) => void;
  onUseDatedSubfolderChange: (value: boolean) => void;
  onOutputNameChange: (value: string) => void;
  onOptionsChange: (options: ConversionOptions) => void;
  onOptionsToggle: () => void;
  onCompletionToggle: () => void;
  onClearFilesAfterSuccessChange: (value: boolean) => void;
  onOpenFolderAfterSuccessChange: (value: boolean) => void;
  onOpenFileAfterSuccessChange: (value: boolean) => void;
  onSelectFile: (item: FileItem, modifiers?: FileSelectionModifiers) => void;
  onRemoveFile: (id: string) => void;
  onReorderFiles: (orderedIds: string[]) => void;
  onRun: () => void;
  onExpand: () => void;
}): JSX.Element {
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<FilePointerDragSession>();
  const insertionIndexRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const [activePointerId, setActivePointerId] = useState<number | null>(null);
  const [dragGhostPosition, setDragGhostPosition] = useState<FileDragGhostPosition | null>(null);
  const selectedIdSet = new Set(selectedFileIds);
  const draggedIdSet = new Set(draggedIds);
  const draggedItems = draggedIds.length > 0 ? displayFiles.filter((item) => draggedIdSet.has(item.id)) : [];
  const visibleFiles = draggedItems.length > 0 ? displayFiles.filter((item) => !draggedIdSet.has(item.id)) : displayFiles;
  const placeholderIndex =
    draggedItems.length > 0
      ? getFileDropInsertionIndex(displayFiles, draggedIds, insertionIndex ?? getFileGroupInsertionIndex(displayFiles, draggedIds))
      : -1;

  const clearInternalDrag = () => {
    pointerDragRef.current = undefined;
    insertionIndexRef.current = null;
    setDraggedIds([]);
    setInsertionIndex(null);
    setActivePointerId(null);
    setDragGhostPosition(null);
  };

  const updateInsertionIndex = (value: number | null) => {
    insertionIndexRef.current = value;
    setInsertionIndex(value);
  };

  const getPointerInsertionIndex = (clientY: number): number => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-file-row-id]") || []);
    if (rows.length === 0) return displayFiles.length;

    for (const row of rows) {
      const id = row.dataset.fileRowId;
      const index = displayFiles.findIndex((file) => file.id === id);
      if (index < 0) continue;
      const rect = row.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }

    return displayFiles.length;
  };

  const startDrag = (event: ReactDragEvent, item: FileItem) => {
    event.stopPropagation();
    const nextDraggedIds = selectedIdSet.has(item.id)
      ? displayFiles.filter((file) => selectedIdSet.has(file.id)).map((file) => file.id)
      : [item.id];

    onSelectFile(item, selectedIdSet.has(item.id) ? { preserveSelection: true } : undefined);

    setDraggedIds(nextDraggedIds);
    setInsertionIndex(getFileGroupInsertionIndex(displayFiles, nextDraggedIds));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(INTERNAL_FILE_DRAG_TYPE, JSON.stringify(nextDraggedIds));
    setTransparentDragImage(event);
  };

  const startPointerDrag = (event: ReactPointerEvent<HTMLElement>, item: FileItem) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-no-row-drag]")) return;
    event.preventDefault();

    const nextDraggedIds = selectedIdSet.has(item.id)
      ? displayFiles.filter((file) => selectedIdSet.has(file.id)).map((file) => file.id)
      : [item.id];

    onSelectFile(item, selectedIdSet.has(item.id) ? { preserveSelection: true } : undefined);
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      ids: nextDraggedIds,
      dragging: false
    };
    setActivePointerId(event.pointerId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePointerDrag = (event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY" | "preventDefault">) => {
    const session = pointerDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;

    const distance = Math.hypot(event.clientX - session.startX, event.clientY - session.startY);
    if (!session.dragging && distance < POINTER_DRAG_THRESHOLD) return;

    event.preventDefault();
    if (!session.dragging) {
      session.dragging = true;
      suppressClickRef.current = true;
      setDraggedIds(session.ids);
    }
    setDragGhostPosition({ x: event.clientX, y: event.clientY });
    updateInsertionIndex(getPointerInsertionIndex(event.clientY));
  };

  const finishPointerDrag = (event?: Pick<PointerEvent, "pointerId" | "preventDefault">) => {
    const session = pointerDragRef.current;
    if (!session || (event && session.pointerId !== event.pointerId)) return;
    if (session.dragging) {
      event?.preventDefault();
      const sourceIds = session.ids;
      const sourceIdSet = new Set(sourceIds);
      const movingItems = displayFiles.filter((item) => sourceIdSet.has(item.id));
      const nextBase = displayFiles.filter((item) => !sourceIdSet.has(item.id));
      const nextIndex = getFileDropInsertionIndex(displayFiles, sourceIds, insertionIndexRef.current ?? displayFiles.length);
      if (movingItems.length > 0) {
        const nextIds = nextBase.map((item) => item.id);
        nextIds.splice(nextIndex, 0, ...movingItems.map((item) => item.id));
        if (nextIds.join("\u0000") !== displayFiles.map((item) => item.id).join("\u0000")) {
          onReorderFiles(nextIds);
        }
      }
    }

    clearInternalDrag();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  };

  const overList = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!hasInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.clientY <= rect.top + 18) setInsertionIndex(0);
    if (event.clientY >= rect.bottom - 18) setInsertionIndex(visibleFiles.length);
  };

  const overRow = (event: ReactDragEvent<HTMLElement>, index: number) => {
    if (!hasInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setInsertionIndex(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
  };

  const dropDrag = (event: ReactDragEvent) => {
    if (!hasInternalFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceIds = parseInternalFileDragIds(event.dataTransfer.getData(INTERNAL_FILE_DRAG_TYPE), draggedIds);
    const sourceIdSet = new Set(sourceIds);
    const movingItems = displayFiles.filter((item) => sourceIdSet.has(item.id));
    const nextBase = displayFiles.filter((item) => !sourceIdSet.has(item.id));
    const nextIndex = getFileDropInsertionIndex(displayFiles, sourceIds, insertionIndex ?? displayFiles.length);
    clearInternalDrag();
    if (movingItems.length === 0) return;
    const nextIds = nextBase.map((item) => item.id);
    nextIds.splice(nextIndex, 0, ...movingItems.map((item) => item.id));
    if (nextIds.join("\u0000") !== displayFiles.map((item) => item.id).join("\u0000")) {
      onReorderFiles(nextIds);
    }
  };

  const effectiveOutputDir = useSourceFolder ? sourceOutputDir : outputDir;

  useEffect(() => {
    if (draggedIds.length === 0) return undefined;

    const clearSoon = () => window.setTimeout(clearInternalDrag, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearInternalDrag();
    };

    window.addEventListener("dragend", clearInternalDrag, true);
    window.addEventListener("drop", clearSoon, true);
    window.addEventListener("blur", clearInternalDrag);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("dragend", clearInternalDrag, true);
      window.removeEventListener("drop", clearSoon, true);
      window.removeEventListener("blur", clearInternalDrag);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [draggedIds.length]);

  useEffect(() => {
    if (activePointerId === null) return undefined;

    const onPointerMove = (event: PointerEvent) => movePointerDrag(event);
    const onPointerUp = (event: PointerEvent) => finishPointerDrag(event);
    const onPointerCancel = (event: PointerEvent) => finishPointerDrag(event);
    const onBlur = () => clearInternalDrag();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        suppressClickRef.current = false;
        clearInternalDrag();
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { passive: false });
    window.addEventListener("pointercancel", onPointerCancel, { passive: false });
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activePointerId, displayFiles, selectedFileIds]);

  useEffect(() => {
    document.body.classList.toggle("convert-smith-grabbing", draggedItems.length > 0);
    return () => {
      document.body.classList.remove("convert-smith-grabbing");
    };
  }, [draggedItems.length]);

  return (
    <main className="compact-shell flex min-h-0 flex-1 flex-col bg-white text-stone-900">
      {dragGhostPosition &&
        draggedItems.length > 0 &&
        createPortal(<CompactFileDragGhost items={draggedItems} position={dragGhostPosition} />, document.body)}
      <header className="compact-header flex shrink-0 items-center justify-between gap-2 border-b border-stone-200 px-3 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold text-stone-950">Convert Smith</h1>
          <p className="truncate text-[11px] text-stone-500">약식 실행창</p>
        </div>
        <button
          type="button"
          onClick={onExpand}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-stone-200 bg-white px-2 text-[11px] font-semibold text-stone-700 hover:bg-stone-50"
        >
          <Maximize2 size={13} />
          전체
        </button>
      </header>

      {notice && <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] leading-4 text-amber-900">{notice}</div>}

      <section
        className={[
          "compact-drop-area m-2 flex min-h-0 flex-1 flex-col rounded-md border bg-stone-50 p-2 transition",
          isDragging ? "border-emerald-500 bg-emerald-50" : "border-stone-200"
        ].join(" ")}
      >
        <div className="grid shrink-0 grid-cols-[1fr_auto_auto] gap-1.5">
          <label className="compact-task-select flex h-9 min-w-0 items-center rounded-md border border-stone-300 bg-white text-stone-800 shadow-sm">
            <span className="flex shrink-0 items-center gap-1 border-r border-stone-200 px-2 text-[11px] font-semibold text-stone-600">
              <FileCog size={12} />
              작업
            </span>
            <select
              value={task}
              onChange={(event) => onTaskChange(event.target.value as CompactTask)}
              className="h-full min-w-0 flex-1 border-0 bg-transparent px-1 text-[11px] font-semibold text-stone-800 outline-none"
              aria-label="약식 작업 선택"
            >
              {taskOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={onOptionsToggle}
            className={[
              "inline-flex h-9 w-9 items-center justify-center rounded-md border text-stone-700",
              isOptionsOpen ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white"
            ].join(" ")}
            aria-label="약식 옵션"
          >
            <SlidersHorizontal size={14} />
          </button>
          <button
            type="button"
            onClick={onCompletionToggle}
            className={[
              "inline-flex h-9 w-9 items-center justify-center rounded-md border text-stone-700",
              isCompletionOpen ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white"
            ].join(" ")}
            aria-label="완료 후 처리"
          >
            <Settings2 size={14} />
          </button>
        </div>

        {(isOptionsOpen || isCompletionOpen) && (
          <div className="compact-panels mt-2 grid shrink-0 gap-2">
            {isOptionsOpen && (
              <CompactOptionsPanel
                outputDir={effectiveOutputDir}
                useSourceFolder={useSourceFolder}
                useDatedSubfolder={useDatedSubfolder}
                outputName={outputName}
                selectedConversion={selectedConversion}
                options={options}
                onPickOutputDir={onPickOutputDir}
                onUseSourceFolderChange={onUseSourceFolderChange}
                onUseDatedSubfolderChange={onUseDatedSubfolderChange}
                onOutputNameChange={onOutputNameChange}
                onOptionsChange={onOptionsChange}
              />
            )}
            {isCompletionOpen && (
              <CompactCompletionPanel
                clearFilesAfterSuccess={clearFilesAfterSuccess}
                openFolderAfterSuccess={openFolderAfterSuccess}
                openFileAfterSuccess={openFileAfterSuccess}
                onClearFilesAfterSuccessChange={onClearFilesAfterSuccessChange}
                onOpenFolderAfterSuccessChange={onOpenFolderAfterSuccessChange}
                onOpenFileAfterSuccessChange={onOpenFileAfterSuccessChange}
              />
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onPickFiles}
          className="mt-2 flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-dashed border-emerald-400 bg-white text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
        >
          <FolderOpen size={14} />
          파일 드롭 · 붙여넣기 · 선택
        </button>

        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-stone-500">
          <span>{files.length}개 파일</span>
          <span>{sortMode === "custom" ? "Custom 순서" : "드래그로 순서 변경"}</span>
        </div>

        <div
          ref={listRef}
          className="compact-file-list mt-1 min-h-0 flex-1 space-y-1 overflow-auto rounded-md border border-stone-200 bg-white p-1.5"
          onDragOver={overList}
          onDrop={dropDrag}
        >
          {visibleFiles.length === 0 && draggedItems.length === 0 && (
            <div className="flex h-full min-h-[120px] items-center justify-center rounded-md border border-dashed border-stone-300 px-3 text-center text-xs leading-5 text-stone-500">
              파일을 여기에 놓거나 Ctrl+V로 붙여넣으세요.
            </div>
          )}
          {visibleFiles.map((item, index) => (
            <CompactFileRow
              key={item.id}
              item={item}
              index={index}
              selected={selectedFileIds.includes(item.id)}
              active={item.id === selectedFileId}
              draggedItems={draggedItems}
              isDragSource={draggedIdSet.has(item.id)}
              placeholderIndex={placeholderIndex}
              onPointerDown={startPointerDrag}
              onPointerMove={movePointerDrag}
              onPointerUp={finishPointerDrag}
              onPointerCancel={finishPointerDrag}
              shouldSuppressClick={() => suppressClickRef.current}
              onSelect={onSelectFile}
              onRemove={onRemoveFile}
            />
          ))}
          {draggedItems.length > 0 && placeholderIndex === visibleFiles.length && (
            <CompactFilePlaceholder items={draggedItems} />
          )}
        </div>

        <div className="mt-2 flex shrink-0 items-end justify-between gap-2">
          <p className="min-w-0 text-[11px] leading-4 text-stone-500">
            선택 순서대로 처리됩니다. 원본 파일은 직접 수정하지 않습니다.
          </p>
          <button
            type="button"
            onClick={onRun}
            disabled={isConverting}
            aria-label="작업 실행"
            className={[
              "convert-arrow-button flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-emerald-300 bg-white text-emerald-700 shadow-sm transition hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-60",
              arrowBurst ? "convert-arrow-button--burst" : ""
            ].join(" ")}
          >
            <ArrowRight className="convert-arrow-icon" size={30} strokeWidth={5} />
          </button>
        </div>
      </section>

      <footer className="h-6 shrink-0 border-t border-stone-200 bg-white px-2 text-center text-[10px] font-semibold tracking-[0.08em] text-stone-500">
        COPYRIGHT © JINKYU YOO
      </footer>
    </main>
  );
}

function CompactOptionsPanel({
  outputDir,
  useSourceFolder,
  useDatedSubfolder,
  outputName,
  selectedConversion,
  options,
  onPickOutputDir,
  onUseSourceFolderChange,
  onUseDatedSubfolderChange,
  onOutputNameChange,
  onOptionsChange
}: {
  outputDir?: string;
  useSourceFolder: boolean;
  useDatedSubfolder: boolean;
  outputName: string;
  selectedConversion?: ConversionType;
  options: ConversionOptions;
  onPickOutputDir: () => void;
  onUseSourceFolderChange: (value: boolean) => void;
  onUseDatedSubfolderChange: (value: boolean) => void;
  onOutputNameChange: (value: string) => void;
  onOptionsChange: (options: ConversionOptions) => void;
}): JSX.Element {
  const update = (patch: Partial<ConversionOptions>) => onOptionsChange({ ...options, ...patch });
  return (
    <section className="rounded-md border border-stone-200 bg-white p-2 text-[11px] text-stone-700">
      <h2 className="mb-1.5 text-xs font-semibold text-stone-950">옵션</h2>
      <div className="space-y-1.5">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={useSourceFolder}
            onChange={(event) => onUseSourceFolderChange(event.target.checked)}
            className="h-3.5 w-3.5 accent-emerald-700"
          />
          원본 폴더 저장
        </label>
        <button
          type="button"
          onClick={onPickOutputDir}
          className="flex h-7 w-full min-w-0 items-center justify-between gap-2 rounded border border-stone-300 bg-stone-50 px-2 text-left text-[11px] hover:bg-stone-100"
        >
          <span className="truncate">{outputDir || "저장 폴더 선택"}</span>
          <FolderOpen size={12} />
        </button>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={useDatedSubfolder}
            onChange={(event) => onUseDatedSubfolderChange(event.target.checked)}
            className="h-3.5 w-3.5 accent-emerald-700"
          />
          날짜별 폴더
        </label>
        <input
          value={outputName}
          onChange={(event) => onOutputNameChange(event.target.value)}
          placeholder="결과 파일명"
          className="h-7 w-full rounded border border-stone-300 bg-white px-2 text-[11px] outline-none focus:border-emerald-400"
        />
        {selectedConversion && compactUsesImageQuality(selectedConversion) && (
          <label className="block">
            품질 {options.imageQuality}
            <input
              type="range"
              min={50}
              max={100}
              value={options.imageQuality}
              onChange={(event) => update({ imageQuality: Number(event.target.value) })}
              className="mt-1 w-full accent-emerald-700"
            />
          </label>
        )}
      </div>
    </section>
  );
}

function CompactCompletionPanel({
  clearFilesAfterSuccess,
  openFolderAfterSuccess,
  openFileAfterSuccess,
  onClearFilesAfterSuccessChange,
  onOpenFolderAfterSuccessChange,
  onOpenFileAfterSuccessChange
}: {
  clearFilesAfterSuccess: boolean;
  openFolderAfterSuccess: boolean;
  openFileAfterSuccess: boolean;
  onClearFilesAfterSuccessChange: (value: boolean) => void;
  onOpenFolderAfterSuccessChange: (value: boolean) => void;
  onOpenFileAfterSuccessChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-2 text-[11px] text-stone-700">
      <h2 className="mb-1.5 text-xs font-semibold text-stone-950">완료 후 처리</h2>
      <div className="space-y-1.5">
        <CompactCheck
          label="목록 초기화"
          checked={clearFilesAfterSuccess}
          onChange={onClearFilesAfterSuccessChange}
        />
        <CompactCheck
          label="결과 위치 열기"
          checked={openFolderAfterSuccess}
          onChange={onOpenFolderAfterSuccessChange}
        />
        <CompactCheck
          label="첫 결과 파일 열기"
          checked={openFileAfterSuccess}
          onChange={onOpenFileAfterSuccessChange}
        />
      </div>
    </section>
  );
}

function CompactCheck({
  label,
  checked,
  onChange
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 rounded bg-stone-50 px-2 py-1">
      <span className="truncate">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 shrink-0 accent-emerald-700"
      />
    </label>
  );
}

function CompactFileRow({
  item,
  index,
  selected,
  active,
  draggedItems,
  isDragSource,
  placeholderIndex,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  shouldSuppressClick,
  onSelect,
  onRemove
}: {
  item: FileItem;
  index: number;
  selected: boolean;
  active: boolean;
  draggedItems: FileItem[];
  isDragSource: boolean;
  placeholderIndex: number;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>, item: FileItem) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  shouldSuppressClick: () => boolean;
  onSelect: (item: FileItem, modifiers?: FileSelectionModifiers) => void;
  onRemove: (id: string) => void;
}): JSX.Element {
  return (
    <>
      {draggedItems.length > 0 && placeholderIndex === index && <CompactFilePlaceholder items={draggedItems} />}
      <div
        role="button"
        tabIndex={0}
        data-file-row-id={item.id}
        onPointerDown={(event) => onPointerDown(event, item)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={(event) => {
          if (shouldSuppressClick()) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          onSelect(item, {
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey
          });
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(item);
          }
        }}
        className={[
          "grid w-full select-none grid-cols-[14px_1fr_auto] items-center gap-1.5 rounded border px-2 py-1.5 text-left transition",
          selected ? "border-emerald-400 bg-emerald-50" : "border-stone-200 bg-white hover:border-emerald-200",
          active ? "ring-1 ring-emerald-200" : "",
          isDragSource ? "opacity-45" : ""
        ].join(" ")}
      >
        <span
          className="inline-flex h-6 w-4 cursor-grab items-center justify-center rounded text-stone-400 active:cursor-grabbing"
          aria-label="파일 순서 이동"
        >
          <GripVertical size={12} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-stone-900">{item.name}</span>
          <span className="block truncate text-[10px] text-stone-500">
            {item.extension} · {formatBytes(item.size)}
          </span>
        </span>
        <span
          role="button"
          tabIndex={0}
          data-no-row-drag="true"
          onClick={(event) => {
            event.stopPropagation();
            onRemove(item.id);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onRemove(item.id);
            }
          }}
          className="inline-flex h-6 w-6 items-center justify-center rounded text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          aria-label={`${item.name} 제거`}
        >
          <Trash2 size={12} />
        </span>
      </div>
    </>
  );
}

function CompactFilePlaceholder({ items }: { items: FileItem[] }): JSX.Element {
  const item = items[0] as FileItem;
  const countLabel = items.length > 1 ? `${items.length}개 이동` : "여기";
  return (
    <div className="compact-file-placeholder grid w-full select-none grid-cols-[14px_1fr_auto] items-center gap-1.5 rounded border border-emerald-400 bg-emerald-50 px-2 py-1.5 text-left">
      <GripVertical size={12} className="text-emerald-500" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-semibold text-stone-900">{item.name}</span>
        <span className="block truncate text-[10px] text-stone-500">
          {item.extension} · {formatBytes(item.size)}
        </span>
      </span>
      <span className="text-[10px] font-semibold text-emerald-700">여기</span>
    </div>
  );
}

function CompactFileDragGhost({
  items,
  position
}: {
  items: FileItem[];
  position: FileDragGhostPosition;
}): JSX.Element {
  const item = items[0] as FileItem;
  const countLabel = items.length > 1 ? `${items.length}개` : "";
  return (
    <div
      className="convert-file-drag-ghost fixed z-[80] grid w-[220px] select-none grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-emerald-400 bg-white/92 px-2.5 py-2 text-left text-stone-900 shadow-xl backdrop-blur-sm"
      style={{
        transform: `translate3d(${position.x - 10}px, ${position.y - 10}px, 0)`
      }}
      aria-hidden="true"
    >
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold">{item.name}</span>
        <span className="mt-0.5 block truncate text-[10px] text-stone-500">
          {item.extension} 쨌 {formatBytes(item.size)}
        </span>
      </span>
      <span className="text-[10px] font-semibold text-emerald-700">{countLabel}</span>
    </div>
  );
}

function TermsAgreementModal({
  onAgree,
  onDecline
}: {
  onAgree: () => void;
  onDecline: () => void;
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-stone-950/55 p-4 backdrop-blur-sm">
      <section className="terms-modal flex max-h-[calc(100vh-32px)] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-stone-200 bg-white text-stone-900 shadow-2xl">
        <div className="border-b border-stone-200 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Convert Smith</p>
          <h2 className="mt-1 text-xl font-bold tracking-normal text-stone-950">이용 약관 및 면책 안내</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            Convert Smith를 사용하려면 아래 약관에 동의해야 합니다. 동의하지 않으면 프로그램이 종료됩니다.
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto px-5 py-4 text-sm leading-6 text-stone-700">
          <TermsBlock title="저작권 및 이용 범위">
            Convert Smith의 프로그램명, 화면 구성, 자체 코드, 문구, 아이콘 구성 및 배포 패키지의 권리는
            JINKYU YOO에게 있습니다. 명시적인 서면 허가 없이 설치 파일, 앱 패키지, 소스, 리소스 또는 그
            일부를 복제, 재배포, 재판매, 재패키징, 변조 배포하거나 제3자에게 제공할 수 없습니다. 무단
            배포와 무단 복제는 허용되지 않습니다.
          </TermsBlock>

          <TermsBlock title="로컬 변환과 결과 책임">
            Convert Smith는 파일을 클라우드로 업로드하지 않고 사용자의 PC에서 로컬 변환을 수행합니다.
            다만 손상, 암호화, DRM 보호, 비표준 구조, 지원되지 않는 코덱 또는 외부 변환 엔진 제한이 있는
            파일은 변환에 실패하거나 결과 품질이 원본과 다를 수 있습니다. 중요한 파일은 변환 전 별도
            백업을 유지해야 하며, 변환 결과의 확인과 사용 책임은 사용자에게 있습니다.
          </TermsBlock>

          <TermsBlock title="면책">
            Convert Smith는 파일 변환, 복구, PDF/문서 레이아웃 보존, 코덱 호환성 개선을 보조하는 도구이며
            모든 파일의 정상 변환, 완전한 복구, 원본과 100% 동일한 서식 보존을 보장하지 않습니다. 법령이
            허용하는 범위에서, 프로그램 사용 또는 사용 불가로 발생하는 데이터 손상, 업무 지연, 기대 이익
            손실, 제3자 분쟁 등 간접적 손해에 대해 개발자는 책임을 부담하지 않습니다.
          </TermsBlock>

          <TermsBlock title="오픈소스 구성요소">
            FFmpeg, FFprobe, Electron, React, Sharp, pdf-lib, pdfjs-dist 등 포함된 오픈소스 구성요소는 각
            프로젝트의 라이선스가 적용됩니다. 본 약관은 해당 오픈소스 라이선스가 사용자에게 부여하는
            권리를 제한하거나 무효화하지 않습니다. 자세한 고지와 소스 제공 안내는 설치 폴더의
            THIRD_PARTY_NOTICES.md 및 legal 폴더를 확인하세요.
          </TermsBlock>

          <TermsBlock title="금지되는 사용">
            타인의 저작권, 영업비밀, 개인정보, 보안 정책을 침해하는 방식으로 파일을 변환하거나 배포해서는
            안 됩니다. 불법 복제물, 권한 없는 DRM 우회, 악성 파일 제작 또는 배포 목적의 사용은 허용되지
            않습니다.
          </TermsBlock>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 bg-stone-50 px-5 py-4">
          <button
            type="button"
            onClick={onDecline}
            className="inline-flex h-10 min-w-[120px] items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 hover:bg-stone-100"
          >
            <XCircle size={16} />
            동의하지 않음
          </button>
          <button
            type="button"
            onClick={onAgree}
            className="inline-flex h-10 min-w-[140px] items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            <CheckCircle2 size={16} />
            동의하고 시작
          </button>
        </div>
      </section>
    </div>
  );
}

function TermsBlock({ title, children }: { title: string; children: string }): JSX.Element {
  return (
    <section className="rounded-md border border-stone-200 bg-stone-50 px-4 py-3">
      <h3 className="text-sm font-semibold text-stone-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-stone-700">{children}</p>
    </section>
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

function QuickPresetPanel({
  presets,
  onApplyPreset
}: {
  presets: QuickConversionPreset[];
  onApplyPreset: (preset: QuickConversionPreset) => void;
}): JSX.Element {
  return (
    <section className="border-b border-stone-200 bg-stone-50 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-stone-900">빠른 선택</h2>
        <span className="text-xs text-stone-500">파일에 맞는 변환을 자동 선택합니다.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onApplyPreset(preset)}
            className="inline-flex h-8 max-w-full items-center justify-center truncate rounded-md border border-stone-200 bg-white px-2.5 text-xs font-semibold text-stone-700 shadow-sm transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 active:scale-[0.97]"
            title={preset.label}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function PreflightNoticePanel({ items }: { items: PreflightNoticeItem[] }): JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <section className="border-b border-stone-200 bg-white p-4">
      <h2 className="mb-3 text-base font-semibold text-stone-900">변환 전 확인</h2>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={`${item.title}-${item.message}`} className={getPreflightToneClass(item.tone)}>
            <span className="mt-0.5 flex-none">{getPreflightIcon(item.tone)}</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 text-xs leading-5">{item.message}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function getPreflightToneClass(tone: PreflightNoticeItem["tone"]): string {
  const base = "flex items-start gap-2 rounded-md border px-3 py-2";
  if (tone === "error") return `${base} border-red-200 bg-red-50 text-red-900`;
  if (tone === "warning") return `${base} border-amber-200 bg-amber-50 text-amber-900`;
  if (tone === "success") return `${base} border-emerald-200 bg-emerald-50 text-emerald-900`;
  return `${base} border-stone-200 bg-stone-50 text-stone-700`;
}

function getPreflightIcon(tone: PreflightNoticeItem["tone"]): JSX.Element {
  if (tone === "error" || tone === "warning") return <AlertTriangle size={16} />;
  if (tone === "success") return <CheckCircle2 size={16} />;
  return <ShieldCheck size={16} />;
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

function cloneFileItems(files: FileItem[]): FileItem[] {
  return files.map((item) => ({ ...item }));
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function mergeUniqueIds(first: string[], second: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const id of [...first, ...second]) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(id);
  }
  return merged;
}

function moveSelectedIdsByStep(orderedIds: string[], selectedIds: string[], direction: -1 | 1): string[] | undefined {
  const selectedIdSet = new Set(selectedIds);
  if (selectedIdSet.size === 0) return undefined;
  if (!orderedIds.some((id) => selectedIdSet.has(id))) return undefined;

  const nextIds = [...orderedIds];
  if (direction < 0) {
    for (let index = 1; index < nextIds.length; index += 1) {
      if (!selectedIdSet.has(nextIds[index]) || selectedIdSet.has(nextIds[index - 1])) continue;
      [nextIds[index - 1], nextIds[index]] = [nextIds[index], nextIds[index - 1]];
    }
  } else {
    for (let index = nextIds.length - 2; index >= 0; index -= 1) {
      if (!selectedIdSet.has(nextIds[index]) || selectedIdSet.has(nextIds[index + 1])) continue;
      [nextIds[index], nextIds[index + 1]] = [nextIds[index + 1], nextIds[index]];
    }
  }

  return sameStringArray(orderedIds, nextIds) ? undefined : nextIds;
}

function getActiveSelectionIds(snapshot: FileListSnapshot): string[] {
  const existingIds = new Set(snapshot.files.map((item) => item.id));
  const selectedIds = snapshot.selectedFileIds.filter((id) => existingIds.has(id));
  if (selectedIds.length > 0) return selectedIds;
  return snapshot.selectedFileId && existingIds.has(snapshot.selectedFileId) ? [snapshot.selectedFileId] : [];
}

function createRendererFileId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `renderer-${crypto.randomUUID()}`;
  }
  return `renderer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getCompactTaskConversionForFile(task: CompactTask, file: FileItem): ConversionType | undefined {
  const extension = file.extension.toLowerCase();
  if (task === "image_optimize") {
    if (extension === ".jpg" || extension === ".jpeg") return "jpg_optimize";
    if (extension === ".png") return "png_optimize";
    if (extension === ".webp") return "webp_optimize";
    return undefined;
  }
  if (task === "doc_to_pdf") {
    if (extension === ".doc" || extension === ".docx") return "docx_to_pdf";
    if (extension === ".xls" || extension === ".xlsx") return "xlsx_to_pdf";
    if (extension === ".ppt" || extension === ".pptx") return "pptx_to_pdf";
  }
  return undefined;
}

function compactUsesImageQuality(conversionType: ConversionType): boolean {
  return [
    "heic_to_jpg",
    "heic_to_png",
    "png_to_jpg",
    "pdf_to_images",
    "image_to_webp",
    "jpg_optimize",
    "png_optimize",
    "webp_optimize",
    "webp_to_jpg",
    "webp_to_png",
    "avif_to_jpg",
    "avif_to_png",
    "tiff_to_jpg",
    "tiff_to_png",
    "bmp_to_jpg",
    "bmp_to_png"
  ].includes(conversionType);
}

function clampIndex(value: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), 0), max);
}

function hasInternalFileDrag(event: ReactDragEvent | DragEvent): boolean {
  return Array.from(event.dataTransfer?.types || []).includes(INTERNAL_FILE_DRAG_TYPE);
}

function getFileGroupInsertionIndex(files: FileItem[], ids: string[]): number {
  const idSet = new Set(ids);
  const firstIndex = files.findIndex((item) => idSet.has(item.id));
  if (firstIndex < 0) return files.length;
  return files.slice(0, firstIndex).filter((item) => !idSet.has(item.id)).length;
}

function getFileDropInsertionIndex(files: FileItem[], movingIds: string[], insertionIndex: number): number {
  const movingIdSet = new Set(movingIds);
  const clampedIndex = clampIndex(insertionIndex, files.length);
  return files.slice(0, clampedIndex).filter((item) => !movingIdSet.has(item.id)).length;
}

function parseInternalFileDragIds(value: string, fallback: string[]): string[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    return [value];
  }
  return fallback;
}

function setTransparentDragImage(event: ReactDragEvent): void {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  event.dataTransfer.setDragImage(canvas, 0, 0);
}

function getPlannedConversionEntries(
  files: FileItem[],
  sortMode: SortMode,
  convertMode: ConvertMode,
  batchConversionType: ConversionType | undefined,
  individualTargets: Record<string, ConversionType>
): PlannedConversionEntry[] {
  const sorted = sortFiles(files, sortMode);
  if (convertMode === "batch") {
    return sorted.map((file) => ({ file, conversionType: batchConversionType }));
  }
  return sorted.map((file) => ({
    file,
    conversionType: individualTargets[file.id] || file.supportedConversions[0]
  }));
}

function buildConversionPreflightItems(
  entries: PlannedConversionEntry[],
  dependencyStatus?: DependencyStatus
): PreflightNoticeItem[] {
  const planned = entries.filter((entry) => Boolean(entry.conversionType));
  if (planned.length === 0) return [];

  const items: PreflightNoticeItem[] = [];
  const videoEntries = planned.filter(
    (entry) =>
      entry.file.kind === "video" &&
      entry.conversionType &&
      VIDEO_ESTIMATE_CONVERSIONS.has(entry.conversionType)
  );
  if (videoEntries.length > 0) {
    const totalBytes = videoEntries.reduce((sum, entry) => sum + entry.file.size, 0);
    const hasTranscode = videoEntries.some(
      (entry) => entry.conversionType && entry.conversionType !== "mp4_to_mp3"
    );
    items.push({
      tone: "info",
      title: "대용량 영상 예상 시간",
      message: `대상 영상 ${videoEntries.length}개, 총 ${formatBytes(totalBytes)}입니다. 예상 소요 시간은 약 ${estimateVideoConversionTime(totalBytes, hasTranscode)}이며 PC 성능, 원본 코덱, 저장 장치 속도에 따라 달라질 수 있습니다.`
    });
  }

  const needsLibreOffice = planned.some(
    (entry) => entry.conversionType && LIBRE_OFFICE_CONVERSIONS.has(entry.conversionType)
  );
  if (needsLibreOffice) {
    const libreOffice = dependencyStatus?.libreOffice;
    items.push(
      libreOffice?.available
        ? {
            tone: "success",
            title: "LibreOffice 확인됨",
            message: `Office 문서 변환에 사용할 LibreOffice를 찾았습니다.${libreOffice.path ? ` 경로: ${libreOffice.path}` : ""}`
          }
        : {
            tone: "error",
            title: "LibreOffice 필요",
            message:
              "DOCX/XLSX/PPTX 변환에는 LibreOffice가 필요합니다. 시작 전에 우측 상단 옵션에서 soffice.exe 또는 soffice.com 경로를 지정해주세요."
          }
    );
  }

  const usesHeicInput = planned.some((entry) => [".heic", ".heif"].includes(entry.file.extension));
  if (usesHeicInput) {
    items.push({
      tone: "info",
      title: "HEIC 입력 지원",
      message:
        "HEIC/HEIF 입력은 JPG 또는 PNG로 변환할 수 있습니다. JPG/PNG를 HEIC로 저장하는 출력 기능은 제공하지 않습니다."
    });
  }

  items.push({
    tone: "info",
    title: "원본 보호와 출력 충돌 처리",
    message:
      "원본 파일은 직접 수정하지 않고 새 출력 파일만 만듭니다. 같은 이름의 결과가 있으면 _001, _002를 붙여 저장하고, 실패하거나 취소된 불완전 출력은 자동 정리합니다."
  });

  return items;
}

function estimateVideoConversionTime(totalBytes: number, hasTranscode: boolean): string {
  const totalMb = Math.max(1, totalBytes / 1024 / 1024);
  const mbPerMinute = hasTranscode ? 350 : 900;
  const low = Math.max(1, Math.ceil(totalMb / mbPerMinute));
  const high = Math.max(low, Math.ceil(low * 1.7));
  if (low <= 1 && high <= 2) return "1-2분";
  if (low === high) return `${low}분`;
  return `${low}-${high}분`;
}

async function extractDroppedPaths(dataTransfer: DataTransfer | null): Promise<string[]> {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files || []);
  const preloadPaths = window.convertSmith.getDroppedFilePaths(files);
  if (preloadPaths.length > 0) return preloadPaths;
  return files.map((file) => file.path).filter((filePath): filePath is string => Boolean(filePath));
}

function normalizeLaunchRequests(requests: ContextMenuLaunchRequest[]): ContextMenuLaunchRequest[] {
  return requests.flatMap((request) => {
    if (request.action !== "convert" && request.action !== "merge" && request.action !== "split") return [];
    const paths = request.paths.filter((filePath) => filePath.trim());
    return paths.length > 0 ? [{ action: request.action, paths }] : [];
  });
}

function dedupePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const filePath of paths) {
    const key = filePath.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(filePath);
  }
  return deduped;
}

function isExternalFileDrag(event: DragEvent): boolean {
  const types = Array.from(event.dataTransfer?.types || []);
  if (types.includes(INTERNAL_FILE_DRAG_TYPE) || types.includes(INTERNAL_PAGE_DRAG_TYPE)) return false;
  return types.includes("Files");
}

function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
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
