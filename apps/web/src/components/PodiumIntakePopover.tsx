import { memo, useCallback, useRef, useState } from "react";
import { FolderPlusIcon, LoaderIcon } from "lucide-react";

import { isElectron } from "../env";
import { ensureLocalApi } from "../localApi";
import type { PodiumIntakeRequest } from "../stores/podium";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";
import { Toggle, ToggleGroup } from "./ui/toggle-group";

interface PodiumIntakePopoverProps {
  readonly onIntake: (request: PodiumIntakeRequest) => Promise<void>;
  readonly isLoading: boolean;
}

export const PodiumIntakePopover = memo(function PodiumIntakePopover({
  onIntake,
  isLoading,
}: PodiumIntakePopoverProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PodiumIntakeRequest["kind"]>("path");
  const [pathValue, setPathValue] = useState("");
  const [gitUrlValue, setGitUrlValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const activeValue = mode === "path" ? pathValue : gitUrlValue;

  const handleSubmit = useCallback(async () => {
    if (!activeValue.trim() || isLoading) return;
    await onIntake({ kind: mode, value: activeValue.trim() });
    const hasError = (await import("../stores/podium")).usePodiumStore.getState().intakeError;
    if (!hasError) {
      setPathValue("");
      setGitUrlValue("");
      setOpen(false);
    }
  }, [activeValue, isLoading, mode, onIntake]);

  const handleBrowse = useCallback(async () => {
    try {
      const picked = await ensureLocalApi().dialogs.pickFolder();
      if (picked) {
        setPathValue(picked);
        inputRef.current?.focus();
      }
    } catch {
      // pickFolder unavailable — ignore
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[12px] font-medium text-foreground shadow-xs/5 transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50">
        <FolderPlusIcon className="size-3.5" />
        Add project
      </PopoverTrigger>
      <PopoverPopup side="bottom" align="end" sideOffset={8} className="w-80">
        <div className="space-y-3">
          <p className="text-[13px] font-medium text-foreground">Add project</p>
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[mode]}
            onValueChange={(value) => {
              const next = value[0];
              if (next === "path" || next === "gitUrl") {
                setMode(next);
              }
            }}
          >
            <Toggle value="path" aria-label="Add project from path">
              Path
            </Toggle>
            <Toggle value="gitUrl" aria-label="Add project from Git URL">
              Git URL
            </Toggle>
          </ToggleGroup>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              size="sm"
              value={activeValue}
              onChange={(e) => {
                const nextValue = (e.target as HTMLInputElement).value;
                if (mode === "path") {
                  setPathValue(nextValue);
                } else {
                  setGitUrlValue(nextValue);
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={mode === "path" ? "Paste an absolute path" : "Paste a Git URL to clone"}
              disabled={isLoading}
              autoFocus
            />
            {isElectron && mode === "path" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void handleBrowse()}
                disabled={isLoading}
                className="h-7 shrink-0 text-[11px]"
              >
                Browse...
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/60">
            {mode === "path"
              ? "Track an existing local directory and initialize .factory/ if needed."
              : "Clone into the current Podium root, then initialize and open the project draft."}
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => void handleSubmit()}
              disabled={!activeValue.trim() || isLoading}
              className="h-7 gap-1.5 text-[11px]"
            >
              {isLoading && <LoaderIcon className="size-3 animate-spin" />}
              {mode === "path" ? "Add" : "Clone"}
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
