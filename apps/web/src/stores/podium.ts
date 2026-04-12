/**
 * Podium store — cross-project factory view.
 *
 * Holds the latest scan result keyed by root directory. Kept separate from
 * the factory store so the two concerns don't contaminate each other: factory
 * store is per-project state, podium store is cross-project discovery.
 *
 * The root directory comes from the server environment (env var
 * ATTACCA_PODIUM_ROOT) with a hardcoded fallback. v0 exposes no settings UI
 * for the root — that's Phase 2.5.
 */

import type { ScannedProject } from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "../wsRpcClient";

/**
 * Default scan root when ATTACCA_PODIUM_ROOT is unset. Absolute Windows
 * path matching the user's projects directory — future work will read
 * this from server settings.
 */
export const DEFAULT_PODIUM_ROOT = "C:/Users/jhon1/projects";

interface PodiumState {
  readonly rootDir: string;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly projects: ReadonlyArray<ScannedProject>;
  readonly error: string | null;
  readonly loadedAt: number | null;
  readonly selectedProjectPath: string | null;
  readonly scan: (rootDir?: string) => Promise<ReadonlyArray<ScannedProject>>;
  readonly refresh: () => Promise<ReadonlyArray<ScannedProject>>;
  readonly setSelectedProjectPath: (projectPath: string | null) => void;
  readonly setRootDir: (rootDir: string) => void;
}

export const usePodiumStore = create<PodiumState>((set, get) => ({
  rootDir: DEFAULT_PODIUM_ROOT,
  status: "idle",
  projects: [],
  error: null,
  loadedAt: null,
  selectedProjectPath: null,

  scan: async (overrideRoot) => {
    const rootDir = overrideRoot ?? get().rootDir;
    set({ rootDir, status: "loading", error: null });
    try {
      const result = await getWsRpcClient().factory.scanProjects({ rootDir });
      set({
        rootDir: result.rootDir,
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

  refresh: async () => {
    return get().scan(get().rootDir);
  },

  setSelectedProjectPath: (projectPath) => {
    set({ selectedProjectPath: projectPath });
  },

  setRootDir: (rootDir) => {
    set({ rootDir });
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
    if (!p.lastActivity) return true;
    const last = Date.parse(p.lastActivity);
    if (!Number.isFinite(last)) return true;
    return now - last > STALLED_THRESHOLD_MS;
  });
}
