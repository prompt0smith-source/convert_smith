import { Settings, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  onToggle: () => void;
  onClose: () => void;
  onRefreshDependencies: () => void;
  onPickLibreOfficePath: () => void;
  onOpenLibreOfficeDownload: () => void;
  onDarkModeChange: (value: boolean) => void;
  onFloatingEnabledChange: (value: boolean) => void;
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
  onToggle,
  onClose,
  onRefreshDependencies,
  onPickLibreOfficePath,
  onOpenLibreOfficeDownload,
  onDarkModeChange,
  onFloatingEnabledChange,
  onCancelJob,
  onReveal,
  onCopy
}: UtilityDrawerProps): JSX.Element {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number>();

  useEffect(() => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }

    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
      return undefined;
    }

    if (!shouldRender) return undefined;
    setIsClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setShouldRender(false);
      setIsClosing(false);
    }, 260);

    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, [isOpen, shouldRender]);

  useEffect(() => {
    if (!shouldRender || isClosing) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isClosing, onClose, shouldRender]);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label="옵션 패널"
        aria-expanded={isOpen}
        className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-stone-200 text-stone-800 shadow-sm hover:bg-stone-300"
      >
        <Settings
          size={19}
          className={["transition-transform duration-300", isOpen ? "rotate-90" : "rotate-0"].join(" ")}
        />
      </button>

      {shouldRender && (
        <div
          className={[
            "utility-drawer-overlay fixed inset-0 z-40 bg-black/20",
            isClosing ? "utility-drawer-overlay--closing" : "utility-drawer-overlay--open"
          ].join(" ")}
          onClick={onClose}
        >
          <aside
            className={[
              "utility-drawer-panel absolute right-0 top-0 flex h-full w-[440px] max-w-[calc(100vw-24px)] flex-col border-l border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl",
              isClosing ? "utility-drawer-panel--closing" : "utility-drawer-panel--open"
            ].join(" ")}
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
                onPickLibreOfficePath={onPickLibreOfficePath}
                onOpenLibreOfficeDownload={onOpenLibreOfficeDownload}
                onDarkModeChange={onDarkModeChange}
                onFloatingEnabledChange={onFloatingEnabledChange}
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
