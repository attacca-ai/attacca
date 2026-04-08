import type {
  AuthSessionRole,
  EnvironmentId,
  ExecutionEnvironmentDescriptor,
  ServerConfig,
} from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY = "t3code:saved-environment-registry:v1";

/**
 * State for user-managed remote environments.
 *
 * This module intentionally colocates:
 * - the persisted registry of environments the user has registered
 * - the ephemeral runtime state for those environments
 *
 * The stores stay separate because they have different lifecycles. Persisted
 * configuration should be stable, while runtime connection/auth state is noisy
 * and should never survive a reload.
 */
export interface SavedEnvironmentRecord {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly wsBaseUrl: string;
  readonly httpBaseUrl: string;
  readonly bearerToken: string;
  readonly createdAt: string;
  readonly lastConnectedAt: string | null;
}

interface PersistedSavedEnvironmentRegistryState {
  readonly byId?: Record<string, SavedEnvironmentRecord>;
}

/**
 * Durable user intent: which remote environments should be materialized by the
 * environment manager on app startup.
 */
interface SavedEnvironmentRegistryState {
  readonly byId: Record<string, SavedEnvironmentRecord>;
  readonly upsert: (record: SavedEnvironmentRecord) => void;
  readonly remove: (environmentId: EnvironmentId) => void;
  readonly markConnected: (environmentId: EnvironmentId, connectedAt: string) => void;
  readonly reset: () => void;
}

function createSavedEnvironmentRegistryStorage() {
  return resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined);
}

function migratePersistedSavedEnvironmentRegistryState(
  persistedState: unknown,
  version: number,
): Pick<SavedEnvironmentRegistryState, "byId"> {
  if (version === 1 && persistedState && typeof persistedState === "object") {
    const candidate = persistedState as PersistedSavedEnvironmentRegistryState;
    return {
      byId: candidate.byId ?? {},
    };
  }

  return {
    byId: {},
  };
}

export const useSavedEnvironmentRegistryStore = create<SavedEnvironmentRegistryState>()(
  persist(
    (set) => ({
      byId: {},
      upsert: (record) =>
        set((state) => ({
          byId: {
            ...state.byId,
            [record.environmentId]: record,
          },
        })),
      remove: (environmentId) =>
        set((state) => {
          const { [environmentId]: _removed, ...remaining } = state.byId;
          return {
            byId: remaining,
          };
        }),
      markConnected: (environmentId, connectedAt) =>
        set((state) => {
          const existing = state.byId[environmentId];
          if (!existing) {
            return state;
          }
          return {
            byId: {
              ...state.byId,
              [environmentId]: {
                ...existing,
                lastConnectedAt: connectedAt,
              },
            },
          };
        }),
      reset: () => ({
        byId: {},
      }),
    }),
    {
      name: SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(createSavedEnvironmentRegistryStorage),
      migrate: migratePersistedSavedEnvironmentRegistryState,
    },
  ),
);

export function listSavedEnvironmentRecords(): ReadonlyArray<SavedEnvironmentRecord> {
  return Object.values(useSavedEnvironmentRegistryStore.getState().byId).toSorted((left, right) =>
    left.label.localeCompare(right.label),
  );
}

export function getSavedEnvironmentRecord(
  environmentId: EnvironmentId,
): SavedEnvironmentRecord | null {
  return useSavedEnvironmentRegistryStore.getState().byId[environmentId] ?? null;
}

export function resetSavedEnvironmentRegistryStoreForTests() {
  useSavedEnvironmentRegistryStore.getState().reset();
}

export type SavedEnvironmentConnectionState = "connecting" | "connected" | "disconnected" | "error";

export type SavedEnvironmentAuthState = "authenticated" | "requires-auth" | "unknown";

/**
 * Live status/diagnostics for a materialized remote environment connection.
 *
 * This is runtime visibility for the UI and can always be rebuilt by the
 * environment manager from active websocket/auth state.
 */
export interface SavedEnvironmentRuntimeState {
  readonly connectionState: SavedEnvironmentConnectionState;
  readonly authState: SavedEnvironmentAuthState;
  readonly lastError: string | null;
  readonly lastErrorAt: string | null;
  readonly role: AuthSessionRole | null;
  readonly descriptor: ExecutionEnvironmentDescriptor | null;
  readonly serverConfig: ServerConfig | null;
  readonly connectedAt: string | null;
  readonly disconnectedAt: string | null;
}

/**
 * Ephemeral runtime store keyed by environment id.
 *
 * The manager ensures entries exist before patching them so UI selectors can
 * subscribe safely even while a connection is still bootstrapping.
 */
interface SavedEnvironmentRuntimeStoreState {
  readonly byId: Record<string, SavedEnvironmentRuntimeState>;
  readonly ensure: (environmentId: EnvironmentId) => void;
  readonly patch: (
    environmentId: EnvironmentId,
    patch: Partial<SavedEnvironmentRuntimeState>,
  ) => void;
  readonly clear: (environmentId: EnvironmentId) => void;
  readonly reset: () => void;
}

const DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE: SavedEnvironmentRuntimeState = Object.freeze({
  connectionState: "disconnected",
  authState: "unknown",
  lastError: null,
  lastErrorAt: null,
  role: null,
  descriptor: null,
  serverConfig: null,
  connectedAt: null,
  disconnectedAt: null,
});

function createDefaultSavedEnvironmentRuntimeState(): SavedEnvironmentRuntimeState {
  return {
    ...DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE,
  };
}

export const useSavedEnvironmentRuntimeStore = create<SavedEnvironmentRuntimeStoreState>()(
  (set) => ({
    byId: {},
    ensure: (environmentId) =>
      set((state) => {
        if (state.byId[environmentId]) {
          return state;
        }
        return {
          byId: {
            ...state.byId,
            [environmentId]: createDefaultSavedEnvironmentRuntimeState(),
          },
        };
      }),
    patch: (environmentId, patch) =>
      set((state) => ({
        byId: {
          ...state.byId,
          [environmentId]: {
            ...(state.byId[environmentId] ?? createDefaultSavedEnvironmentRuntimeState()),
            ...patch,
          },
        },
      })),
    clear: (environmentId) =>
      set((state) => {
        const { [environmentId]: _removed, ...remaining } = state.byId;
        return {
          byId: remaining,
        };
      }),
    reset: () => ({
      byId: {},
    }),
  }),
);

export function getSavedEnvironmentRuntimeState(
  environmentId: EnvironmentId,
): SavedEnvironmentRuntimeState {
  return (
    useSavedEnvironmentRuntimeStore.getState().byId[environmentId] ??
    DEFAULT_SAVED_ENVIRONMENT_RUNTIME_STATE
  );
}

export function resetSavedEnvironmentRuntimeStoreForTests() {
  useSavedEnvironmentRuntimeStore.getState().reset();
}
