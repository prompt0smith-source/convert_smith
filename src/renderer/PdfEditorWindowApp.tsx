import { ExternalLink, Minus, Plus, Save, Trash2, X } from "lucide-react";
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
  const [textRepairEnabled, setTextRepairEnabled] = useState(true);
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
          throw new Error(buildPreviewErrorMessage(preview));
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
    (item) =>
      deletedIds.has(item.id) ||
      drafts[item.id] !== undefined ||
      geometryOverrides[item.id] ||
      (selectedTarget?.kind === "text" && selectedTarget.id === item.id)
  );
  const currentPageRepairItems = currentPageItems.filter(
    (item) =>
      textNeedsVisualRepair(item.text) &&
      !deletedIds.has(item.id) &&
      drafts[item.id] === undefined &&
      !geometryOverrides[item.id] &&
      !(selectedTarget?.kind === "text" && selectedTarget.id === item.id)
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
    const wasDeleted = deletedIds.has(item.id);
    setDeletedIds((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
    if (!wasDeleted) {
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
    }
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
        {editMode && (
          <button
            type="button"
            onClick={() => setTextRepairEnabled((value) => !value)}
            className={[
              "inline-flex h-8 items-center rounded-md border px-2 text-xs font-semibold",
              textRepairEnabled
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-stone-200 bg-white text-stone-600 hover:bg-stone-100"
            ].join(" ")}
            title="PDF 렌더러가 한글을 네모로 표시할 때 화면 표시만 보정합니다. 원본 저장 구조에는 바로 적용하지 않습니다."
          >
            텍스트 보정
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
        <PdfViewerLoadingOverlay
          progress={isLoading ? 42 : 76}
          message={isLoading ? "PDF 구조와 텍스트 레이어를 읽는 중입니다." : "PDF 페이지를 자체 Viewer로 렌더링 중입니다."}
          completed={isLoading ? 0 : 1}
          total={2}
        />
      )}

      {error && (
        <div className="absolute left-1/2 top-20 z-40 max-w-[680px] -translate-x-1/2 whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900 shadow-xl">
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

                  {textRepairEnabled &&
                    currentPageRepairItems.map((item) => (
                      <TextRepairOverlayBox
                        key={`repair-${item.id}`}
                        item={item}
                        zoom={zoom}
                      />
                    ))}

                  {currentPageItems.filter((item) => !deletedIds.has(item.id)).map((item) => (
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
          <p className="mb-1 text-xs font-semibold">{getSaveModeMessage(result)}</p>
          <p className="truncate text-xs">{result.outputPath}</p>
          {result.warnings.slice(0, 2).map((warning) => (
            <p key={warning} className="mt-1 line-clamp-2 text-xs leading-5 text-emerald-800">
              {warning}
            </p>
          ))}
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

function buildPreviewErrorMessage(preview: FilePreview): string {
  const details = preview.details || {};
  const reason = getDetailString(details.error);
  const pdfiumReason = getDetailString(details.pdfiumError);
  const logPath = getDetailString(details.logPath);
  return [
    "PDF 페이지를 자체 Viewer로 렌더링하지 못했습니다.",
    reason ? `상세: ${reason}` : undefined,
    pdfiumReason ? `PDFium: ${pdfiumReason}` : undefined,
    logPath ? `Debug log: ${logPath}` : undefined
  ].filter(Boolean).join("\n");
}

function getDetailString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function getSaveModeMessage(result: PdfEditorSaveResult): string {
  if (result.mode === "native_text_edit") {
    return "PDF 내부 텍스트를 직접 수정했습니다.";
  }
  if (result.mode === "surface_overlay_edit") {
    return "이 PDF는 내부 텍스트 직접 수정이 어려워 표면 편집 방식으로 저장했습니다.";
  }
  return "PDF 편집 저장 상태를 확인하지 못했습니다.";
}

function InlineEditableText({
  value,
  placeholder,
  fontSize,
  fontFamily,
  color,
  onChange
}: {
  value: string;
  placeholder?: string;
  fontSize: number;
  fontFamily?: string;
  color?: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  useEffect(() => {
    if (!ref.current || document.activeElement === ref.current) return;
    if (ref.current.innerText !== value) {
      ref.current.innerText = value;
    }
  }, [value]);

  return (
    <div
      ref={ref}
      data-no-drag
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label={placeholder || "PDF text"}
      data-placeholder={placeholder}
      className="pdf-editor-inline-editor allow-text-selection"
      style={{
        color: color ? `#${color.replace(/^#/, "")}` : "#111827",
        fontFamily: fontFamily || "Malgun Gothic, Arial, sans-serif",
        fontSize: `${Math.max(8, fontSize)}px`,
        lineHeight: "1.05"
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onInput={(event) => onChange(event.currentTarget.innerText.replace(/\n$/, ""))}
    >
      {value}
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
          <InlineEditableText
            value={value}
            fontSize={item.fontSize * zoom}
            fontFamily={item.fontFamily}
            color={item.color}
            onChange={onChange}
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

function TextRepairOverlayBox({ item, zoom }: { item: PdfEditorTextItem; zoom: number }): JSX.Element {
  return (
    <div
      className="pdf-editor-repair-item"
      style={boxStyle(item, zoom)}
      aria-hidden="true"
    >
      <span
        className="pdf-editor-repair-text"
        style={{
          color: item.color ? `#${item.color.replace(/^#/, "")}` : "#111827",
          fontFamily: item.fontFamily || "Malgun Gothic, Arial, sans-serif",
          fontSize: `${Math.max(8, item.fontSize * zoom)}px`,
          lineHeight: "1.05"
        }}
      >
        {item.text}
      </span>
    </div>
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
          <InlineEditableText
            value={item.text}
            placeholder="텍스트 입력"
            fontSize={item.fontSize * zoom}
            fontFamily="Malgun Gothic"
            onChange={onChange}
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

function textNeedsVisualRepair(value: string): boolean {
  return /[\u3131-\u318e\uac00-\ud7a3]/.test(value);
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
