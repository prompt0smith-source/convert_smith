import { useEffect, useState } from "react";
import { BadgeAlert, BadgeCheck, Search } from "lucide-react";
import type { FileItem, VideoInspection } from "../../main/types/conversion";
import { formatDuration } from "../lib/formatLabels";
import { helperMessages } from "../lib/koreanMessages";

interface VideoCodecInspectorProps {
  selectedFile?: FileItem;
}

export function VideoCodecInspector({ selectedFile }: VideoCodecInspectorProps): JSX.Element {
  const [inspection, setInspection] = useState<VideoInspection>();
  const [error, setError] = useState<string>();
  const isVideo = selectedFile?.kind === "video";

  useEffect(() => {
    let cancelled = false;
    setInspection(undefined);
    setError(undefined);
    if (!selectedFile || !isVideo) return;

    window.convertSmith
      .inspectVideo(selectedFile.path)
      .then((result) => {
        if (!cancelled) setInspection(result);
      })
      .catch((inspectError: unknown) => {
        if (!cancelled) setError(inspectError instanceof Error ? inspectError.message : "코덱 검사를 실패했습니다.");
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile, isVideo]);

  if (!selectedFile || !isVideo) {
    return (
      <section className="border-b border-stone-200 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold text-stone-900">코덱 검사</h2>
        <p className="text-sm leading-6 text-stone-600">{helperMessages.kakao}</p>
      </section>
    );
  }

  return (
    <section className="border-b border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Search size={17} className="text-emerald-700" />
        <h2 className="text-base font-semibold text-stone-900">코덱 검사</h2>
      </div>
      {error && <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>}
      {!inspection && !error && <p className="text-sm text-stone-600">비디오 정보를 읽는 중입니다.</p>}
      {inspection && (
        <div className="space-y-2 text-sm">
          <Info label="확장자" value={inspection.extension.toUpperCase()} />
          <Info label="컨테이너" value={inspection.container || "-"} />
          <Info label="현재 비디오 코덱" value={(inspection.videoCodec || "-").toUpperCase()} />
          <Info label="현재 오디오 코덱" value={(inspection.audioCodec || "-").toUpperCase()} />
          <Info
            label="해상도"
            value={inspection.width && inspection.height ? `${inspection.width} x ${inspection.height}` : "-"}
          />
          <Info label="길이" value={formatDuration(inspection.durationSeconds)} />
          <div
            className={[
              "mt-3 flex gap-2 rounded-md px-3 py-2 leading-6",
              inspection.warning ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"
            ].join(" ")}
          >
            {inspection.warning ? (
              <BadgeAlert size={17} className="mt-0.5" />
            ) : (
              <BadgeCheck size={17} className="mt-0.5" />
            )}
            <span>{inspection.warning || inspection.compatibilityMessage}</span>
          </div>
        </div>
      )}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 rounded-md bg-stone-50 px-3 py-2">
      <span className="font-medium text-stone-700">{label}</span>
      <span className="truncate text-stone-600">{value}</span>
    </div>
  );
}
