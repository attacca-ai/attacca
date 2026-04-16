import { scopeProjectRef, scopedProjectKey } from "@t3tools/client-runtime";
import { createFileRoute } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";
import { memo, useCallback, useEffect, useState } from "react";
import type { FactoryConfig, Gap, ScannedProject } from "@t3tools/contracts";
import { DEFAULT_MODEL_BY_PROVIDER, FACTORY_PROTOCOL_VERSION } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FactoryIcon,
  FolderPlusIcon,
  LoaderIcon,
  RefreshCwIcon,
  SendIcon,
  XIcon,
} from "lucide-react";

import { isElectron } from "../env";
import { readEnvironmentApi } from "../environmentApi";
import { ensureLocalApi } from "../localApi";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { useSettings, useUpdateSettings } from "../hooks/useSettings";
import { cn } from "~/lib/utils";
import { newCommandId, newProjectId } from "../lib/utils";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { PodiumIntakePopover } from "../components/PodiumIntakePopover";
import { ScrollArea } from "../components/ui/scroll-area";
import { SidebarTrigger } from "../components/ui/sidebar";
import { toastManager } from "../components/ui/toast";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { useFactoryStore } from "../stores/factory";
import {
  normalizeCwd,
  selectDiscoveredProjects,
  selectStalledProjects,
  selectTrackedProjects,
  usePodiumStore,
  type IntakeDeps,
  type ScanOptions,
} from "../stores/podium";
import { useUiStateStore } from "../uiStateStore";
import { getWsRpcClient } from "../rpc/wsRpcClient";

function defaultConfigFor(project: ScannedProject): FactoryConfig {
  const displayName = project.displayName || project.slug;
  return {
    version: FACTORY_PROTOCOL_VERSION,
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

function ProjectBadges({
  project,
  gapsExpanded,
  onToggleGaps,
}: {
  readonly project: ScannedProject;
  readonly gapsExpanded?: boolean;
  readonly onToggleGaps?: () => void;
}) {
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
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleGaps?.();
          }}
          className="inline-flex items-center gap-0.5"
        >
          <Badge variant="secondary" className="bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-400 hover:bg-amber-500/20 transition-colors">
            {gapsExpanded ? <ChevronDownIcon className="mr-0.5 size-2.5" /> : <ChevronRightIcon className="mr-0.5 size-2.5" />}
            {project.gapCount} {project.gapCount === 1 ? "gap" : "gaps"}
          </Badge>
        </button>
      ) : null}
      {project.assignedDev ? (
        <span className="text-[10px] text-muted-foreground/50">@{project.assignedDev}</span>
      ) : null}
    </div>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  high: "bg-red-500/10 text-red-400",
  medium: "bg-amber-500/10 text-amber-400",
  low: "bg-muted/50 text-muted-foreground/60",
};

function GapRow({
  gap,
  onDispatch,
  onDispatchAndOpen,
  isDispatching,
}: {
  readonly gap: Gap;
  readonly onDispatch: (gap: Gap) => void;
  readonly onDispatchAndOpen: (gap: Gap) => void;
  readonly isDispatching: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-2 rounded border border-border/30 bg-background/50 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className={cn("px-1 py-0 text-[9px]", SEVERITY_COLORS[gap.severity])}>
            {gap.severity}
          </Badge>
          <span className="text-[10px] font-medium text-foreground/70">{gap.category}</span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/60">{gap.message}</p>
        {gap.suggestedSkill ? (
          <p className="mt-0.5 text-[10px] text-muted-foreground/40">
            Skill: <code className="rounded bg-muted/30 px-0.5">{gap.suggestedSkill}</code>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onDispatch(gap);
          }}
          disabled={isDispatching}
          className="h-6 gap-1 px-1.5 text-[10px]"
          title="Add to work queue"
        >
          {isDispatching ? <LoaderIcon className="size-3 animate-spin" /> : <SendIcon className="size-3" />}
          Dispatch
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            onDispatchAndOpen(gap);
          }}
          disabled={isDispatching}
          className="h-6 gap-1 px-1.5 text-[10px]"
          title="Add to queue and open thread"
        >
          <ExternalLinkIcon className="size-3" />
        </Button>
      </div>
    </div>
  );
}

