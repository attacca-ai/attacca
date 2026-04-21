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
  type ForgeSkill,
  type SessionLog,
  type WorkQueue,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { getWsRpcClient } from "../rpc/wsRpcClient";

const FACTORY_STORE_STORAGE_KEY = "attacca:factory-store:v1";

interface FactoryProjectEntry {
  readonly projectPath: string;
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly directory: FactoryDirectory | null;
  readonly error: string | null;
  readonly loadedAt: number | null;
  readonly claudeMdGeneratedAt: string | null;
  readonly claudeMdError: string | null;
}

interface ForgeSkillsState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly skills: ReadonlyArray<ForgeSkill>;
  readonly error: string | null;
  readonly loadedAt: number | null;
  readonly source: string | null;
}

interface ActiveSession {
  readonly sessionId: string;
  readonly dev: string;
  readonly startedAt: string;
  readonly notes: string;
}

interface FactoryState {
  readonly activeProjectPath: string | null;
  readonly entries: Record<string, FactoryProjectEntry>;
  readonly forgeSkills: ForgeSkillsState;
  readonly activeSessionsByProjectPath: Record<string, ActiveSession>;
  readonly setActiveProjectPath: (projectPath: string | null) => void;
  readonly loadFactory: (projectPath: string) => Promise<FactoryDirectory | null>;
  readonly initializeFactory: (
    projectPath: string,
    config: FactoryConfig,
    allowedRoots?: ReadonlyArray<string>,
  ) => Promise<FactoryDirectory | null>;
  readonly writeQueue: (projectPath: string, queue: WorkQueue) => Promise<void>;
  readonly writeSessionLog: (projectPath: string, session: SessionLog) => Promise<void>;
  readonly loadForgeSkills: () => Promise<ReadonlyArray<ForgeSkill>>;
  readonly regenerateClaudeMd: (projectPath: string) => Promise<string | null>;
  readonly startSession: (projectPath: string, dev: string) => ActiveSession;
  readonly updateActiveSessionNotes: (projectPath: string, notes: string) => void;
  readonly endSession: (projectPath: string) => Promise<SessionLog | null>;
  readonly clear: (projectPath?: string) => void;
}

const initialForgeSkillsState: ForgeSkillsState = {
  status: "idle",
  skills: [],
  error: null,
  loadedAt: null,
  source: null,
};

