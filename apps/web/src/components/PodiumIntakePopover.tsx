import { memo, useCallback, useRef, useState } from "react";
import { FolderPlusIcon, LoaderIcon } from "lucide-react";

import { isElectron } from "../env";
import { ensureLocalApi } from "../localApi";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "./ui/popover";

interface PodiumIntakePopoverProps {
  readonly onIntake: (rawPath: string) => Promise<void>;
  readonly isLoading: boolean;
}

export const PodiumIntakePopover = memo(function PodiumIntakePopover({
  onIntake,
  isLoading,
}: PodiumIntakePopoverProps) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = useCallback(async () => {
    if (!path.trim() || isLoading) return;
    await onIntake(path.trim());
    const hasError = (await import("../stores/podium")).usePodiumStore.getState().intakeError;
    if (!hasError) {
      setPath("");
      setOpen(false);
    }
  }, [path, isLoading, onIntake]);

  const handleBrowse = useCallback(async () => {
    try {
      const picked = await ensureLocalApi().dialogs.pickFolder();
      if (picked) {
        setPath(picked);
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
          <p className="text-[13px] font-medium text-foreground">Add project from path</p>
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              size="sm"
              value={path}
              onChange={(e) => setPath((e.target as HTMLInputElement).value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste an absolute path"
              disabled={isLoading}
              autoFocus
            />
            {isElectron && (
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
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => void handleSubmit()}
              disabled={!path.trim() || isLoading}
              className="h-7 gap-1.5 text-[11px]"
            >
              {isLoading && <LoaderIcon className="size-3 animate-spin" />}
              Add
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
