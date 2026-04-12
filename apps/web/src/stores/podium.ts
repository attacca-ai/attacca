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

import type { ScannedProject } from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "../wsRpcClient";

interface PodiumState {
  readonly rootDir: string;
  readonly rootSource: "env" | "default" | "override" | null;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly projects: ReadonlyArray<ScannedProject>;
  readonly error: string | null;
  readonly loadedAt: number | null;
  readonly selectedProjectPath: string | null;
  readonly scan: (rootDir?: string) => Promise<ReadonlyArray<ScannedProject>>;
  readonly refresh: () => Promise<ReadonlyArray<ScannedProject>>;
  readonly setSelectedProjectPath: (projectPath: string | null) => void;
}

export const usePodiumStore = create<PodiumState>((set, get) => ({
  rootDir: "",
  rootSource: null,
  status: "idle",
  projects: [],
  error: null,
  loadedAt: null,
  selectedProjectPath: null,

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
