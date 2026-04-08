import { createKnownEnvironmentFromWsUrl } from "@t3tools/client-runtime";
import type { AuthSessionRole, EnvironmentId, ServerConfig } from "@t3tools/contracts";

import {
  fetchRemoteSessionState,
  resolveRemotePairingTarget,
  resolveRemoteWebSocketConnectionUrl,
  bootstrapRemoteBearerSession,
} from "./remoteEnvironmentAuth";
import {
  getSavedEnvironmentRecord,
  listSavedEnvironmentRecords,
  type SavedEnvironmentRecord,
  useSavedEnvironmentRegistryStore,
} from "./savedEnvironmentRegistryStore";
import { useSavedEnvironmentRuntimeStore } from "./savedEnvironmentRuntimeStore";
import {
  createWsRpcClient,
  readWsRpcClientEntryForEnvironment,
  registerWsRpcClientEntry,
  removeWsRpcClientEntry,
} from "./wsRpcClient";
import { WsTransport } from "./wsTransport";

type ActiveSavedEnvironmentConnection = {
  readonly entryKey: string;
  readonly client: ReturnType<typeof createWsRpcClient>;
  readonly cleanup: () => void;
  readonly refreshMetadata: () => Promise<void>;
};

const activeSavedEnvironmentConnections = new Map<
  EnvironmentId,
  ActiveSavedEnvironmentConnection
>();

function isoNow(): string {
  return new Date().toISOString();
}

function setRuntimeConnecting(environmentId: EnvironmentId) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "connecting",
    lastError: null,
    lastErrorAt: null,
  });
}

function setRuntimeConnected(environmentId: EnvironmentId) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "connected",
    authState: "authenticated",
    connectedAt: isoNow(),
    disconnectedAt: null,
    lastError: null,
    lastErrorAt: null,
  });
  useSavedEnvironmentRegistryStore.getState().markConnected(environmentId, isoNow());
}

function setRuntimeDisconnected(environmentId: EnvironmentId, reason?: string | null) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "disconnected",
    disconnectedAt: isoNow(),
    ...(reason && reason.trim().length > 0
      ? {
          lastError: reason,
          lastErrorAt: isoNow(),
        }
      : {}),
  });
}

function setRuntimeError(environmentId: EnvironmentId, error: unknown) {
  useSavedEnvironmentRuntimeStore.getState().patch(environmentId, {
    connectionState: "error",
    lastError: error instanceof Error ? error.message : String(error),
    lastErrorAt: isoNow(),
  });
}

async function refreshSavedEnvironmentMetadata(
  record: SavedEnvironmentRecord,
  client: ReturnType<typeof createWsRpcClient>,
  roleHint?: AuthSessionRole | null,
  configHint?: ServerConfig | null,
): Promise<void> {
  const [serverConfig, sessionState] = await Promise.all([
    configHint ? Promise.resolve(configHint) : client.server.getConfig(),
    fetchRemoteSessionState({
      httpBaseUrl: record.httpBaseUrl,
      bearerToken: record.bearerToken,
    }),
  ]);

  useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
    authState: sessionState.authenticated ? "authenticated" : "requires-auth",
    descriptor: serverConfig.environment,
    serverConfig,
    role: sessionState.authenticated ? (sessionState.role ?? roleHint ?? null) : null,
  });
}

function createSavedEnvironmentClient(record: SavedEnvironmentRecord) {
  const runtimeStore = useSavedEnvironmentRuntimeStore.getState();
  runtimeStore.ensure(record.environmentId);

  return createWsRpcClient(
    new WsTransport(
      () =>
        resolveRemoteWebSocketConnectionUrl({
          wsBaseUrl: record.wsBaseUrl,
          httpBaseUrl: record.httpBaseUrl,
          bearerToken: record.bearerToken,
        }),
      {
        onAttempt: () => {
          setRuntimeConnecting(record.environmentId);
        },
        onOpen: () => {
          setRuntimeConnected(record.environmentId);
        },
        onError: (message) => {
          useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
            connectionState: "error",
            lastError: message,
            lastErrorAt: isoNow(),
          });
        },
        onClose: (details) => {
          setRuntimeDisconnected(record.environmentId, details.reason);
        },
      },
    ),
  );
}

