/// <reference types="vite/client" />

import type { DesktopBridge, LocalNativeApi } from "@t3tools/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    nativeApi?: LocalNativeApi;
    desktopBridge?: DesktopBridge;
  }
}
