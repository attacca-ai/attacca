import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createOrchestrationRegistrySyncController,
  createSnapshotBootstrapController,
} from "./environmentManager";
import type { WsRpcClient, WsRpcClientEntry } from "./wsRpcClient";

function createTestClient(options?: {
  readonly getSnapshot?: () => Promise<{ readonly snapshotSequence: number }>;
}) {
  const lifecycleListeners = new Set<(event: any) => void>();
  const configListeners = new Set<(event: any) => void>();
  const terminalListeners = new Set<(event: any) => void>();

  const getSnapshot = vi.fn(
    options?.getSnapshot ??
      (async () =>
        ({
          snapshotSequence: 1,
          projects: [],
          threads: [],
        }) as any),
  );

  const client = {
    dispose: vi.fn(async () => undefined),
    reconnect: vi.fn(async () => undefined),
    server: {
      getConfig: vi.fn(async () => ({
        environment: {
          environmentId: EnvironmentId.makeUnsafe("env-1"),
        },
      })),
      subscribeConfig: (listener: (event: any) => void) => {
        configListeners.add(listener);
        return () => configListeners.delete(listener);
      },
      subscribeLifecycle: (listener: (event: any) => void) => {
        lifecycleListeners.add(listener);
        return () => lifecycleListeners.delete(listener);
      },
      subscribeAuthAccess: () => () => undefined,
      refreshProviders: vi.fn(async () => undefined),
      upsertKeybinding: vi.fn(async () => undefined),
      getSettings: vi.fn(async () => undefined),
      updateSettings: vi.fn(async () => undefined),
    },
    orchestration: {
      getSnapshot,
      dispatchCommand: vi.fn(async () => undefined),
      getTurnDiff: vi.fn(async () => undefined),
      getFullThreadDiff: vi.fn(async () => undefined),
      replayEvents: vi.fn(async () => []),
      onDomainEvent: () => () => undefined,
    },
    terminal: {
      open: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      onEvent: (listener: (event: any) => void) => {
        terminalListeners.add(listener);
        return () => terminalListeners.delete(listener);
      },
    },
    projects: {
      searchEntries: vi.fn(async () => []),
      writeFile: vi.fn(async () => undefined),
    },
    shell: {
      openInEditor: vi.fn(async () => undefined),
    },
    git: {
      pull: vi.fn(async () => undefined),
      refreshStatus: vi.fn(async () => undefined),
      onStatus: vi.fn(() => () => undefined),
      runStackedAction: vi.fn(async () => ({}) as any),
      listBranches: vi.fn(async () => []),
      createWorktree: vi.fn(async () => undefined),
      removeWorktree: vi.fn(async () => undefined),
      createBranch: vi.fn(async () => undefined),
      checkout: vi.fn(async () => undefined),
      init: vi.fn(async () => undefined),
      resolvePullRequest: vi.fn(async () => undefined),
      preparePullRequestThread: vi.fn(async () => undefined),
    },
  } as unknown as WsRpcClient;

  return {
    client,
    getSnapshot,
    emitWelcome: (environmentId: EnvironmentId) => {
      for (const listener of lifecycleListeners) {
        listener({
          type: "welcome",
          payload: {
            environment: {
              environmentId,
            },
          },
        });
      }
    },
  };
}

describe("createSnapshotBootstrapController", () => {
  it("deduplicates concurrent snapshot recovery requests", async () => {
    const environmentId = EnvironmentId.makeUnsafe("env-1");
    let boundEnvironmentId: EnvironmentId | null = environmentId;
    let bootstrapped = false;
    let resolveRecovery: (() => void) | undefined;
    const runSnapshotRecovery = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRecovery = () => {
            bootstrapped = true;
            resolve();
          };
        }),
    );

    const controller = createSnapshotBootstrapController({
      isBootstrapped: () => bootstrapped,
      getBoundEnvironmentId: () => boundEnvironmentId,
      runSnapshotRecovery,
    });

    const first = controller.ensureSnapshotRecovery("bootstrap", environmentId);
    const second = controller.ensureSnapshotRecovery("bootstrap", environmentId);

    expect(runSnapshotRecovery).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    resolveRecovery?.();
    await Promise.all([first, second]);
  });

  it("skips recovery after the bound environment has already been bootstrapped", async () => {
    const firstEnvironmentId = EnvironmentId.makeUnsafe("env-1");
    const secondEnvironmentId = EnvironmentId.makeUnsafe("env-2");
    let boundEnvironmentId: EnvironmentId | null = firstEnvironmentId;
    let bootstrapped = true;
    const runSnapshotRecovery = vi.fn(async () => undefined);

    const controller = createSnapshotBootstrapController({
      isBootstrapped: () => bootstrapped,
      getBoundEnvironmentId: () => boundEnvironmentId,
      runSnapshotRecovery,
    });

    await controller.ensureSnapshotRecovery("bootstrap", firstEnvironmentId);

    expect(runSnapshotRecovery).not.toHaveBeenCalled();

    boundEnvironmentId = secondEnvironmentId;
    bootstrapped = false;
    await controller.ensureSnapshotRecovery("bootstrap", secondEnvironmentId);

    expect(runSnapshotRecovery).toHaveBeenCalledTimes(1);
    expect(runSnapshotRecovery).toHaveBeenCalledWith("bootstrap", secondEnvironmentId);
  });
});

describe("createOrchestrationRegistrySyncController", () => {
  it("bootstraps a snapshot when an entry binds an environment after connect", async () => {
    const environmentId = EnvironmentId.makeUnsafe("env-1");
    const { client, getSnapshot, emitWelcome } = createTestClient();
    const baseEntry: WsRpcClientEntry = {
      key: "client-1",
      knownEnvironment: {
        id: "client-1",
        label: "Remote env",
        source: "manual",
        target: {
          type: "ws",
          wsUrl: "ws://example.test/ws",
        },
      },
      client,
      environmentId: null,
    };
    let entries: ReadonlyArray<WsRpcClientEntry> = [baseEntry];
    const listeners = new Set<() => void>();
    const syncSnapshot = vi.fn();

    const controller = createOrchestrationRegistrySyncController(
      {
        applyEventBatch: vi.fn(),
        syncSnapshot,
        applyTerminalEvent: vi.fn(),
      },
      {
        listEntries: () => entries,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        bindEnvironment: (_entryKey, nextEnvironmentId) => {
          entries = [
            {
              ...baseEntry,
              environmentId: nextEnvironmentId,
              knownEnvironment: {
                ...baseEntry.knownEnvironment,
                environmentId: nextEnvironmentId,
              },
            },
          ];
        },
      },
    );

    emitWelcome(environmentId);
    await Promise.resolve();
    await Promise.resolve();

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(syncSnapshot).toHaveBeenCalledTimes(1);
    expect(syncSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotSequence: 1 }),
      environmentId,
    );

    controller.dispose();
  });
});