export async function ensureSavedEnvironmentConnection(
  record: SavedEnvironmentRecord,
  options?: {
    readonly client?: ReturnType<typeof createWsRpcClient>;
    readonly role?: AuthSessionRole | null;
    readonly serverConfig?: ServerConfig | null;
  },
): Promise<void> {
  if (activeSavedEnvironmentConnections.has(record.environmentId)) {
    return;
  }

  const existingEntry = readWsRpcClientEntryForEnvironment(record.environmentId);
  if (existingEntry && existingEntry.key !== record.environmentId) {
    useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
      connectionState: "error",
      lastError: "This environment is already connected elsewhere in the app.",
      lastErrorAt: isoNow(),
      authState: "unknown",
    });
    return;
  }

  const client = options?.client ?? createSavedEnvironmentClient(record);
  const knownEnvironment = createKnownEnvironmentFromWsUrl({
    id: record.environmentId,
    label: record.label,
    source: "manual",
    wsUrl: record.wsBaseUrl,
  });

  let removedOnFailure = false;
  try {
    const entry = registerWsRpcClientEntry({
      key: record.environmentId,
      knownEnvironment: {
        ...knownEnvironment,
        environmentId: record.environmentId,
      },
      client,
      environmentId: record.environmentId,
    });

    let nextRoleHint = options?.role ?? null;
    let nextServerConfigHint = options?.serverConfig ?? null;
    const refreshMetadata = async () => {
      const roleHint = nextRoleHint;
      const serverConfigHint = nextServerConfigHint;
      nextRoleHint = null;
      nextServerConfigHint = null;
      await refreshSavedEnvironmentMetadata(record, client, roleHint, serverConfigHint);
    };

    const unsubscribeConfig = client.server.subscribeConfig((event) => {
      if (event.type !== "snapshot") {
        return;
      }
      useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
        descriptor: event.config.environment,
        serverConfig: event.config,
      });
    });

    const unsubscribeLifecycle = client.server.subscribeLifecycle((event) => {
      if (event.type !== "welcome") {
        return;
      }
      useSavedEnvironmentRuntimeStore.getState().patch(record.environmentId, {
        descriptor: event.payload.environment,
      });
    });

    activeSavedEnvironmentConnections.set(record.environmentId, {
      entryKey: entry.key,
      client,
      cleanup: () => {
        unsubscribeConfig();
        unsubscribeLifecycle();
      },
      refreshMetadata,
    });

    await refreshMetadata();
  } catch (error) {
    setRuntimeError(record.environmentId, error);
    if (activeSavedEnvironmentConnections.has(record.environmentId)) {
      const active = activeSavedEnvironmentConnections.get(record.environmentId);
      activeSavedEnvironmentConnections.delete(record.environmentId);
      active?.cleanup();
    } else {
      await client.dispose().catch(() => undefined);
    }

    if (readWsRpcClientEntryForEnvironment(record.environmentId)?.key === record.environmentId) {
      removedOnFailure = await removeWsRpcClientEntry(record.environmentId);
    }

    if (!removedOnFailure) {
      await removeWsRpcClientEntry(record.environmentId).catch(() => false);
    }
    throw error;
  }
}

export async function syncSavedEnvironmentConnections(
  records: ReadonlyArray<SavedEnvironmentRecord>,
): Promise<void> {
  const expectedEnvironmentIds = new Set(records.map((record) => record.environmentId));
  const staleEnvironmentIds = [...activeSavedEnvironmentConnections.keys()].filter(
    (environmentId) => !expectedEnvironmentIds.has(environmentId),
  );

  await Promise.all(
    staleEnvironmentIds.map((environmentId) => disconnectSavedEnvironment(environmentId)),
  );
  await Promise.all(
    records.map((record) => ensureSavedEnvironmentConnection(record).catch(() => undefined)),
  );
}

