import { memo, useEffect } from "react";
import type { FactoryDirectory, SessionLog, WorkItem } from "@t3tools/contracts";
import { FactoryIcon, LoaderIcon, PanelRightCloseIcon, RefreshCwIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { useFactoryStore } from "../stores/factory";

interface FactoryPanelProps {
  readonly projectPath: string | null;
  readonly onClose: () => void;
}

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function priorityBadgeClass(priority: WorkItem["priority"]): string {
  switch (priority) {
    case "high":
      return "bg-red-500/10 text-red-400";
    case "medium":
      return "bg-amber-500/10 text-amber-400";
    case "low":
      return "bg-muted/40 text-muted-foreground/70";
  }
}

function statusBadgeClass(status: WorkItem["status"]): string {
  switch (status) {
    case "in_progress":
      return "bg-blue-500/10 text-blue-400";
    case "done":
      return "bg-emerald-500/10 text-emerald-400";
    case "blocked":
      return "bg-red-500/10 text-red-400";
    case "pending":
    default:
      return "bg-muted/30 text-muted-foreground/60";
  }
}

function sortedQueueItems(directory: FactoryDirectory): ReadonlyArray<WorkItem> {
  if (!directory.queue) return [];
  return [...directory.queue.items].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority],
  );
}

function SectionHeading({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
      {children}
    </p>
  );
}

