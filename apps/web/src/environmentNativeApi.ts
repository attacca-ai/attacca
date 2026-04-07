import type { EnvironmentId, EnvironmentNativeApi } from "@t3tools/contracts";

import { getWsRpcClientForEnvironment } from "./wsRpcClient";
import { createWsEnvironmentNativeApiForRpcClient } from "./wsNativeApi";

export function readEnvironmentNativeApi(
  environmentId: EnvironmentId | null | undefined,
): EnvironmentNativeApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (!environmentId) {
    return undefined;
  }

  return createWsEnvironmentNativeApiForRpcClient(getWsRpcClientForEnvironment(environmentId));
}

export function ensureEnvironmentNativeApi(environmentId: EnvironmentId): EnvironmentNativeApi {
  const api = readEnvironmentNativeApi(environmentId);
  if (!api) {
    throw new Error(`Native API not found for environment ${environmentId}`);
  }
  return api;
}