export async function disconnectSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  const active = activeSavedEnvironmentConnections.get(environmentId);
  activeSavedEnvironmentConnections.delete(environmentId);
  active?.cleanup();
  useSavedEnvironmentRuntimeStore.getState().clear(environmentId);
  await removeWsRpcClientEntry(environmentId).catch(() => false);
}

export async function reconnectSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  const record = getSavedEnvironmentRecord(environmentId);
  if (!record) {
    throw new Error("Saved environment not found.");
  }

  const active = activeSavedEnvironmentConnections.get(environmentId);
  if (!active) {
    await ensureSavedEnvironmentConnection(record);
    return;
  }

  setRuntimeConnecting(environmentId);
  try {
    await active.client.reconnect();
    await active.refreshMetadata();
  } catch (error) {
    setRuntimeError(environmentId, error);
    throw error;
  }
}

export async function removeSavedEnvironment(environmentId: EnvironmentId): Promise<void> {
  useSavedEnvironmentRegistryStore.getState().remove(environmentId);
  await disconnectSavedEnvironment(environmentId);
}

export async function addSavedEnvironment(input: {
  readonly label: string;
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
}): Promise<SavedEnvironmentRecord> {
  const resolvedTarget = resolveRemotePairingTarget({
    ...(input.pairingUrl !== undefined ? { pairingUrl: input.pairingUrl } : {}),
    ...(input.host !== undefined ? { host: input.host } : {}),
    ...(input.pairingCode !== undefined ? { pairingCode: input.pairingCode } : {}),
  });
  const bearerSession = await bootstrapRemoteBearerSession({
    httpBaseUrl: resolvedTarget.httpBaseUrl,
    credential: resolvedTarget.credential,
  });
  const temporaryClient = createWsRpcClient(
    new WsTransport(() =>
      resolveRemoteWebSocketConnectionUrl({
        wsBaseUrl: resolvedTarget.wsBaseUrl,
        httpBaseUrl: resolvedTarget.httpBaseUrl,
        bearerToken: bearerSession.sessionToken,
      }),
    ),
  );

  try {
    const serverConfig = await temporaryClient.server.getConfig();
    const environmentId = serverConfig.environment.environmentId;

    if (readWsRpcClientEntryForEnvironment(environmentId)) {
      throw new Error("This environment is already connected.");
    }

    const record: SavedEnvironmentRecord = {
      environmentId,
      label: input.label.trim() || serverConfig.environment.label,
      wsBaseUrl: resolvedTarget.wsBaseUrl,
      httpBaseUrl: resolvedTarget.httpBaseUrl,
      bearerToken: bearerSession.sessionToken,
      createdAt: isoNow(),
      lastConnectedAt: isoNow(),
    };

    await temporaryClient.dispose().catch(() => undefined);
    await ensureSavedEnvironmentConnection(record, {
      client: createSavedEnvironmentClient(record),
      role: bearerSession.role,
      serverConfig,
    });
    useSavedEnvironmentRegistryStore.getState().upsert(record);
    return record;
  } catch (error) {
    await temporaryClient.dispose().catch(() => undefined);
    throw error;
  }
}

export function listActiveSavedEnvironmentIds(): ReadonlyArray<EnvironmentId> {
  return [...activeSavedEnvironmentConnections.keys()];
}

export function syncSavedEnvironmentConnectionsFromStore(): Promise<void> {
  return syncSavedEnvironmentConnections(listSavedEnvironmentRecords());
}

export async function resetSavedEnvironmentConnectionsForTests(): Promise<void> {
  await Promise.all(
    [...activeSavedEnvironmentConnections.keys()].map((environmentId) =>
      disconnectSavedEnvironment(environmentId),
    ),
  );
}