const emptyEntry = (projectPath: string): FactoryProjectEntry => ({
  projectPath,
  status: "idle",
  directory: null,
  error: null,
  loadedAt: null,
  claudeMdGeneratedAt: null,
  claudeMdError: null,
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

function generateSessionId(): string {
  const iso = new Date().toISOString().replace(/:/g, "-").replace(/\./g, "-");
  return `session-${iso}`;
}

export const useFactoryStore = create<FactoryState>()(
  persist(
    (set, get) => ({
      activeProjectPath: null,
      entries: {},
      forgeSkills: initialForgeSkillsState,
      activeSessionsByProjectPath: {},

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

      initializeFactory: async (projectPath, config, allowedRoots) => {
        try {
          await getWsRpcClient().factory.initialize({ projectPath, config, allowedRoots });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to initialize .factory/";
          set((state) => ({
            entries: setEntry(state.entries, projectPath, {
              status: "error",
              error: message,
            }),
          }));
          // Re-throw so callers can surface the failure (e.g. via a toast)
          // instead of seeing a silent null.
          throw cause instanceof Error ? cause : new Error(message);
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

      regenerateClaudeMd: async (projectPath) => {
        try {
          const result = await getWsRpcClient().factory.regenerateClaudeMd({ projectPath });
          set((state) => ({
            entries: setEntry(state.entries, projectPath, {
              claudeMdGeneratedAt: result.generatedAt,
              claudeMdError: null,
            }),
          }));
          return result.content;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to regenerate CLAUDE.md";
          set((state) => ({
            entries: setEntry(state.entries, projectPath, {
              claudeMdError: message,
            }),
          }));
          return null;
        }
      },

      loadForgeSkills: async () => {
        set((state) => ({
          forgeSkills: { ...state.forgeSkills, status: "loading", error: null },
        }));
        try {
          const result = await getWsRpcClient().factory.listForgeSkills();
          set({
            forgeSkills: {
              status: "ready",
              skills: result.skills,
              source: result.source,
              error: null,
              loadedAt: Date.now(),
            },
          });
          return result.skills;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to load Forge skills";
          set((state) => ({
            forgeSkills: { ...state.forgeSkills, status: "error", error: message },
          }));
          return [];
        }
      },

      startSession: (projectPath, dev) => {
        const session: ActiveSession = {
          sessionId: generateSessionId(),
          dev,
          startedAt: new Date().toISOString(),
          notes: "",
        };
        set((state) => ({
          activeSessionsByProjectPath: {
            ...state.activeSessionsByProjectPath,
            [projectPath]: session,
          },
        }));
        return session;
      },

      updateActiveSessionNotes: (projectPath, notes) => {
        set((state) => {
          const existing = state.activeSessionsByProjectPath[projectPath];
          if (!existing) return state;
          return {
            activeSessionsByProjectPath: {
              ...state.activeSessionsByProjectPath,
              [projectPath]: { ...existing, notes },
            },
          };
        });
      },

      endSession: async (projectPath) => {
        const active = get().activeSessionsByProjectPath[projectPath];
        if (!active) return null;

        const endedAt = new Date().toISOString();
        const startedMs = Date.parse(active.startedAt);
        const endedMs = Date.parse(endedAt);
        const durationMinutes =
          Number.isFinite(startedMs) && Number.isFinite(endedMs)
            ? Math.max(0, Math.round((endedMs - startedMs) / 60_000))
            : 0;

        const session: SessionLog = {
          session_id: active.sessionId,
          dev: active.dev,
          started: active.startedAt,
          ended: endedAt,
          duration_minutes: durationMinutes,
          ...(active.notes.trim().length > 0 ? { notes: active.notes.trim() } : {}),
        };

        try {
          await getWsRpcClient().factory.writeSessionLog({ projectPath, session });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "Failed to write session log";
          set((state) => ({
            entries: setEntry(state.entries, projectPath, { error: message, status: "error" }),
          }));
          return null;
        }

        set((state) => {
          const { [projectPath]: _dropped, ...rest } = state.activeSessionsByProjectPath;
          return { activeSessionsByProjectPath: rest };
        });
        await get().loadFactory(projectPath);
        return session;
      },

      clear: (projectPath) => {
        if (projectPath === undefined) {
          set({
            entries: {},
            activeProjectPath: null,
            forgeSkills: initialForgeSkillsState,
            activeSessionsByProjectPath: {},
          });
          return;
        }
        set((state) => {
          const { [projectPath]: _droppedEntry, ...restEntries } = state.entries;
          const { [projectPath]: _droppedSession, ...restSessions } =
            state.activeSessionsByProjectPath;
          return {
            entries: restEntries,
            activeSessionsByProjectPath: restSessions,
            activeProjectPath:
              state.activeProjectPath === projectPath ? null : state.activeProjectPath,
          };
        });
      },
    }),
    {
      name: FACTORY_STORE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist active sessions — entries and forge skills are reloaded
      // from the server on mount, so caching them in localStorage would just
      // show stale data on reload.
      partialize: (state) => ({
        activeSessionsByProjectPath: state.activeSessionsByProjectPath,
      }),
    },
  ),
);

export const selectActiveFactoryEntry = (state: FactoryState): FactoryProjectEntry | null => {
  if (!state.activeProjectPath) return null;
  return state.entries[state.activeProjectPath] ?? null;
};

export const selectFactoryEntry =
  (projectPath: string | null | undefined) =>
  (state: FactoryState): FactoryProjectEntry | null => {
    if (!projectPath) return null;
    return state.entries[projectPath] ?? null;
  };
