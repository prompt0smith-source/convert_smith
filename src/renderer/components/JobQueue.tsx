import type { ConversionJob } from "../../main/types/conversion";
import { JobCard } from "./JobCard";

interface JobQueueProps {
  jobs: ConversionJob[];
  onCancel: (jobId: string) => void;
  onReveal: (path: string) => void;
  onCopy: (path: string) => void;
}

export function JobQueue({ jobs, onCancel, onReveal, onCopy }: JobQueueProps): JSX.Element {
  return (
    <section className="min-h-0 flex-1 overflow-auto border-b border-stone-200 bg-stone-50 p-4">
      <h2 className="mb-3 text-base font-semibold text-stone-900">작업 큐</h2>
      {jobs.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-md border border-stone-200 bg-white text-sm text-stone-500">
          아직 변환 작업이 없습니다.
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onCancel={onCancel} onReveal={onReveal} onCopy={onCopy} />
          ))}
        </div>
      )}
    </section>
  );
}
