import { Download, Maximize2, MousePointerClick, Moon, Pin, Sun, Wrench } from "lucide-react";
import type { ContextMenuStatus } from "../../main/types/contextMenu";

interface SettingsPanelProps {
  libreOfficePath?: string;
  contextMenuStatus?: ContextMenuStatus;
  darkMode: boolean;
  floatingEnabled: boolean;
  alwaysOnTop: boolean;
  onPickLibreOfficePath: () => void;
  onOpenLibreOfficeDownload: () => void;
  onInstallContextMenu: () => void;
  onUninstallContextMenu: () => void;
  onDarkModeChange: (value: boolean) => void;
  onFloatingEnabledChange: (value: boolean) => void;
  onAlwaysOnTopChange: (value: boolean) => void;
}

export function SettingsPanel({
  libreOfficePath,
  contextMenuStatus,
  darkMode,
  floatingEnabled,
  alwaysOnTop,
  onPickLibreOfficePath,
  onOpenLibreOfficeDownload,
  onInstallContextMenu,
  onUninstallContextMenu,
  onDarkModeChange,
  onFloatingEnabledChange,
  onAlwaysOnTopChange
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

        <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <MousePointerClick size={15} className="text-stone-700" />
            <span className="text-sm font-semibold text-stone-900">Windows 탐색기 우클릭 메뉴</span>
          </div>
          <p className="mb-2 text-xs leading-5 text-stone-600">
            파일을 우클릭하여 Convert Smith로 바로 불러올 수 있습니다. 변환은 자동으로 시작하지 않습니다.
          </p>
          <p className="mb-3 rounded-md bg-white px-2 py-1.5 text-xs text-stone-600">
            상태: {contextMenuStatus?.message || "상태 확인 중입니다."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onInstallContextMenu}
              disabled={!contextMenuStatus?.supported}
              className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              우클릭 메뉴 등록
            </button>
            <button
              type="button"
              onClick={onUninstallContextMenu}
              disabled={!contextMenuStatus?.supported}
              className="h-8 rounded-md border border-stone-300 bg-white px-2 text-xs font-semibold text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              우클릭 메뉴 제거
            </button>
          </div>
          {contextMenuStatus && !contextMenuStatus.supported && (
            <p className="mt-2 text-xs leading-5 text-stone-500">
              우클릭 메뉴 등록은 현재 Windows에서만 지원됩니다.
            </p>
          )}
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

        <label className="flex items-center justify-between rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-800">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Pin size={15} />
            <span className="truncate">항상 위에 표시</span>
          </span>
          <input
            type="checkbox"
            checked={alwaysOnTop}
            onChange={(event) => onAlwaysOnTopChange(event.target.checked)}
            className="h-4 w-4 shrink-0 accent-emerald-700"
          />
        </label>

        <p className="rounded-md bg-stone-50 px-3 py-2 text-xs leading-5 text-stone-600 [word-break:keep-all]">
          파일 선택이나 드래그 중 Convert Smith가 다른 창 뒤로 밀리지 않도록 전방에 유지합니다.
        </p>
      </div>
    </section>
  );
}
