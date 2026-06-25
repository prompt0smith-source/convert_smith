import { ExternalLink, Minus, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MutableRefObject } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  PdfEditorGraphicLineItem,
  PdfEditorImageItem,
  PdfEditorPageSize,
  PdfEditorSaveResult,
  PdfEditorTableItem,
  PdfEditorTextItem,
  PdfEditorTextLayer,
  PdfEditorWindowContext
} from "../main/types/conversion";
import {
  buildPdfEditorEdits,
  countPdfEditorChanges,
  createPdfEditorAddition,
  type PdfEditorBoxGeometry,
  type PendingPdfEditorAddition
} from "./lib/pdfEditorModel";

type DragTarget =
  | { kind: "text"; id: string }
  | { kind: "add"; id: string }
  | { kind: "line"; id: string }
  | { kind: "image"; id: string };

type PdfObjectTarget =
  | { kind: "image"; id: string }
  | { kind: "line"; id: string }
  | { kind: "table"; id: string };

interface DragState {
  pointerId: number;
  target: DragTarget;
  startClientX: number;
  startClientY: number;
  origin: PdfEditorBoxGeometry;
  lineOrigin?: PdfEditorGraphicLineItem;
  lineMode?: LineDragMode;
  imageMode?: ImageResizeMode;
  moved: boolean;
  historyCaptured: boolean;
}

interface EditorHistorySnapshot {
  drafts: Record<string, string>;
  deletedIds: string[];
  additions: PendingPdfEditorAddition[];
  geometryOverrides: Record<string, PdfEditorBoxGeometry>;
  lineGeometryOverrides: Record<string, PdfEditorGraphicLineItem>;
  imageGeometryOverrides: Record<string, PdfEditorImageItem>;
  deletedLineIds: string[];
  deletedImageIds: string[];
  copiedLines: PdfEditorGraphicLineItem[];
  copiedImages: PdfEditorImageItem[];
}

interface DragGuideState {
  geometry: PdfEditorBoxGeometry;
  label: string;
}

type ObjectClipboard =
  | { kind: "image"; item: PdfEditorImageItem }
  | { kind: "line"; item: PdfEditorGraphicLineItem };

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.8;
const DRAG_THRESHOLD = 3;
const HISTORY_LIMIT = 80;
const PDF_PAGE_SURFACE_MARGIN_PX = 0;

type LineDragMode = "move" | "start" | "end";
type ImageResizeMode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const IMAGE_RESIZE_HANDLES: Array<{ mode: Exclude<ImageResizeMode, "move">; cursor: CSSProperties["cursor"] }> = [
  { mode: "n", cursor: "ns-resize" },
  { mode: "s", cursor: "ns-resize" },
  { mode: "e", cursor: "ew-resize" },
  { mode: "w", cursor: "ew-resize" },
  { mode: "ne", cursor: "nesw-resize" },
  { mode: "nw", cursor: "nwse-resize" },
  { mode: "se", cursor: "nwse-resize" },
  { mode: "sw", cursor: "nesw-resize" }
];

