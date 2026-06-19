import { ExternalLink, Loader2, Minus, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  FilePreview,
  PdfEditorPageSize,
  PdfEditorSaveResult,
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
  | { kind: "add"; id: string };

interface DragState {
  pointerId: number;
  target: DragTarget;
  startClientX: number;
  startClientY: number;
  origin: PdfEditorBoxGeometry;
  moved: boolean;
}

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2.8;
const DRAG_THRESHOLD = 3;

export function PdfEditorWindowApp(): JSX.Element {
  const token = new URLSearchParams(window.location.search).get("token") || "";
  const pageFrameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>();

  const [context, setContext] = useState<PdfEditorWindowContext>();
  const [layer, setLayer] = useState<PdfEditorTextLayer>();
  const [pagePreview, setPagePreview] = useState<FilePreview>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [additions, setAdditions] = useState<PendingPdfEditorAddition[]>([]);
  const [geometryOverrides, setGeometryOverrides] = useState<Record<string, PdfEditorBoxGeometry>>({});
  const [selectedPage, setSelectedPage] = useState(1);
  const [selectedTarget, setSelectedTarget] = useState<DragTarget>();
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
        const nextLayer = await window.convertSmith.getPdfEditorTextLayer(nextContext.sourcePath);
        if (cancelled) return;
        setLayer(nextLayer);
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
    if (!context) return undefined;
    let cancelled = false;
    setIsPageLoading(true);
    setError(undefined);
    window.convertSmith
      .getFilePreview(context.sourcePath, selectedPage)
      .then((preview) => {
        if (cancelled) return;
        if (preview.previewType !== "pdf_page" || !preview.dataUrl) {
          throw new Error("PDF 페이지를 자체 Viewer로 렌더링하지 못했습니다.");
        }
        setPagePreview(preview);
      })
      .catch((previewError: unknown) => {
        if (!cancelled) setError(previewError instanceof Error ? previewError.message : "PDF 페이지 렌더링에 실패했습니다.");
      })
      .finally(() => {
        if (!cancelled) setIsPageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [context?.sourcePath, selectedPage]);

  const pageCount = layer?.pageCount || 0;
  const pageSize = useMemo(
    () => layer?.pageSizes.find((item) => item.pageNumber === selectedPage),
    [layer?.pageSizes, selectedPage]
  );
  const currentPageItems = useMemo(
    () => (layer?.items || []).filter((item) => item.pageNumber === selectedPage),
    [layer?.items, selectedPage]
  );
  const currentPageAdditions = additions.filter((item) => item.pageNumber === selectedPage);
  const coveredItems = currentPageItems.filter(
    (item) => deletedIds.has(item.id) || drafts[item.id] !== undefined || geometryOverrides[item.id]
  );
  const changedCount = useMemo(
    () => countPdfEditorChanges(layer?.items || [], drafts, deletedIds, additions, geometryOverrides),
    [additions, deletedIds, drafts, geometryOverrides, layer?.items]
  );

  useEffect(() => {
    setSelectedTarget(undefined);
  }, [selectedPage]);

  const save = async () => {
    if (!context?.outputDir || !layer) {
      setError("저장할 폴더가 지정되지 않았습니다. 메인 창에서 저장 폴더를 지정한 뒤 Viewer를 다시 열어주세요.");
      return;
    }
    const edits = buildPdfEditorEdits(layer.items, drafts, deletedIds, additions, geometryOverrides);
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
      setResult(saveResult);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "PDF 수정본을 저장하지 못했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const changePage = (pageNumber: number) => {
    const nextPage = Math.max(1, Math.min(pageCount || 1, Math.trunc(pageNumber) || 1));
    setSelectedPage(nextPage);
  };

  const selectText = (item: PdfEditorTextItem) => {
    if (!editMode) return;
    setSelectedTarget({ kind: "text", id: item.id });
  };

  const selectAddition = (item: PendingPdfEditorAddition) => {
    if (!editMode) return;
    setSelectedTarget({ kind: "add", id: item.id });
  };

  const addTextBox = () => {
    const next = createPdfEditorAddition(selectedPage, additions.length, pageSize);
    setAdditions((current) => [...current, next]);
    setSelectedTarget({ kind: "add", id: next.id });
    setEditMode(true);
  };

  const updateTextDraft = (item: PdfEditorTextItem, value: string) => {
    setDrafts((current) => ({ ...current, [item.id]: value }));
    if (deletedIds.has(item.id)) {
      setDeletedIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };

  const toggleDelete = (item: PdfEditorTextItem) => {
    setDeletedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };

  const updateAddition = (id: string, patch: Partial<PendingPdfEditorAddition>) => {
    setAdditions((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeAddition = (id: string) => {
    setAdditions((current) => current.filter((item) => item.id !== id));
    if (selectedTarget?.kind === "add" && selectedTarget.id === id) setSelectedTarget(undefined);
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
    setSelectedTarget(target);
    dragRef.current = {
      pointerId: event.pointerId,
      target,
      startClientX: event.clientX,
      startClientY: event.clientY,
      origin: geometry,
      moved: false
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
      drag.moved = true;
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
  }, [pageSize, zoom]);

  const applyGeometry = (target: DragTarget, geometry: PdfEditorBoxGeometry) => {
    if (target.kind === "text") {
      setGeometryOverrides((current) => ({ ...current, [target.id]: geometry }));
      return;
    }
    setAdditions((current) => current.map((item) => (item.id === target.id ? { ...item, ...geometry } : item)));
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
          {isSaving ? "저장 중" : `저장 ${changedCount ? `(${changedCount})` : ""}`}
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(MIN_ZOOM, Math.round((value - 0.1) * 100) / 100))} className="viewer-icon-button" aria-label="축소">
          <Minus size={13} />
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.min(MAX_ZOOM, Math.round((value + 0.1) * 100) / 100))} className="viewer-icon-button" aria-label="확대">
          <Plus size={13} />
        </button>
        <button
          type="button"
          onClick={() => context && window.convertSmith.previewFile(context.sourcePath)}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-stone-200 bg-white px-3 text-xs text-stone-700 hover:bg-stone-100"
        >
          <ExternalLink size={13} />
          외부 앱
        </button>
      </div>

      {(isLoading || isPageLoading) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-stone-100/80">
          <div className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 shadow">
            <Loader2 size={18} className="animate-spin" />
            자체 PDF Viewer 렌더링 중입니다.
          </div>
        </div>
      )}

      {error && (
        <div className="absolute left-1/2 top-20 z-40 max-w-[680px] -translate-x-1/2 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900 shadow-xl">
          {error}
        </div>
      )}

      <div className="h-full overflow-auto px-8 pb-12 pt-16">
        <div className="mx-auto w-fit">
          {pagePreview?.dataUrl && pageSize && (
            <div
              ref={pageFrameRef}
              className="relative bg-white shadow-2xl"
              style={{
                width: `${pageSize.width * zoom}px`,
                height: `${pageSize.height * zoom}px`
              }}
            >
              <img
                src={pagePreview.dataUrl}
                alt="PDF page"
                draggable={false}
                className="absolute inset-0 h-full w-full select-none"
              />

              {editMode && (
                <div className="absolute inset-0">
                  {currentPageItems.map((item) => (
                    <CoverOverlayBox
                      key={`cover-${item.id}`}
                      item={item}
                      zoom={zoom}
                      visible={coveredItems.includes(item)}
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
                      onSelect={() => selectText(item)}
                      onStartDrag={(event) => startDrag(event, { kind: "text", id: item.id }, geometryOverrides[item.id] || item)}
                      onChange={(value) => updateTextDraft(item, value)}
                      onDelete={() => toggleDelete(item)}
                    />
                  ))}

                  {currentPageAdditions.map((item) => (
                    <AdditionOverlayBox
                      key={item.id}
                      item={item}
                      zoom={zoom}
                      selected={selectedTarget?.kind === "add" && selectedTarget.id === item.id}
                      onSelect={() => selectAddition(item)}
                      onStartDrag={(event) => startDrag(event, { kind: "add", id: item.id }, item)}
                      onChange={(value) => updateAddition(item.id, { text: value })}
                      onDelete={() => removeAddition(item.id)}
                    />
                  ))}
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

function TextOverlayBox({
  item,
  geometry,
  zoom,
  selected,
  deleted,
  value,
  changed,
  onSelect,
  onStartDrag,
  onChange,
  onDelete
}: {
  item: PdfEditorTextItem;
  geometry: PdfEditorBoxGeometry;
  zoom: number;
  selected: boolean;
  deleted: boolean;
  value: string;
  changed: boolean;
  onSelect: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onChange: (value: string) => void;
  onDelete: () => void;
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
          <textarea
            data-no-drag
            value={value}
            disabled={deleted}
            onChange={(event) => onChange(event.target.value)}
            className="allow-text-selection h-full w-full resize-none rounded-sm border border-emerald-500 bg-white/96 px-1 py-0 text-[inherit] leading-tight outline-none disabled:bg-rose-50 disabled:text-rose-500"
            style={{ fontSize: `${Math.max(8, item.fontSize * zoom)}px` }}
            autoFocus
          />
          <button
            data-no-drag
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-sm border border-stone-300 bg-white text-stone-600 shadow"
            aria-label="삭제"
          >
            {deleted ? <X size={12} /> : <Trash2 size={12} />}
          </button>
        </>
      ) : changed && !deleted ? (
        <div
          className="pdf-editor-field-text"
          style={{
            color: item.color ? `#${item.color.replace(/^#/, "")}` : "#111827",
            fontFamily: item.fontFamily || "Malgun Gothic, Arial, sans-serif",
            fontSize: `${Math.max(8, item.fontSize * zoom)}px`,
            lineHeight: "1.05"
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

function CoverOverlayBox({ item, zoom, visible }: { item: PdfEditorTextItem; zoom: number; visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return (
    <div
      className="pdf-editor-cover"
      style={boxStyle(item, zoom)}
    />
  );
}

function AdditionOverlayBox({
  item,
  zoom,
  selected,
  onSelect,
  onStartDrag,
  onChange,
  onDelete
}: {
  item: PendingPdfEditorAddition;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onStartDrag: (event: ReactPointerEvent<HTMLElement>) => void;
  onChange: (value: string) => void;
  onDelete: () => void;
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
          <textarea
            data-no-drag
            value={item.text}
            onChange={(event) => onChange(event.target.value)}
            placeholder="텍스트 입력"
            className="allow-text-selection h-full w-full resize-none rounded-sm border border-emerald-500 bg-white/96 px-1 py-0 leading-tight outline-none"
            style={{ fontSize: `${Math.max(8, item.fontSize * zoom)}px` }}
            autoFocus
          />
          <button
            data-no-drag
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-sm border border-stone-300 bg-white text-stone-600 shadow"
            aria-label="제거"
          >
            <X size={12} />
          </button>
        </>
      ) : (
        <span className="pdf-editor-field-label">{item.text || "추가 텍스트"}</span>
      )}
    </div>
  );
}

function boxStyle(geometry: PdfEditorBoxGeometry, zoom: number): CSSProperties {
  return {
    left: `${geometry.x * zoom}px`,
    top: `${geometry.y * zoom}px`,
    width: `${Math.max(12, geometry.width * zoom)}px`,
    height: `${Math.max(12, geometry.height * zoom)}px`
  };
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
