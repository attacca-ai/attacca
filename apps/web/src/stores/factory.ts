/**
 * Factory store — Stand mode .factory/ state.
 *
 * Holds the latest FactoryDirectory read from the server per project, plus
 * load/error state. Components call `useFactoryStore.getState().loadFactory`
 * or subscribe via selectors.
 *
 * Loads are keyed by project path so multiple Stand mode tabs can coexist.
 */

import {
  type FactoryConfig,
  type FactoryDirectory,
  type SessionLog,
  type WorkQueue,
} from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "../wsRpcClient";

interface FactoryProjectEntry {
  readonly projectPath: string;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly directory: FactoryDirectory | null;
  readonly error: string | null;
  readonly loadedAt: number | null;
}

interface FactoryState {
  readonly activeProjectPath: string | null;
  readonly entries: Record<string, FactoryProjectEntry>;
  readonly setActiveProjectPath: (projectPath: string | null) => void;
  readonly loadFactory: (projectPath: string) => Promise<FactoryDirectory | null>;
  readonly initializeFactory: (
    projectPath: string,
    config: FactoryConfig,
  ) => Promise<FactoryDirectory | null>;
  readonly writeQueue: (projectPath: string, queue: WorkQueue) => Promise<void>;
  readonly writeSessionLog: (projectPath: string, session: SessionLog) => Promise<void>;
  readonly clear: (projectPath?: string) => void;
}

const emptyEntry = (projectPath: string): FactoryProjectEntry => ({
  projectPath,
  status: "idle",
  directory: null,
  error: null,
  loadedAt: null,
});

const setEntry = (
  entries: Record<string, FactoryProjectEntry>,
  projectPath: string,
  patch: Partial<FactoryProjectEntry>,
): Record<string, FactoryProjectEntry> => {
  const previous = entries[projectPath] ?? emptyEntry(projectPath);
  return {
    ...entries,
    [projectPath]: { ...previous, ...patch, projectPath },
  };
};

export const useFactoryStore = create<FactoryState>((set, get) => ({
  activeProjectPath: null,
  entries: {},

  setActiveProjectPath: (projectPath) => {
    set({ activeProjectPath: projectPath });
  },

  loadFactory: async (projectPath) => {
    set((state) => ({
      entries: setEntry(state.entries, projectPath, { status: "loading", error: null }),
    }));
    try {
      const directory = await getWsRpcClient().factory.read({ projectPath });
      set((state) => ({
        entries: setEntry(state.entries, projectPath, {
          status: "ready",
          directory,
          error: null,
          loadedAt: Date.now(),
        }),
      }));
      return directory;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to read .factory/";
      set((state) => ({
        entries: setEntry(state.entries, projectPath, {
          status: "error",
          error: message,
        }),
      }));
      return null;
    }
  },

  initializeFactory: async (projectPath, config) => {
    try {
      await getWsRpcClient().factory.initialize({ projectPath, config });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to initialize .factory/";
      set((state) => ({
        entries: setEntry(state.entries, projectPath, {
          status: "error",
          error: message,
        }),
      }));
      return null;
    }
    return get().loadFactory(projectPath);
  },

  writeQueue: async (projectPath, queue) => {
    await getWsRpcClient().factory.writeQueue({ projectPath, queue });
    await get().loadFactory(projectPath);
  },

  writeSessionLog: async (projectPath, session) => {
    await getWsRpcClient().factory.writeSessionLog({ projectPath, session });
    await get().loadFactory(projectPath);
  },

  clear: (projectPath) => {
    if (projectPath === undefined) {
      set({ entries: {}, activeProjectPath: null });
      return;
    }
    set((state) => {
      const { [projectPath]: _dropped, ...rest } = state.entries;
      return {
        entries: rest,
        activeProjectPath:
          state.activeProjectPath === projectPath ? null : state.activeProjectPath,
      };
    });
  },
}));

export const selectActiveFactoryEntry = (state: FactoryState): FactoryProjectEntry | null => {
  if (!state.activeProjectPath) return null;
  return state.entries[state.activeProjectPath] ?? null;
};

export const selectFactoryEntry = (projectPath: string | null | undefined) =>
  (state: FactoryState): FactoryProjectEntry | null => {
    if (!projectPath) return null;
    return state.entries[projectPath] ?? null;
  };
