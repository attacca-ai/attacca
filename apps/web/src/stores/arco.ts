/**
 * Arco store: lifecycle state for the singleton Arco thread (Phase 3).
 *
 * Message history and streaming state live in the main orchestration
 * store like any other thread — Arco is a normal server thread with
 * `scope: "arco"`. This store only owns the ensure-thread flow: resolving
 * the Podium root, creating the backing "Factory" project when missing,
 * dispatching the scoped thread.create, and persisting the resulting
 * thread id into the `arcoSessionId` client setting.
 */

import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

import { getWsRpcClient } from "../rpc/wsRpcClient";
import { normalizeCwd } from "./podium";

export const ARCO_THREAD_TITLE = "Arco";

/**
 * Title for the orchestration project that anchors the Arco thread. Its
 * workspaceRoot is the Podium root, so the provider session cwd resolves
 * to the factory root through the standard thread→project path.
 */
export const ARCO_PROJECT_TITLE = "Factory";

export interface ArcoEnsureDeps {
  /** Current `arcoSessionId` client setting (thread id or null). */
  readonly arcoSessionId: string | null;
  /** Whether that thread id currently resolves to a live thread in the store. */
  readonly threadExists: boolean;
  readonly activeEnvironmentId: EnvironmentId;
  readonly orchestrationProjects: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
    readonly cwd: string;
  }>;
  /** `podiumScanRootOverride` client setting; empty string means "ask the server". */
  readonly podiumScanRootOverride: string;
  readonly dispatchProjectCreate: (input: {
    readonly projectId: ProjectId;
    readonly title: string;
    readonly workspaceRoot: string;
  }) => Promise<void>;
  readonly dispatchThreadCreate: (input: {
    readonly threadId: ThreadId;
    readonly projectId: ProjectId;
  }) => Promise<void>;
  readonly updateSettings: (patch: { readonly arcoSessionId: string | null }) => void;
  readonly newProjectId: () => ProjectId;
  readonly newThreadId: () => ThreadId;
}

interface ArcoState {
  readonly status: "idle" | "creating" | "error";
  readonly error: string | null;
  /**
   * Thread id of an in-flight or just-dispatched creation. Guards against
   * dispatching a second thread while the created one is still being
   * projected into the orchestration store.
   */
  readonly pendingThreadId: string | null;
  readonly ensureArcoThread: (deps: ArcoEnsureDeps) => Promise<void>;
  readonly reset: () => void;
}

export const useArcoStore = create<ArcoState>((set, get) => ({
  status: "idle",
  error: null,
  pendingThreadId: null,

  ensureArcoThread: async (deps) => {
    const state = get();
    if (state.status === "creating") return;
    if (deps.arcoSessionId && deps.threadExists) {
      if (state.pendingThreadId || state.error) {
        set({ pendingThreadId: null, error: null, status: "idle" });
      }
      return;
    }
    // Already dispatched a create for this id; wait for the projection to land.
    if (deps.arcoSessionId !== null && deps.arcoSessionId === state.pendingThreadId) {
      return;
    }

    set({ status: "creating", error: null });
    try {
      const override = deps.podiumScanRootOverride.trim();
      const rootDir =
        override.length > 0
          ? override
          : (await getWsRpcClient().factory.getPodiumRoot()).rootDir;
      const normalizedRoot = normalizeCwd(rootDir);

      const existingProject = deps.orchestrationProjects.find(
        (project) =>
          project.environmentId === deps.activeEnvironmentId &&
          normalizeCwd(project.cwd) === normalizedRoot,
      );
      const projectId = existingProject?.id ?? deps.newProjectId();
      if (!existingProject) {
        await deps.dispatchProjectCreate({
          projectId,
          title: ARCO_PROJECT_TITLE,
          workspaceRoot: rootDir,
        });
      }

      const threadId = deps.newThreadId();
      await deps.dispatchThreadCreate({ threadId, projectId });
      deps.updateSettings({ arcoSessionId: threadId });
      set({ status: "idle", error: null, pendingThreadId: threadId });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Failed to start Arco";
      set({ status: "error", error: message });
    }
  },

  reset: () => set({ status: "idle", error: null, pendingThreadId: null }),
}));

export function selectArcoStatus(state: ArcoState): "idle" | "creating" | "error" {
  return state.status;
}

export function selectArcoError(state: ArcoState): string | null {
  return state.error;
}
