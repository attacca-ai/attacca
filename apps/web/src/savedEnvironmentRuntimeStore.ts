import type {
  AuthSessionRole,
  EnvironmentId,
  ExecutionEnvironmentDescriptor,
  ServerConfig,
} from "@t3tools/contracts";
import { create } from "zustand";

export type SavedEnvironmentConnectionState = "connecting" | "connected" | "disconnected" | "error";

export type SavedEnvironmentAuthState = "authenticated" | "requires-auth" | "unknown";

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
