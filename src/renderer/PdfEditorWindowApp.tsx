import { ExternalLink, Minus, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.8;
const DRAG_THRESHOLD = 3;
const HISTORY_LIMIT = 80;
const CHROME_PDF_VIEWER_PAGE_MARGIN_PX = 8;

type LineDragMode = "move" | "start" | "end";

export function PdfEditorWindowApp(): JSX.Element {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const pageFrameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>();
  const livePreviewSequenceRef = useRef(0);
  const suppressNextPageLoadingRef = useRef(false);

  const [context, setContext] = useState<PdfEditorWindowContext>();
  const [layer, setLayer] = useState<PdfEditorTextLayer>();
  const [nativePreviewUrl, setNativePreviewUrl] = useState<string>();
  const [sourceNativePreviewUrl, setSourceNativePreviewUrl] = useState<string>();
  const [livePreviewKey, setLivePreviewKey] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [additions, setAdditions] = useState<PendingPdfEditorAddition[]>([]);
  const [geometryOverrides, setGeometryOverrides] = useState<Record<string, PdfEditorBoxGeometry>>({});
  const [lineGeometryOverrides, setLineGeometryOverrides] = useState<Record<string, PdfEditorGraphicLineItem>>({});
  const [imageGeometryOverrides, setImageGeometryOverrides] = useState<Record<string, PdfEditorImageItem>>({});
  const [historyPast, setHistoryPast] = useState<EditorHistorySnapshot[]>([]);
  const [historyFuture, setHistoryFuture] = useState<EditorHistorySnapshot[]>([]);
  const [selectedPage, setSelectedPage] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState<DragTarget>();
  const [selectedObject, setSelectedObject] = useState<PdfObjectTarget>();
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<DragTarget>();
  const [editMode, setEditMode] = useState(false);
  const [zoom, setZoom] = useState(1.18);
  const [isLoading, setIsLoading] = useState(true);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<PdfEditorSaveResult>();

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
        setSourceNativePreviewUrl(nextNativePreviewUrl);
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
    if (suppressNextPageLoadingRef.current) {
      suppressNextPageLoadingRef.current = false;
      return undefined;
    }
    setIsPageLoading(true);
    const timer = window.setTimeout(() => setIsPageLoading(false), 1800);
    return () => window.clearTimeout(timer);
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
    () => (layer?.images || []).filter((item) => item.pageNumber === selectedPage),
    [layer?.images, selectedPage]
  );
  const visiblePageImages = useMemo(
    () => currentPageImages.map((image) => imageGeometryOverrides[image.id] || image),
    [currentPageImages, imageGeometryOverrides]
  );
  const currentPageLines = useMemo(
    () => (layer?.lines || []).filter((item) => item.pageNumber === selectedPage),
    [layer?.lines, selectedPage]
  );
  const visiblePageLines = useMemo(
    () => currentPageLines.map((line) => lineGeometryOverrides[line.id] || line),
    [currentPageLines, lineGeometryOverrides]
  );
  const currentPageTables = useMemo(
    () => (layer?.tables || []).filter((item) => item.pageNumber === selectedPage),
    [layer?.tables, selectedPage]
  );
  const currentPageAdditions = additions.filter((item) => item.pageNumber === selectedPage);
  const currentEditorEdits = useMemo(
    () =>
      layer
        ? buildPdfEditorEdits(
            layer.items,
            drafts,
            deletedIds,
            additions,
            geometryOverrides,
            layer.lines,
            lineGeometryOverrides,
            layer.images,
            imageGeometryOverrides
          )
        : [],
    [additions, deletedIds, drafts, geometryOverrides, imageGeometryOverrides, layer, lineGeometryOverrides]
  );
  const currentEditorEditsKey = useMemo(() => createPdfEditorEditsKey(currentEditorEdits), [currentEditorEdits]);
  const livePreviewSynced = currentEditorEditsKey !== "" && livePreviewKey === currentEditorEditsKey;
  const changedCount = useMemo(
    () => countPdfEditorChanges(layer?.items || [], drafts, deletedIds, additions, geometryOverrides, lineGeometryOverrides, imageGeometryOverrides),
    [additions, deletedIds, drafts, geometryOverrides, imageGeometryOverrides, layer?.items, lineGeometryOverrides]
  );
  const shouldShowEditorOverlay = editMode || changedCount > 0;
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
    imageGeometryOverrides: cloneImageGeometryOverrides(imageGeometryOverrides)
  });

  const restoreHistorySnapshot = (snapshot: EditorHistorySnapshot) => {
    setDrafts({ ...snapshot.drafts });
    setDeletedIds(new Set(snapshot.deletedIds));
    setAdditions(snapshot.additions.map((item) => ({ ...item })));
    setGeometryOverrides(cloneGeometryOverrides(snapshot.geometryOverrides));
    setLineGeometryOverrides(cloneLineGeometryOverrides(snapshot.lineGeometryOverrides));
    setImageGeometryOverrides(cloneImageGeometryOverrides(snapshot.imageGeometryOverrides));
    setDeleteConfirmTarget(undefined);
    setResult(undefined);
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

  useEffect(() => {
    if (!context || !layer || !sourceNativePreviewUrl) return undefined;
    if (isSaving) return undefined;

    if (currentEditorEdits.length === 0) {
      livePreviewSequenceRef.current += 1;
      setLivePreviewKey("");
      setNativePreviewUrl((current) => {
        if (!current || current === sourceNativePreviewUrl) return current;
        suppressNextPageLoadingRef.current = true;
        return sourceNativePreviewUrl;
      });
      return undefined;
    }

    const sequence = livePreviewSequenceRef.current + 1;
    livePreviewSequenceRef.current = sequence;
    const editsKey = currentEditorEditsKey;
    const timer = window.setTimeout(async () => {
      try {
        const previewResult = await window.convertSmith.previewPdfEditorTextEdits({
          sourcePath: context.sourcePath,
          outputDir: context.outputDir || "",
          outputName: context.outputName,
          useDatedSubfolder: false,
          edits: currentEditorEdits
        });
        const nextNativePreviewUrl = await window.convertSmith.getNativePreviewUrl(previewResult.outputPath);
        if (livePreviewSequenceRef.current !== sequence) return;
        suppressNextPageLoadingRef.current = true;
        setNativePreviewUrl(nextNativePreviewUrl);
        setLivePreviewKey(editsKey);
      } catch (previewError) {
        if (livePreviewSequenceRef.current === sequence) {
          setLivePreviewKey("");
        }
        console.warn("PDF editor live preview failed", previewError);
      }
    }, 280);

    return () => {
      window.clearTimeout(timer);
    };
  }, [context, currentEditorEdits, currentEditorEditsKey, isSaving, layer, sourceNativePreviewUrl]);

  const save = async () => {
    if (!context?.outputDir || !layer) {
      setError("저장할 폴더가 지정되지 않았습니다. 메인 창에서 저장 폴더를 지정한 뒤 Viewer를 다시 열어주세요.");
      return;
    }
    const liveValues = collectLiveEditorValues(layer.items, drafts, additions);
    const edits = buildPdfEditorEdits(
      layer.items,
      liveValues.drafts,
      deletedIds,
      liveValues.additions,
      geometryOverrides,
      layer.lines,
      lineGeometryOverrides,
      layer.images,
      imageGeometryOverrides
    );
    if (edits.length === 0) {
      setError("저장할 수정 내용이 없습니다.");
      return;
    }

    setIsSaving(true);
    setError(undefined);
    try {
      const saveResult = await window.convertSmith.savePdfEditorTextEdits({
        sourcePath: context.sourcePath,
        outputDir: context.outputDir,
        outputName: context.outputName,
        useDatedSubfolder: context.useDatedSubfolder,
        edits
      });
      const nextLayer = await window.convertSmith.getPdfEditorTextLayer(saveResult.outputPath);
      const nextNativePreviewUrl = await window.convertSmith.getNativePreviewUrl(saveResult.outputPath);
      setResult(saveResult);
      setDrafts({});
      setDeletedIds(new Set());
      setAdditions([]);
      setGeometryOverrides({});
      setLineGeometryOverrides({});
      setImageGeometryOverrides({});
      setHistoryPast([]);
      setHistoryFuture([]);
      setSelectedTarget(undefined);
      setSelectedObject(undefined);
      setDeleteConfirmTarget(undefined);
      setLayer(nextLayer);
      setNativePreviewUrl(nextNativePreviewUrl);
      setSourceNativePreviewUrl(nextNativePreviewUrl);
      setLivePreviewKey("");
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        event.stopPropagation();
        void save();
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
  }, [additions, changedCount, context, deletedIds, drafts, geometryOverrides, historyFuture, historyPast, imageGeometryOverrides, isSaving, layer, lineGeometryOverrides]);

  const changePage = (pageNumber: number) => {
    const nextPage = Math.max(1, Math.min(pageCount || 1, Math.trunc(pageNumber) || 1));
    setSelectedPage(nextPage);
  };

  const commitEditorSelection = () => {
    setSelectedTarget(undefined);
    setSelectedObject(undefined);
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
    }
    setDeleteConfirmTarget(undefined);
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
    setSelectedTarget(undefined);
    setDeleteConfirmTarget(undefined);
    setSelectedObject({ kind: "line", id: line.id });
    dragRef.current = {
      pointerId: event.pointerId,
      target: { kind: "line", id: line.id },
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: line,
      lineOrigin: line,
      lineMode: getLineDragMode(line, event, zoom),
      moved: false,
      historyCaptured: false
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const startImageDrag = (
    event: ReactPointerEvent<HTMLElement>,
    image: PdfEditorImageItem
  ) => {
    if (!editMode || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedTarget(undefined);
    setDeleteConfirmTarget(undefined);
    setSelectedObject({ kind: "image", id: image.id });
    dragRef.current = {
      pointerId: event.pointerId,
      target: { kind: "image", id: image.id },
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: image,
      moved: false,
      historyCaptured: false
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
        const nextLine = adjustLineGeometry(drag.lineOrigin, dx, dy, drag.lineMode || "move", pageSize);
        applyLineGeometry(drag.target.id, nextLine);
        return;
      }
      const nextGeometry = clampGeometry(
        {
          ...drag.origin,
          x: drag.origin.x + dx,
          y: drag.origin.y + dy
        },
        pageSize
      );
      applyGeometry(drag.target, nextGeometry);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) {
        dragRef.current = undefined;
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
  }, [additions, deletedIds, drafts, geometryOverrides, imageGeometryOverrides, lineGeometryOverrides, pageSize, zoom]);

  const applyGeometry = (target: DragTarget, geometry: PdfEditorBoxGeometry) => {
    if (target.kind === "text") {
      setGeometryOverrides((current) => ({ ...current, [target.id]: geometry }));
      return;
    }
    if (target.kind === "image") {
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
    setLineGeometryOverrides((current) => ({ ...current, [id]: geometry }));
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
          onClick={() => setEditMode((value) => !value)}
          className={[
            "inline-flex h-8 items-center rounded-md border px-3 text-xs font-semibold",
            editMode ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-stone-200 bg-white text-stone-700 hover:bg-stone-100"
          ].join(" ")}
        >
          수정
        </button>
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

      {(isLoading || isPageLoading) && (
        <PdfViewerLoadingOverlay
          progress={isLoading ? 42 : 76}
          message={isLoading ? "PDF 구조와 텍스트 레이어를 읽는 중입니다." : "PDF 페이지를 Viewer로 렌더링 중입니다."}
          completed={isLoading ? 0 : 1}
          total={2}
        />
      )}

      {error && (
        <div className="absolute left-1/2 top-20 z-40 max-w-[680px] -translate-x-1/2 whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900 shadow-xl">
          {error}
        </div>
      )}

      {!error && layer?.warnings?.length ? (
        <div className="absolute left-1/2 top-20 z-40 max-w-[680px] -translate-x-1/2 whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 shadow-xl">
          <strong className="mb-1 block">제한 모드로 열었습니다.</strong>
          {layer.warnings.slice(0, 3).join("\n")}
        </div>
      ) : null}

      <div className="h-full overflow-auto px-8 pb-12 pt-16">
        <div className="mx-auto w-fit">
          {nativePageUrl && pageSize && (
            <div
              ref={pageFrameRef}
              className="relative bg-white shadow-2xl"
              onPointerDown={(event) => {
                if (!editMode) return;
                if (event.target === event.currentTarget || event.target instanceof HTMLIFrameElement) {
                  commitEditorSelection();
                }
              }}
              style={{
                width: `${pageSize.width * zoom + CHROME_PDF_VIEWER_PAGE_MARGIN_PX * 2}px`,
                height: `${pageSize.height * zoom + CHROME_PDF_VIEWER_PAGE_MARGIN_PX * 2}px`
              }}
            >
              <iframe
                key={nativePageUrl}
                src={nativePageUrl}
                title="PDF page"
                className="pdf-native-page-frame"
                onLoad={() => setIsPageLoading(false)}
              />

              {shouldShowEditorOverlay && (
                <div
                  className="pdf-editor-page-surface"
                  style={pageSurfaceStyle(pageSize, zoom)}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) commitEditorSelection();
                  }}
                >
                  {editMode && (
                    <PdfObjectRecognitionLayer
                      images={visiblePageImages}
                      lines={visiblePageLines}
                      tables={currentPageTables}
                      zoom={zoom}
                      selected={selectedObject}
                      onStartLineDrag={startLineDrag}
                      onStartImageDrag={startImageDrag}
                      onSelect={(target) => {
                        setSelectedTarget(undefined);
                        setDeleteConfirmTarget(undefined);
                        setSelectedObject(target);
                      }}
                    />
                  )}

                  {currentPageImages.filter((image) => imageGeometryOverrides[image.id]).map((image) => (
                    <ImageCoverOverlayBox
                      key={`image-cover-${image.id}`}
                      image={image}
                      zoom={zoom}
                    />
                  ))}

                  {Object.values(imageGeometryOverrides).filter((image) => image.pageNumber === selectedPage).map((image) => (
                    <MovedImagePreview
                      key={`image-preview-${image.id}`}
                      image={image}
                      zoom={zoom}
                    />
                  ))}

                  {currentPageLines.filter((line) => lineGeometryOverrides[line.id]).map((line) => (
                    <LineCoverOverlayBox
                      key={`line-cover-${line.id}`}
                      line={line}
                      zoom={zoom}
                    />
                  ))}

                  {Object.values(lineGeometryOverrides).filter((line) => line.pageNumber === selectedPage).map((line) => (
                    <AdjustedLinePreview
                      key={`line-preview-${line.id}`}
                      line={line}
                      zoom={zoom}
                    />
                  ))}


                  {currentPageItems.map((item) => (
                    <TextOverlayBox
                      key={item.id}
                      item={item}
                      geometry={geometryOverrides[item.id] || item}
                      zoom={zoom}
                      selected={selectedTarget?.kind === "text" && selectedTarget.id === item.id}
                      deleted={deletedIds.has(item.id)}
                      value={drafts[item.id] ?? item.text}
                      changed={drafts[item.id] !== undefined || Boolean(geometryOverrides[item.id])}
                      previewSynced={livePreviewSynced}
                      confirmDeleteOpen={deleteConfirmTarget?.kind === "text" && deleteConfirmTarget.id === item.id}
                      onSelect={() => selectText(item)}
                      onStartDrag={(event) => startDrag(event, { kind: "text", id: item.id }, geometryOverrides[item.id] || item)}
                      onChange={(value) => updateTextDraft(item, value)}
                      onRequestDelete={() => requestDelete({ kind: "text", id: item.id })}
                      onConfirmDelete={confirmDelete}
                      onCancelDelete={cancelDelete}
                    />
                  ))}

                  {currentPageAdditions.filter((item) => editMode || item.text.trim()).map((item) => (
                    <AdditionOverlayBox
                      key={item.id}
                      item={item}
                      zoom={zoom}
                      selected={selectedTarget?.kind === "add" && selectedTarget.id === item.id}
                      previewOnly={!editMode}
                      previewSynced={livePreviewSynced}
                      confirmDeleteOpen={deleteConfirmTarget?.kind === "add" && deleteConfirmTarget.id === item.id}
                      onSelect={() => selectAddition(item)}
                      onStartDrag={(event) => startDrag(event, { kind: "add", id: item.id }, item)}
                      onChange={(value) => updateAddition(item.id, { text: value })}
                      onRequestDelete={() => requestDelete({ kind: "add", id: item.id })}
                      onConfirmDelete={confirmDelete}
                      onCancelDelete={cancelDelete}
                    />
                  ))}
                </div>
              )}

              {!editMode && (
                <ViewerTextSelectionLayer
                  items={currentPageItems}
                  additions={currentPageAdditions}
                  drafts={drafts}
                  deletedIds={deletedIds}
                  geometryOverrides={geometryOverrides}
                  zoom={zoom}
                  pageSize={pageSize}
                />
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
        fontSize: `${Math.max(8, fontSize)}px`,
        lineHeight: "1.05",
        whiteSpace: fitToWidth ? "pre" : "pre-wrap",
        overflowWrap: fitToWidth ? "normal" : "anywhere",
        wordBreak: fitToWidth ? "keep-all" : "normal",
        ...(fitToWidth && targetWidth
          ? createFitTextStyle(value, fontSize, fontFamily, targetWidth, fontWeight, fontStyle)
          : {})
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
  zoom,
  selected,
  deleted,
  value,
  changed,
  previewSynced,
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
  zoom: number;
  selected: boolean;
  deleted: boolean;
  value: string;
  changed: boolean;
  previewSynced: boolean;
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
      className={[
        "pdf-editor-field",
        selected ? "pdf-editor-field--selected" : "",
        deleted ? "pdf-editor-field--deleted" : "",
        changed && !selected ? "pdf-editor-field--changed" : ""
      ].join(" ")}
      style={boxStyle(geometry, zoom)}
      title={item.text}
    >
      {selected && !deleted ? (
        <>
          <InlineEditableText
            value={value}
            fontSize={item.fontSize * zoom}
            fontFamily={item.fontFamily}
            fontWeight={item.fontWeight}
            fontStyle={item.fontStyle}
            color={item.color}
            targetWidth={geometry.width * zoom}
            fitToWidth
            visible
            textId={item.id}
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
              onConfirm={onConfirmDelete}
              onCancel={onCancelDelete}
            />
          )}
        </>
      ) : changed && !deleted && !previewSynced ? (
        <div
          className="pdf-editor-field-text"
          style={{
            color: item.color ? `#${item.color.replace(/^#/, "")}` : "#111827",
            fontFamily: createViewerFontStack(item.fontFamily, value),
            fontWeight: normalizeCssFontWeight(item.fontWeight),
            fontStyle: normalizeCssFontStyle(item.fontStyle),
            fontSize: `${Math.max(8, item.fontSize * zoom)}px`,
            lineHeight: "1.05",
            whiteSpace: "pre",
            overflowWrap: "normal",
            wordBreak: "keep-all",
            ...createFitTextStyle(value, item.fontSize * zoom, item.fontFamily, geometry.width * zoom, item.fontWeight, item.fontStyle)
          }}
        >
          {value}
        </div>
      ) : (
        <span className="pdf-editor-field-label">{deleted ? "삭제 예정" : ""}</span>
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

function LineCoverOverlayBox({ line, zoom }: { line: PdfEditorGraphicLineItem; zoom: number }): JSX.Element {
  return (
    <div
      className="pdf-editor-cover pdf-editor-cover--line"
      style={boxStyleExact(createLineCoverGeometry(line), zoom)}
    />
  );
}

function ImageCoverOverlayBox({ image, zoom }: { image: PdfEditorImageItem; zoom: number }): JSX.Element {
  return (
    <div
      className="pdf-editor-cover pdf-editor-cover--image"
      style={boxStyleExact(image, zoom)}
    />
  );
}

function MovedImagePreview({ image, zoom }: { image: PdfEditorImageItem; zoom: number }): JSX.Element | null {
  if (!image.imageDataBase64) return null;
  return (
    <img
      className="pdf-editor-image-preview"
      src={`data:${image.mimeType || "image/png"};base64,${image.imageDataBase64}`}
      alt=""
      draggable={false}
      style={boxStyleExact(image, zoom)}
    />
  );
}

function AdjustedLinePreview({ line, zoom }: { line: PdfEditorGraphicLineItem; zoom: number }): JSX.Element {
  const geometry = createLineHitGeometry(line);
  return (
    <svg
      className="pdf-editor-line-preview"
      style={boxStyleExact(geometry, zoom)}
      viewBox={`${geometry.x} ${geometry.y} ${geometry.width} ${geometry.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <line
        x1={line.x1}
        y1={line.y1}
        x2={line.x2}
        y2={line.y2}
        stroke="black"
        strokeWidth={Math.max(0.6, line.strokeWidth)}
        strokeLinecap="square"
      />
    </svg>
  );
}

function PdfObjectRecognitionLayer({
  images,
  lines,
  tables,
  zoom,
  selected,
  onStartLineDrag,
  onStartImageDrag,
  onSelect
}: {
  images: PdfEditorImageItem[];
  lines: PdfEditorGraphicLineItem[];
  tables: PdfEditorTableItem[];
  zoom: number;
  selected?: PdfObjectTarget;
  onStartLineDrag: (event: ReactPointerEvent<HTMLElement>, line: PdfEditorGraphicLineItem) => void;
  onStartImageDrag: (event: ReactPointerEvent<HTMLElement>, image: PdfEditorImageItem) => void;
  onSelect: (target: PdfObjectTarget) => void;
}): JSX.Element | null {
  if (images.length === 0 && lines.length === 0 && tables.length === 0) return null;

  return (
    <div className="pdf-editor-object-layer" aria-label="PDF 객체 인식 레이어">
      {tables.map((table) => (
        <button
          type="button"
          key={table.id}
          className={[
            "pdf-editor-object-box pdf-editor-object-box--table",
            selected?.kind === "table" && selected.id === table.id ? "pdf-editor-object-box--selected" : ""
          ].join(" ")}
          style={boxStyle(table, zoom)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onSelect({ kind: "table", id: table.id });
          }}
          title={`표 후보 ${table.rowCount}행 ${table.columnCount}열`}
        >
          <span>표</span>
        </button>
      ))}

      {images.map((image) => (
        <button
          type="button"
          key={image.id}
          className={[
            "pdf-editor-object-box pdf-editor-object-box--image",
            selected?.kind === "image" && selected.id === image.id ? "pdf-editor-object-box--selected" : ""
          ].join(" ")}
          style={boxStyle(image, zoom)}
          onPointerDown={(event) => onStartImageDrag(event, image)}
          onClick={(event) => {
            event.stopPropagation();
            onSelect({ kind: "image", id: image.id });
          }}
          title="이미지 객체"
        >
          <span>이미지</span>
        </button>
      ))}

      {lines.map((line) => (
        <button
          type="button"
          key={line.id}
          className={[
            "pdf-editor-object-box pdf-editor-object-box--line",
            `pdf-editor-object-box--${line.orientation}`,
            selected?.kind === "line" && selected.id === line.id ? "pdf-editor-object-box--selected" : ""
          ].join(" ")}
          style={{
            ...boxStyle(createLineHitGeometry(line), zoom),
            cursor: "move"
          }}
          onPointerDown={(event) => onStartLineDrag(event, line)}
          onClick={(event) => {
            event.stopPropagation();
            onSelect({ kind: "line", id: line.id });
          }}
          aria-label="선 조절"
        >
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
        </button>
      ))}
    </div>
  );
}

function DeleteConfirmBubble({
  onConfirm,
  onCancel
}: {
  onConfirm: () => void;
  onCancel: () => void;
}): JSX.Element {
  return (
    <div
      data-no-drag
      className="pdf-editor-delete-bubble"
      role="dialog"
      aria-label="텍스트 삭제 확인"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <p>선택한 텍스트 칸을 삭제할까요?</p>
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
  previewSynced,
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
  previewSynced: boolean;
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
      style={boxStyle(item, zoom)}
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
              onConfirm={onConfirmDelete}
              onCancel={onCancelDelete}
            />
          )}
        </>
      ) : (previewOnly || item.text) && !previewSynced ? (
        <div
          className="pdf-editor-field-text"
          style={{
            color: item.color ? `#${item.color.replace(/^#/, "")}` : "#111827",
            fontFamily: createViewerFontStack(undefined, item.text),
            fontSize: `${Math.max(8, item.fontSize * zoom)}px`,
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

function ViewerTextSelectionLayer({
  items,
  additions,
  drafts,
  deletedIds,
  geometryOverrides,
  zoom,
  pageSize
}: {
  items: PdfEditorTextItem[];
  additions: PendingPdfEditorAddition[];
  drafts: Record<string, string>;
  deletedIds: Set<string>;
  geometryOverrides: Record<string, PdfEditorBoxGeometry>;
  zoom: number;
  pageSize: PdfEditorPageSize;
}): JSX.Element {
  const selectableItems = items.filter((item) => !deletedIds.has(item.id));

  return (
    <div className="pdf-viewer-text-selection-layer" style={pageSurfaceStyle(pageSize, zoom)} aria-label="PDF 텍스트 선택 레이어">
      {selectableItems.map((item) => {
        const geometry = geometryOverrides[item.id] || item;
        const value = drafts[item.id] ?? item.text;
        return (
          <span
            key={`select-${item.id}`}
            className="pdf-viewer-selectable-text"
            style={{
              ...boxStyle(geometry, zoom),
              color: item.color ? `#${item.color.replace(/^#/, "")}` : "#111827",
              fontFamily: createViewerFontStack(item.fontFamily, value),
              fontWeight: normalizeCssFontWeight(item.fontWeight),
              fontStyle: normalizeCssFontStyle(item.fontStyle),
              fontSize: `${Math.max(8, item.fontSize * zoom)}px`,
              lineHeight: "1.05",
              ...createFitTextStyle(value, item.fontSize * zoom, item.fontFamily, geometry.width * zoom, item.fontWeight, item.fontStyle)
            }}
          >
            {value}
          </span>
        );
      })}

      {additions.filter((item) => item.text.trim()).map((item) => (
        <span
          key={`select-${item.id}`}
          className="pdf-viewer-selectable-text"
          style={{
            ...boxStyle(item, zoom),
            color: item.color ? `#${item.color.replace(/^#/, "")}` : "#111827",
            fontFamily: createViewerFontStack(undefined, item.text),
            fontSize: `${Math.max(8, item.fontSize * zoom)}px`,
            lineHeight: "1.08"
          }}
        >
          {item.text}
        </span>
      ))}
    </div>
  );
}

function pageSurfaceStyle(pageSize: PdfEditorPageSize, zoom: number): CSSProperties {
  return {
    position: "absolute",
    left: `${CHROME_PDF_VIEWER_PAGE_MARGIN_PX}px`,
    top: `${CHROME_PDF_VIEWER_PAGE_MARGIN_PX}px`,
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

function createLineCoverGeometry(line: PdfEditorGraphicLineItem): PdfEditorBoxGeometry {
  const pad = Math.max(1.5, line.strokeWidth * 1.8);
  return {
    x: Math.max(0, Math.min(line.x1, line.x2) - pad),
    y: Math.max(0, Math.min(line.y1, line.y2) - pad),
    width: Math.abs(line.x2 - line.x1) + pad * 2,
    height: Math.abs(line.y2 - line.y1) + pad * 2
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
  const safeFontSize = Math.max(8, fontSize);
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

function snapshotKey(snapshot: EditorHistorySnapshot): string {
  return JSON.stringify({
    drafts: snapshot.drafts,
    deletedIds: [...snapshot.deletedIds].sort(),
    additions: snapshot.additions,
    geometryOverrides: snapshot.geometryOverrides,
    lineGeometryOverrides: snapshot.lineGeometryOverrides,
    imageGeometryOverrides: snapshot.imageGeometryOverrides
  });
}

function createPdfEditorEditsKey(edits: unknown[]): string {
  return edits.length > 0 ? JSON.stringify(edits) : "";
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