function ConfigSection({ directory }: { readonly directory: FactoryDirectory }) {
  const config = directory.config;
  const status = directory.status;
  if (!config) {
    return (
      <p className="text-[12px] text-muted-foreground/60">
        No <code className="rounded bg-muted/30 px-1">.factory/config.yaml</code> found.
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <SectionHeading>Project</SectionHeading>
      <p className="text-[13px] font-medium text-foreground/90">{config.display_name}</p>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {config.phase}
        </Badge>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          tier {config.trust_tier}
        </Badge>
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
          {config.type}
        </Badge>
        {status ? (
          <Badge
            variant="secondary"
            className={cn(
              "px-1.5 py-0 text-[10px]",
              status.health === "active" && "bg-emerald-500/10 text-emerald-400",
              status.health === "blocked" && "bg-red-500/10 text-red-400",
              status.health === "stalled" && "bg-amber-500/10 text-amber-400",
            )}
          >
            {status.health}
          </Badge>
        ) : null}
      </div>
      {status?.next_action ? (
        <p className="pt-1 text-[12px] leading-snug text-muted-foreground/80">
          <span className="text-muted-foreground/40">Next: </span>
          {status.next_action}
        </p>
      ) : null}
    </div>
  );
}

function WorkQueueSection({ directory }: { readonly directory: FactoryDirectory }) {
  const items = sortedQueueItems(directory);
  return (
    <div className="space-y-1.5">
      <SectionHeading>Work Queue</SectionHeading>
      {items.length === 0 ? (
        <p className="text-[12px] text-muted-foreground/50">No pending work items.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-border/40 bg-background/40 px-2.5 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] leading-snug text-foreground/90">{item.title}</p>
                <span
                  className={cn(
                    "shrink-0 rounded px-1 py-px text-[9px] font-semibold tracking-wide uppercase",
                    priorityBadgeClass(item.priority),
                  )}
                >
                  {item.priority}
                </span>
              </div>
              {item.description ? (
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
                  {item.description}
                </p>
              ) : null}
              <div className="mt-1.5 flex items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1 py-px text-[9px] font-semibold tracking-wide uppercase",
                    statusBadgeClass(item.status),
                  )}
                >
                  {item.status.replace("_", " ")}
                </span>
                {item.spec_section ? (
                  <span className="text-[10px] text-muted-foreground/40">
                    {item.spec_section}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SessionInfoSection({ session }: { readonly session: SessionLog | null }) {
  if (!session) {
    return (
      <div className="space-y-1.5">
        <SectionHeading>Latest Session</SectionHeading>
        <p className="text-[12px] text-muted-foreground/50">No sessions logged yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      <SectionHeading>Latest Session</SectionHeading>
      <p className="text-[12px] text-foreground/80">
        <span className="text-muted-foreground/50">{session.session_id}</span>
      </p>
      {session.notes ? (
        <p className="text-[12px] leading-snug text-muted-foreground/80">{session.notes}</p>
      ) : null}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground/60">
        {session.duration_minutes != null ? (
          <span>{session.duration_minutes} min</span>
        ) : null}
        {session.files_changed != null ? <span>{session.files_changed} files</span> : null}
        {session.tests_passed != null && session.tests_run != null ? (
          <span>
            {session.tests_passed}/{session.tests_run} tests
          </span>
        ) : null}
      </div>
    </div>
  );
}

const FactoryPanel = memo(function FactoryPanel({ projectPath, onClose }: FactoryPanelProps) {
  const entry = useFactoryStore((state) =>
    projectPath ? (state.entries[projectPath] ?? null) : null,
  );
  const loadFactory = useFactoryStore((state) => state.loadFactory);
  const regenerateClaudeMd = useFactoryStore((state) => state.regenerateClaudeMd);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    void (async () => {
      const directory = await loadFactory(projectPath);
      if (cancelled) return;
      if (directory?.exists && directory.config) {
        await regenerateClaudeMd(projectPath);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectPath, loadFactory, regenerateClaudeMd]);

  const handleRefresh = async () => {
    if (!projectPath) return;
    const directory = await loadFactory(projectPath);
    if (directory?.exists && directory.config) {
      await regenerateClaudeMd(projectPath);
    }
  };

  const directory = entry?.directory ?? null;
  const isLoading = entry?.status === "loading";
  const latestSession = directory?.sessions[0] ?? null;
  const claudeMdGeneratedAt = entry?.claudeMdGeneratedAt ?? null;
  const claudeMdError = entry?.claudeMdError ?? null;

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-border/70 bg-card/50">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="rounded-md bg-purple-500/10 px-1.5 py-0 text-[10px] font-semibold tracking-wide text-purple-400 uppercase"
          >
            Factory
          </Badge>
          {isLoading ? <LoaderIcon className="size-3 animate-spin text-muted-foreground/50" /> : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => void handleRefresh()}
            disabled={!projectPath || isLoading}
            aria-label="Refresh factory"
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            <RefreshCwIcon className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={onClose}
            aria-label="Close factory panel"
            className="text-muted-foreground/50 hover:text-foreground/70"
          >
            <PanelRightCloseIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-4 p-3">
          {!projectPath ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FactoryIcon className="mb-2 size-5 text-muted-foreground/30" />
              <p className="text-[13px] text-muted-foreground/40">No active project.</p>
            </div>
          ) : entry?.status === "error" ? (
            <div className="space-y-2">
              <p className="text-[12px] text-red-400">{entry.error ?? "Failed to load .factory/"}</p>
              <Button size="sm" variant="outline" onClick={handleRefresh}>
                Retry
              </Button>
            </div>
          ) : !directory || (!directory.exists && !isLoading) ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FactoryIcon className="mb-2 size-5 text-muted-foreground/30" />
              <p className="text-[13px] text-muted-foreground/50">
                No <code className="rounded bg-muted/30 px-1">.factory/</code> directory in this
                project.
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/30">
                Initialize one to enable Stand mode.
              </p>
            </div>
          ) : (
            <>
              <ConfigSection directory={directory} />
              <WorkQueueSection directory={directory} />
              <SessionInfoSection session={latestSession} />
              {claudeMdError ? (
                <p className="text-[11px] text-red-400/80">
                  CLAUDE.md: {claudeMdError}
                </p>
              ) : claudeMdGeneratedAt ? (
                <p className="text-[10px] text-muted-foreground/40">
                  CLAUDE.md regenerated {new Date(claudeMdGeneratedAt).toLocaleTimeString()}
                </p>
              ) : null}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

export default FactoryPanel;
export type { FactoryPanelProps };
