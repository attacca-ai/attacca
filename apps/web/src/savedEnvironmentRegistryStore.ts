import type { EnvironmentId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const SAVED_ENVIRONMENT_REGISTRY_STORAGE_KEY = "t3code:saved-environment-registry:v1";

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
