import type { EnvironmentId } from "@t3tools/contracts";
import { useServerConfig } from "../rpc/serverState";

/**
 * Returns the environment ID of the primary (local) environment.
 *
 * The primary environment is the one connected via the main WebSocket
 * transport (desktop-managed, configured, or window-origin). Its identity
 * is surfaced through the server config descriptor.
 */
export function usePrimaryEnvironmentId(): EnvironmentId | null {
  const serverConfig = useServerConfig();
  return serverConfig?.environment.environmentId ?? null;
}
