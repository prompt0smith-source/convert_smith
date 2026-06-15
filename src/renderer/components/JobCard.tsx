import { CheckCircle2, CircleAlert, CircleStop, FolderOpen, Loader2, X } from "lucide-react";
import type { ConversionJob } from "../../main/types/conversion";
import { conversionLabels, formatBytes } from "../lib/formatLabels";

interface JobCardProps {
  job: ConversionJob;
  onCancel: (jobId: string) => void;
  onReveal: (path: string) => void;
  onCopy: (path: string) => void;
}

export function JobCard({ job, onCancel, onReveal, onCopy }: JobCardProps): JSX.Element {
  const statusColor =
    job.status === "success"
      ? "text-emerald-700"
      : job.status === "failed"
        ? "text-rose-700"
        : job.status === "cancelled"
          ? "text-stone-500"
          : "text-amber-700";

  return (
    <article className="rounded-md border border-stone-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <StatusIcon status={job.status} />
            <h3 className="truncate text-sm font-semibold text-stone-900">
              {conversionLabels[job.conversionType]}
            </h3>
          </div>
          <p className={`mt-1 text-sm ${statusColor}`}>{job.status === "failed" && job.error ? job.error : job.message}</p>
        </div>
        {job.status === "running" && (
          <button
            type="button"
            onClick={() => onCancel(job.id)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-stone-500 hover:bg-rose-50 hover:text-rose-700"
            aria-label="변환 취소"
          >
            <X size={16} />
          </button>
        )}
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
        <div
          className="h-full rounded-full bg-emerald-600 transition-all"
          style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
        />
      </div>

      {job.error && (
        <details className="mt-3 rounded-md bg-rose-50 p-2 text-sm text-rose-900">
          <summary className="cursor-pointer font-medium">오류 상세</summary>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs">
            {job.technicalDetails || job.error}
          </pre>
        </details>
      )}

      {job.status === "success" && job.resultReport && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border border-emerald-100 bg-emerald-50 p-2 text-xs text-emerald-950">
          <ReportItem label="검증" value={job.resultReport.validationPassed ? "완료" : "실패"} />
          <ReportItem label="결과 파일" value={`${job.resultReport.outputCount}개`} />
          <ReportItem label="원본 용량" value={formatBytes(job.resultReport.inputBytes)} />
          <ReportItem label="결과 용량" value={formatBytes(job.resultReport.outputBytes)} />
          <ReportItem label="용량 차이" value={formatByteDelta(job.resultReport.byteDelta, job.resultReport.byteDeltaPercent)} />
          <ReportItem label="소요 시간" value={formatDurationMs(job.resultReport.durationMs)} />
        </div>
      )}

      {job.outputPaths.length > 0 && (
        <div className="mt-3 space-y-2">
          {job.outputPaths.map((outputPath) => (
            <div key={outputPath} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-xs">
              <span className="truncate text-stone-600">{outputPath}</span>
              <button
                type="button"
                onClick={() => onReveal(outputPath)}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-stone-300 px-2 text-stone-700 hover:bg-stone-50"
              >
                <FolderOpen size={13} />
                위치
              </button>
              <button
                type="button"
                onClick={() => onCopy(outputPath)}
                className="h-7 rounded-md border border-stone-300 px-2 text-stone-700 hover:bg-stone-50"
              >
                복사
              </button>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

function ReportItem({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-emerald-700">{label}</p>
      <p className="truncate font-semibold text-emerald-950">{value}</p>
    </div>
  );
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}분 ${rest}초`;
}

function formatByteDelta(byteDelta: number, percent: number): string {
  if (!Number.isFinite(byteDelta) || byteDelta === 0) return "변화 없음";
  const label = byteDelta > 0 ? "절감" : "증가";
  const formattedPercent = Number.isFinite(percent) ? ` (${Math.abs(percent).toFixed(1)}%)` : "";
  return `${label} ${formatBytes(Math.abs(byteDelta))}${formattedPercent}`;
}

function StatusIcon({ status }: { status: ConversionJob["status"] }): JSX.Element {
  if (status === "success") return <CheckCircle2 size={17} className="text-emerald-700" />;
  if (status === "failed") return <CircleAlert size={17} className="text-rose-700" />;
  if (status === "cancelled") return <CircleStop size={17} className="text-stone-500" />;
  return <Loader2 size={17} className="animate-spin text-amber-700" />;
}
