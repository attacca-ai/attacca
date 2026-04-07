import type { LocalNativeApi } from "@t3tools/contracts";

import { __resetWsNativeApiForTests, createWsLocalNativeApi } from "./wsNativeApi";

let cachedApi: LocalNativeApi | undefined;

export function readNativeApi(): LocalNativeApi | undefined {
  if (typeof window === "undefined") return undefined;
  if (cachedApi) return cachedApi;

  if (window.nativeApi) {
    cachedApi = window.nativeApi;
    return cachedApi;
  }

  cachedApi = createWsLocalNativeApi();
  return cachedApi;
}

export function ensureNativeApi(): LocalNativeApi {
  const api = readNativeApi();
  if (!api) {
    throw new Error("Native API not found");
  }
  return api;
}

export async function __resetNativeApiForTests() {
  cachedApi = undefined;
  await __resetWsNativeApiForTests();
}