interface TrackedRowProps {
  readonly project: ScannedProject;
  readonly onOpen: (project: ScannedProject) => void;
  readonly onDispatchGap: (project: ScannedProject, gap: Gap) => Promise<boolean>;
  readonly onDispatchGapAndOpen: (project: ScannedProject, gap: Gap) => Promise<void>;
  readonly emphasized?: boolean;
  readonly isOpening?: boolean;
  readonly isDisabled?: boolean;
}

const TrackedRow = memo(function TrackedRow({
  project,
  onOpen,
  onDispatchGap,
  onDispatchGapAndOpen,
  emphasized = false,
  isOpening = false,
  isDisabled = false,
}: TrackedRowProps) {
  const [gapsExpanded, setGapsExpanded] = useState(false);
  const [dispatchingGap, setDispatchingGap] = useState<string | null>(null);

  const handleDispatch = useCallback(
    async (gap: Gap) => {
      setDispatchingGap(gap.category);
      try {
        await onDispatchGap(project, gap);
      } finally {
        setDispatchingGap(null);
      }
    },
    [onDispatchGap, project],
  );

  const handleDispatchAndOpen = useCallback(
    async (gap: Gap) => {
      setDispatchingGap(gap.category);
      try {
        await onDispatchGapAndOpen(project, gap);
      } finally {
        setDispatchingGap(null);
      }
    },
    [onDispatchGapAndOpen, project],
  );

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
        emphasized
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-border/50 bg-card/40",
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(project)}
        disabled={isDisabled}
        className={cn(
          "flex w-full flex-col gap-1.5 text-left transition-colors hover:opacity-80 disabled:cursor-wait disabled:opacity-60",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-foreground/90">
              {project.displayName}
            </p>
            <p className="truncate font-mono text-[10px] text-muted-foreground/50">{project.path}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/60">
            {isOpening ? <LoaderIcon className="size-3 animate-spin" /> : null}
            {formatRelativeTime(project.lastActivity)}
          </span>
        </div>
      </button>
      <ProjectBadges
        project={project}
        gapsExpanded={gapsExpanded}
        onToggleGaps={() => setGapsExpanded((v) => !v)}
      />
      {project.nextAction ? (
        <p className="text-[11px] leading-snug text-muted-foreground/70">
          <span className="text-muted-foreground/40">Next: </span>
          {project.nextAction}
        </p>
      ) : null}
      {gapsExpanded && project.gaps.length > 0 ? (
        <div className="mt-1 space-y-1">
          {project.gaps.map((g) => (
            <GapRow
              key={g.category}
              gap={g}
              onDispatch={handleDispatch}
              onDispatchAndOpen={handleDispatchAndOpen}
              isDispatching={dispatchingGap === g.category}
            />
          ))}
        </div>
      ) : null}
    </div>
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
  const tracked = usePodiumStore(useShallow(selectTrackedProjects));
  const discovered = usePodiumStore(useShallow(selectDiscoveredProjects));
  const stalled = usePodiumStore(useShallow(selectStalledProjects));
  const initializeFactory = useFactoryStore((s) => s.initializeFactory);
  const orchestrationProjects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const setProjectExpanded = useUiStateStore((s) => s.setProjectExpanded);
  const activeEnvironmentId = useStore((s) => s.activeEnvironmentId);
  const defaultThreadEnvMode = useSettings((s) => s.defaultThreadEnvMode);
  const podiumScanRootOverride = useSettings((s) => s.podiumScanRootOverride);
  const externalIntakeRoots = useSettings((s) => s.externalIntakeRoots);
  const { updateSettings } = useUpdateSettings();
  const { handleNewThread } = useHandleNewThread();
  const intakeProjectFromPath = usePodiumStore((s) => s.intakeProjectFromPath);
  const intakeStatus = usePodiumStore((s) => s.intakeStatus);
  const intakeError = usePodiumStore((s) => s.intakeError);

  const scanWarnings = usePodiumStore(useShallow((s) => s.scanWarnings));
  const scanRoots = usePodiumStore(useShallow((s) => s.scanRoots));

  const [initializingPath, setInitializingPath] = useState<string | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [dismissedWarnings, setDismissedWarnings] = useState(false);

  const handleIntake = useCallback(
    async (rawPath: string) => {
      if (!activeEnvironmentId) {
        toastManager.add({
          type: "error",
          title: "Cannot intake project",
          description: "No active environment.",
        });
        return;
      }
      const api = readEnvironmentApi(activeEnvironmentId);
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Cannot intake project",
          description: "Environment API unavailable.",
        });
        return;
      }

      const deps: IntakeDeps = {
        orchestrationProjects,
        activeEnvironmentId,
        dispatchProjectCreate: async (input) => {
          await api.orchestration.dispatchCommand({
            type: "project.create",
            commandId: newCommandId(),
            projectId: input.projectId,
            title: input.title,
            workspaceRoot: input.workspaceRoot,
            defaultModelSelection: {
              provider: "codex",
              model: DEFAULT_MODEL_BY_PROVIDER.codex,
            },
            createdAt: new Date().toISOString(),
          });
        },
        handleNewThread: async (ref, options) => {
          setProjectExpanded(scopedProjectKey(ref), true);
          await handleNewThread(ref, options);
        },
        externalIntakeRoots,
        podiumScanRoot: rootDir,
        updateSettings,
        defaultThreadEnvMode,
        confirm: async (message) => {
          try {
            return await ensureLocalApi().dialogs.confirm(message);
          } catch {
            return window.confirm(message);
          }
        },
        scopeProjectRef,
        newProjectId,
      };

      await intakeProjectFromPath(rawPath, deps);

      const state = usePodiumStore.getState();
      if (state.intakeError) {
        toastManager.add({
          type: "error",
          title: "Intake failed",
          description: state.intakeError,
        });
      }
    },
    [
      activeEnvironmentId,
      defaultThreadEnvMode,
      externalIntakeRoots,
      handleNewThread,
      intakeProjectFromPath,
      orchestrationProjects,
      rootDir,
      setProjectExpanded,
      updateSettings,
    ],
  );

  useEffect(() => {
    if (status === "idle") {
      const override = podiumScanRootOverride.trim();
      void scan({
        overrideRoot: override.length > 0 ? override : undefined,
        externalRoots: externalIntakeRoots,
      });
    }
  }, [status, scan, podiumScanRootOverride, externalIntakeRoots]);

  const handleOpenProject = useCallback(
    async (project: ScannedProject) => {
      if (openingPath) return;
      setOpeningPath(project.path);
      usePodiumStore.getState().setSelectedProjectPath(project.path);
      try {
        const wantedCwd = normalizeCwd(project.path);
        const match = orchestrationProjects.find((p) => normalizeCwd(p.cwd) === wantedCwd);

        // Already registered — expand the sidebar row and open a draft thread
        // for it. handleNewThread will reuse an existing draft if one exists
        // or create a new one.
        if (match) {
          const projectRef = scopeProjectRef(match.environmentId, match.id);
          setProjectExpanded(scopedProjectKey(projectRef), true);
          await handleNewThread(projectRef, { envMode: defaultThreadEnvMode });
          return;
        }

        // Not registered. Dispatch project.create with a local id, then
        // handleNewThread for a fresh draft. Mirrors Sidebar's addProjectFromPath
        // fire-and-forget pattern — we don't wait for the server event to
        // land in the read model; the local refs are authoritative for the
        // draft flow.
        if (!activeEnvironmentId) {
          toastManager.add({
            type: "error",
            title: `Cannot open ${project.displayName || project.slug}`,
            description: "No active environment.",
          });
          return;
        }
        const api = readEnvironmentApi(activeEnvironmentId);
        if (!api) {
          toastManager.add({
            type: "error",
            title: `Cannot open ${project.displayName || project.slug}`,
            description: "Environment API unavailable.",
          });
          return;
        }
        const projectId = newProjectId();
        const title = project.displayName || project.slug;
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: project.path,
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          createdAt: new Date().toISOString(),
        });
        const projectRef = scopeProjectRef(activeEnvironmentId, projectId);
        setProjectExpanded(scopedProjectKey(projectRef), true);
        await handleNewThread(projectRef, { envMode: defaultThreadEnvMode });
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: `Failed to open ${project.displayName || project.slug}`,
          description: cause instanceof Error ? cause.message : "Unknown error",
        });
      } finally {
        setOpeningPath(null);
      }
    },
    [
      activeEnvironmentId,
      defaultThreadEnvMode,
      handleNewThread,
      openingPath,
      orchestrationProjects,
      setProjectExpanded,
    ],
  );

  const refreshWithOverride = useCallback(() => {
    setDismissedWarnings(false);
    const override = podiumScanRootOverride.trim();
    return scan({
      overrideRoot: override.length > 0 ? override : undefined,
      externalRoots: externalIntakeRoots,
    });
  }, [podiumScanRootOverride, externalIntakeRoots, scan]);

  const handleInitialize = useCallback(
    async (project: ScannedProject) => {
      setInitializingPath(project.path);
      try {
        await initializeFactory(project.path, defaultConfigFor(project));
        await refreshWithOverride();
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
    [initializeFactory, refreshWithOverride],
  );

  const handleDispatchGap = useCallback(
    async (project: ScannedProject, gap: Gap): Promise<boolean> => {
      try {
        const allRoots = externalIntakeRoots.length > 0
          ? [...externalIntakeRoots, rootDir].filter(Boolean)
          : [rootDir].filter(Boolean);
        const result = await getWsRpcClient().factory.dispatchWorkPackage({
          projectPath: project.path,
          gap,
          allowedRoots: allRoots,
        });
        toastManager.add({
          type: "success",
          title: `Dispatched: ${result.workItem.title}`,
        });
        return true;
      } catch (cause) {
        toastManager.add({
          type: "error",
          title: "Dispatch failed",
          description: cause instanceof Error ? cause.message : "Unknown error",
        });
        return false;
      }
    },
    [externalIntakeRoots, rootDir],
  );

  const handleDispatchGapAndOpen = useCallback(
    async (project: ScannedProject, gap: Gap) => {
      const ok = await handleDispatchGap(project, gap);
      if (ok) await handleOpenProject(project);
    },
    [handleDispatchGap, handleOpenProject],
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
        <div className="flex items-center gap-1.5">
          <PodiumIntakePopover
            onIntake={handleIntake}
            isLoading={intakeStatus === "loading"}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refreshWithOverride()}
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

          {scanWarnings.length > 0 && !dismissedWarnings ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-400">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                {scanWarnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setDismissedWarnings(true)}
                className="shrink-0 rounded p-0.5 transition-colors hover:bg-amber-500/10"
                aria-label="Dismiss scan warnings"
              >
                <XIcon className="size-3.5" />
              </button>
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
                No projects found{scanRoots.length > 1
                  ? ` across ${scanRoots.length} scan roots`
                  : <> at <code className="rounded bg-muted/30 px-1">{rootDir}</code></>}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground/40">
                Check your scan root via the ATTACCA_PODIUM_ROOT env var or add intake roots in Settings.
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
                    onDispatchGap={handleDispatchGap}
                    onDispatchGapAndOpen={handleDispatchGapAndOpen}
                    emphasized
                    isOpening={openingPath === project.path}
                    isDisabled={openingPath !== null && openingPath !== project.path}
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
                    onDispatchGap={handleDispatchGap}
                    onDispatchGapAndOpen={handleDispatchGapAndOpen}
                    isOpening={openingPath === project.path}
                    isDisabled={openingPath !== null && openingPath !== project.path}
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
