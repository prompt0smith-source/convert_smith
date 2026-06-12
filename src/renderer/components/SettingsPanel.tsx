import { Download, Moon, Sun, Wrench } from "lucide-react";

interface SettingsPanelProps {
  libreOfficePath?: string;
  darkMode: boolean;
  onPickLibreOfficePath: () => void;
  onOpenLibreOfficeDownload: () => void;
  onDarkModeChange: (value: boolean) => void;
}

export function SettingsPanel({
  libreOfficePath,
  darkMode,
  onPickLibreOfficePath,
  onOpenLibreOfficeDownload,
  onDarkModeChange
}: SettingsPanelProps): JSX.Element {
  return (
    <section className="border-b border-stone-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Wrench size={17} className="text-stone-700" />
        <h2 className="text-base font-semibold text-stone-900">설정</h2>
      </div>
      <div className="space-y-3">
        <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-stone-900">LibreOffice</span>
            <button
              type="button"
              onClick={onOpenLibreOfficeDownload}
              className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-2 text-xs font-medium text-stone-700 hover:bg-stone-100"
            >
              <Download size={14} />
              다운로드
            </button>
          </div>
          <p className="mb-3 text-xs leading-5 text-stone-600 [word-break:keep-all]">
            DOCX/XLSX → PDF 변환에는 LibreOffice가 필요합니다. 설치 후
            <span className="font-medium text-stone-800"> program\soffice.exe</span> 파일을 지정하세요.
          </p>
          <button
            type="button"
            onClick={onPickLibreOfficePath}
            className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-stone-300 bg-white px-3 text-left text-sm text-stone-800 hover:bg-stone-100"
          >
            <span className="truncate">{libreOfficePath || "LibreOffice 경로 지정"}</span>
          </button>
        </div>

        <label className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-800">
          <span className="inline-flex items-center gap-2">
            {darkMode ? <Moon size={15} /> : <Sun size={15} />}
            다크 모드
          </span>
          <input
            type="checkbox"
            checked={darkMode}
            onChange={(event) => onDarkModeChange(event.target.checked)}
            className="h-4 w-4 accent-emerald-700"
          />
        </label>
      </div>
    </section>
  );
}
