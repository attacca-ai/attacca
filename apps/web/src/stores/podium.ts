/**
 * Podium store — cross-project factory view.
 *
 * Holds the latest scan result keyed by root directory. Kept separate from
 * the factory store so the two concerns don't contaminate each other: factory
 * store is per-project state, podium store is cross-project discovery.
 *
 * The root directory is resolved server-side via factory.scanProjects (which
 * falls back to ATTACCA_PODIUM_ROOT or ~/projects when the client passes no
 * override). The store just surfaces whatever the server reports.
 */

import {
  FACTORY_PROTOCOL_VERSION,
  type EnvironmentId,
  type FactoryConfig,
  type ProjectId,
  type ScannedProject,
  type ScopedProjectRef,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "../wsRpcClient";

// ---------------------------------------------------------------------------
// Helpers shared with _chat.podium.tsx
// ---------------------------------------------------------------------------

export function normalizeCwd(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function getParentDir(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash > 0 ? normalized.substring(0, lastSlash) : normalized;
}

function isPathUnderRoots(
  normalizedPath: string,
  roots: ReadonlyArray<string>,
): boolean {
  return roots.some((root) => {
    const nr = normalizeCwd(root);
    return normalizedPath === nr || normalizedPath.startsWith(nr + "/");
  });
}

// ---------------------------------------------------------------------------
// Intake deps — things only available in component context
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
    options?: { envMode?: "local" | "worktree" },
  ) => Promise<void>;
  readonly externalIntakeRoots: ReadonlyArray<string>;
  readonly podiumScanRoot: string;
  readonly updateSettings: (patch: { externalIntakeRoots: ReadonlyArray<string> }) => void;
  readonly defaultThreadEnvMode: "local" | "worktree";
  readonly confirm: (message: string) => Promise<boolean>;
  readonly scopeProjectRef: (environmentId: EnvironmentId, projectId: ProjectId) => ScopedProjectRef;
  readonly newProjectId: () => ProjectId;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface PodiumState {
  readonly rootDir: string;
  readonly rootSource: "env" | "default" | "override" | null;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly projects: ReadonlyArray<ScannedProject>;
  readonly error: string | null;
  readonly loadedAt: number | null;
  readonly selectedProjectPath: string | null;
  readonly intakeStatus: "idle" | "loading" | "error";
  readonly intakeError: string | null;
  readonly scan: (rootDir?: string) => Promise<ReadonlyArray<ScannedProject>>;
  readonly refresh: () => Promise<ReadonlyArray<ScannedProject>>;
  readonly setSelectedProjectPath: (projectPath: string | null) => void;
  readonly intakeProjectFromPath: (rawPath: string, deps: IntakeDeps) => Promise<void>;
}

export const usePodiumStore = create<PodiumState>((set, get) => ({
  rootDir: "",
  rootSource: null,
  status: "idle",
  projects: [],
  error: null,
  loadedAt: null,
  selectedProjectPath: null,
  intakeStatus: "idle",
  intakeError: null,

  scan: async (overrideRoot) => {
    const client = getWsRpcClient();
    set({ status: "loading", error: null });
    try {
      // Resolve the root source tag from the server on the first call so the
      // UI can show "from env var" vs "default" without a second round-trip.
      let rootSource = get().rootSource;
      if (rootSource === null && overrideRoot === undefined) {
        const rootInfo = await client.factory.getPodiumRoot();
        rootSource = rootInfo.source;
      } else if (overrideRoot !== undefined) {
        rootSource = "override";
      }

      const result = await client.factory.scanProjects(
        overrideRoot !== undefined ? { rootDir: overrideRoot } : {},
      );
      set({
        rootDir: result.rootDir,
        rootSource,
        status: "ready",
        projects: result.projects,
        error: null,
        loadedAt: Date.now(),
      });
      return result.projects;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to scan projects";
      set({ status: "error", error: message });
      return [];
    }
  },

  refresh: async () => get().scan(),

  setSelectedProjectPath: (projectPath) => {
    set({ selectedProjectPath: projectPath });
  },

  intakeProjectFromPath: async (rawPath, deps) => {
    const trimmed = rawPath.trim();
    if (!trimmed) return;
    if (get().intakeStatus === "loading") return;

    set({ intakeStatus: "loading", intakeError: null });

    try {
      const wantedCwd = normalizeCwd(trimmed);

      // ── Duplicate check ──────────────────────────────────────
      const existing = deps.orchestrationProjects.find(
        (p) => normalizeCwd(p.cwd) === wantedCwd,
      );
      if (existing) {
        const ref = deps.scopeProjectRef(existing.environmentId, existing.id);
        await deps.handleNewThread(ref, { envMode: deps.defaultThreadEnvMode });
        set({ intakeStatus: "idle" });
        return;
      }

      // ── Allowlist check ──────────────────────────────────────
      const allRoots = deps.podiumScanRoot
        ? [...deps.externalIntakeRoots, deps.podiumScanRoot]
        : [...deps.externalIntakeRoots];

      if (!isPathUnderRoots(wantedCwd, allRoots)) {
        const parentDir = getParentDir(trimmed);
        const confirmed = await deps.confirm(
          `Add "${parentDir}" to intake roots? Attacca will be able to write .factory/ metadata in any project under this directory.`,
        );
        if (!confirmed) {
          set({ intakeStatus: "idle", intakeError: "Intake cancelled" });
          return;
        }
        const updatedRoots = [...deps.externalIntakeRoots, parentDir];
        deps.updateSettings({ externalIntakeRoots: updatedRoots });
      }

      // ── project.create ───────────────────────────────────────
      const projectId = deps.newProjectId();
      const slug = trimmed.split(/[/\\]/).filter(Boolean).pop() ?? trimmed;
      await deps.dispatchProjectCreate({
        projectId,
        title: slug,
        workspaceRoot: trimmed,
      });

      // ── factory.initialize ───────────────────────────────────
      const client = getWsRpcClient();
      const currentRoots = deps.podiumScanRoot
        ? [...deps.externalIntakeRoots, deps.podiumScanRoot]
        : [...deps.externalIntakeRoots];
      // Include the parent we may have just added
      const parentDir = getParentDir(trimmed);
      const rootsForRpc = isPathUnderRoots(normalizeCwd(trimmed), currentRoots)
        ? currentRoots
        : [...currentRoots, parentDir];

      const config: FactoryConfig = {
        version: FACTORY_PROTOCOL_VERSION,
        name: slug,
        display_name: slug,
        type: "greenfield",
        trust_tier: 2,
        phase: "IDEA",
        track: "software",
      };
      await client.factory.initialize({
        projectPath: trimmed,
        config,
        allowedRoots: rootsForRpc,
      });

      // ── Open draft thread ────────────────────────────────────
      const ref = deps.scopeProjectRef(deps.activeEnvironmentId, projectId);
      await deps.handleNewThread(ref, { envMode: deps.defaultThreadEnvMode });

      set({ intakeStatus: "idle", intakeError: null });
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Intake failed";
      set({ intakeStatus: "error", intakeError: message });
    }
  },
}));

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const STALLED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export function selectTrackedProjects(state: PodiumState): ReadonlyArray<ScannedProject> {
  return [...state.projects]
    .filter((p) => p.hasFactory)
    .sort((a, b) => {
      const aTime = a.lastActivity ? Date.parse(a.lastActivity) : 0;
      const bTime = b.lastActivity ? Date.parse(b.lastActivity) : 0;
      return bTime - aTime;
    });
}

export function selectDiscoveredProjects(
  state: PodiumState,
): ReadonlyArray<ScannedProject> {
  return state.projects
    .filter((p) => !p.hasFactory)
    .slice()
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function selectStalledProjects(state: PodiumState): ReadonlyArray<ScannedProject> {
  const now = Date.now();
  return selectTrackedProjects(state).filter((p) => {
    if (p.gapCount > 0) return true;
    // Missing or unparseable lastActivity is treated as "don't know" — not
    // stalled. Otherwise freshly-initialized projects and legacy configs
    // would appear permanently stalled, contradicting spec scenario 1.
    if (!p.lastActivity) return false;
    const last = Date.parse(p.lastActivity);
    if (!Number.isFinite(last)) return false;
    return now - last > STALLED_THRESHOLD_MS;
  });
}
