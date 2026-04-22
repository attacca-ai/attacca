/**
 * Podium store: cross-project factory view.
 *
 * Holds the latest scan result keyed by root directory. Kept separate from
 * the factory store so the two concerns do not contaminate each other:
 * factory store is per-project state, podium store is cross-project discovery.
 *
 * The root directory is resolved server-side via factory.scanProjects (which
 * falls back to ATTACCA_PODIUM_ROOT or ~/projects when the client passes no
 * override). The store just surfaces whatever the server reports.
 */

import {
  FACTORY_PROTOCOL_VERSION,
  STALLED_THRESHOLD_MS,
  type EnvironmentId,
  type FactoryConfig,
  type ProjectId,
  type ProjectType,
  type ScannedProject,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "../rpc/wsRpcClient";

// ---------------------------------------------------------------------------
// Helpers shared with _chat.podium.tsx
// ---------------------------------------------------------------------------

export function normalizeCwd(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function compareProjectSlug(a: ScannedProject, b: ScannedProject): number {
  return a.slug.localeCompare(b.slug);
}

function getProjectNameFromPath(rawPath: string): string {
  return rawPath.split(/[/\\]/).findLast((part) => part.length > 0) ?? rawPath;
}

function getParentDir(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
}

function isPathUnderRoots(normalizedPath: string, roots: ReadonlyArray<string>): boolean {
  return roots.some((root) => {
    const normalizedRoot = normalizeCwd(root);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/");
  });
}

export function buildIntakePresetPrompt(
  projectName: string,
  projectType: ProjectType | null,
): string {
  if (projectType === "brownfield") {
    return [
      `Project: ${projectName}.`,
      "This project already has code on disk. Map the existing system before planning changes.",
      "Start with /attacca-forge:codebase-discovery and capture the findings in the .factory docs.",
    ].join("\n\n");
  }

  return [
    `Project: ${projectName}.`,
    "This project is effectively greenfield. Draft the initial specification and execution plan before implementation work begins.",
    "Start with /attacca-forge:spec-writer and use it to seed the .factory project docs.",
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Intake deps: things only available in component context
// ---------------------------------------------------------------------------

export interface IntakeDeps {
  readonly orchestrationProjects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly cwd: string;
  }>;
  readonly activeEnvironmentId: EnvironmentId;
  readonly dispatchProjectCreate: (input: {
    projectId: ProjectId;
    title: string;
    workspaceRoot: string;
  }) => Promise<void>;
  readonly handleNewThread: (
    projectRef: ScopedProjectRef,
    options?: { envMode?: "local" | "worktree"; presetPrompt?: string | null },
  ) => Promise<void>;
  readonly externalIntakeRoots: ReadonlyArray<string>;
  readonly podiumScanRoot: string;
  readonly updateSettings: (patch: { externalIntakeRoots: ReadonlyArray<string> }) => void;
  readonly defaultThreadEnvMode: "local" | "worktree";
  readonly confirm: (message: string) => Promise<boolean>;
  readonly scopeProjectRef: (
    environmentId: EnvironmentId,
    projectId: ProjectId,
  ) => ScopedProjectRef;
  readonly newProjectId: () => ProjectId;
}

export interface PodiumIntakeRequest {
  readonly kind: "path" | "gitUrl";
  readonly value: string;
}

function getAllowedRootsForIntake(deps: IntakeDeps): ReadonlyArray<string> {
  return deps.podiumScanRoot
    ? [...deps.externalIntakeRoots, deps.podiumScanRoot]
    : [...deps.externalIntakeRoots];
}

async function performPathIntake(rawPath: string, deps: IntakeDeps): Promise<void> {
  const trimmed = rawPath.trim();
  if (!trimmed) return;

  const wantedCwd = normalizeCwd(trimmed);
  const client = getWsRpcClient();
  const initialSummary = await client.factory.readSummary({ projectPath: trimmed });
  const projectName = initialSummary.config?.display_name ?? getProjectNameFromPath(trimmed);

  const existing = deps.orchestrationProjects.find(
    (project) => normalizeCwd(project.cwd) === wantedCwd,
  );
  if (existing && initialSummary.config) {
    const ref = deps.scopeProjectRef(existing.environmentId, existing.id);
    await deps.handleNewThread(ref, {
      envMode: deps.defaultThreadEnvMode,
      presetPrompt: buildIntakePresetPrompt(projectName, initialSummary.config.type),
    });
    return;
  }

  const allRoots = getAllowedRootsForIntake(deps);
  if (!isPathUnderRoots(wantedCwd, allRoots)) {
    const parentDir = getParentDir(trimmed);
    const confirmed = await deps.confirm(
      `Add "${parentDir}" to intake roots? Attacca will be able to write .factory/ metadata in any project under this directory.`,
    );
    if (!confirmed) {
      throw new Error("Intake cancelled");
    }
    deps.updateSettings({ externalIntakeRoots: [...deps.externalIntakeRoots, parentDir] });
  }

  const projectId = existing?.id ?? deps.newProjectId();
  if (!existing) {
    await deps.dispatchProjectCreate({
      projectId,
      title: projectName,
      workspaceRoot: trimmed,
    });
  }

  const currentRoots = getAllowedRootsForIntake(deps);
  const parentDir = getParentDir(trimmed);
  const rootsForRpc = isPathUnderRoots(normalizeCwd(trimmed), currentRoots)
    ? currentRoots
    : [...currentRoots, parentDir];

  const config: FactoryConfig = {
    version: FACTORY_PROTOCOL_VERSION,
    name: projectName,
    display_name: projectName,
    type: "greenfield",
    trust_tier: 2,
    phase: "IDEA",
    track: "software",
  };
  await client.factory.initialize({
    projectPath: trimmed,
    config,
    autoDetectType: true,
    allowedRoots: rootsForRpc,
  });

  const summary =
    initialSummary.config !== null
      ? initialSummary
      : await client.factory.readSummary({ projectPath: trimmed });
  const presetPrompt = buildIntakePresetPrompt(projectName, summary.config?.type ?? null);

  const ref = deps.scopeProjectRef(existing?.environmentId ?? deps.activeEnvironmentId, projectId);
  await deps.handleNewThread(ref, {
    envMode: deps.defaultThreadEnvMode,
    presetPrompt,
  });
}

async function performGitUrlIntake(rawUrl: string, deps: IntakeDeps): Promise<void> {
  const trimmed = rawUrl.trim();
  if (!trimmed) return;
  if (!deps.podiumScanRoot.trim()) {
    throw new Error("Podium root is unavailable. Refresh Podium and try again.");
  }

  const cloneResult = await getWsRpcClient().git.cloneRepository({
    url: trimmed,
    destinationParent: deps.podiumScanRoot,
    allowedRoots: getAllowedRootsForIntake(deps),
  });

  await performPathIntake(cloneResult.projectPath, deps);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface ScanOptions {
  readonly overrideRoot?: string | undefined;
  readonly externalRoots?: ReadonlyArray<string> | undefined;
}

interface PodiumState {
  readonly rootDir: string;
  readonly rootSource: "env" | "default" | "override" | null;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly projects: ReadonlyArray<ScannedProject>;
  readonly error: string | null;
  readonly loadedAt: number | null;
  readonly selectedProjectPath: string | null;
  readonly scanRoots: ReadonlyArray<string>;
  readonly scanWarnings: ReadonlyArray<string>;
  readonly intakeStatus: "idle" | "loading" | "error";
  readonly intakeError: string | null;
  readonly scan: (options?: ScanOptions) => Promise<ReadonlyArray<ScannedProject>>;
  readonly refresh: () => Promise<ReadonlyArray<ScannedProject>>;
  readonly setSelectedProjectPath: (projectPath: string | null) => void;
  readonly intakeProjectFromPath: (rawPath: string, deps: IntakeDeps) => Promise<void>;
  readonly intakeProjectFromGitUrl: (rawUrl: string, deps: IntakeDeps) => Promise<void>;
}

function formatRejectedScanWarning(root: string, cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  return message.length > 0 ? `Could not scan ${root} (${message}).` : `Could not scan ${root}.`;
}

async function runIntakeOperation(
  get: () => PodiumState,
  set: (partial: Partial<PodiumState>) => void,
  operation: () => Promise<void>,
): Promise<void> {
  if (get().intakeStatus === "loading") return;

  set({ intakeStatus: "loading", intakeError: null });
  try {
    await operation();
    set({ intakeStatus: "idle", intakeError: null });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Intake failed";
    set({ intakeStatus: "error", intakeError: message });
  }
}

/** Retained across calls so refresh() can replay the last scan config. */
let _lastScanOptions: ScanOptions | null = null;

export const usePodiumStore = create<PodiumState>((set, get) => ({
  rootDir: "",
  rootSource: null,
  status: "idle",
  projects: [],
  error: null,
  loadedAt: null,
  selectedProjectPath: null,
  scanRoots: [],
  scanWarnings: [],
  intakeStatus: "idle",
  intakeError: null,

  scan: async (options) => {
    const client = getWsRpcClient();
    const overrideRoot = options?.overrideRoot;
    const externalRoots = options?.externalRoots ?? [];
    _lastScanOptions = options ?? null;

    set({ status: "loading", error: null, scanWarnings: [] });
    try {
      let rootSource = get().rootSource;
      if (rootSource === null && overrideRoot === undefined) {
        const rootInfo = await client.factory.getPodiumRoot();
        rootSource = rootInfo.source;
      } else if (overrideRoot !== undefined) {
        rootSource = "override";
      }

      const primaryResult = await client.factory.scanProjects(
        overrideRoot !== undefined ? { rootDir: overrideRoot } : {},
      );

      const primaryRootDir = primaryResult.rootDir;
      const scanRoots: string[] = [primaryRootDir];
      const warnings: string[] = primaryResult.warning ? [primaryResult.warning] : [];

      const seen = new Map<string, ScannedProject>();
      for (const project of primaryResult.projects) {
        seen.set(normalizeCwd(project.path), project);
      }

      const normalizedPrimary = normalizeCwd(primaryRootDir);
      const uniqueExternalRoots = externalRoots.filter(
        (root) => normalizeCwd(root) !== normalizedPrimary,
      );

      if (uniqueExternalRoots.length > 0) {
        const results = await Promise.allSettled(
          uniqueExternalRoots.map((root) => client.factory.scanProjects({ rootDir: root })),
        );

        for (let i = 0; i < results.length; i++) {
          const root = uniqueExternalRoots[i]!;
          scanRoots.push(root);
          const result = results[i]!;

          if (result.status === "rejected") {
            warnings.push(formatRejectedScanWarning(root, result.reason));
            continue;
          }

          if (result.value.warning) {
            warnings.push(result.value.warning);
            continue;
          }

          for (const project of result.value.projects) {
            const key = normalizeCwd(project.path);
            if (!seen.has(key)) {
              seen.set(key, project);
            }
          }
        }
      }

      const mergedProjects = Array.from(seen.values());
      set({
        rootDir: primaryRootDir,
        rootSource,
        status: "ready",
        projects: mergedProjects,
        error: null,
        loadedAt: Date.now(),
        scanRoots,
        scanWarnings: warnings,
      });
      return mergedProjects;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to scan projects";
      set({ status: "error", error: message });
      return [];
    }
  },

  refresh: async () => get().scan(_lastScanOptions ?? undefined),

  setSelectedProjectPath: (projectPath) => {
    set({ selectedProjectPath: projectPath });
  },

  intakeProjectFromPath: async (rawPath, deps) =>
    runIntakeOperation(get, set, () => performPathIntake(rawPath, deps)),

  intakeProjectFromGitUrl: async (rawUrl, deps) =>
    runIntakeOperation(get, set, () => performGitUrlIntake(rawUrl, deps)),
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function selectTrackedProjects(state: PodiumState): ReadonlyArray<ScannedProject> {
  return state.projects
    .filter((project) => project.hasFactory)
    .toSorted((a, b) => {
      const aTime = a.lastActivity ? Date.parse(a.lastActivity) : 0;
      const bTime = b.lastActivity ? Date.parse(b.lastActivity) : 0;
      return bTime - aTime;
    });
}

export function selectDiscoveredProjects(state: PodiumState): ReadonlyArray<ScannedProject> {
  return state.projects.filter((project) => !project.hasFactory).toSorted(compareProjectSlug);
}

export function partitionDiscoveredProjects(
  discoveredProjects: ReadonlyArray<ScannedProject>,
  dismissedPaths: ReadonlyArray<string>,
): {
  readonly visibleProjects: ReadonlyArray<ScannedProject>;
  readonly dismissedProjects: ReadonlyArray<ScannedProject>;
} {
  const dismissed = new Set(dismissedPaths.map(normalizeCwd));
  const visibleProjects: ScannedProject[] = [];
  const dismissedProjects: ScannedProject[] = [];

  for (const project of discoveredProjects) {
    if (dismissed.has(normalizeCwd(project.path))) {
      dismissedProjects.push(project);
    } else {
      visibleProjects.push(project);
    }
  }

  return {
    visibleProjects: visibleProjects.toSorted(compareProjectSlug),
    dismissedProjects: dismissedProjects.toSorted(compareProjectSlug),
  };
}

export function selectStalledProjects(state: PodiumState): ReadonlyArray<ScannedProject> {
  const now = Date.now();
  return selectTrackedProjects(state).filter((project) => {
    if (project.gaps.length > 0) return true;
    if (!project.lastActivity) return false;
    const last = Date.parse(project.lastActivity);
    if (!Number.isFinite(last)) return false;
    return now - last > STALLED_THRESHOLD_MS;
  });
}

const GAP_SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function selectProjectsByGapSeverity(state: PodiumState): ReadonlyArray<ScannedProject> {
  return selectTrackedProjects(state)
    .filter((project) => project.gaps.length > 0)
    .toSorted((a, b) => {
      const aMax = Math.min(...a.gaps.map((gap) => GAP_SEVERITY_ORDER[gap.severity] ?? 3));
      const bMax = Math.min(...b.gaps.map((gap) => GAP_SEVERITY_ORDER[gap.severity] ?? 3));
      if (aMax !== bMax) return aMax - bMax;
      return b.gaps.length - a.gaps.length;
    });
}