export function PdfEditorWindowApp(): JSX.Element {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const pageFrameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>();
  const draftPreviewSequenceRef = useRef(0);
  const objectClipboardRef = useRef<ObjectClipboard>();
  const lastPagePointerRef = useRef<{ pageNumber: number; x: number; y: number }>();

  const [context, setContext] = useState<PdfEditorWindowContext>();
  const [layer, setLayer] = useState<PdfEditorTextLayer>();
  const [nativePreviewUrl, setNativePreviewUrl] = useState<string>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [additions, setAdditions] = useState<PendingPdfEditorAddition[]>([]);
  const [geometryOverrides, setGeometryOverrides] = useState<Record<string, PdfEditorBoxGeometry>>({});
  const [lineGeometryOverrides, setLineGeometryOverrides] = useState<Record<string, PdfEditorGraphicLineItem>>({});
  const [imageGeometryOverrides, setImageGeometryOverrides] = useState<Record<string, PdfEditorImageItem>>({});
  const [deletedLineIds, setDeletedLineIds] = useState<Set<string>>(new Set());
  const [deletedImageIds, setDeletedImageIds] = useState<Set<string>>(new Set());
  const [copiedLines, setCopiedLines] = useState<PdfEditorGraphicLineItem[]>([]);
  const [copiedImages, setCopiedImages] = useState<PdfEditorImageItem[]>([]);
  const [historyPast, setHistoryPast] = useState<EditorHistorySnapshot[]>([]);
  const [historyFuture, setHistoryFuture] = useState<EditorHistorySnapshot[]>([]);
  const [selectedPage, setSelectedPage] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState<DragTarget>();
  const [selectedObject, setSelectedObject] = useState<PdfObjectTarget>();
  const [hoveredTextId, setHoveredTextId] = useState<string>();
  const [visualTextBoxes, setVisualTextBoxes] = useState<Record<string, PdfEditorBoxGeometry>>({});
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<DragTarget>();
  const [editMode, setEditMode] = useState(false);
  const [zoom, setZoom] = useState(1.18);
  const [isLoading, setIsLoading] = useState(true);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [result, setResult] = useState<PdfEditorSaveResult>();
  const [dragGuide, setDragGuide] = useState<DragGuideState>();

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    window.convertSmith
      .getPdfEditorWindowContext(token)
      .then(async (nextContext) => {
        if (cancelled) return;
        setContext(nextContext);
        const [nextLayer, nextNativePreviewUrl] = await Promise.all([
          window.convertSmith.getPdfEditorTextLayer(nextContext.sourcePath),
          window.convertSmith.getNativePreviewUrl(nextContext.sourcePath)
        ]);
        if (cancelled) return;
        setLayer(nextLayer);
        setNativePreviewUrl(nextNativePreviewUrl);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "PDF Viewer를 열지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!nativePreviewUrl) return undefined;
    if (editMode) return undefined;
    setIsPageLoading(true);
    const timer = window.setTimeout(() => setIsPageLoading(false), 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [nativePreviewUrl, selectedPage]);

  const pageCount = layer?.pageCount || 0;
  const pageSize = useMemo(
    () => layer?.pageSizes.find((item) => item.pageNumber === selectedPage),
    [layer?.pageSizes, selectedPage]
  );
  const currentPageItems = useMemo(
    () => (layer?.items || []).filter((item) => item.pageNumber === selectedPage),
    [layer?.items, selectedPage]
  );
  const currentPageImages = useMemo(
    () => [
      ...(layer?.images || []).filter((item) => item.pageNumber === selectedPage),
      ...copiedImages.filter((item) => item.pageNumber === selectedPage)
    ],
    [copiedImages, layer?.images, selectedPage]
  );
  const currentPageLines = useMemo(
    () => [
      ...(layer?.lines || []).filter((item) => item.pageNumber === selectedPage),
      ...copiedLines.filter((item) => item.pageNumber === selectedPage)
    ],
    [copiedLines, layer?.lines, selectedPage]
  );
  const currentPageTables = useMemo(
    () => (layer?.tables || []).filter((item) => item.pageNumber === selectedPage),
    [layer?.tables, selectedPage]
  );
  const currentPageAdditions = additions.filter((item) => item.pageNumber === selectedPage);
  const changedCount = useMemo(
    () =>
      countPdfEditorChanges(
        layer?.items || [],
        drafts,
        deletedIds,
        additions,
        geometryOverrides,
        lineGeometryOverrides,
        imageGeometryOverrides,
        deletedLineIds,
        deletedImageIds,
        copiedLines,
        copiedImages
      ),
    [additions, copiedImages, copiedLines, deletedIds, deletedImageIds, deletedLineIds, drafts, geometryOverrides, imageGeometryOverrides, layer?.items, lineGeometryOverrides]
  );

  useLayoutEffect(() => {
    if (!editMode || !pageFrameRef.current) {
      setVisualTextBoxes({});
      return undefined;
    }

    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const surface = pageFrameRef.current?.querySelector<HTMLElement>(".pdf-editor-page-surface");
      if (!surface) {
        setVisualTextBoxes({});
        return;
      }

      const next: Record<string, PdfEditorBoxGeometry> = {};
      const surfaceRect = surface.getBoundingClientRect();
      const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;

      surface
        .querySelectorAll<HTMLElement>("[data-pdf-editor-visual-id]")
        .forEach((element) => {
          const id = element.dataset.pdfEditorVisualId;
          if (!id || !element.textContent?.trim()) return;
          const box = measureVisibleTextBox(element, surfaceRect, safeZoom);
          if (box) next[id] = box;
        });

      setVisualTextBoxes((current) => (areGeometryMapsEqual(current, next) ? current : next));
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [currentPageItems, deletedIds, drafts, editMode, geometryOverrides, selectedPage, zoom]);

  const loadNativePreviewPath = (sourcePath: string) => {
    const sequence = draftPreviewSequenceRef.current + 1;
    draftPreviewSequenceRef.current = sequence;
    setIsPageLoading(true);
    window.convertSmith
      .getNativePreviewUrl(sourcePath)
      .then((url) => {
        if (draftPreviewSequenceRef.current === sequence) {
          setNativePreviewUrl(url);
        }
      })
      .catch((previewError: unknown) => {
        if (draftPreviewSequenceRef.current === sequence) {
          setError(previewError instanceof Error ? previewError.message : "PDF Viewer 미리보기를 다시 열지 못했습니다.");
        }
      })
      .finally(() => {
        if (draftPreviewSequenceRef.current === sequence) {
          setIsPageLoading(false);
        }
      });
  };

  const nativePageUrl = useMemo(
    () => nativePreviewUrl ? createNativePdfPageUrl(nativePreviewUrl, selectedPage, zoom) : undefined,
    [nativePreviewUrl, selectedPage, zoom]
  );
  const createHistorySnapshot = (): EditorHistorySnapshot => ({
    drafts: { ...drafts },
    deletedIds: Array.from(deletedIds),
    additions: additions.map((item) => ({ ...item })),
    geometryOverrides: cloneGeometryOverrides(geometryOverrides),
    lineGeometryOverrides: cloneLineGeometryOverrides(lineGeometryOverrides),
    imageGeometryOverrides: cloneImageGeometryOverrides(imageGeometryOverrides),
    deletedLineIds: Array.from(deletedLineIds),
    deletedImageIds: Array.from(deletedImageIds),
    copiedLines: copiedLines.map((item) => ({ ...item, dashArray: item.dashArray ? [...item.dashArray] : undefined })),
    copiedImages: copiedImages.map((item) => ({ ...item }))
  });

  const restoreHistorySnapshot = (snapshot: EditorHistorySnapshot) => {
    setDrafts({ ...snapshot.drafts });
    setDeletedIds(new Set(snapshot.deletedIds));
    setAdditions(snapshot.additions.map((item) => ({ ...item })));
    setGeometryOverrides(cloneGeometryOverrides(snapshot.geometryOverrides));
    setLineGeometryOverrides(cloneLineGeometryOverrides(snapshot.lineGeometryOverrides));
    setImageGeometryOverrides(cloneImageGeometryOverrides(snapshot.imageGeometryOverrides));
    setDeletedLineIds(new Set(snapshot.deletedLineIds));
    setDeletedImageIds(new Set(snapshot.deletedImageIds));
    setCopiedLines(snapshot.copiedLines.map((item) => ({ ...item, dashArray: item.dashArray ? [...item.dashArray] : undefined })));
    setCopiedImages(snapshot.copiedImages.map((item) => ({ ...item })));
    setDeleteConfirmTarget(undefined);
    setDragGuide(undefined);
    setResult(undefined);
  };

  const resetEditorState = () => {
    dragRef.current = undefined;
    setDrafts({});
    setDeletedIds(new Set());
    setAdditions([]);
    setGeometryOverrides({});
    setLineGeometryOverrides({});
    setImageGeometryOverrides({});
    setDeletedLineIds(new Set());
    setDeletedImageIds(new Set());
    setCopiedLines([]);
    setCopiedImages([]);
    setHistoryPast([]);
    setHistoryFuture([]);
    setSelectedTarget(undefined);
    setSelectedObject(undefined);
    setDeleteConfirmTarget(undefined);
    setDragGuide(undefined);
    setEditMode(false);
    setError(undefined);
    if (context?.sourcePath) loadNativePreviewPath(context.sourcePath);
  };

  const rememberHistory = () => {
    const snapshot = createHistorySnapshot();
    const key = snapshotKey(snapshot);
    setHistoryPast((current) => {
      const last = current[current.length - 1];
      if (last && snapshotKey(last) === key) return current;
      return [...current, snapshot].slice(-HISTORY_LIMIT);
    });
    setHistoryFuture([]);
    setResult(undefined);
  };

  const undo = () => {
    const previous = historyPast[historyPast.length - 1];
    if (!previous) return;
    const current = createHistorySnapshot();
    setHistoryPast((items) => items.slice(0, -1));
    setHistoryFuture((items) => [current, ...items].slice(0, HISTORY_LIMIT));
    restoreHistorySnapshot(previous);
  };

  const redo = () => {
    const next = historyFuture[0];
    if (!next) return;
    const current = createHistorySnapshot();
    setHistoryFuture((items) => items.slice(1));
    setHistoryPast((items) => [...items, current].slice(-HISTORY_LIMIT));
    restoreHistorySnapshot(next);
  };

  useEffect(() => {
    setSelectedTarget(undefined);
    setSelectedObject(undefined);
    setDeleteConfirmTarget(undefined);
  }, [selectedPage]);

  useEffect(() => {
    if (editMode) return;
    setSelectedTarget(undefined);
    setSelectedObject(undefined);
    setDeleteConfirmTarget(undefined);
  }, [editMode]);

  const save = async () => {
    if (!context?.outputDir || !layer) {
      setError("저장할 폴더가 지정되지 않았습니다. 메인 창에서 저장 폴더를 지정한 뒤 Viewer를 다시 열어주세요.");
      return;
    }
    const liveValues = collectLiveEditorValues(layer.items, drafts, additions);
    const allEdits = buildPdfEditorEdits(
      layer.items,
      liveValues.drafts,
      deletedIds,
      liveValues.additions,
      geometryOverrides,
      layer.lines,
      lineGeometryOverrides,
      layer.images,
      imageGeometryOverrides,
      deletedLineIds,
      deletedImageIds,
      copiedLines,
      copiedImages
    );
    const edits = allEdits;
    if (edits.length === 0) {
      setError("저장할 수정 내용이 없습니다.");
      return;
    }

    const pendingLineGeometryOverrides = cloneLineGeometryOverrides(lineGeometryOverrides);
    const pendingImageGeometryOverrides = cloneImageGeometryOverrides(imageGeometryOverrides);
    const pendingDeletedLineIds = new Set(deletedLineIds);
    const pendingDeletedImageIds = new Set(deletedImageIds);
    setIsSaving(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const saveResult = await window.convertSmith.savePdfEditorTextEdits({
        sourcePath: context.sourcePath,
        outputDir: context.outputDir,
        outputName: context.outputName,
        useDatedSubfolder: context.useDatedSubfolder,
        edits
      });
      const nextLayer = await window.convertSmith.getPdfEditorTextLayer(saveResult.outputPath);
      setResult(saveResult);
      setDrafts({});
      setDeletedIds(new Set());
      setAdditions([]);
      setGeometryOverrides({});
      const nextLineIds = new Set(nextLayer.lines.map((line) => line.id));
      const nextImageIds = new Set(nextLayer.images.map((image) => image.id));
      setLineGeometryOverrides(filterObjectMapByIds(pendingLineGeometryOverrides, nextLineIds));
      setImageGeometryOverrides(filterObjectMapByIds(pendingImageGeometryOverrides, nextImageIds));
      setDeletedLineIds(new Set([...pendingDeletedLineIds].filter((id) => nextLineIds.has(id))));
      setDeletedImageIds(new Set([...pendingDeletedImageIds].filter((id) => nextImageIds.has(id))));
      setCopiedLines([]);
      setCopiedImages([]);
      setHistoryPast([]);
      setHistoryFuture([]);
      setSelectedTarget(undefined);
      setSelectedObject(undefined);
      setDeleteConfirmTarget(undefined);
      setLayer(nextLayer);
      const nextNativePreviewUrl = await window.convertSmith.getNativePreviewUrl(saveResult.outputPath);
      setNativePreviewUrl(nextNativePreviewUrl);
      setEditMode(false);
      setSelectedPage((current) => Math.max(1, Math.min(nextLayer.pageCount || 1, current)));
      setContext((current) =>
        current
          ? {
              ...current,
              sourcePath: saveResult.outputPath,
              sourceName: getFileNameFromPath(saveResult.outputPath)
            }
          : current
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PDF 수정본을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const getEditableImage = (id: string): PdfEditorImageItem | undefined => {
    const source = copiedImages.find((image) => image.id === id) || layer?.images.find((image) => image.id === id);
    if (!source) return undefined;
    return { ...source, ...(imageGeometryOverrides[id] || {}) };
  };

  const getEditableLine = (id: string): PdfEditorGraphicLineItem | undefined => {
    const source = copiedLines.find((line) => line.id === id) || layer?.lines.find((line) => line.id === id);
    if (!source) return undefined;
    return { ...source, ...(lineGeometryOverrides[id] || {}) };
  };

  const createImageCopy = (
    source: PdfEditorImageItem,
    targetPage: number,
    targetPoint?: { x: number; y: number }
  ): PdfEditorImageItem | undefined => {
    if (!pageSize) return undefined;
    const sourceObjectId = source.sourceObjectId || source.nativeObjectId;
    if (!sourceObjectId) {
      setError("이 이미지는 PDF 내부 원본 객체를 특정하지 못해 복사할 수 없습니다.");
      return undefined;
    }
    const base = {
      ...source,
      id: `copy-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageNumber: targetPage,
      nativeObjectId: sourceObjectId,
      sourceObjectId
    };
    const x = targetPoint ? targetPoint.x - source.width / 2 : source.x + 12;
    const y = targetPoint ? targetPoint.y - source.height / 2 : source.y + 12;
    return { ...base, ...clampGeometry({ ...source, x, y }, pageSize) };
  };

  const createLineCopy = (
    source: PdfEditorGraphicLineItem,
    targetPage: number,
    targetPoint?: { x: number; y: number }
  ): PdfEditorGraphicLineItem | undefined => {
    if (!pageSize) return undefined;
    const sourceObjectId = source.sourceObjectId || source.nativeObjectId;
    if (!sourceObjectId) {
      setError("이 선은 PDF 내부 원본 객체를 특정하지 못해 복사할 수 없습니다.");
      return undefined;
    }
    const centerX = (source.x1 + source.x2) / 2;
    const centerY = (source.y1 + source.y2) / 2;
    const dx = targetPoint ? targetPoint.x - centerX : 12;
    const dy = targetPoint ? targetPoint.y - centerY : 12;
    return normalizeLineGeometry(clampLineToPage({
      ...source,
      id: `copy-line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageNumber: targetPage,
      nativeObjectId: sourceObjectId,
      sourceObjectId,
      x1: source.x1 + dx,
      y1: source.y1 + dy,
      x2: source.x2 + dx,
      y2: source.y2 + dy,
      dashArray: source.dashArray ? [...source.dashArray] : undefined
    }, pageSize));
  };

  const copySelectedObjectToClipboard = (): boolean => {
    if (selectedObject?.kind === "image") {
      const image = getEditableImage(selectedObject.id);
      if (!image) return false;
      objectClipboardRef.current = { kind: "image", item: image };
      setNotice("이미지 객체를 복사했습니다. Ctrl+V로 같은 페이지 안에 붙여넣을 수 있습니다.");
      return true;
    }
    if (selectedObject?.kind === "line") {
      const line = getEditableLine(selectedObject.id);
      if (!line) return false;
      objectClipboardRef.current = { kind: "line", item: line };
      setNotice("선 객체를 복사했습니다. Ctrl+V로 같은 페이지 안에 붙여넣을 수 있습니다.");
      return true;
    }
    return false;
  };

  const pasteObjectNearPointer = (): boolean => {
    const clipboard = objectClipboardRef.current;
    if (!clipboard || !pageSize) return false;
    const sourcePage = clipboard.item.pageNumber;
    if (sourcePage !== selectedPage) {
      setError("객체 붙여넣기는 현재 같은 페이지 안에서만 지원합니다.");
      return true;
    }
    const pointer = lastPagePointerRef.current?.pageNumber === selectedPage
      ? { x: lastPagePointerRef.current.x, y: lastPagePointerRef.current.y }
      : undefined;
    rememberHistory();
    if (clipboard.kind === "image") {
      const copy = createImageCopy(clipboard.item, selectedPage, pointer);
      if (!copy) return true;
      setCopiedImages((current) => [...current, copy]);
      setSelectedTarget(undefined);
      setSelectedObject({ kind: "image", id: copy.id });
      setNotice(undefined);
      return true;
    }
    const copy = createLineCopy(clipboard.item, selectedPage, pointer);
    if (!copy) return true;
    setCopiedLines((current) => [...current, copy]);
    setSelectedTarget(undefined);
    setSelectedObject({ kind: "line", id: copy.id });
    setNotice(undefined);
    return true;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      const activeElement = document.activeElement;
      const isEditingText = activeElement instanceof HTMLElement && activeElement.isContentEditable;
      if (key === "s") {
        event.preventDefault();
        event.stopPropagation();
        void save();
        return;
      }
      if (key === "c") {
        if (isEditingText) return;
        if (copySelectedObjectToClipboard()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (key === "v") {
        if (isEditingText) return;
        if (pasteObjectNearPointer()) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        undo();
        return;
      }
      if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        redo();
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [additions, changedCount, context, copiedImages, copiedLines, deletedIds, deletedImageIds, deletedLineIds, drafts, geometryOverrides, historyFuture, historyPast, imageGeometryOverrides, isSaving, layer, lineGeometryOverrides, pageSize, selectedObject, selectedPage]);

  const changePage = (pageNumber: number) => {
    const nextPage = Math.max(1, Math.min(pageCount || 1, Math.trunc(pageNumber) || 1));
    setSelectedPage(nextPage);
  };

  const commitEditorSelection = () => {
    setSelectedTarget(undefined);
    setSelectedObject(undefined);
    setHoveredTextId(undefined);
    setDeleteConfirmTarget(undefined);
  };

  const selectText = (item: PdfEditorTextItem) => {
    if (!editMode) return;
    setSelectedObject(undefined);
    setSelectedTarget({ kind: "text", id: item.id });
  };

  const selectAddition = (item: PendingPdfEditorAddition) => {
    if (!editMode) return;
    setSelectedObject(undefined);
    setSelectedTarget({ kind: "add", id: item.id });
  };

  const addTextBox = () => {
    rememberHistory();
    const next = createPdfEditorAddition(selectedPage, additions.length, pageSize);
    setAdditions((current) => [...current, next]);
    setSelectedTarget({ kind: "add", id: next.id });
    setEditMode(true);
  };

  const updateTextDraft = (item: PdfEditorTextItem, value: string) => {
    if ((drafts[item.id] ?? item.text) === value && !deletedIds.has(item.id)) return;
    rememberHistory();
    setDrafts((current) => ({ ...current, [item.id]: value }));
    const currentGeometry = geometryOverrides[item.id] || item;
    const expandedGeometry = createStableDraftTextGeometry(
      currentGeometry,
      item,
      value,
      zoom,
      pageSize
    );
    if (
      Math.abs(expandedGeometry.width - currentGeometry.width) > 0.1 ||
      Math.abs(expandedGeometry.height - currentGeometry.height) > 0.1
    ) {
      setGeometryOverrides((current) => ({ ...current, [item.id]: expandedGeometry }));
    }
    if (deletedIds.has(item.id)) {
      setDeletedIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const deleteTextItem = (item: PdfEditorTextItem) => {
    if (deletedIds.has(item.id)) return;
    rememberHistory();
    setDeletedIds((current) => {
      const next = new Set(current);
      next.add(item.id);
      return next;
    });
    setSelectedTarget(undefined);
    setDrafts((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setGeometryOverrides((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  };

  const updateAddition = (id: string, patch: Partial<PendingPdfEditorAddition>) => {
    const target = additions.find((item) => item.id === id);
    if (target && Object.entries(patch).every(([key, value]) => target[key as keyof PendingPdfEditorAddition] === value)) return;
    rememberHistory();
    setAdditions((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeAddition = (id: string) => {
    if (!additions.some((item) => item.id === id)) return;
    rememberHistory();
    setAdditions((current) => current.filter((item) => item.id !== id));
    if (selectedTarget?.kind === "add" && selectedTarget.id === id) setSelectedTarget(undefined);
  };

  const requestDelete = (target: DragTarget) => {
    setDeleteConfirmTarget(target);
  };

  const cancelDelete = () => {
    setDeleteConfirmTarget(undefined);
  };

  const confirmDelete = () => {
    const target = deleteConfirmTarget;
    if (!target) return;
    if (target.kind === "text") {
      const item = layer?.items.find((entry) => entry.id === target.id);
      if (item) deleteTextItem(item);
    } else if (target.kind === "add") {
      removeAddition(target.id);
    } else if (target.kind === "image") {
      deleteImageItem(target.id);
    } else if (target.kind === "line") {
      deleteLineItem(target.id);
    }
    setDeleteConfirmTarget(undefined);
  };

  const deleteImageItem = (id: string) => {
    if (copiedImages.some((image) => image.id === id)) {
      rememberHistory();
      setCopiedImages((current) => current.filter((image) => image.id !== id));
      setSelectedObject(undefined);
      return;
    }
    if (deletedImageIds.has(id)) return;
    rememberHistory();
    setDeletedImageIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    setImageGeometryOverrides((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelectedObject(undefined);
  };

  const deleteLineItem = (id: string) => {
    if (copiedLines.some((line) => line.id === id)) {
      rememberHistory();
      setCopiedLines((current) => current.filter((line) => line.id !== id));
      setSelectedObject(undefined);
      return;
    }
    if (deletedLineIds.has(id)) return;
    rememberHistory();
    setDeletedLineIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
    setLineGeometryOverrides((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSelectedObject(undefined);
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLElement>,
    target: DragTarget,
    geometry: PdfEditorBoxGeometry
  ) => {
    if (!editMode || event.button !== 0) return;
    const targetElement = event.target;
    if (targetElement instanceof HTMLElement && targetElement.closest("[data-no-drag]")) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedTarget(target);
    dragRef.current = {
      pointerId: event.pointerId,
      target,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: geometry,
      moved: false,
      historyCaptured: false
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const startLineDrag = (
    event: ReactPointerEvent<HTMLElement>,
    line: PdfEditorGraphicLineItem
  ) => {
    if (!editMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const dragLine = event.ctrlKey
      ? createLineCopy(line, line.pageNumber, { x: (line.x1 + line.x2) / 2, y: (line.y1 + line.y2) / 2 })
      : line;
    if (!dragLine) return;
    if (event.ctrlKey) {
      rememberHistory();
      setCopiedLines((current) => [...current, dragLine]);
      objectClipboardRef.current = { kind: "line", item: dragLine };
    }
    setSelectedTarget(undefined);
    setDeleteConfirmTarget(undefined);
    setSelectedObject({ kind: "line", id: dragLine.id });
    dragRef.current = {
      pointerId: event.pointerId,
      target: { kind: "line", id: dragLine.id },
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: dragLine,
      lineOrigin: dragLine,
      lineMode: getLineDragMode(dragLine, event, zoom),
      moved: false,
      historyCaptured: event.ctrlKey
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const startImageDrag = (
    event: ReactPointerEvent<HTMLElement>,
    image: PdfEditorImageItem,
    imageMode: ImageResizeMode = "move"
  ) => {
    if (!editMode || event.button !== 0) return;
    const targetElement = event.target;
    if (targetElement instanceof HTMLElement && targetElement.closest("[data-no-drag]")) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceImage = imageGeometryOverrides[image.id] || image;
    const dragImage = event.ctrlKey && imageMode === "move"
      ? createImageCopy(sourceImage, sourceImage.pageNumber, {
          x: sourceImage.x + sourceImage.width / 2,
          y: sourceImage.y + sourceImage.height / 2
        })
      : sourceImage;
    if (!dragImage) return;
    if (event.ctrlKey && imageMode === "move") {
      rememberHistory();
      setCopiedImages((current) => [...current, dragImage]);
      objectClipboardRef.current = { kind: "image", item: dragImage };
    }
    setSelectedTarget(undefined);
    setDeleteConfirmTarget(undefined);
    setSelectedObject({ kind: "image", id: dragImage.id });
    dragRef.current = {
      pointerId: event.pointerId,
      target: { kind: "image", id: dragImage.id },
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: dragImage,
      imageMode,
      moved: false,
      historyCaptured: event.ctrlKey && imageMode === "move"
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || !pageSize) return;
      const dx = (event.clientX - drag.startClientX) / zoom;
      const dy = (event.clientY - drag.startClientY) / zoom;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      event.preventDefault();
      if (!drag.historyCaptured) {
        rememberHistory();
        drag.historyCaptured = true;
      }
      drag.moved = true;
      if (drag.target.kind === "line" && drag.lineOrigin) {
        const delta = event.shiftKey && (drag.lineMode || "move") === "move" ? constrainAxisDelta(dx, dy) : { dx, dy };
        const nextLine = adjustLineGeometry(drag.lineOrigin, delta.dx, delta.dy, drag.lineMode || "move", pageSize);
        applyLineGeometry(drag.target.id, nextLine);
        setDragGuide(createLineDragGuide(nextLine));
        return;
      }
      if (drag.target.kind === "image" && drag.imageMode && drag.imageMode !== "move") {
        const nextGeometry = resizeImageGeometry(drag.origin, dx, dy, drag.imageMode, pageSize, event.shiftKey);
        applyGeometry(drag.target, nextGeometry);
        setDragGuide(createBoxDragGuide(nextGeometry));
        return;
      }
      const delta = event.shiftKey ? constrainAxisDelta(dx, dy) : { dx, dy };
      const nextGeometry = clampGeometry(
        {
          ...drag.origin,
          x: drag.origin.x + delta.dx,
          y: drag.origin.y + delta.dy
        },
        pageSize
      );
      applyGeometry(drag.target, nextGeometry);
      setDragGuide(createBoxDragGuide(nextGeometry));
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = undefined;
        setDragGuide(undefined);
      }
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [additions, copiedImages, copiedLines, deletedIds, drafts, geometryOverrides, imageGeometryOverrides, lineGeometryOverrides, pageSize, zoom]);

  const applyGeometry = (target: DragTarget, geometry: PdfEditorBoxGeometry) => {
    if (target.kind === "text") {
      setGeometryOverrides((current) => ({ ...current, [target.id]: geometry }));
      return;
    }
    if (target.kind === "image") {
      if (copiedImages.some((image) => image.id === target.id)) {
        setCopiedImages((current) => current.map((image) => (image.id === target.id ? { ...image, ...geometry } : image)));
        return;
      }
      setImageGeometryOverrides((current) => {
        const source = current[target.id] || currentPageImages.find((image) => image.id === target.id);
        if (!source) return current;
        return {
          ...current,
          [target.id]: {
            ...source,
            ...geometry
          }
        };
      });
      return;
    }
    setAdditions((current) => current.map((item) => (item.id === target.id ? { ...item, ...geometry } : item)));
  };

  const applyLineGeometry = (id: string, geometry: PdfEditorGraphicLineItem) => {
    if (copiedLines.some((line) => line.id === id)) {
      setCopiedLines((current) => current.map((line) => (line.id === id ? geometry : line)));
      return;
    }
    setLineGeometryOverrides((current) => ({ ...current, [id]: geometry }));
  };

  const handleDraftPagePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    updateLastPagePointer(event, selectedPage, zoom, lastPagePointerRef);
    if (!editMode || event.button !== 0 || event.target !== event.currentTarget || !pageSize) return;

    const hit = findTextHitAtPointer(
      event,
      currentPageItems.filter((item) => !deletedIds.has(item.id)),
      geometryOverrides,
      drafts,
      zoom,
      visualTextBoxes
    );

    if (!hit) {
      commitEditorSelection();
      return;
    }

    setSelectedObject(undefined);
    setDeleteConfirmTarget(undefined);
    startDrag(event, { kind: "text", id: hit.item.id }, hit.geometry);
  };

  const handleDraftPagePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    updateLastPagePointer(event, selectedPage, zoom, lastPagePointerRef);
    if (!editMode || event.target !== event.currentTarget || dragRef.current) return;
    const hit = findTextHitAtPointer(
      event,
      currentPageItems.filter((item) => !deletedIds.has(item.id)),
      geometryOverrides,
      drafts,
      zoom,
      visualTextBoxes
    );
    setHoveredTextId(hit?.item.id);
  };

  return (
    <div className="pdf-viewer-window h-screen overflow-hidden bg-[#242424] text-stone-950">
      <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2 shadow-xl">
        <strong className="max-w-[320px] truncate text-sm">{context?.sourceName || "PDF Viewer"}</strong>
        <span className="h-5 w-px bg-stone-200" />
        <button type="button" onClick={() => changePage(selectedPage - 1)} disabled={selectedPage <= 1} className="viewer-toolbar-button">
          이전
        </button>
        <span className="min-w-16 text-center text-xs font-semibold text-stone-600">
          {selectedPage} / {pageCount || "-"}
        </span>
        <button type="button" onClick={() => changePage(selectedPage + 1)} disabled={!pageCount || selectedPage >= pageCount} className="viewer-toolbar-button">
          다음
        </button>
        <span className="h-5 w-px bg-stone-200" />
        <button
          type="button"
          onClick={() => {
            setResult(undefined);
            setEditMode(true);
          }}
          className={[
            "inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold",
            editMode ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
          ].join(" ")}
        >
          수정
        </button>
        {(editMode || changedCount > 0) && (
          <button
            type="button"
            onClick={resetEditorState}
            disabled={isSaving}
            className="viewer-toolbar-button"
          >
            수정 취소
          </button>
        )}
        <button type="button" onClick={addTextBox} disabled={!editMode || !pageSize} className="viewer-toolbar-button">
          추가
        </button>
        <button
          type="button"
          onClick={save}
          disabled={changedCount === 0 || isSaving}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
        >
          <Save size={13} />
          {isSaving ? "저장 중" : `저장${changedCount ? `(${changedCount})` : ""}`}
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, Math.round((value - 0.1) * 100) / 100))} className="viewer-icon-button" aria-label="축소">
          <Minus size={13} />
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, Math.round((value + 0.1) * 100) / 100))} className="viewer-icon-button" aria-label="확대">
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={() => context && window.convertSmith.previewFile(result?.outputPath || context.sourcePath)}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-stone-200 bg-white px-3 text-xs text-stone-700 hover:bg-stone-100"
        >
          <ExternalLink size={13} />
          외부 앱
        </button>
      </div>

      {editMode && (
        <div className="pdf-editor-floating-notice absolute left-1/2 top-[4.5rem] z-30 -translate-x-1/2 rounded-md border border-emerald-100 bg-white/95 px-3 py-2 text-xs leading-5 text-stone-700 shadow">
          Convert Smith는 가능한 경우 PDF 내부 텍스트 명령을 직접 수정합니다. 직접 수정이 어려운 PDF는 안전을 위해 저장을 제한합니다.
        </div>
      )}

      {(isLoading || isPageLoading) && (
        <PdfViewerLoadingOverlay
          progress={isLoading ? 42 : 76}
          message={isLoading ? "PDF 구조와 텍스트 레이어를 읽는 중입니다." : "PDF 페이지를 Viewer로 렌더링 중입니다."}
          completed={isLoading ? 0 : 1}
          total={2}
        />
      )}

      {error && (
        <div className="pdf-editor-floating-notice absolute left-1/2 top-20 z-40 -translate-x-1/2 whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900 shadow-xl">
          {error}
        </div>
      )}

      {!error && notice ? (
        <div className="pdf-editor-floating-notice absolute left-1/2 top-20 z-40 -translate-x-1/2 whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 shadow-xl">
          {notice}
        </div>
      ) : null}

      {!error && !notice && layer?.warnings?.length ? (
        <div className="pdf-editor-floating-notice absolute left-1/2 top-20 z-40 -translate-x-1/2 whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 shadow-xl">
          <strong className="mb-1 block">제한 모드로 열었습니다.</strong>
          {layer.warnings.slice(0, 3).join("\n")}
        </div>
      ) : null}

      <div
        className="h-full overflow-auto px-8 pb-12 pt-16"
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          const direction = event.deltaY < 0 ? 1 : -1;
          setZoom((value) => {
            const step = direction > 0 ? 0.08 : -0.08;
            return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round((value + step) * 100) / 100));
          });
        }}
      >
        <div className="mx-auto w-fit">
          {nativePageUrl && pageSize && (
            <div
              ref={pageFrameRef}
              className="relative bg-white shadow-2xl"
              onPointerDown={(event) => {
                if (!editMode) return;
                if (event.target === event.currentTarget) {
                  commitEditorSelection();
                }
              }}
              style={{
                width: `${pageSize.width * zoom + PDF_PAGE_SURFACE_MARGIN_PX * 2}px`,
                height: `${pageSize.height * zoom + PDF_PAGE_SURFACE_MARGIN_PX * 2}px`
              }}
            >
              {!editMode && (
                <iframe
                  key={nativePageUrl}
                  src={nativePageUrl}
                  title="PDF page"
                  className="pdf-native-page-frame"
                  onLoad={() => setIsPageLoading(false)}
                />
              )}

              {editMode && (
                <div
                  className={[
                    "pdf-editor-page-surface pdf-editor-draft-page",
                    hoveredTextId ? "pdf-editor-page-surface--text-hovered" : ""
                  ].join(" ")}
                  style={pageSurfaceStyle(pageSize, zoom)}
                  onPointerDown={handleDraftPagePointerDown}
                  onPointerMove={handleDraftPagePointerMove}
                  onPointerLeave={() => setHoveredTextId(undefined)}
                >
                  {currentPageLines.filter((line) => !deletedLineIds.has(line.id)).map((line) => {
                    const adjustedLine = lineGeometryOverrides[line.id] || line;
                    return (
                      <DraftLineBox
                        key={line.id}
                        line={adjustedLine}
                        zoom={zoom}
                        selected={selectedObject?.kind === "line" && selectedObject.id === line.id}
                        confirmDeleteOpen={deleteConfirmTarget?.kind === "line" && deleteConfirmTarget.id === line.id}
                        onSelect={() => {
                          setSelectedTarget(undefined);
                          setDeleteConfirmTarget(undefined);
                          setSelectedObject({ kind: "line", id: line.id });
                        }}
                        onStartDrag={(event) => startLineDrag(event, adjustedLine)}
                        onRequestDelete={() => requestDelete({ kind: "line", id: line.id })}
                        onConfirmDelete={confirmDelete}
                        onCancelDelete={cancelDelete}
                      />
                    );
                  })}

                  {currentPageImages.filter((image) => !deletedImageIds.has(image.id)).map((image) => {
                    const adjustedImage = imageGeometryOverrides[image.id] || image;
                    return (
                      <DraftImageBox
                        key={image.id}
                        image={adjustedImage}
                        zoom={zoom}
                        selected={selectedObject?.kind === "image" && selectedObject.id === image.id}
                        confirmDeleteOpen={deleteConfirmTarget?.kind === "image" && deleteConfirmTarget.id === image.id}
                        onSelect={() => {
                          setSelectedTarget(undefined);
                          setDeleteConfirmTarget(undefined);
                          setSelectedObject({ kind: "image", id: image.id });
                        }}
                        onStartDrag={(event) => startImageDrag(event, adjustedImage)}
                        onStartResize={(event, mode) => startImageDrag(event, adjustedImage, mode)}
                        onRequestDelete={() => requestDelete({ kind: "image", id: image.id })}
                        onConfirmDelete={confirmDelete}
                        onCancelDelete={cancelDelete}
                      />
                    );
                  })}

                  {currentPageItems.filter((item) => !deletedIds.has(item.id)).map((item) => {
                    const changed = drafts[item.id] !== undefined || Boolean(geometryOverrides[item.id]);
                    const selected = selectedTarget?.kind === "text" && selectedTarget.id === item.id;
                    return (
                      <TextOverlayBox
                        key={item.id}
                        item={item}
                        geometry={geometryOverrides[item.id] || item}
                        pageSize={pageSize}
                        zoom={zoom}
                        selected={selected}
                        hovered={!selected && hoveredTextId === item.id}
                        deleted={false}
                        value={drafts[item.id] ?? item.text}
                        visualGeometry={visualTextBoxes[item.id]}
                        changed={changed}
                        cloneMode={!selected}
                        confirmDeleteOpen={deleteConfirmTarget?.kind === "text" && deleteConfirmTarget.id === item.id}
                        onSelect={() => selectText(item)}
                        onStartDrag={(event) => startDrag(event, { kind: "text", id: item.id }, geometryOverrides[item.id] || item)}
                        onChange={(value) => updateTextDraft(item, value)}
                        onRequestDelete={() => requestDelete({ kind: "text", id: item.id })}
                        onConfirmDelete={confirmDelete}
                        onCancelDelete={cancelDelete}
                      />
                    );
                  })}

                  {currentPageAdditions.filter((item) => editMode || item.text.trim()).map((item) => (
                    <AdditionOverlayBox
                      key={item.id}
                      item={item}
                      zoom={zoom}
                      selected={selectedTarget?.kind === "add" && selectedTarget.id === item.id}
                      previewOnly={!editMode}
                      confirmDeleteOpen={deleteConfirmTarget?.kind === "add" && deleteConfirmTarget.id === item.id}
                      onSelect={() => selectAddition(item)}
                      onStartDrag={(event) => startDrag(event, { kind: "add", id: item.id }, item)}
                      onChange={(value) => updateAddition(item.id, { text: value })}
                      onRequestDelete={() => requestDelete({ kind: "add", id: item.id })}
                      onConfirmDelete={confirmDelete}
                      onCancelDelete={cancelDelete}
                    />
                  ))}
                  {dragGuide && <DragGuideOverlay guide={dragGuide} zoom={zoom} pageSize={pageSize} />}
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="absolute bottom-4 right-4 z-40 max-w-[380px] rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-xl">
          <strong className="mb-1 block">수정본 저장 완료</strong>
          <p className="truncate text-xs">{result.outputPath}</p>
        </div>
      )}
    </div>
  );
}

function PdfViewerLoadingOverlay({
  progress,
  message,
  completed,
  total
}: {
  progress: number;
  message: string;
  completed: number;
  total: number;
}): JSX.Element {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));
  const title = "PDF Viewer 준비 중입니다";

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
        <p className="max-w-[320px] text-center text-sm leading-5 text-stone-700">{message}</p>
        <div className="w-full">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-stone-600">
            <span>진행률 {safeProgress}%</span>
            <span>
              {completed}/{total}
            </span>
          </div>
          <div className="smith-loader-progress" aria-hidden="true">
            <span style={{ width: `${safeProgress}%` }} />
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
        <filter id="smith-water-drop-gooey-viewer">
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
      <div className="smith-water-drop-loader-gooey" style={{ filter: 'url("#smith-water-drop-gooey-viewer")' }}>
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

function createNativePdfPageUrl(nativePreviewUrl: string, pageNumber: number, zoom: number): string {
  const safePageNumber = Math.max(1, Math.trunc(pageNumber) || 1);
  const chromePdfZoom = Math.max(20, Math.min(300, Math.round(zoom * 75)));
  return `${nativePreviewUrl}#page=${safePageNumber}&zoom=${chromePdfZoom}&toolbar=0&navpanes=0&scrollbar=0`;
}

function moveCaretToEnd(element: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function InlineEditableText({
  value,
  placeholder,
  fontSize,
  fontFamily,
  fontWeight,
  fontStyle,
  color,
  targetWidth,
  fitToWidth,
  visible = true,
  textId,
  additionId,
  editorStyle,
  onChange
}: {
  value: string;
  placeholder?: string;
  fontSize: number;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  color?: string;
  targetWidth?: number;
  fitToWidth?: boolean;
  visible?: boolean;
  textId?: string;
  additionId?: string;
  editorStyle?: CSSProperties;
  onChange: (value: string) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastValueRef = useRef(value);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    lastValueRef.current = value;
    element.innerText = value;
    element.focus();
    moveCaretToEnd(element);
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (document.activeElement === element) return;
    if (element.innerText !== value) {
      lastValueRef.current = value;
      element.innerText = value;
    }
  }, [value]);

  const commitCurrentText = () => {
    const element = ref.current;
    if (!element) return;
    const nextValue = normalizeEditableDomText(element.innerText);
    if (lastValueRef.current === nextValue) return;
    lastValueRef.current = nextValue;
    onChange(nextValue);
  };

  return (
    <div
      ref={ref}
      data-no-drag
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={placeholder || "PDF text"}
      data-placeholder={placeholder}
      data-pdf-editor-text-id={textId}
      data-pdf-editor-addition-id={additionId}
      className="pdf-editor-inline-editor allow-text-selection"
      dir="ltr"
      spellCheck={false}
      style={{
        color: visible ? (color ? `#${color.replace(/^#/, "")}` : "#111827") : "transparent",
        fontFamily: createViewerFontStack(fontFamily, value),
        fontWeight: normalizeCssFontWeight(fontWeight),
        fontStyle: normalizeCssFontStyle(fontStyle),
        fontSize: `${Math.max(1, fontSize)}px`,
        lineHeight: "1.05",
        whiteSpace: fitToWidth ? "pre" : "pre-wrap",
        overflowWrap: fitToWidth ? "normal" : "anywhere",
        wordBreak: fitToWidth ? "keep-all" : "normal",
        ...(fitToWidth && targetWidth
          ? createFitTextStyle(value, fontSize, fontFamily, targetWidth, fontWeight, fontStyle)
          : {}),
        ...editorStyle
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
        window.setTimeout(commitCurrentText, 0);
      }}
      onInput={commitCurrentText}
      onKeyUp={commitCurrentText}
      onCompositionEnd={commitCurrentText}
    />
  );
}

function TextOverlayBox({
  item,
  geometry,
  pageSize,
  zoom,
  selected,
  hovered,
  deleted,
  value,
  visualGeometry,
  changed,
  cloneMode,
  confirmDeleteOpen,
  onSelect,
  onStartDrag,
  onChange,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete
}: {
  item: PdfEditorTextItem;
  geometry: PdfEditorBoxGeometry;
  pageSize?: PdfEditorPageSize;
  zoom: number;
  selected: boolean;
  hovered: boolean;
  deleted: boolean;
  value: string;
  visualGeometry?: PdfEditorBoxGeometry;
  changed: boolean;
  cloneMode: boolean;
  confirmDeleteOpen: boolean;
  onSelect: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onChange: (value: string) => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}): JSX.Element {
  const displayGeometry = changed
    ? createTextDisplayGeometry(
        geometry,
        value,
        item.fontSize,
        zoom,
        item.fontFamily,
        item.fontWeight,
        item.fontStyle,
        pageSize,
        item.width
      )
    : geometry;
  const visibleGeometry = !selected && cloneMode
    ? expandGeometryForText(
        displayGeometry,
        value,
        item.fontSize,
        zoom,
        item.fontFamily,
        item.fontWeight,
        item.fontStyle,
        pageSize,
        Math.max(item.width, displayGeometry.width)
      )
    : displayGeometry;
  const interactionGeometry = !selected && visualGeometry
    ? visualGeometry
    : createTextHitGeometry(visibleGeometry, item, value, zoom);
  const interactionStyle = relativeBoxStyleExact(interactionGeometry, visibleGeometry, zoom);
  const placeDeleteBubbleLeft = pageSize
    ? interactionGeometry.x + interactionGeometry.width + 180 > pageSize.width
    : false;
  const selectedGeometry = selected
    ? createStableDraftTextGeometry(visibleGeometry, item, value, zoom, pageSize)
    : visibleGeometry;
  const selectedInteractionStyle = relativeBoxStyleExact(selectedGeometry, visibleGeometry, zoom);
  return (
    <div
      onClick={onSelect}
      onPointerDown={onStartDrag}
      className={[
        "pdf-editor-field",
        cloneMode && !selected ? "pdf-editor-field--clone" : "",
        hovered ? "pdf-editor-field--hovered" : "",
        selected ? "pdf-editor-field--selected" : "",
        selected ? "pdf-editor-field--text-selected-root" : "",
        deleted ? "pdf-editor-field--deleted" : "",
        changed && !selected ? "pdf-editor-field--changed" : ""
      ].join(" ")}
      style={boxStyleExact(visibleGeometry, zoom)}
      title={item.text}
    >
      {selected && !deleted && item.editCapability === "not_editable" ? (
        <span
          className="pdf-editor-text-interaction-box pdf-editor-text-interaction-box--selected"
          style={selectedInteractionStyle}
        >
          <CapabilityBadge capability={item.editCapability} reason={item.editCapabilityReason} />
        </span>
      ) : selected && !deleted ? (
        <span
          className="pdf-editor-text-interaction-box pdf-editor-text-interaction-box--selected"
          style={selectedInteractionStyle}
        >
          <InlineEditableText
            value={value}
            fontSize={item.fontSize * zoom}
            fontFamily={item.fontFamily}
            fontWeight={item.fontWeight}
            fontStyle={item.fontStyle}
            color={item.color}
            targetWidth={selectedGeometry.width * zoom}
            fitToWidth
            visible
            textId={item.id}
            editorStyle={{
              height: `${Math.max(1, selectedGeometry.height * zoom)}px`,
              minHeight: `${Math.max(1, selectedGeometry.height * zoom)}px`
            }}
            onChange={onChange}
          />
          <button
            data-no-drag
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete();
            }}
            className="pdf-editor-delete-trigger absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-sm border border-stone-300 bg-white text-stone-600 shadow"
            aria-label="삭제"
          >
            <Trash2 size={12} />
          </button>
          {confirmDeleteOpen && (
            <DeleteConfirmBubble
              placement={placeDeleteBubbleLeft ? "left" : "right"}
              onConfirm={onConfirmDelete}
              onCancel={onCancelDelete}
            />
          )}
          <CapabilityBadge capability={item.editCapability} reason={item.editCapabilityReason} />
        </span>
      ) : cloneMode && !deleted ? (
        <>
          <div
            className="pdf-editor-field-text"
            data-pdf-editor-visual-id={item.id}
            style={{
              color: item.color ? `#${item.color.replace(/^#/, "")}` : "#111827",
              fontFamily: createViewerFontStack(item.fontFamily, value),
              fontWeight: normalizeCssFontWeight(item.fontWeight),
              fontStyle: normalizeCssFontStyle(item.fontStyle),
              fontSize: `${Math.max(1, item.fontSize * zoom)}px`,
              lineHeight: "1.05",
              whiteSpace: "pre",
              overflowWrap: "normal",
              wordBreak: "keep-all",
              ...createFitTextStyle(value, item.fontSize * zoom, item.fontFamily, visibleGeometry.width * zoom, item.fontWeight, item.fontStyle)
            }}
          >
            {value}
          </div>
          {hovered && (
            <span
              className="pdf-editor-text-interaction-box pdf-editor-text-interaction-box--hovered"
              style={interactionStyle}
              aria-hidden="true"
            />
          )}
        </>
      ) : (
        <span className="pdf-editor-field-label" />
      )}
    </div>
  );
}

function collectLiveEditorValues(
  items: PdfEditorTextItem[],
  drafts: Record<string, string>,
  additions: PendingPdfEditorAddition[]
): { drafts: Record<string, string>; additions: PendingPdfEditorAddition[] } {
  const nextDrafts = { ...drafts };
  const itemById = new Map(items.map((item) => [item.id, item]));
  document.querySelectorAll<HTMLElement>("[data-pdf-editor-text-id]").forEach((element) => {
    const id = element.dataset.pdfEditorTextId;
    if (!id) return;
    const item = itemById.get(id);
    if (!item) return;
    const value = normalizeEditableDomText(element.innerText);
    if (value !== item.text) {
      nextDrafts[id] = value;
    } else {
      delete nextDrafts[id];
    }
  });

  const liveAdditionText = new Map<string, string>();
  document.querySelectorAll<HTMLElement>("[data-pdf-editor-addition-id]").forEach((element) => {
    const id = element.dataset.pdfEditorAdditionId;
    if (!id) return;
    liveAdditionText.set(id, normalizeEditableDomText(element.innerText));
  });

  const nextAdditions = additions.map((item) =>
    liveAdditionText.has(item.id) ? { ...item, text: liveAdditionText.get(item.id)! } : item
  );
  return { drafts: nextDrafts, additions: nextAdditions };
}

function normalizeEditableDomText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "").normalize("NFC");
}

function CapabilityBadge({
  capability,
  reason
}: {
  capability?: PdfEditorTextItem["editCapability"];
  reason?: string;
}): JSX.Element | null {
  if (capability === "direct") return null;
  const meta = getCapabilityBadgeMeta(capability, reason);
  return (
    <span
      data-no-drag
      className={[
        "pdf-editor-capability-badge rounded-sm border px-1.5 py-0.5 text-[10px] font-medium shadow-sm",
        meta.className
      ].join(" ")}
      title={meta.detail}
    >
      {meta.label}
    </span>
  );
}

function getCapabilityBadgeMeta(capability?: PdfEditorTextItem["editCapability"], reason?: string): {
  label: string;
  detail: string;
  className: string;
} {
  if (capability === "direct") {
    return {
      label: "직접 수정 가능",
      detail: "원본 PDF 내부 텍스트 명령을 직접 교체할 수 있습니다.",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700"
    };
  }
  if (capability === "neutralize_and_insert") {
    return {
      label: "새 글꼴 삽입 필요",
      detail: "원본 텍스트 명령을 비우고 새 글꼴의 실제 PDF 텍스트 객체로 저장될 수 있습니다.",
      className: "border-amber-200 bg-amber-50 text-amber-800"
    };
  }
  if (capability === "add_only") {
    return {
      label: "추가만 가능",
      detail: "기존 텍스트 직접 수정은 제한되며 새 텍스트 추가만 가능합니다.",
      className: "border-stone-200 bg-stone-50 text-stone-700"
    };
  }
  return {
    label: "보기 전용",
    detail: reason === "ambiguous_text_span"
      ? "반복 텍스트가 있어 원본 명령을 하나로 특정하지 못했습니다."
      : "PDF 내부 구조상 이 텍스트는 직접 수정이 어렵습니다.",
    className: "border-rose-200 bg-rose-50 text-rose-700"
  };
}

function DraftImageBox({
  image,
  zoom,
  selected,
  confirmDeleteOpen,
  onSelect,
  onStartDrag,
  onStartResize,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete
}: {
  image: PdfEditorImageItem;
  zoom: number;
  selected: boolean;
  confirmDeleteOpen: boolean;
  onSelect: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onStartResize: (event: ReactPointerEvent<HTMLElement>, mode: ImageResizeMode) => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}): JSX.Element {
  const src = image.imageDataBase64 ? `data:${image.mimeType || "image/png"};base64,${image.imageDataBase64}` : undefined;
  return (
    <div
      className={["pdf-editor-draft-image", selected ? "pdf-editor-draft-image--selected" : ""].join(" ")}
      style={boxStyleExact(image, zoom)}
      onPointerDown={onStartDrag}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      title="이미지 객체"
    >
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        <span className="pdf-editor-draft-image-fallback">이미지</span>
      )}
      {selected && (
        <button
          data-no-drag
          type="button"
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            onRequestDelete();
          }}
          className="pdf-editor-delete-trigger absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-sm border border-stone-300 bg-white text-stone-600 shadow"
          aria-label="이미지 삭제"
        >
          <Trash2 size={12} />
        </button>
      )}
      {selected && (
        <>
          {IMAGE_RESIZE_HANDLES.map((handle) => (
            <i
              key={handle.mode}
              className={`pdf-editor-image-resize-handle pdf-editor-image-resize-handle--${handle.mode}`}
              style={{ cursor: handle.cursor }}
              aria-hidden="true"
              onPointerDown={(event) => onStartResize(event, handle.mode)}
            />
          ))}
        </>
      )}
      {selected && confirmDeleteOpen && (
        <DeleteConfirmBubble
          placement="left"
          onConfirm={onConfirmDelete}
          onCancel={onCancelDelete}
        />
      )}
    </div>
  );
}

function DraftLineBox({
  line,
  zoom,
  selected,
  confirmDeleteOpen,
  onSelect,
  onStartDrag,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete
}: {
  line: PdfEditorGraphicLineItem;
  zoom: number;
  selected: boolean;
  confirmDeleteOpen: boolean;
  onSelect: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}): JSX.Element {
  const hitGeometry = createLineHitGeometry(line);
  return (
    <button
      type="button"
      className={["pdf-editor-draft-line", selected ? "pdf-editor-draft-line--selected" : ""].join(" ")}
      style={boxStyle(hitGeometry, zoom)}
      onPointerDown={(event) => {
        onSelect();
        onStartDrag(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      aria-label="선 객체"
      title="선 객체"
    >
      <i className="pdf-editor-draft-line-stroke" style={lineStrokeStyle(line, hitGeometry, zoom)} aria-hidden="true" />
      {selected && (
        <>
          <i
            className="pdf-editor-line-handle pdf-editor-line-handle--start"
            style={{
              ...lineEndpointStyle(line, "start", zoom),
              cursor: getLineCursor(line)
            }}
            aria-hidden="true"
          />
          <i
            className="pdf-editor-line-handle pdf-editor-line-handle--end"
            style={{
              ...lineEndpointStyle(line, "end", zoom),
              cursor: getLineCursor(line)
            }}
            aria-hidden="true"
          />
          <button
            data-no-drag
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete();
            }}
            className="pdf-editor-delete-trigger absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-sm border border-stone-300 bg-white text-stone-600 shadow"
            aria-label="선 삭제"
          >
            <Trash2 size={12} />
          </button>
          {confirmDeleteOpen && (
            <DeleteConfirmBubble
              placement="left"
              onConfirm={onConfirmDelete}
              onCancel={onCancelDelete}
            />
          )}
        </>
      )}
    </button>
  );
}

function PdfObjectRecognitionLayer({
  images,
  lines,
  tables,
  imageGeometryOverrides,
  lineGeometryOverrides,
  zoom,
  selected,
  onSelect,
  onStartLineDrag
}: {
  images: PdfEditorImageItem[];
  lines: PdfEditorGraphicLineItem[];
  tables: PdfEditorTableItem[];
  imageGeometryOverrides: Record<string, PdfEditorImageItem>;
  lineGeometryOverrides: Record<string, PdfEditorGraphicLineItem>;
  zoom: number;
  selected?: PdfObjectTarget;
  onSelect: (target: PdfObjectTarget) => void;
  onStartLineDrag: (event: ReactPointerEvent<HTMLElement>, line: PdfEditorGraphicLineItem) => void;
}): JSX.Element | null {
  if (images.length === 0 && lines.length === 0 && tables.length === 0) return null;

  return (
    <div className="pdf-editor-object-layer" aria-label="PDF 객체 인식 레이어">
      {tables.map((table) => (
        <div
          key={table.id}
          className="pdf-editor-object-box pdf-editor-object-box--table"
          style={boxStyleExact(table, zoom)}
          title={`표 후보 ${table.rowCount}행 ${table.columnCount}열`}
          aria-hidden="true"
        />
      ))}

      {images.map((image) => {
        const adjustedImage = imageGeometryOverrides[image.id] || image;
        return (
          <button
            type="button"
            key={image.id}
            className={[
              "pdf-editor-object-box pdf-editor-object-box--image",
              selected?.kind === "image" && selected.id === image.id ? "pdf-editor-object-box--selected" : ""
            ].join(" ")}
            style={boxStyleExact(adjustedImage, zoom)}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect({ kind: "image", id: image.id });
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ kind: "image", id: image.id });
            }}
            title="이미지 객체 - 직접 이동/삭제 저장은 native object patch 구현 전까지 제한됩니다."
          >
            <span className="smith-sr-only">이미지 객체</span>
          </button>
        );
      })}

      {lines.map((line) => {
        const adjustedLine = lineGeometryOverrides[line.id] || line;
        return (
          <button
            type="button"
            key={line.id}
            className={[
              "pdf-editor-object-box pdf-editor-object-box--line",
              `pdf-editor-object-box--${adjustedLine.orientation}`,
              selected?.kind === "line" && selected.id === line.id ? "pdf-editor-object-box--selected" : ""
            ].join(" ")}
            style={{
              ...boxStyle(createLineHitGeometry(adjustedLine), zoom),
              cursor: getLineCursor(adjustedLine)
            }}
            onPointerDown={(event) => {
              onSelect({ kind: "line", id: line.id });
              onStartLineDrag(event, adjustedLine);
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect({ kind: "line", id: line.id });
            }}
            aria-label="선 객체"
            title="선 객체 - 위치 미리보기만 가능하며 저장은 native patch 구현 전까지 제한됩니다."
          >
            <i
              className="pdf-editor-line-handle pdf-editor-line-handle--start"
              style={{
                ...lineEndpointStyle(adjustedLine, "start", zoom),
                cursor: getLineCursor(adjustedLine)
              }}
              aria-hidden="true"
            />
            <i
              className="pdf-editor-line-handle pdf-editor-line-handle--end"
              style={{
                ...lineEndpointStyle(adjustedLine, "end", zoom),
                cursor: getLineCursor(adjustedLine)
              }}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

function DeleteConfirmBubble({
  placement,
  onConfirm,
  onCancel
}: {
  placement: "left" | "right";
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div
      data-no-drag
      className={["pdf-editor-delete-bubble", placement === "left" ? "pdf-editor-delete-bubble--left" : ""].join(" ")}
      role="dialog"
      aria-label="텍스트 삭제 확인"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <p>선택한 항목을 삭제할까요?</p>
      <div className="pdf-editor-delete-bubble-actions">
        <button type="button" onClick={onConfirm}>
          예
        </button>
        <button type="button" onClick={onCancel}>
          아니오
        </button>
      </div>
    </div>
  );
}

function AdditionOverlayBox({
  item,
  zoom,
  selected,
  previewOnly,
  confirmDeleteOpen,
  onSelect,
  onStartDrag,
  onChange,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete
}: {
  item: PendingPdfEditorAddition;
  zoom: number;
  selected: boolean;
  previewOnly?: boolean;
  confirmDeleteOpen: boolean;
  onSelect: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onChange: (value: string) => void;
  onRequestDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
}): JSX.Element {
  return (
    <div
      onClick={onSelect}
      onPointerDown={onStartDrag}
      className={["pdf-editor-field pdf-editor-field--addition", selected ? "pdf-editor-field--selected" : ""].join(" ")}
      style={boxStyleExact(item, zoom)}
    >
      {selected ? (
        <>
          <InlineEditableText
            value={item.text}
            placeholder="텍스트 입력"
            fontSize={item.fontSize * zoom}
            fontFamily="Malgun Gothic"
            fontWeight="400"
            fontStyle="normal"
            targetWidth={item.width * zoom}
            fitToWidth={false}
            additionId={item.id}
            onChange={onChange}
          />
          <button
            data-no-drag
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.stopPropagation();
              onRequestDelete();
            }}
            className="pdf-editor-delete-trigger absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-sm border border-stone-300 bg-white text-stone-600 shadow"
            aria-label="제거"
          >
            <Trash2 size={12} />
          </button>
          {confirmDeleteOpen && (
            <DeleteConfirmBubble
              placement="left"
              onConfirm={onConfirmDelete}
              onCancel={onCancelDelete}
            />
          )}
        </>
      ) : previewOnly || item.text ? (
        <div
          className="pdf-editor-field-text"
          style={{
            color: item.color ? `#${item.color.replace(/^#/, "")}` : "#111827",
            fontFamily: createViewerFontStack(undefined, item.text),
            fontSize: `${Math.max(1, item.fontSize * zoom)}px`,
            lineHeight: "1.08",
            ...createFitTextStyle(item.text, item.fontSize * zoom, undefined, item.width * zoom, "400", "normal")
          }}
        >
          {item.text}
        </div>
      ) : (
        <span className="pdf-editor-field-label">추가 텍스트</span>
      )}
    </div>
  );
}

function pageSurfaceStyle(pageSize: PdfEditorPageSize, zoom: number): CSSProperties {
  return {
    position: "absolute",
    left: `${PDF_PAGE_SURFACE_MARGIN_PX}px`,
    top: `${PDF_PAGE_SURFACE_MARGIN_PX}px`,
    width: `${pageSize.width * zoom}px`,
    height: `${pageSize.height * zoom}px`,
    zIndex: 8,
    overflow: "hidden"
  };
}

function boxStyle(geometry: PdfEditorBoxGeometry, zoom: number): CSSProperties {
  return {
    left: `${geometry.x * zoom}px`,
    top: `${geometry.y * zoom}px`,
    width: `${Math.max(12, geometry.width * zoom)}px`,
    height: `${Math.max(12, geometry.height * zoom)}px`
  };
}

function boxStyleExact(geometry: PdfEditorBoxGeometry, zoom: number): CSSProperties {
  return {
    left: `${geometry.x * zoom}px`,
    top: `${geometry.y * zoom}px`,
    width: `${Math.max(1, geometry.width * zoom)}px`,
    height: `${Math.max(1, geometry.height * zoom)}px`
  };
}

function measureVisibleTextBox(
  element: HTMLElement,
  surfaceRect: DOMRect,
  zoom: number
): PdfEditorBoxGeometry | undefined {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const rect = getElementTextRangeRect(element) || element.getBoundingClientRect();
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }

  return {
    x: roundGeometryValue((rect.left - surfaceRect.left) / safeZoom),
    y: roundGeometryValue((rect.top - surfaceRect.top) / safeZoom),
    width: roundGeometryValue(rect.width / safeZoom),
    height: roundGeometryValue(rect.height / safeZoom)
  };
}

function getElementTextRangeRect(element: HTMLElement): DOMRect | undefined {
  const selection = document.createRange();
  try {
    selection.selectNodeContents(element);
    const rects = Array.from(selection.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return undefined;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  } finally {
    selection.detach();
  }
}

function areGeometryMapsEqual(
  a: Record<string, PdfEditorBoxGeometry>,
  b: Record<string, PdfEditorBoxGeometry>
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const left = a[key];
    const right = b[key];
    return Boolean(right) &&
      Math.abs(left.x - right.x) < 0.02 &&
      Math.abs(left.y - right.y) < 0.02 &&
      Math.abs(left.width - right.width) < 0.02 &&
      Math.abs(left.height - right.height) < 0.02;
  });
}

function roundGeometryValue(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function relativeBoxStyleExact(
  geometry: PdfEditorBoxGeometry,
  parentGeometry: PdfEditorBoxGeometry,
  zoom: number
): CSSProperties {
  return {
    position: "absolute",
    left: `${(geometry.x - parentGeometry.x) * zoom}px`,
    top: `${(geometry.y - parentGeometry.y) * zoom}px`,
    width: `${Math.max(1, geometry.width * zoom)}px`,
    height: `${Math.max(1, geometry.height * zoom)}px`
  };
}

function findTextHitAtPointer(
  event: ReactPointerEvent<HTMLElement>,
  items: PdfEditorTextItem[],
  geometryOverrides: Record<string, PdfEditorBoxGeometry>,
  drafts: Record<string, string>,
  zoom: number,
  visualTextBoxes: Record<string, PdfEditorBoxGeometry> = {}
): { item: PdfEditorTextItem; geometry: PdfEditorBoxGeometry } | undefined {
  const rect = event.currentTarget.getBoundingClientRect();
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const x = (event.clientX - rect.left) / safeZoom;
  const y = (event.clientY - rect.top) / safeZoom;

  return items
    .map((item) => {
      const geometry = geometryOverrides[item.id] || item;
      const value = drafts[item.id] ?? item.text;
      const hitGeometry = visualTextBoxes[item.id] || createTextHitGeometry(geometry, item, value, safeZoom);
      const padX = Math.max(1.25, item.fontSize * 0.12);
      const padY = Math.max(1.25, item.fontSize * 0.18);
      const inside =
        x >= hitGeometry.x - padX &&
        x <= hitGeometry.x + hitGeometry.width + padX &&
        y >= hitGeometry.y - padY &&
        y <= hitGeometry.y + hitGeometry.height + padY;

      if (!inside) return undefined;

      const centerY = hitGeometry.y + hitGeometry.height / 2;
      const centerX = hitGeometry.x + Math.min(hitGeometry.width, Math.max(1, item.width)) / 2;
      const xOutsideDistance = distanceToRange(x, hitGeometry.x, hitGeometry.x + hitGeometry.width);
      const yDistance = Math.abs(y - centerY);
      const xDistance = Math.abs(x - centerX);
      const sourceIndex = Number.isFinite(item.sourceIndex) ? Number(item.sourceIndex) : 0;

      return {
        item,
        geometry,
        score: yDistance * 8 + xOutsideDistance * 3 + xDistance * 0.08 + sourceIndex * 0.00001
      };
    })
    .filter(Boolean)
    .sort((a, b) => a!.score - b!.score)[0] as { item: PdfEditorTextItem; geometry: PdfEditorBoxGeometry; score: number } | undefined;
}

function createTextHitGeometry(
  geometry: PdfEditorBoxGeometry,
  item: PdfEditorTextItem,
  value: string,
  zoom: number
): PdfEditorBoxGeometry {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const cssFontSize = Math.max(1, item.fontSize * safeZoom);
  const measuredWidth = measureViewerTextWidth(value || item.text, cssFontSize, item.fontFamily, item.fontWeight, item.fontStyle) / safeZoom;
  const visualWidth = Math.max(
    1,
    Math.min(geometry.width, Math.max(measuredWidth, item.fontSize * 0.45))
  );
  const baseVisualHeight = clampNumber(
    Math.min(geometry.height, Math.max(1, item.fontSize * 1.05)),
    Math.max(1, item.fontSize * 0.5),
    Math.max(1, geometry.height)
  );
  const smallTextBias = clampNumber((12.5 - item.fontSize) / 7.5, 0, 1);
  const lineBoxHeight = Math.max(1, item.fontSize * 1.12);
  const visualHeight =
    smallTextBias > 0
      ? Math.max(baseVisualHeight, Math.min(lineBoxHeight, baseVisualHeight + item.fontSize * 0.8))
      : baseVisualHeight;
  const maxYOffset = Math.max(0, geometry.height - visualHeight);
  const expandedBeyondGeometry = visualHeight > geometry.height;
  const baselineYOffset = expandedBeyondGeometry ? 0 : smallTextBias * Math.max(0.7, item.fontSize * 0.36);
  const maxSmallTextOverflow = expandedBeyondGeometry
    ? 0
    : Math.max(maxYOffset, smallTextBias * Math.max(1, item.fontSize * 0.55));
  const yOffset = clampNumber((geometry.height - visualHeight) / 2 + baselineYOffset, 0, maxSmallTextOverflow);

  return {
    x: geometry.x,
    y: geometry.y + yOffset,
    width: visualWidth,
    height: visualHeight
  };
}

function distanceToRange(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

function expandGeometryForText(
  geometry: PdfEditorBoxGeometry,
  text: string,
  fontSize: number,
  zoom: number,
  fontFamily?: string,
  fontWeight?: string,
  fontStyle?: string,
  pageSize?: PdfEditorPageSize,
  minimumWidth = geometry.width
): PdfEditorBoxGeometry {
  const longestLine = getLongestVisualTextLine(text);
  if (!longestLine) return geometry;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const cssFontSize = Math.max(1, fontSize * safeZoom);
  const naturalWidth = measureViewerTextWidth(longestLine, cssFontSize, fontFamily, fontWeight, fontStyle) / safeZoom;
  const padding = Math.max(2.5, fontSize * 0.38);
  const targetWidth = Math.max(minimumWidth, geometry.width, naturalWidth * 1.025 + padding * 2);
  const maxWidth = pageSize ? Math.max(1, pageSize.width - geometry.x) : targetWidth;
  return {
    ...geometry,
    width: Math.max(1, Math.min(targetWidth, maxWidth))
  };
}

function createTextDisplayGeometry(
  geometry: PdfEditorBoxGeometry,
  text: string,
  fontSize: number,
  zoom: number,
  fontFamily?: string,
  fontWeight?: string,
  fontStyle?: string,
  pageSize?: PdfEditorPageSize,
  minimumWidth = geometry.width
): PdfEditorBoxGeometry {
  return normalizeTextDisplayHeight(
    expandGeometryForText(geometry, text, fontSize, zoom, fontFamily, fontWeight, fontStyle, pageSize, minimumWidth),
    text,
    fontSize,
    pageSize
  );
}

function createStableDraftTextGeometry(
  geometry: PdfEditorBoxGeometry,
  item: PdfEditorTextItem,
  text: string,
  zoom: number,
  pageSize?: PdfEditorPageSize
): PdfEditorBoxGeometry {
  const expanded = expandGeometryForText(
    geometry,
    text,
    item.fontSize,
    zoom,
    item.fontFamily,
    item.fontWeight,
    item.fontStyle,
    pageSize,
    Math.max(item.width, geometry.width)
  );
  const lineCount = getTextLineCount(text);
  const wantedHeight = lineCount <= 1
    ? Math.max(geometry.height, item.fontSize * 1.08)
    : Math.max(geometry.height, item.fontSize * 1.12 * lineCount);
  const maxHeight = pageSize ? Math.max(1, pageSize.height - geometry.y) : wantedHeight;

  return {
    ...geometry,
    width: expanded.width,
    height: Math.max(1, Math.min(wantedHeight, maxHeight))
  };
}

function normalizeTextDisplayHeight(
  geometry: PdfEditorBoxGeometry,
  text: string,
  fontSize: number,
  pageSize?: PdfEditorPageSize
): PdfEditorBoxGeometry {
  const lineCount = getTextLineCount(text);
  const minHeight = Math.max(1, fontSize * 0.9);
  const singleLineHeight = Math.max(minHeight, fontSize * 1.18);
  const multiLineHeight = Math.max(geometry.height, fontSize * 1.12 * lineCount);
  const targetHeight = lineCount <= 1 ? Math.min(geometry.height, singleLineHeight) : multiLineHeight;
  const maxHeight = pageSize ? Math.max(1, pageSize.height - geometry.y) : Math.max(targetHeight, minHeight);

  return {
    ...geometry,
    height: Math.max(1, Math.min(Math.max(minHeight, targetHeight), maxHeight))
  };
}

function getTextLineCount(text: string): number {
  return Math.max(1, text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length);
}

function getLongestVisualTextLine(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .reduce((longest, line) => (line.length > longest.length ? line : longest), "");
}

function createLineHitGeometry(line: PdfEditorGraphicLineItem): PdfEditorBoxGeometry {
  const pad = Math.max(3, line.strokeWidth * 1.8);
  return {
    x: Math.max(0, Math.min(line.x1, line.x2) - pad),
    y: Math.max(0, Math.min(line.y1, line.y2) - pad),
    width: Math.abs(line.x2 - line.x1) + pad * 2,
    height: Math.abs(line.y2 - line.y1) + pad * 2
  };
}

function lineEndpointStyle(
  line: PdfEditorGraphicLineItem,
  endpoint: "start" | "end",
  zoom: number
): CSSProperties {
  const geometry = createLineHitGeometry(line);
  const x = endpoint === "start" ? line.x1 : line.x2;
  const y = endpoint === "start" ? line.y1 : line.y2;
  const size = 10;
  return {
    left: `${(x - geometry.x) * zoom - size / 2}px`,
    top: `${(y - geometry.y) * zoom - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`
  };
}

function lineStrokeStyle(
  line: PdfEditorGraphicLineItem,
  hitGeometry: PdfEditorBoxGeometry,
  zoom: number
): CSSProperties {
  const stroke = Math.max(1, line.strokeWidth * zoom);
  const x1 = (line.x1 - hitGeometry.x) * zoom;
  const y1 = (line.y1 - hitGeometry.y) * zoom;
  const x2 = (line.x2 - hitGeometry.x) * zoom;
  const y2 = (line.y2 - hitGeometry.y) * zoom;
  const length = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
  return {
    left: `${x1}px`,
    top: `${y1 - stroke / 2}px`,
    width: `${length}px`,
    height: `${stroke}px`,
    transform: `rotate(${angle}deg)`,
    transformOrigin: "0 50%",
    background: "#111827"
  };
}

function getLineCursor(line: PdfEditorGraphicLineItem): CSSProperties["cursor"] {
  if (line.orientation === "horizontal") return "ew-resize";
  if (line.orientation === "vertical") return "ns-resize";
  const dx = line.x2 - line.x1;
  const dy = line.y2 - line.y1;
  return dx * dy >= 0 ? "nwse-resize" : "nesw-resize";
}

function getLineDragMode(
  line: PdfEditorGraphicLineItem,
  event: ReactPointerEvent<HTMLElement>,
  zoom: number
): LineDragMode {
  const rect = event.currentTarget.getBoundingClientRect();
  const px = (event.clientX - rect.left) / zoom + createLineHitGeometry(line).x;
  const py = (event.clientY - rect.top) / zoom + createLineHitGeometry(line).y;
  const endpointRadius = Math.max(8 / zoom, line.strokeWidth * 3);
  const startDistance = Math.hypot(px - line.x1, py - line.y1);
  const endDistance = Math.hypot(px - line.x2, py - line.y2);
  if (startDistance <= endpointRadius || startDistance < endDistance * 0.72) return "start";
  if (endDistance <= endpointRadius || endDistance < startDistance * 0.72) return "end";
  return "move";
}

function adjustLineGeometry(
  origin: PdfEditorGraphicLineItem,
  dx: number,
  dy: number,
  mode: LineDragMode,
  pageSize: PdfEditorPageSize
): PdfEditorGraphicLineItem {
  let x1 = origin.x1;
  let y1 = origin.y1;
  let x2 = origin.x2;
  let y2 = origin.y2;

  if (mode === "move") {
    x1 += dx;
    x2 += dx;
    y1 += dy;
    y2 += dy;
  } else if (mode === "start") {
    x1 += dx;
    y1 += dy;
  } else {
    x2 += dx;
    y2 += dy;
  }

  if (origin.orientation === "horizontal") {
    const y = clampNumber(mode === "move" ? (y1 + y2) / 2 : (origin.y1 + origin.y2) / 2, 0, pageSize.height);
    y1 = y;
    y2 = y;
  } else if (origin.orientation === "vertical") {
    const x = clampNumber(mode === "move" ? (x1 + x2) / 2 : (origin.x1 + origin.x2) / 2, 0, pageSize.width);
    x1 = x;
    x2 = x;
  }

  const clamped = clampLineToPage({ ...origin, x1, y1, x2, y2 }, pageSize);
  return normalizeLineGeometry(clamped);
}

function clampLineToPage(line: PdfEditorGraphicLineItem, pageSize: PdfEditorPageSize): PdfEditorGraphicLineItem {
  return {
    ...line,
    x1: clampNumber(line.x1, 0, pageSize.width),
    y1: clampNumber(line.y1, 0, pageSize.height),
    x2: clampNumber(line.x2, 0, pageSize.width),
    y2: clampNumber(line.y2, 0, pageSize.height)
  };
}

function normalizeLineGeometry(line: PdfEditorGraphicLineItem): PdfEditorGraphicLineItem {
  const x = Math.min(line.x1, line.x2);
  const y = Math.min(line.y1, line.y2);
  const rawWidth = Math.abs(line.x2 - line.x1);
  const rawHeight = Math.abs(line.y2 - line.y1);
  return {
    ...line,
    x,
    y,
    width: Math.max(line.strokeWidth, rawWidth),
    height: Math.max(line.strokeWidth, rawHeight),
    orientation:
      rawHeight <= Math.max(1.5, rawWidth * 0.08)
        ? "horizontal"
        : rawWidth <= Math.max(1.5, rawHeight * 0.08)
          ? "vertical"
          : "diagonal"
  };
}

let textMeasureCanvas: HTMLCanvasElement | undefined;

function createFitTextStyle(
  text: string,
  fontSize: number,
  fontFamily: string | undefined,
  targetWidth: number,
  fontWeight?: string,
  fontStyle?: string
): CSSProperties {
  const safeFontSize = Math.max(1, fontSize);
  const naturalWidth = measureViewerTextWidth(text, safeFontSize, fontFamily, fontWeight, fontStyle);
  if (!Number.isFinite(naturalWidth) || naturalWidth <= 1 || targetWidth <= 1) {
    return {};
  }

  const rawRatio = targetWidth / naturalWidth;
  if (rawRatio >= 1) {
    return {
      letterSpacing: "0px",
      transform: "none"
    };
  }

  return {
    letterSpacing: "0px",
    transform: `scaleX(${clampNumber(rawRatio, 0.42, 1.12)})`,
    transformOrigin: "left top"
  };
}

function measureViewerTextWidth(
  text: string,
  fontSize: number,
  fontFamily?: string,
  fontWeight?: string,
  fontStyle?: string
): number {
  try {
    textMeasureCanvas ||= document.createElement("canvas");
    const context = textMeasureCanvas.getContext("2d");
    if (!context) return estimateViewerTextWidth(text, fontSize);
    context.font = `${normalizeCssFontStyle(fontStyle)} ${normalizeCssFontWeight(fontWeight)} ${fontSize}px ${createViewerFontStack(fontFamily, text)}`;
    const measured = context.measureText(text).width;
    return Number.isFinite(measured) && measured > 0 ? measured : estimateViewerTextWidth(text, fontSize);
  } catch {
    return estimateViewerTextWidth(text, fontSize);
  }
}

function estimateViewerTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((sum, char) => {
    if (char === " ") return sum + fontSize * 0.32;
    if (/[\u3131-\u318e\uac00-\ud7a3]/.test(char)) return sum + fontSize;
    if (/[0-9A-Z]/.test(char)) return sum + fontSize * 0.58;
    if (/[a-z]/.test(char)) return sum + fontSize * 0.5;
    return sum + fontSize * 0.44;
  }, 0);
}

function countTextSpacingSlots(text: string): number {
  return Math.max(0, Array.from(text.replace(/\s+$/g, "")).length - 1);
}

function createViewerFontStack(fontFamily: string | undefined, text: string): string {
  const fallback = /[\u3131-\u318e\uac00-\ud7a3]/.test(text)
    ? '"Malgun Gothic", "Noto Sans KR", Arial, sans-serif'
    : 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  if (!fontFamily?.trim()) return fallback;
  return `${quoteCssFontFamily(fontFamily)}, ${fallback}`;
}

function quoteCssFontFamily(fontFamily: string): string {
  const family = fontFamily.trim().replace(/["\\]/g, "");
  if (!family) return "Arial";
  return /^[a-zA-Z0-9_-]+$/.test(family) ? family : `"${family}"`;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(min, Math.min(max, value));
}

function normalizeCssFontWeight(weight?: string): CSSProperties["fontWeight"] {
  if (!weight) return "400";
  if (/bold|black|heavy/i.test(weight)) return "700";
  const numeric = Number.parseInt(weight, 10);
  if (Number.isFinite(numeric)) return Math.max(100, Math.min(900, numeric)) as CSSProperties["fontWeight"];
  return "400";
}

function normalizeCssFontStyle(style?: string): CSSProperties["fontStyle"] {
  return /italic|oblique/i.test(style || "") ? "italic" : "normal";
}

function cloneGeometryOverrides(
  geometryOverrides: Record<string, PdfEditorBoxGeometry>
): Record<string, PdfEditorBoxGeometry> {
  return Object.fromEntries(Object.entries(geometryOverrides).map(([key, value]) => [key, { ...value }]));
}

function cloneLineGeometryOverrides(
  lineGeometryOverrides: Record<string, PdfEditorGraphicLineItem>
): Record<string, PdfEditorGraphicLineItem> {
  return Object.fromEntries(Object.entries(lineGeometryOverrides).map(([key, value]) => [key, { ...value }]));
}

function cloneImageGeometryOverrides(
  imageGeometryOverrides: Record<string, PdfEditorImageItem>
): Record<string, PdfEditorImageItem> {
  return Object.fromEntries(Object.entries(imageGeometryOverrides).map(([key, value]) => [key, { ...value }]));
}

function filterObjectMapByIds<T>(items: Record<string, T>, allowedIds: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(items).filter(([key]) => allowedIds.has(key)));
}

function snapshotKey(snapshot: EditorHistorySnapshot): string {
  return JSON.stringify({
    drafts: snapshot.drafts,
    deletedIds: [...snapshot.deletedIds].sort(),
    additions: snapshot.additions,
    geometryOverrides: snapshot.geometryOverrides,
    lineGeometryOverrides: snapshot.lineGeometryOverrides,
    imageGeometryOverrides: snapshot.imageGeometryOverrides,
    deletedLineIds: [...snapshot.deletedLineIds].sort(),
    deletedImageIds: [...snapshot.deletedImageIds].sort(),
    copiedLines: snapshot.copiedLines,
    copiedImages: snapshot.copiedImages
  });
}

function getFileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function clampGeometry(geometry: PdfEditorBoxGeometry, pageSize: PdfEditorPageSize): PdfEditorBoxGeometry {
  const width = Math.max(4, Math.min(geometry.width, pageSize.width));
  const height = Math.max(4, Math.min(geometry.height, pageSize.height));
  return {
    ...geometry,
    width,
    height,
    x: Math.max(0, Math.min(pageSize.width - width, geometry.x)),
    y: Math.max(0, Math.min(pageSize.height - height, geometry.y))
  };
}

function constrainAxisDelta(dx: number, dy: number): { dx: number; dy: number } {
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

function resizeImageGeometry(
  origin: PdfEditorBoxGeometry,
  dx: number,
  dy: number,
  mode: ImageResizeMode,
  pageSize: PdfEditorPageSize,
  keepRatio: boolean
): PdfEditorBoxGeometry {
  const minSize = 6;
  let left = origin.x;
  let top = origin.y;
  let right = origin.x + origin.width;
  let bottom = origin.y + origin.height;

  if (mode.includes("w")) left += dx;
  if (mode.includes("e")) right += dx;
  if (mode.includes("n")) top += dy;
  if (mode.includes("s")) bottom += dy;

  left = clampNumber(left, 0, pageSize.width - minSize);
  top = clampNumber(top, 0, pageSize.height - minSize);
  right = clampNumber(right, minSize, pageSize.width);
  bottom = clampNumber(bottom, minSize, pageSize.height);

  if (right - left < minSize) {
    if (mode.includes("w")) left = right - minSize;
    else right = left + minSize;
  }
  if (bottom - top < minSize) {
    if (mode.includes("n")) top = bottom - minSize;
    else bottom = top + minSize;
  }

  if (keepRatio && origin.width > 0 && origin.height > 0) {
    const ratio = origin.width / origin.height;
    let width = right - left;
    let height = bottom - top;
    if (width / height > ratio) width = height * ratio;
    else height = width / ratio;

    if (mode.includes("w")) left = right - width;
    else right = left + width;
    if (mode.includes("n")) top = bottom - height;
    else bottom = top + height;

    if (left < 0) {
      const shift = -left;
      left += shift;
      right += shift;
    }
    if (right > pageSize.width) {
      const shift = right - pageSize.width;
      left -= shift;
      right -= shift;
    }
    if (top < 0) {
      const shift = -top;
      top += shift;
      bottom += shift;
    }
    if (bottom > pageSize.height) {
      const shift = bottom - pageSize.height;
      top -= shift;
      bottom -= shift;
    }
  }

  return clampGeometry({
    ...origin,
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  }, pageSize);
}

function createBoxDragGuide(geometry: PdfEditorBoxGeometry): DragGuideState {
  return {
    geometry,
    label: `x ${Math.round(geometry.x)} / y ${Math.round(geometry.y)}`
  };
}

function createLineDragGuide(line: PdfEditorGraphicLineItem): DragGuideState {
  const geometry = createLineHitGeometry(line);
  return {
    geometry,
    label: `x ${Math.round(geometry.x)} / y ${Math.round(geometry.y)}`
  };
}

function updateLastPagePointer(
  event: ReactPointerEvent<HTMLElement>,
  pageNumber: number,
  zoom: number,
  targetRef: MutableRefObject<{ pageNumber: number; x: number; y: number } | undefined>
): void {
  const rect = event.currentTarget.getBoundingClientRect();
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  targetRef.current = {
    pageNumber,
    x: Math.max(0, (event.clientX - rect.left) / safeZoom),
    y: Math.max(0, (event.clientY - rect.top) / safeZoom)
  };
}

function DragGuideOverlay({
  guide,
  zoom,
  pageSize
}: {
  guide: DragGuideState;
  zoom: number;
  pageSize: PdfEditorPageSize;
}): JSX.Element {
  const geometry = clampGeometry(guide.geometry, pageSize);
  return (
    <div className="pdf-editor-drag-guide" style={boxStyleExact(geometry, zoom)} aria-hidden="true">
      <span>{guide.label}</span>
    </div>
  );
}
