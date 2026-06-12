import { ExternalLink, FileSearch, ImageIcon, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { FileItem, FilePreview } from "../../main/types/conversion";
import { formatBytes } from "../lib/formatLabels";

interface PreviewPanelProps {
  selectedFile?: FileItem;
  onOpenExternal: (item: FileItem) => void;
}

interface Size {
  width: number;
  height: number;
}

interface Offset {
  x: number;
  y: number;
}

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 8;

export function PreviewPanel({ selectedFile, onOpenExternal }: PreviewPanelProps): JSX.Element {
  const [preview, setPreview] = useState<FilePreview>();
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreview(undefined);
    setError(undefined);
    if (!selectedFile) return;

    setIsLoading(true);
    window.convertSmith
      .getFilePreview(selectedFile.path)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((previewError: unknown) => {
        if (!cancelled) {
          setError(previewError instanceof Error ? previewError.message : "미리보기를 만들지 못했습니다.");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile]);

  if (!selectedFile) {
    return (
      <section className="flex min-h-0 flex-1 flex-col bg-stone-50">
        <PreviewHeader title="미리보기" />
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="rounded-md border border-dashed border-stone-300 bg-white px-6 py-10 text-center">
            <FileSearch className="mx-auto mb-3 h-8 w-8 text-stone-400" />
            <p className="max-w-64 text-sm leading-6 text-stone-500 [word-break:keep-all]">
              좌측 파일을 선택하면 여기에 미리보기가 표시됩니다.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-stone-50">
      <PreviewHeader
        title="미리보기"
        subtitle={`${selectedFile.name} · ${formatBytes(selectedFile.size)}`}
        action={
          <button
            type="button"
            onClick={() => onOpenExternal(selectedFile)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm text-stone-700 hover:bg-stone-100"
          >
            <ExternalLink size={15} />
            외부 앱
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-hidden p-4">
        {isLoading && (
          <div className="flex h-full items-center justify-center rounded-md border border-stone-200 bg-white">
            <div className="flex items-center gap-2 text-sm text-stone-600">
              <Loader2 size={18} className="animate-spin" />
              미리보기를 만드는 중입니다.
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {error}
          </div>
        )}

        {!isLoading && !error && preview && <PreviewBody preview={preview} />}
      </div>
    </section>
  );
}

function PreviewHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-white px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        {subtitle && <p className="mt-1 truncate text-sm text-stone-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function PreviewBody({ preview }: { preview: FilePreview }): JSX.Element {
  if ((preview.previewType === "image" || preview.previewType === "pdf_page") && preview.dataUrl) {
    return <ZoomableImagePreview preview={preview} />;
  }

  return (
    <div className="h-full overflow-auto rounded-md border border-stone-200 bg-white p-4">
      <div className="mb-4 flex items-center gap-2">
        <ImageIcon size={18} className="text-emerald-700" />
        <h3 className="text-sm font-semibold text-stone-900">{preview.message}</h3>
      </div>
      <dl className="grid grid-cols-[140px_1fr] gap-2 text-sm">
        <Info label="파일명" value={preview.name} />
        <Info label="형식" value={preview.extension || "-"} />
        <Info label="크기" value={formatBytes(preview.size)} />
        {preview.details &&
          Object.entries(preview.details)
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([key, value]) => <Info key={key} label={labelFor(key)} value={String(value)} />)}
      </dl>
    </div>
  );
}

function ZoomableImagePreview({ preview }: { preview: FilePreview }): JSX.Element {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);

  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [naturalSize, setNaturalSize] = useState<Size>({ width: 0, height: 0 });
  const [viewerSize, setViewerSize] = useState<Size>({ width: 0, height: 0 });

  const baseSize = useMemo(() => {
    if (!naturalSize.width || !naturalSize.height || !viewerSize.width || !viewerSize.height) {
      return { width: 0, height: 0 };
    }
    const ratio = Math.min(viewerSize.width / naturalSize.width, viewerSize.height / naturalSize.height, 1);
    return {
      width: Math.max(1, Math.round(naturalSize.width * ratio)),
      height: Math.max(1, Math.round(naturalSize.height * ratio))
    };
  }, [naturalSize, viewerSize]);

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setIsPanning(false);
    setNaturalSize({ width: 0, height: 0 });
    dragRef.current = null;
  }, [preview.path, preview.dataUrl]);

  useEffect(() => {
    const node = viewerRef.current;
    if (!node) return undefined;

    const updateSize = () => {
      setViewerSize({
        width: node.clientWidth,
        height: node.clientHeight
      });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setOffset((current) => clampOffset(current, zoom, baseSize, viewerSize));
  }, [baseSize, viewerSize, zoom]);

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.14 : 0.88;
    const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    setZoom(nextZoom);
    setOffset((current) => clampOffset(current, nextZoom, baseSize, viewerSize));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: offset.x,
      originY: offset.y
    };
    setIsPanning(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const next = {
      x: dragRef.current.originX + event.clientX - dragRef.current.x,
      y: dragRef.current.originY + event.clientY - dragRef.current.y
    };
    setOffset(clampOffset(next, zoom, baseSize, viewerSize));
  };

  const endPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setIsPanning(false);
  };

  const onImageLoad = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget;
    setNaturalSize({
      width: image.naturalWidth,
      height: image.naturalHeight
    });
  };

  return (
    <div className="relative h-full overflow-hidden rounded-md border border-stone-200 bg-white">
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-md border border-stone-200 bg-white/95 px-2 py-1 text-xs text-stone-700 shadow-sm">
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={resetView}
          className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-stone-100"
          aria-label="미리보기 확대 초기화"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      <div
        ref={viewerRef}
        className={[
          "flex h-full w-full select-none items-center justify-center overflow-hidden bg-stone-100",
          isPanning ? "cursor-grabbing" : "cursor-grab"
        ].join(" ")}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
      >
        <img
          src={preview.dataUrl}
          alt={preview.message}
          draggable={false}
          onLoad={onImageLoad}
          className="rounded border border-stone-200 object-contain shadow-sm"
          style={{
            width: baseSize.width ? `${baseSize.width}px` : "auto",
            height: baseSize.height ? `${baseSize.height}px` : "auto",
            maxWidth: "none",
            maxHeight: "none",
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
            transformOrigin: "center center"
          }}
        />
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <>
      <dt className="rounded bg-stone-100 px-2 py-1 font-medium text-stone-700">{label}</dt>
      <dd className="min-w-0 truncate rounded bg-stone-50 px-2 py-1 text-stone-600">{value}</dd>
    </>
  );
}

function labelFor(key: string): string {
  const labels: Record<string, string> = {
    pages: "페이지",
    container: "컨테이너",
    videoCodec: "비디오 코덱",
    audioCodec: "오디오 코덱",
    pixelFormat: "픽셀 형식",
    durationSeconds: "길이(초)",
    resolution: "해상도",
    fileName: "파일명",
    extension: "확장자",
    size: "크기",
    error: "상세"
  };
  return labels[key] || key;
}

function clampOffset(offset: Offset, zoom: number, baseSize: Size, viewerSize: Size): Offset {
  const horizontalLimit = getPanLimit(baseSize.width, viewerSize.width, zoom);
  const verticalLimit = getPanLimit(baseSize.height, viewerSize.height, zoom);
  return {
    x: clamp(offset.x, -horizontalLimit, horizontalLimit),
    y: clamp(offset.y, -verticalLimit, verticalLimit)
  };
}

function getPanLimit(baseLength: number, viewerLength: number, zoom: number): number {
  if (!baseLength || !viewerLength) return 0;
  const scaledLength = baseLength * zoom;
  if (scaledLength <= viewerLength) return 0;
  return Math.max(0, (scaledLength - viewerLength) / 2);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
