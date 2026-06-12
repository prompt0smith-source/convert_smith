import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";
import type { DependencyStatus } from "../../main/types/conversion";

interface DependencyStatusPanelProps {
  status?: DependencyStatus;
  onRefresh: () => void;
}

export function DependencyStatusPanel({ status, onRefresh }: DependencyStatusPanelProps): JSX.Element {
  return (
    <section className="border-b border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold text-stone-900">의존성 상태</h2>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-stone-300 px-2 text-sm text-stone-700 hover:bg-stone-50"
        >
          <RefreshCw size={14} />
          확인
        </button>
      </div>
      <div className="space-y-2 text-sm">
        <StatusLine label="FFmpeg" available={Boolean(status?.ffmpeg.available)} detail={status?.ffmpeg.path} />
        <StatusLine label="FFprobe" available={Boolean(status?.ffprobe.available)} detail={status?.ffprobe.path} />
        <StatusLine
          label="LibreOffice"
          available={Boolean(status?.libreOffice.available)}
          detail={status?.libreOffice.path || status?.libreOffice.message}
        />
      </div>
    </section>
  );
}

function StatusLine({
  label,
  available,
  detail
}: {
  label: string;
  available: boolean;
  detail?: string;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-2 rounded-md bg-stone-50 px-3 py-2">
      <span className="flex items-center gap-2 font-medium text-stone-800">
        {available ? (
          <CheckCircle2 size={15} className="text-emerald-700" />
        ) : (
          <CircleAlert size={15} className="text-amber-700" />
        )}
        {label}
      </span>
      <span className="min-w-0 truncate text-xs text-stone-500" title={detail}>
        {detail || "확인 필요"}
      </span>
    </div>
  );
}
