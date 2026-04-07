import type { EnvironmentId, EnvironmentApi } from "@t3tools/contracts";

import { getWsRpcClientForEnvironment } from "./wsRpcClient";
import { createWsEnvironmentApiForRpcClient } from "./wsApi";

export function readEnvironmentApi(
  environmentId: EnvironmentId | null | undefined,
): EnvironmentApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  return createWsEnvironmentApiForRpcClient(getWsRpcClientForEnvironment(environmentId));
}

export function ensureEnvironmentApi(environmentId: EnvironmentId): EnvironmentApi {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw new Error(`Environment API not found for environment ${environmentId}`);
  }
  return api;
}
