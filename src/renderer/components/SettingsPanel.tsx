import { Download, FileCheck2, FolderOpen, ListRestart, Maximize2, Moon, Sun, Wrench } from "lucide-react";

interface SettingsPanelProps {
  libreOfficePath?: string;
  darkMode: boolean;
  floatingEnabled: boolean;
  clearFilesAfterSuccess: boolean;
  openFolderAfterSuccess: boolean;
  openFileAfterSuccess: boolean;
  onPickLibreOfficePath: () => void;
  onOpenLibreOfficeDownload: () => void;
  onDarkModeChange: (value: boolean) => void;
  onFloatingEnabledChange: (value: boolean) => void;
  onClearFilesAfterSuccessChange: (value: boolean) => void;
  onOpenFolderAfterSuccessChange: (value: boolean) => void;
  onOpenFileAfterSuccessChange: (value: boolean) => void;
}

export function SettingsPanel({
  libreOfficePath,
  darkMode,
  floatingEnabled,
  clearFilesAfterSuccess,
  openFolderAfterSuccess,
  openFileAfterSuccess,
  onPickLibreOfficePath,
  onOpenLibreOfficeDownload,
  onDarkModeChange,
  onFloatingEnabledChange,
  onClearFilesAfterSuccessChange,
  onOpenFolderAfterSuccessChange,
  onOpenFileAfterSuccessChange
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
            DOCX/XLSX/PPTX 변환에는 LibreOffice가 필요합니다. 설치 후
            <span className="font-medium text-stone-800"> program\soffice.exe</span> 또는
            <span className="font-medium text-stone-800"> program\soffice.com</span>을 지정하세요.
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

        <label className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-800">
          <span className="inline-flex items-center gap-2">
            <Maximize2 size={15} />
            플로팅 버튼
          </span>
          <input
            type="checkbox"
            checked={floatingEnabled}
            onChange={(event) => onFloatingEnabledChange(event.target.checked)}
            className="h-4 w-4 accent-emerald-700"
          />
        </label>

        <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
          <h3 className="mb-2 text-sm font-semibold text-stone-900">완료 후 처리</h3>
          <div className="space-y-2">
            <SettingsCheckbox
              icon={<ListRestart size={15} />}
              label="완료 후 목록 초기화"
              checked={clearFilesAfterSuccess}
              onChange={onClearFilesAfterSuccessChange}
            />
            <SettingsCheckbox
              icon={<FolderOpen size={15} />}
              label="완료 후 결과 위치 열기"
              checked={openFolderAfterSuccess}
              onChange={onOpenFolderAfterSuccessChange}
            />
            <SettingsCheckbox
              icon={<FileCheck2 size={15} />}
              label="완료 후 첫 결과 파일 열기"
              checked={openFileAfterSuccess}
              onChange={onOpenFileAfterSuccessChange}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function SettingsCheckbox({
  icon,
  label,
  checked,
  onChange
}: {
  icon: JSX.Element;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}): JSX.Element {
  return (
    <label className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm text-stone-800">
      <span className="inline-flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-emerald-700"
      />
    </label>
  );
}
