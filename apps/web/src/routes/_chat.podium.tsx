import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { memo, useCallback, useEffect, useState } from "react";
import type { FactoryConfig, ScannedProject } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  FactoryIcon,
  FolderPlusIcon,
  LoaderIcon,
  RefreshCwIcon,
} from "lucide-react";

import { isElectron } from "../env";
import { cn } from "~/lib/utils";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { SidebarTrigger } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { useFactoryStore } from "../stores/factory";
import {
  selectDiscoveredProjects,
  selectStalledProjects,
  selectTrackedProjects,
  usePodiumStore,
} from "../stores/podium";
import { useUiStateStore } from "../uiStateStore";

function defaultConfigFor(project: ScannedProject): FactoryConfig {
  const displayName = project.displayName || project.slug;
  return {
    name: project.slug,
    display_name: displayName,
    type: "greenfield",
    trust_tier: 2,
    phase: "IDEA",
    track: "software",
  };
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "never";
  const deltaMinutes = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (deltaMinutes < 1) return "just now";
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const hours = Math.floor(deltaMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function ProjectBadges({ project }: { readonly project: ScannedProject }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
        {project.phase}
      </Badge>
      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
        tier {project.trustTier}
      </Badge>
      <Badge
        variant="secondary"
        className={cn(
          "px-1.5 py-0 text-[10px]",
          project.health === "active" && "bg-emerald-500/10 text-emerald-400",
          project.health === "blocked" && "bg-red-500/10 text-red-400",
          project.health === "stalled" && "bg-amber-500/10 text-amber-400",
        )}
      >
        {project.health}
      </Badge>
      {project.gapCount > 0 ? (
        <Badge variant="secondary" className="bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-400">
          {project.gapCount} gaps
        </Badge>
      ) : null}
      {project.assignedDev ? (
        <span className="text-[10px] text-muted-foreground/50">@{project.assignedDev}</span>
      ) : null}
    </div>
  );
}

interface TrackedRowProps {
  readonly project: ScannedProject;
  readonly onOpen: (project: ScannedProject) => void;
  readonly emphasized?: boolean;
}

const TrackedRow = memo(function TrackedRow({
  project,
  onOpen,
  emphasized = false,
}: TrackedRowProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(project)}
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-card/70",
        emphasized
          ? "border-amber-500/40 bg-amber-500/5 hover:border-amber-500/60"
          : "border-border/50 bg-card/40 hover:border-border",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-foreground/90">
            {project.displayName}
          </p>
          <p className="truncate font-mono text-[10px] text-muted-foreground/50">{project.path}</p>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground/60">
          {formatRelativeTime(project.lastActivity)}
        </span>
      </div>
      <ProjectBadges project={project} />
      {project.nextAction ? (
        <p className="text-[11px] leading-snug text-muted-foreground/70">
          <span className="text-muted-foreground/40">Next: </span>
          {project.nextAction}
        </p>
      ) : null}
    </button>
  );
});

interface DiscoveredRowProps {
  readonly project: ScannedProject;
  readonly onInitialize: (project: ScannedProject) => void;
  readonly isInitializing: boolean;
}

const DiscoveredRow = memo(function DiscoveredRow({
  project,
  onInitialize,
  isInitializing,
}: DiscoveredRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-border/40 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-foreground/80">{project.slug}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground/40">{project.path}</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() => onInitialize(project)}
        disabled={isInitializing}
        className="h-7 shrink-0 gap-1.5 text-[11px]"
      >
        {isInitializing ? (
          <LoaderIcon className="size-3 animate-spin" />
        ) : (
          <FolderPlusIcon className="size-3" />
        )}
        Initialize
      </Button>
    </div>
  );
});

