import { ExternalLink } from "lucide-react";
import type { ConversionJob } from "../../main/types/conversion";

interface ConversionResultPanelProps {
  jobs: ConversionJob[];
  onReveal: (path: string) => void;
}

export function ConversionResultPanel({ jobs, onReveal }: ConversionResultPanelProps): JSX.Element {
  const outputs = jobs
    .filter((job) => job.status === "success")
    .flatMap((job) => job.outputPaths.map((path) => ({ path, jobId: job.id })));

  return (
    <section className="bg-white p-4">
      <h2 className="mb-3 text-base font-semibold text-stone-900">결과 파일</h2>
      {outputs.length === 0 ? (
        <p className="text-sm text-stone-500">검증을 통과한 결과 파일이 여기에 표시됩니다.</p>
      ) : (
        <div className="space-y-2">
          {outputs.map((output) => (
            <button
              key={`${output.jobId}-${output.path}`}
              type="button"
              onClick={() => onReveal(output.path)}
              className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-left text-sm hover:bg-stone-100"
            >
              <span className="truncate text-stone-700">{output.path}</span>
              <ExternalLink size={14} className="text-stone-500" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
