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
  STALLED_THRESHOLD_MS,
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

export interface ScanOptions {
  readonly overrideRoot?: string | undefined;
  readonly externalRoots?: ReadonlyArray<string> | undefined;
}

/** Retained across calls so `refresh()` can replay the last scan config. */
let _lastScanOptions: ScanOptions | null = null;

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
}

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
      // Resolve the root source tag from the server on the first call so the
      // UI can show "from env var" vs "default" without a second round-trip.
      let rootSource = get().rootSource;
      if (rootSource === null && overrideRoot === undefined) {
        const rootInfo = await client.factory.getPodiumRoot();
        rootSource = rootInfo.source;
      } else if (overrideRoot !== undefined) {
        rootSource = "override";
      }

      // ── Primary scan ────────────────────────────────────────────
      const primaryResult = await client.factory.scanProjects(
        overrideRoot !== undefined ? { rootDir: overrideRoot } : {},
      );

      const primaryRootDir = primaryResult.rootDir;
      const scanRoots: string[] = [primaryRootDir];
      const warnings: string[] = [];

      // Dedup map — primary projects get first-writer advantage
      const seen = new Map<string, ScannedProject>();
      for (const p of primaryResult.projects) {
        seen.set(normalizeCwd(p.path), p);
      }

      // ── External root scans (parallel) ──────────────────────────
      const normalizedPrimary = normalizeCwd(primaryRootDir);
      const uniqueExternalRoots = externalRoots.filter(
        (root) => normalizeCwd(root) !== normalizedPrimary,
      );

      if (uniqueExternalRoots.length > 0) {
        const results = await Promise.allSettled(
          uniqueExternalRoots.map((root) =>
            client.factory.scanProjects({ rootDir: root }),
          ),
        );

        for (let i = 0; i < results.length; i++) {
          const root = uniqueExternalRoots[i]!;
          scanRoots.push(root);
          const result = results[i]!;

          if (result.status === "rejected") {
            warnings.push(`Could not scan ${root}`);
            continue;
          }

          for (const p of result.value.projects) {
            const key = normalizeCwd(p.path);
            if (!seen.has(key)) {
              seen.set(key, p);
            }
            // Already seen from primary or earlier root — skip (first-writer wins)
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

// STALLED_THRESHOLD_MS imported from contracts

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
    if (p.gaps.length > 0) return true;
    // Missing or unparseable lastActivity is treated as "don't know" — not
    // stalled. Otherwise freshly-initialized projects and legacy configs
    // would appear permanently stalled, contradicting spec scenario 1.
    if (!p.lastActivity) return false;
    const last = Date.parse(p.lastActivity);
    if (!Number.isFinite(last)) return false;
    return now - last > STALLED_THRESHOLD_MS;
  });
}

const GAP_SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Sort projects by their highest-severity gap (worst first). */
export function selectProjectsByGapSeverity(state: PodiumState): ReadonlyArray<ScannedProject> {
  return selectTrackedProjects(state)
    .filter((p) => p.gaps.length > 0)
    .slice()
    .sort((a, b) => {
      const aMax = Math.min(...a.gaps.map((g) => GAP_SEVERITY_ORDER[g.severity] ?? 3));
      const bMax = Math.min(...b.gaps.map((g) => GAP_SEVERITY_ORDER[g.severity] ?? 3));
      if (aMax !== bMax) return aMax - bMax;
      return b.gaps.length - a.gaps.length;
    });
}