function PodiumRouteView() {
  const rootDir = usePodiumStore((s) => s.rootDir);
  const status = usePodiumStore((s) => s.status);
  const error = usePodiumStore((s) => s.error);
  const scan = usePodiumStore((s) => s.scan);
  const refresh = usePodiumStore((s) => s.refresh);
  const tracked = usePodiumStore(selectTrackedProjects);
  const discovered = usePodiumStore(selectDiscoveredProjects);
  const stalled = usePodiumStore(selectStalledProjects);
  const initializeFactory = useFactoryStore((s) => s.initializeFactory);
  const orchestrationProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const setProjectExpanded = useUiStateStore((s) => s.setProjectExpanded);
  const navigate = useNavigate();

  const [initializingPath, setInitializingPath] = useState<string | null>(null);

  useEffect(() => {
    if (status === "idle") {
      void scan();
    }
  }, [status, scan]);

  const handleOpenProject = useCallback(
    (project: ScannedProject) => {
      usePodiumStore.getState().setSelectedProjectPath(project.path);
      const match = orchestrationProjects.find(
        (p) => p.cwd === project.path || p.cwd === project.path.replace(/\\/g, "/"),
      );
      if (match) {
        setProjectExpanded(
          scopedProjectKey(scopeProjectRef(match.environmentId, match.id)),
          true,
        );
      }
      void navigate({ to: "/" });
    },
    [navigate, orchestrationProjects, setProjectExpanded],
  );

  const handleInitialize = useCallback(
    async (project: ScannedProject) => {
      setInitializingPath(project.path);
      try {
        await initializeFactory(project.path, defaultConfigFor(project));
        await refresh();
      } catch (error) {
        toastManager.add({
          type: "error",
          title: `Failed to initialize ${project.displayName || project.slug}`,
          description: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        setInitializingPath(null);
      }
    },
    [initializeFactory, refresh],
  );

  const isLoading = status === "loading";
  const hasProjects = tracked.length + discovered.length > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
      {!isElectron && (
        <header className="border-b border-border px-3 py-2 md:hidden">
          <div className="flex items-center gap-2">
            <SidebarTrigger className="size-7 shrink-0" />
            <span className="text-sm font-medium text-foreground">Podium</span>
          </div>
        </header>
      )}

      <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-border px-5">
        <div className="flex items-center gap-2">
          <FactoryIcon className="size-4 text-muted-foreground/60" />
          <span className="text-sm font-medium text-foreground">Podium</span>
          <span className="text-[11px] text-muted-foreground/50">{rootDir}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={isLoading}
          className="h-7 gap-1.5 text-[12px]"
          aria-label="Refresh scan"
        >
          {isLoading ? (
            <LoaderIcon className="size-3.5 animate-spin" />
          ) : (
            <RefreshCwIcon className="size-3.5" />
          )}
          Refresh
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-3xl space-y-6 px-5 py-5">
          {status === "error" ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/5 px-3 py-2 text-[12px] text-red-400">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">Failed to scan projects</p>
                <p className="text-red-400/80">{error ?? "Unknown error"}</p>
              </div>
            </div>
          ) : null}

          {isLoading && !hasProjects ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground/50">
              <LoaderIcon className="mr-2 size-4 animate-spin" />
              <span className="text-[13px]">Scanning {rootDir}...</span>
            </div>
          ) : null}

          {!isLoading && !hasProjects && status === "ready" ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FactoryIcon className="mb-2 size-6 text-muted-foreground/30" />
              <p className="text-[13px] text-muted-foreground/60">
                No projects found at <code className="rounded bg-muted/30 px-1">{rootDir}</code>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/40">
                Check your scan root via the ATTACCA_PODIUM_ROOT env var.
              </p>
            </div>
          ) : null}

          {stalled.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-semibold tracking-widest text-amber-400/80 uppercase">
                  Needs attention
                </h2>
                <span className="text-[10px] text-muted-foreground/40">{stalled.length}</span>
              </div>
              <div className="space-y-1.5">
                {stalled.map((project) => (
                  <TrackedRow
                    key={`stalled-${project.path}`}
                    project={project}
                    onOpen={handleOpenProject}
                    emphasized
                  />
                ))}
              </div>
            </section>
          ) : null}

          {tracked.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-semibold tracking-widest text-muted-foreground/50 uppercase">
                  Tracked
                </h2>
                <span className="text-[10px] text-muted-foreground/40">{tracked.length}</span>
              </div>
              <div className="space-y-1.5">
                {tracked.map((project) => (
                  <TrackedRow
                    key={project.path}
                    project={project}
                    onOpen={handleOpenProject}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {discovered.length > 0 ? (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-semibold tracking-widest text-muted-foreground/50 uppercase">
                  Discovered
                </h2>
                <span className="text-[10px] text-muted-foreground/40">{discovered.length}</span>
              </div>
              <div className="space-y-1.5">
                {discovered.map((project) => (
                  <DiscoveredRow
                    key={project.path}
                    project={project}
                    onInitialize={handleInitialize}
                    isInitializing={initializingPath === project.path}
                  />
                ))}
              </div>
              <p className="pt-1 text-[10px] text-muted-foreground/40">
                Set ATTACCA_PODIUM_EXCLUDE (comma-separated) to hide noisy directories.
              </p>
            </section>
          ) : null}

        </div>
      </ScrollArea>
    </div>
  );
}

export const Route = createFileRoute("/_chat/podium")({
  component: PodiumRouteView,
});
