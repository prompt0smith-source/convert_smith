import { Settings, X } from "lucide-react";
import { useEffect } from "react";
import type { ConversionJob, DependencyStatus } from "../../main/types/conversion";
import { ConversionResultPanel } from "./ConversionResultPanel";
import { DependencyStatusPanel } from "./DependencyStatusPanel";
import { JobQueue } from "./JobQueue";
import { SettingsPanel } from "./SettingsPanel";

interface UtilityDrawerProps {
  isOpen: boolean;
  dependencyStatus?: DependencyStatus;
  jobs: ConversionJob[];
  libreOfficePath?: string;
  darkMode: boolean;
  floatingEnabled: boolean;
  clearFilesAfterSuccess: boolean;
  openFolderAfterSuccess: boolean;
  openFileAfterSuccess: boolean;
  onToggle: () => void;
  onClose: () => void;
  onRefreshDependencies: () => void;
  onPickLibreOfficePath: () => void;
  onOpenLibreOfficeDownload: () => void;
  onDarkModeChange: (value: boolean) => void;
  onFloatingEnabledChange: (value: boolean) => void;
  onClearFilesAfterSuccessChange: (value: boolean) => void;
  onOpenFolderAfterSuccessChange: (value: boolean) => void;
  onOpenFileAfterSuccessChange: (value: boolean) => void;
  onCancelJob: (jobId: string) => void;
  onReveal: (path: string) => void;
  onCopy: (path: string) => void;
}

export function UtilityDrawer({
  isOpen,
  dependencyStatus,
  jobs,
  libreOfficePath,
  darkMode,
  floatingEnabled,
  clearFilesAfterSuccess,
  openFolderAfterSuccess,
  openFileAfterSuccess,
  onToggle,
  onClose,
  onRefreshDependencies,
  onPickLibreOfficePath,
  onOpenLibreOfficeDownload,
  onDarkModeChange,
  onFloatingEnabledChange,
  onClearFilesAfterSuccessChange,
  onOpenFolderAfterSuccessChange,
  onOpenFileAfterSuccessChange,
  onCancelJob,
  onReveal,
  onCopy
}: UtilityDrawerProps): JSX.Element {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label="옵션 패널"
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-stone-200 text-stone-800 shadow-sm hover:bg-stone-300"
      >
        <Settings
          size={19}
          className={["transition-transform duration-300", isOpen ? "rotate-90" : "rotate-0"].join(" ")}
        />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose}>
          <aside
            className="absolute right-0 top-0 flex h-full w-[440px] max-w-[calc(100vw-40px)] flex-col border-l border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-zinc-100">옵션</h2>
                <p className="mt-1 text-xs text-zinc-400">의존성, 설정, 작업 로그</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-white"
                aria-label="옵션 닫기"
              >
                <X size={17} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-stone-50 text-stone-900">
              <DependencyStatusPanel status={dependencyStatus} onRefresh={onRefreshDependencies} />
              <SettingsPanel
                libreOfficePath={libreOfficePath}
                darkMode={darkMode}
                floatingEnabled={floatingEnabled}
                clearFilesAfterSuccess={clearFilesAfterSuccess}
                openFolderAfterSuccess={openFolderAfterSuccess}
                openFileAfterSuccess={openFileAfterSuccess}
                onPickLibreOfficePath={onPickLibreOfficePath}
                onOpenLibreOfficeDownload={onOpenLibreOfficeDownload}
                onDarkModeChange={onDarkModeChange}
                onFloatingEnabledChange={onFloatingEnabledChange}
                onClearFilesAfterSuccessChange={onClearFilesAfterSuccessChange}
                onOpenFolderAfterSuccessChange={onOpenFolderAfterSuccessChange}
                onOpenFileAfterSuccessChange={onOpenFileAfterSuccessChange}
              />
              <JobQueue jobs={jobs} onCancel={onCancelJob} onReveal={onReveal} onCopy={onCopy} />
              <ConversionResultPanel jobs={jobs} onReveal={onReveal} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
